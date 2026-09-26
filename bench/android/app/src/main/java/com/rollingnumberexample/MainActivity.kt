package com.rollingnumberexample

import android.os.Bundle
import com.facebook.react.ReactActivity
import com.margelo.nitro.nitroinput.NitroTextView
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "RollingNumberExample"

  // EXPERIMENT (experiment/kotlin-reflow-engine): KOTLIN_ENGINE=1 runs NitroText on the
  // Kotlin port of the reflow engine; ENGINE_CHECK / ENGINE_BENCH run the comparisons.
  override fun onCreate(savedInstanceState: Bundle?) {
    NitroTextView.useKotlinEngine = intent?.getStringExtra("KOTLIN_ENGINE") == "1"
    super.onCreate(savedInstanceState)
    if (intent?.getStringExtra("ENGINE_CHECK") == "1") Thread { EngineExperiment.check() }.start()
    if (intent?.getStringExtra("ENGINE_BENCH") == "1") Thread { EngineExperiment.bench() }.start()
  }

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
