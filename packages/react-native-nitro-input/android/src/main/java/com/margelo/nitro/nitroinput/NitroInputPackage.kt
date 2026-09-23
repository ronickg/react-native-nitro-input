package com.margelo.nitro.nitroinput

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.facebook.react.uimanager.ViewManager
import com.margelo.nitro.nitroinput.views.HybridNitroInputViewManager
import com.margelo.nitro.nitroinput.views.HybridRollingNumberViewManager

class NitroInputPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? = null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider { HashMap() }

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
    return listOf(HybridNitroInputViewManager(), HybridRollingNumberViewManager())
  }

  companion object {
    init {
      NitroInputOnLoad.initializeNative()
    }
  }
}
