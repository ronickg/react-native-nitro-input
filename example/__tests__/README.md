# On-device suites

The `*.harness.tsx` files here run **inside the example app** on a simulator or
an emulator through [React Native Harness](https://www.react-native-harness.dev):
a Jest-compatible runner is bundled with the app, each test's tree is rendered
as an overlay in the running app, and results come back over a Metro bridge.
They exercise the two packages the way an app does, so a regression in the
native views, the engines, the formatter or the wrappers fails here rather
than on a device in someone's hands.

`App.test.tsx` next to them is an ordinary Jest test and runs on Node
(`bun run test` in this folder); the harness runner only picks up
`*.harness.*` files (`jest.harness.config.mjs`).

## Running

Build and install the debug app once (`bun example ios` / `bun example
android`, or the `xcodebuild` / `gradlew` commands in the root README), then:

```sh
bun run test:harness:ios        # from the repo root, or in example/
bun run test:harness:android
bun --cwd example test:harness:ios -- --testPathPatterns=rolling-number   # one file
```

Harness starts its own Metro (moving to a free port if 8081 is taken), launches
the installed app on the device named in `rn-harness.config.mjs` and runs the
suites. The device defaults are a stock Xcode simulator (`iPhone 17`, iOS
`26.5`) and a stock Android Studio AVD (`Pixel_9_API36`); the `HARNESS_*`
variables in the config override them, and CI (`.github/workflows/harness.yml`)
sets them to what its images have.

## Writing tests

- **Set the tree up inline**, with the public components and props, the way
  the README shows them. The only shared helpers are the waiting primitives in
  `test-utils.ts`.
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
