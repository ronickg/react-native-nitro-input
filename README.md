# react-native-nitro-rolling-number (monorepo)

- [`packages/react-native-nitro-rolling-number`](packages/react-native-nitro-rolling-number) – the library (Nitro View, Swift + Kotlin). Its README documents the API.
- [`example/`](example) – React Native 0.87 app exercising both drive modes, currency layouts and shrink-to-fit.

```sh
bun install                 # hoisted linker, see bunfig.toml
bun specs                   # re-run nitrogen after editing src/specs/*.nitro.ts
bun build                   # emit lib/ for the package
bun test                    # jest tests for the JS wrapper
bun example ios             # or: bun example android
```

The example's Android Gradle files point at the workspace root `node_modules`, and Metro watches the whole repo.
