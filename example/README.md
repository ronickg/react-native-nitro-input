# example

The app you test `react-native-nitro-input` in. It depends on this library and
what an app pairs it with (Reanimated and worklets, keyboard-controller,
react-navigation) and nothing else, so it builds quickly. The benchmarks
against other libraries live in [`../bench`](../bench).

```sh
bun example ios                 # or: bun example android (Metro on 8081)
bun run test:harness:ios        # the on-device suites in __tests__/, from the repo root
```

- `__tests__/*.harness.tsx`: the on-device suites, run by [React Native Harness](https://www.react-native-harness.dev) inside this app (see [`__tests__/README.md`](__tests__/README.md)). CI runs them on an iOS simulator and an Android emulator.
- `src/screens/`: the demo and the manual checks (parity with `TextInput`, navigation, form sheets, keyboard-controller, RTL, view props, recycling), driven by `testID`.
- Bundle id `com.nitroinput.example` on both platforms, so it installs next to the bench app.
