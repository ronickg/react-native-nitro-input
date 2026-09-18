package com.margelo.nitro.nitromorphinput

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.facebook.react.uimanager.ViewManager
import com.margelo.nitro.nitromorphinput.views.HybridMorphInputViewManager

class NitroMorphInputPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? = null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider { HashMap() }

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
    return listOf(HybridMorphInputViewManager())
  }

  companion object {
    init {
      NitroMorphInputOnLoad.initializeNative()
    }
  }
}
