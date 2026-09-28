package com.margelo.nitro.nitroinput

import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UIManager
import com.facebook.react.bridge.UIManagerListener
import com.facebook.react.common.annotations.UnstableReactNativeAPI
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.common.UIManagerType
import java.util.Collections
import java.util.IdentityHashMap
import java.util.concurrent.ConcurrentLinkedQueue

/**
 * Runs `keyboardHandoffMs` handoffs on the UI thread right before Fabric
 * applies the next batch of view changes.
 *
 * `NitroInput` asks for the handoff from React's commit, on the JS thread,
 * ahead of the commit that removes the field. A message posted from there to
 * the UI thread does not reliably get there first: the UI thread can already be
 * in the frame that applies the removal (seen 42 ms late on a Galaxy A22), and
 * a removed editor takes the IME with it. Fabric's `willMountItems` runs on the
 * UI thread before any view in the batch is touched, so the field still has
 * focus when the stand-in takes it over.
 */
@OptIn(UnstableReactNativeAPI::class)
internal object UnmountHandoffs : UIManagerListener {
  private val pending = ConcurrentLinkedQueue<NitroInputView>()
  private val listeningTo = Collections.newSetFromMap(IdentityHashMap<UIManager, Boolean>())

  /** Queues `view`'s handoff for the next batch; false when there is no Fabric UIManager to wait for. */
  fun request(context: ReactContext, view: NitroInputView): Boolean {
    val uiManager = UIManagerHelper.getUIManager(context, UIManagerType.FABRIC) ?: return false
    synchronized(listeningTo) {
      if (listeningTo.add(uiManager)) uiManager.addUIManagerEventListener(this)
    }
    pending.add(view)
    return true
  }

  private fun drain() {
    while (true) {
      val view = pending.poll() ?: return
      view.handOffKeyboardIfFocused()
    }
  }

  override fun willMountItems(uiManager: UIManager) = drain()

  // Every frame, mount items or not: a request whose batch never came still runs.
  override fun didDispatchMountItems(uiManager: UIManager) = drain()

  override fun willDispatchViewUpdates(uiManager: UIManager) {}

  override fun didMountItems(uiManager: UIManager) {}

  override fun didScheduleMountItems(uiManager: UIManager) {}
}
