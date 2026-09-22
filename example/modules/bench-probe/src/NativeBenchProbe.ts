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
  /** JSON snapshot of cumulative CPU time per thread: { wallMs, rssMb, threads: [{ id, name, main, cpuMs }] } */
  sample(): string
  /** Start counting display frames on the main thread (CADisplayLink / Choreographer). */
  startFrames(): void
  /** Stop and summarize: { frames, seconds, fps, hz, dropped, long, p50, p95, p99, max } (gaps in ms). */
  stopFrames(): string
  /** Write one line to stdout (iOS) or logcat tag BENCH (Android), and append it to bench-results.ndjson in the app's files. */
  report(line: string): void
}

export default TurboModuleRegistry.get<Spec>('BenchProbe')
