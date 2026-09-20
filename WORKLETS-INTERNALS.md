# Worklets today: Reanimated 4, `react-native-worklets`, and VisionCamera 5

Notes from reading the versions this monorepo's `monorepo` checkout actually builds
against: **react-native-reanimated 4.5.1**, **react-native-worklets 0.10.2**,
**react-native-vision-camera 5.2.1** (+ `react-native-vision-camera-worklets` 5.2.3 from
npm). Relevant because `react-native-nitro-input` already has its own worklets bridge
(`cpp/worklets/`, `src/worklets.ts`) and VisionCamera 5 solves a very similar problem in
a more general way.

Sibling notes: [NITRO-INTERNALS.md](./NITRO-INTERNALS.md),
[RN-TEXTINPUT-INTERNALS.md](./packages/react-native-nitro-input/RN-TEXTINPUT-INTERNALS.md),
[ADVANCED-INPUT-MASK-INTERNALS.md](./packages/react-native-nitro-input/ADVANCED-INPUT-MASK-INTERNALS.md).

## 1. Worklets is no longer part of Reanimated

The headline change. Reanimated 4.5.1's `package.json`:

```json
"peerDependencies": {
  "react-native": "0.83 - 0.86",
  "react-native-worklets": "0.10.x"
}
```

Reanimated no longer *contains* the worklets runtime — it consumes it. Its own C++
(`Common/cpp/reanimated/`) is now animations only: `CSS/`, `LayoutAnimations/`,
`AnimatedSensor/`, `Events/`, `Fabric/`, `PseudoStyles/`.

For back-compat it still re-exports a subset from `./workletFunctions`
(`createWorkletRuntime`, `runOnJS`, `runOnUI`, `runOnRuntime`,
`executeOnUIRuntimeSync`, `isWorkletFunction`, `makeShareableCloneRecursive`), so
`import { runOnUI } from 'react-native-reanimated'` still compiles — but it is a shim.
New code should import from `react-native-worklets`.

31 files in Reanimated's `src/` import from `react-native-worklets` directly.

## 2. What the worklets API looks like now

### Runtime kinds

`RuntimeKind` is an actual enum now, readable from any runtime via
`globalThis.__RUNTIME_KIND`:

| kind | value | what |
| --- | --- | --- |
| `ReactNative` | 1 | the RN JS runtime, where React lives |
| `UI` | 2 | the UI-thread runtime (animations, gestures) |
| `Worker` | 3 | any runtime you create yourself |

with `isRNRuntime()` / `isUIRuntime()` / `isWorkerRuntime()` / `isWorkletRuntime()`
helpers, all themselves worklets.

### Naming has shifted

The scheduling API grew a consistent shape — and the *`WithId` variants are what
`react-native-nitro-input` already uses*:

| | fire-and-forget | blocking | promise |
| --- | --- | --- | --- |
| a runtime object | `scheduleOnRuntime` | `runOnRuntimeSync` | `runOnRuntimeAsync` |
| a runtime **id** | `scheduleOnRuntimeWithId` | `runOnRuntimeSyncWithId` | `runOnRuntimeAsyncWithId` |
| UI specifically | `scheduleOnUI` | `runOnUISync` | `runOnUIAsync` |
| back to RN | `scheduleOnRN` (was `runOnJS`) | — | — |

`UIRuntimeId` is just `RuntimeKind.UI`, i.e. `2` — so the UI runtime is addressable by a
constant id without holding the object. `getUIRuntimeHolder()` / `getUISchedulerHolder()`
return opaque JSI objects for handing the UI runtime to native code; this is exactly the
hook NitroInput's `HybridNitroInputWorklets::install` takes.

### Shareable → Serializable

The old "shareable" vocabulary has been renamed to **serializable**
(`createSerializable`, `isSerializableRef`, `serializableMappingCache`,
`registerCustomSerializable`), with the old names kept in `./deprecated`.

Confusingly, `Shareable` now means something *different* and new — a host/guest
decorator system (`createShareable`, `ShareableHost`, `ShareableGuest`,
`ShareableHostDecorator`). Don't read old blog posts as current.

The C++ taxonomy (`SharedItems/Serializable.h`) is one class per transportable shape:
`SerializableArray`, `SerializableObject`, `SerializableMap`, `SerializableSet`,
`SerializableError`, `SerializableRegExp`, `SerializableHostObject`,
`SerializableHostFunction`, `SerializableArrayBuffer`, `SerializableWorklet`,
`SerializableImport`, `SerializableInitializer`, `SerializableString`,
`SerializableBigInt`, `SerializableScalar`, `SerializableTurboModuleLike`, and
`CustomSerializable` for user-registered types.

### `Synchronizable`

New primitive: cross-runtime mutable state with *blocking* accessors
(`createSynchronizable`, `getBlocking()` / `setBlocking()`). VisionCamera uses it for an
`isBusy` flag readable from inside a frame processor — see below. This is the thing to
reach for when a shared value needs a synchronous, correct read from another thread,
rather than Reanimated's eventually-consistent shared values.

## 3. `WorkletRuntime` in C++

`Common/cpp/worklets/WorkletRuntime/WorkletRuntime.h` — a `jsi::HostObject` wrapping a
`jsi::Runtime`, guarded by a **`std::recursive_mutex`**. Every `runSync` variant takes
`std::unique_lock` on it, which is what makes calling into a worklet runtime from an
arbitrary native thread safe.

The surface, roughly:

- `schedule(...)` — overloaded for `jsi::Function`, `SerializableWorklet`,
  `std::function<void()>`, `std::function<void(jsi::Runtime&)>`.
- `runSync(...)` — blocking, returns the `jsi::Value`.
- `runSyncSerialized(...)` — blocking, requires the worklet to return something wrapped
  with `createSerializable`, so the result can cross runtimes. This is why
  `runOnRuntimeSync` in JS wraps your worklet in one that calls
  `makeShareableCloneOnUIRecursive(result)`.
- `callMicrotasks()`.

In debug builds everything goes through `callGuarded` with an optional captured schedule
stack — the `ENABLE_CROSS_RUNTIME_STACK_TRACES` feature flag gives you a JS stack from
the *scheduling* side when a worklet throws.

### The run loop

A worklet runtime is now a real event loop, not just a queue. `RunLoop/EventLoop.h` holds
a task queue plus a **timeouts** min-heap (`setTimeout` works), driven by an
`AsyncQueue`. `createWorkletRuntime` takes `enableEventLoop` and
`animationQueuePollingRate` (default 16ms), and the initializer calls `setupRunLoop(...)`
inside the new runtime.

### The extension point that matters

`AsyncQueue` is deliberately tiny (`RunLoop/AsyncQueue.h`):

```cpp
class AsyncQueue : public facebook::jsi::NativeState {
 public:
  virtual void push(std::function<void()> &&job) = 0;
};
```

and `createWorkletRuntime` accepts `{ customQueue, useDefaultQueue: false }`. **Anyone
can supply the thread a worklet runtime runs on** by implementing one virtual method.
That is the hinge the whole VisionCamera design hangs off.

## 4. VisionCamera 5: no worklets dependency at all

The surprise. VisionCamera 5.2.1's peer dependencies:

```json
"react-native-nitro-modules": "*",
"react-native-nitro-image": "*"
```

That's it. **The camera core is a pure Nitro module with no worklets dependency.** Frame
processors are factored into a separate optional package,
`react-native-vision-camera-worklets`, which peer-depends on
`react-native-nitro-modules`, `react-native-vision-camera` and — note — **SWM's
`react-native-worklets`**, not mrousavy's own `react-native-worklets-core`. VisionCamera
has migrated onto the Reanimated-4 worklets package.

### How the optional dependency is wired

`src/third-party/VisionCameraWorkletsProxy.ts` defines a `RuntimeThreadProvider`
interface (`createAsyncRunner`, `createRuntimeForThread`, `bindUIUpdatesToController`),
then lazily `require()`s the worklets package inside a try/catch and validates the
export shape with `Object.hasOwn`. If it's missing you get:

> Cannot use Frame Processors - `react-native-vision-camera-worklets` is not installed!

Clean pattern worth copying: **an interface in the core, an implementation in an optional
peer, resolved lazily at first use** — no build-time conditional compilation, no
`#ifdef`.

(NitroInput does the `#ifdef MORPH_INPUT_WORKLETS` compile-time version instead. Both
work; the VisionCamera one gives a better error and doesn't need the flag plumbed through
the podspec/CMake.)

### The thread trick

`NativeThread` is a Nitro HybridObject — a JS handle to a `DispatchQueue` (iOS) or
`Executor` (Android), with `runOnThread(task)` and an `id`. A `CameraFrameOutput` exposes
the thread its pipeline runs on.

`createWorkletRuntimeForThread` then does the interesting bit:

```ts
const workletQueue = HybridWorkletQueueFactory.wrapThreadInQueue(thread)

return createWorkletRuntime({
  name: thread.id,
  customQueue: workletQueue,
  useDefaultQueue: false,
  initializer: () => {
    'worklet'
    HybridWorkletQueueFactory.installDispatcher(thread)
  },
})
```

So: wrap the camera's own thread in a `worklets::AsyncQueue`, and create a worklet
runtime on it. **The frame processor runs on the camera pipeline's thread** — no hop, no
synchronization, no frame copied between runtimes.

And the type that carries it across is a Nitro **`CustomType`**:

```ts
export type WorkletQueue = CustomType<
  object,
  'std::shared_ptr<::worklets::AsyncQueue>',
  { canBePassedByReference: true; include: 'JSIConverter+AsyncQueue.hpp' }
>
```

A `shared_ptr<AsyncQueue>` travels from one third-party C++ library through Nitro into
another third-party C++ library, with JS only naming it. Worth knowing that
`CustomType` + a hand-written `JSIConverter` specialization is the supported escape hatch
for exactly this.

### Registration happens *inside* the runtime

`createRuntimeThreadProvider` registers the frame callback from within a
`scheduleOnRuntime`:

```ts
scheduleOnRuntime(runtime, () => {
  'worklet'
  frameOutput.setOnFrameCallback((frame) => {
    try { onFrame(frame) } catch (e) { console.error(...) }
    return true
  })
})
```

Because the Nitro callback is created *on* the camera runtime, the native side invokes it
directly on that thread. The try/catch inside matters: an uncaught throw in a frame
processor would otherwise take down the pipeline.

### Frames are Nitro objects with manual lifetime

`Frame` and `FramePlane` are HybridObjects with `readonly isValid` and an explicit
`dispose()` — the same `dispose()` from Nitro's `HybridObject` base. The API contract is
now "dispose the frame as soon as you're done or you stall the pipeline", and
`onFrameDropped(reason)` reports `'out-of-buffers'` when your processor overruns a frame
interval. The old fire-and-forget `runAsync` became:

```ts
const wasHandled = asyncRunner.runAsync(() => { 'worklet'; heavy(frame); frame.dispose() })
if (!wasHandled) frame.dispose()   // runner busy — you must drop
```

backed by a `Synchronizable<boolean>` busy flag read with `getBlocking()`.

One thing to know before adopting: `createAsyncRunner.ts` as shipped carries a `TODO`
saying the `scheduleOnRuntime` call inside `runAsync` currently throws
*"Trying to access property `scheduleOnRuntime` of an object which cannot be sent to the
UI runtime"*. Treat `AsyncRunner` as not-yet-settled; the frame-processor path itself
(`useFrameOutput`) doesn't go through it.

## 5. What this means for `react-native-nitro-input`

The bridge in `cpp/worklets/` does the right thing and matches how the ecosystem works:
install the UI runtime once from JS via `getUIRuntimeHolder()`, register worklets in a
map by id, call them synchronously by id from the native edit hook. That is the same
shape `runOnRuntimeSyncWithId` exposes, done manually so it can be called from
`shouldChangeCharactersIn` with no JS on the stack.

Three things worth considering, in order of value:

1. **`Synchronizable` may replace part of the id map.** If any worklet state needs to be
   read back from the RN runtime, `createSynchronizable` gives blocking cross-runtime
   reads without inventing a protocol.
2. **The optional-peer pattern beats the `#ifdef`.** `MORPH_INPUT_WORKLETS` has to be
   plumbed through the podspec and CMake, and when it's off the failure is a silent
   no-op (`isAvailable` false). VisionCamera's lazy `require()` + interface gives a
   precise error message and keeps the native build unconditional. Worth it if the flag
   ever causes a support issue.
3. **A custom `AsyncQueue` is available if the input ever needs its own thread.**
   Probably not — text editing belongs on the UI thread — but if amount formatting ever
   moves off it, `{customQueue, useDefaultQueue: false}` is how, and VisionCamera's
   `WorkletQueueFactory` is the reference implementation.

Also: the spec comment in `NitroInputWorklets.nitro.ts` cites "Expo UI's worklet
`onTextChange` and react-native-transformer-text-input" as prior art. VisionCamera 5 is
now a better reference for the *Nitro + worklets* combination specifically, since it is
the same two libraries composed.

## 6. Where to read

All of these ship full source in `node_modules` — no clone needed:

| what | where |
| --- | --- |
| Worklets JS | `react-native-worklets/src/{runtimes.native.ts,threads.native.ts,runtimeKind.ts,memory/}` |
| Worklets C++ | `react-native-worklets/Common/cpp/worklets/{WorkletRuntime,SharedItems,RunLoop,Tools}` |
| Reanimated C++ | `react-native-reanimated/Common/cpp/reanimated/` (animations only now) |
| VisionCamera specs | `react-native-vision-camera/src/specs/`, `src/threading/`, `src/third-party/` |
| VC worklets glue | `npm pack react-native-vision-camera-worklets` — 7 small files, all worth reading |
