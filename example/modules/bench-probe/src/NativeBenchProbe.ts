import type { TurboModule } from 'react-native'
import { TurboModuleRegistry } from 'react-native'

/**
 * Everything the benchmark needs from the native side, kept to strings so the
 * codegen surface is trivial. Every method is synchronous.
 */
export interface Spec extends TurboModule {
  /** JSON: { platform, model, name, os, refreshRate, cpuCores, lowPowerMode, thermal, debug } */
  getDeviceInfo(): string
  /** The plan the app was launched with, base64-decoded: the BENCH_PLAN environment variable on iOS, the BENCH_PLAN intent extra on Android. Empty when absent. */
  getLaunchPlan(): string
  /** nominal | fair | serious | critical on iOS; none | light | moderate | severe | critical | emergency | shutdown on Android. */
  thermalState(): string
  /**
   * JSON snapshot of cumulative CPU time per thread and memory:
   * { wallMs, rssMb, nativeHeapMb, threads: [{ id, name, main, cpuMs }] }.
   * `rssMb` is the physical footprint on iOS (what Xcode and jetsam count) and
   * the resident set on Android; `nativeHeapMb` is malloc's bytes in use (the
   * C++ and native-view side; iOS `malloc_zone_statistics`, Android
   * `Debug.getNativeHeapAllocatedSize`); `javaHeapMb` (Android only) is the
   * Java heap in use.
   */
  sample(): string
  /**
   * Makes the memory floor comparable before a sample: Android runs the Java
   * garbage collector and finalizers (a detached view, and the C++ engine its
   * `HybridData` owns, are only freed after that), iOS asks malloc to return
   * freed pages to the system. Blocks for about a quarter of a second.
   */
  forceGc(): void
  /**
   * Android: remembers, weakly, every view in the window whose class name
   * starts with `classPrefix` (`com.margelo.nitro.` for this repo's views),
   * and returns how many are remembered. Call it while the views are mounted;
   * after they are unmounted and a collection has run, `trackedLiveCount`
   * says how many are still alive, which is the leak check. -1 on iOS, where
   * Fabric pools component views and a survivor is not a leak.
   */
  trackNativeViews(classPrefix: string): number
  /** How many of the tracked views are still alive (Android; -1 on iOS). */
  trackedLiveCount(): number
  /** Start counting display frames on the main thread (CADisplayLink / Choreographer). */
  startFrames(): void
  /** Stop and summarize: { frames, seconds, fps, hz, dropped, long, p50, p95, p99, max } (gaps in ms). */
  stopFrames(): string
  /** Write one line to stdout (iOS) or logcat tag BENCH (Android), and append it to bench-results.ndjson in the app's files. */
  report(line: string): void
  /**
   * Types `text` into the focused field one key at a time at `keysPerSecond`,
   * through the path real typing takes (`insertText` on iOS, the input
   * connection's `commitText` on Android). Resolves with JSON per key: when it
   * landed, how many later frames rewrote the field's text before it settled
   * (a JS-formatted field shows the raw key first), and main-thread CPU ms.
   */
  typeText(text: string, keysPerSecond: number): Promise<string>
}

export default TurboModuleRegistry.get<Spec>('BenchProbe')
