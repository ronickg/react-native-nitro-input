# bench

The benchmark app: `react-native-nitro-input` against the other animated-number
libraries and amount / mask inputs on npm (Skia, NumberFlow, Expo UI and the
rest), with the in-app probe from [`../modules/bench-probe`](../modules/bench-probe).
It is its own app so the everyday [`../example`](../example) does not build
any of them.

`scripts/bench/run.mjs` builds it in Release, installs it on a phone, launches
it with a plan and collects the results; `scripts/bench/report.mjs` turns them
into [BENCHMARKS.md](../BENCHMARKS.md). The app can also be run by hand
(`bun bench ios`), with both benchmarks on its home screen.

Bundle id `org.reactjs.native.example.RollingNumberExample` / package
`com.rollingnumberexample`, as the example had before the split, so the
scripts and the phones it is installed on keep working.
