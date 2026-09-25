# On-device suites

The `*.harness.tsx` files here run **inside the example app** on a simulator or
an emulator through [React Native Harness](https://www.react-native-harness.dev):
a Jest-compatible runner is bundled with the app, each test's tree is rendered
as an overlay in the running app, and results come back over a Metro bridge.
They exercise both components the way an app does, so a regression in the
native views, the engines, the formatter or the wrappers fails here rather
than on a device in someone's hands. Each file ends with a lifetime suite:
two dozen copies mounted and unmounted thirty times, a forced collection,
then the live `View` count on Android (read through the probe
module in `modules/bench-probe`, what `dumpsys meminfo` calls Views) must be where it started and the
copies mounted afterwards must work. That is the leak the 0.1.0 memory fix
closed, kept closed.

`number-format.harness.tsx` checks `NumberFormat` against Hermes' own
`Intl.NumberFormat` (25 locales, every style), and
`test262-number-format.harness.tsx` runs test262's `intl402/NumberFormat`
conformance suite against both: every test Hermes passes must pass, and the
few `NumberFormat` is known to fail are listed with their reason. Its tests
are bundled by `node scripts/test262/number-format.mjs` (a pinned test262
commit, fetched into `scripts/test262/.cache`); without the bundle the suite
is skipped.

`App.test.tsx` next to them is an ordinary Jest test and runs on Node
(`bun run test` in this folder); the harness runner only picks up
`*.harness.*` files (`jest.harness.config.mjs`).

## Running

Build and install the debug app once (`bun example ios` / `bun example
android`, or the `xcodebuild` / `gradlew` commands in the root README), then:

```sh
bun run test:harness:ios        # from the repo root, or in example/
bun run test:harness:android
bun run test:harness:android-device   # a cabled Android phone instead of the emulator
bun --cwd example test:harness:ios -- --testPathPatterns=nitro-number   # one file
```

Harness starts its own Metro (moving to a free port if 8081 is taken), launches
the installed app on the device named in `rn-harness.config.mjs` and runs the
suites. The device defaults are a stock Xcode simulator (`iPhone 17`, iOS
`26.5`) and a stock Android Studio AVD (`Pixel_9_API36`); the `HARNESS_*`
variables in the config override them, and CI (`.github/workflows/harness.yml`)
sets them to what its images have.

### When they flake

An emulator shares the machine's CPU. On a busy machine (other simulators
booted, a build running) a debug build can take long enough that Harness gives
up on it: a render that did not mount within the second Harness allows by
default, a bridge that was not ready in time, or Android killing an app that
took over 25 s to start as not responding. The failures then move between
tests from run to run, and every one is a timeout, never a wrong value.
`test-utils.ts`'s `render` gives a mount or re-render 5 s, and the config gives
startup a slow machine's allowance everywhere; past that, run the Android
suites on a phone (`android-device`, a Galaxy A22 by default, the
`HARNESS_ANDROID_DEVICE_*` variables for another), which has a CPU of its own,
or let CI run them.

## What React Native's own TextInput tests check

React Native 0.87 tests its `TextInput` in a Fantom integration suite
(`packages/react-native/Libraries/Components/TextInput/__tests__/TextInput-itest.js`).
Every case there has a counterpart for `NitroInput`: the ones a device can
observe are in `nitro-input.harness.tsx` (focus from a ref callback or an
effect right after mount, focus taken from the field that had it, `blur()` on
an unfocused field doing nothing, `isFocused()` after unmount, `clear()`,
`setSelection()`, the change / focus / blur events), and the prop-level ones
(`id` / `nativeID`, `testID`, `aria-label`, the `aria-*` state, `aria-hidden`,
`accessibilityRole`, `style`, `selection`, `displayName`) are in the package's
`src/__tests__/TextInputParity.test.tsx`, which renders `TextInput` itself
next to ours and compares what reaches the host.

## Writing tests

- **Set the tree up inline**, with the public components and props, the way
  the README shows them. The only shared helpers are the waiting primitives in
  `test-utils.ts`, and its `render`, which is Harness's with a longer timeout:
  import `render` from there, not from `react-native-harness`.
- **Compare two views' sizes with `expectSameLength`**, which allows one
  physical pixel: React Native snaps edges to whole pixels, so equal views at
  different positions can measure a pixel apart, more than
  `toBeCloseTo(x, 0)` allows at the Galaxy A22's density.
- **Assert what an app can observe**: the handle (`getValue`, `getText`,
  `isFocused`), the callbacks (`onRevealEnd`, `onChangeText`, `onFocus`, …)
  and the measured layout (`onLayout`). There is no screenshot comparison; a
  device's rendering is checked in the manual QA screens.
- **Wait on events, not on time.** `waitFor` and a `deferred()` fed by a
  callback keep a test tied to the thing it checks. A `sleep` is only for an
  animation whose length is a prop (a roll, a reveal) and is kept short.
- **No typing.** Harness has no keyboard input, so return-key behaviour,
  caret matching while typing and the like are not covered here.
- **Platform differences** go through `.ios.harness.tsx` /
  `.android.harness.tsx` file names when a behaviour is meant to differ; a
  behaviour meant to match runs in the shared file and CI shows where it
  does not.
- Every native prop is optional in the wrapper and always sent to native, so
  a test never has to worry about `null` reaching the view.
