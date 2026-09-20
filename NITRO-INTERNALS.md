# How Nitro Modules works

Notes from reading [mrousavy/nitro](https://github.com/mrousavy/nitro) at **v0.37.1**
(docs + core C++ + nitrogen codegen templates) — the version both packages in this
monorepo pin. Written for the maintainer of a Nitro library, so it skips the getting-started
material and concentrates on mechanism and on what it costs.

Sibling notes: [RN-TEXTINPUT-INTERNALS.md](./packages/react-native-nitro-input/RN-TEXTINPUT-INTERNALS.md),
[ADVANCED-INPUT-MASK-INTERNALS.md](./packages/react-native-nitro-input/ADVANCED-INPUT-MASK-INTERNALS.md).

## Three nouns

- **Nitro Module** — a library built with Nitro; contains one or more Hybrid Objects.
- **Hybrid Object** — a JS object whose implementation is C++, Swift or Kotlin.
- **Nitrogen** — the optional code generator that turns a TypeScript `*.nitro.ts` spec
  into native interfaces. Optional in principle; in practice everyone uses it.

A **Hybrid View** is just a Hybrid Object with one extra member, `view`, and is rendered
through `getHostComponent(...)` rather than constructed by hand.

## The core mechanism: `NativeState` + shared prototypes

This is the thing that makes Nitro fast, and it is worth understanding exactly.

Turbo/Expo modules use `jsi::HostObject`, where **every property access goes through a
C++ `get()` call** that string-compares the property name. Nitro instead uses
`jsi::NativeState`: a plain JS object whose prototype carries real JS functions, with the
native instance attached as opaque state.

`HybridObject::toObject` (`cpp/core/HybridObject.cpp`) is the whole story:

1. Check a per-runtime `_objectCache` of `jsi::WeakObject` — if this Hybrid Object was
   already handed to JS and the object is still alive, reuse it (JS identity is stable).
2. `getPrototype(runtime)` — the prototype is **shared across all instances of the type**
   and cached per runtime.
3. `Object.create(prototype)`.
4. `object.setNativeState(runtime, shared())` — attach the native instance.
5. `object.setExternalMemoryPressure(runtime, getExternalMemorySize())` — tell Hermes'
   GC how big this really is.

The prototype itself (`HybridObjectPrototype::createPrototype`) is built once per
(runtime, C++ type) and cached in `_prototypeCache`. Methods become real
`jsi::Function`s installed with `defineProperty`; properties become real getter/setter
pairs. In debug builds the prototype is frozen and tagged with `__type`.

So a method call from JS is: property lookup on a cached prototype (a normal JS
prototype walk the engine already optimizes) → `jsi::Function` → `HybridFunction`
trampoline that reads `NativeState` and converts arguments. No name comparison, no
`HostObject::get`.

`PrototypeChain` (`cpp/prototype/PrototypeChain.hpp`) mirrors the C++ inheritance chain
into a JS prototype chain by `typeid`, so a spec that extends another spec gets a real
prototype chain in JS too.

**Registry.** Non-view Hybrid Objects reach JS through `HybridObjectRegistry`: native
registers `name → constructorFn`, and JS calls
`NitroModules.createHybridObject<T>('Name')`.

## Typing: static, compile-time, zero-runtime

Nitrogen makes the TypeScript spec the single source of truth and generates native
interfaces that *must* match — a Swift method returning the wrong type simply does not
compile. Conversion is `JSIConverter<T>` template specializations, so the type-checking
is compile-time and `constexpr`; there is no runtime schema.

The mapping is the usual one (`number` → `double`, `string` → `std::string`,
`T[]` → `std::vector<T>`, `T?` → `std::optional<T>`, `A | B` → `std::variant`,
`(T) => void` → `std::function`), plus `ArrayBuffer`, `Promise`, tuples (C++/Swift only),
typed and untyped maps, and `AnyHybridObject` (C++ only).

Hybrid Objects are themselves first-class types: you can accept and return them across
the boundary, which is the recommended way to avoid copying large data — return a proxy
Hybrid Object rather than a big array.

## Hybrid Views

A Nitro view is a real Fabric view backed by a C++ ShadowNode. The difference from a
normal Fabric component is **who parses the props**: Nitro does it, not RN's
folly/MapBuffer parser. That is why Nitro views can take callbacks, variants and Hybrid
Objects as props, which codegen'd Fabric props cannot.

Requires RN ≥ 0.78 and the new architecture.

### What the generated component actually does

From `packages/nitrogen/src/views/swift/SwiftHybridViewManager.ts`, the generated
`RCTViewComponentView` subclass:

```objc
- (instancetype) init {
  _props = …ShadowNode::defaultSharedProps();
  std::shared_ptr<HybridTSpec> hybridView = <constructor call>;
  _hybridView = std::dynamic_pointer_cast<HybridTSpecSwift>(hybridView);
  [self updateView];   // swiftPart.getView() → __bridge_transfer → setContentView:
}

- (void) updateProps:(…)props oldProps:(…)oldProps {
  const bool hasTransactionPropChanges = oldViewProps == nullptr
      ? newViewProps.hasAnyProvidedProps()
      : !newViewProps.hasSameProps(*oldViewProps);
  if (hasTransactionPropChanges) {
    swiftPart.beforeUpdate();
    …one assignment per changed prop…
    swiftPart.afterUpdate();
  }
  [super updateProps:props oldProps:oldProps];
}
```

Two structural consequences:

- **A Nitro view is two `UIView`s** — the component view plus the Swift/Kotlin content
  view set via `setContentView:`. One more than RN's own components.
- **Props are diffed twice**: `ReactProp<T>` caches the converted value against the
  original `jsi::Value` via `strictEquals`, and each prop's `Entry` is a
  `shared_ptr<const Entry>` so `hasSameValue` is a pointer comparison. An unchanged prop
  is never re-converted and never crosses into Swift.

### Props on JS side

`getHostComponent(name, getViewConfig)` registers with RN's `NativeComponentRegistry` and
rewrites every attribute to `{diff: (a,b) => a !== b, process: (i) => i}`.

**Callbacks must be wrapped**: React converts function props to `true` before they reach
native, so Nitro transports them as `{ f: fn }` and unwraps `f` in
`ReactProp::fromRawValue` (guarded by `IsFunctionProp`). That is the reason for the
`callback(...)` helper and the `hybridRef={callback(ref => …)}` syntax.

### Recycling

Opt-in via `RecyclableView` / `prepareForRecycle()`, disabled by default because Nitro
cannot know how to reset your state. The generated view calls `shouldBeRecycled`,
`prepareForRecycle`, `onDropView` and (where available) `invalidate`.

This matters for anything holding per-instance state — see the open item at the end of
[RN-TEXTINPUT-INTERNALS.md](./packages/react-native-nitro-input/RN-TEXTINPUT-INTERNALS.md).

## Threading

**Synchronous by default.** Every Hybrid method runs on the calling thread (usually JS),
blocking it. That is deliberate — for small methods a thread hop costs more than the
work.

**Async by returning a `Promise`.** The native method still *starts* synchronously (good
for argument validation), then `Promise.async { … }` moves the body off-thread —
Swift `async`/`await` or Kotlin coroutines. The docs' rule of thumb: make it async above
~50ms.

`Dispatcher` (`cpp/threading/`) is the primitive for scheduling back onto the JS thread
from native; worklets support exists for running Hybrid Objects on worklet runtimes,
with boxing (`BoxedHybridObject`) to move an object between runtimes.

## Memory and GC

- `getExternalMemorySize()` / `memorySize` reports native heap size to the JS GC. Without
  it, Hermes thinks a Hybrid Object wrapping a 20 MB image is a tiny empty object and
  collects it far too late. Implement it for anything holding buffers.
- `dispose()` is exposed to JS for eager cleanup: it calls the virtual `dispose()`,
  removes the `NativeState`, and clears the object cache.
- Destruction is ordinary `shared_ptr` semantics plus GC — no manual retain/release.

## Performance guidance, condensed

From `docs/guides/performance-tips.md`, in rough order of how much they matter:

1. Avoid dynamic types (untyped maps, variants) — they cost real conversion work.
2. Use `ArrayBuffer` for large data; avoid large arrays, which are deep-copied.
3. Return Hybrid Objects as proxies instead of materializing big structures.
4. Implement `memorySize`.
5. Implement `RecyclableView` for views rendered repeatedly.
6. Prefer C++ over Swift/Kotlin where the bridge hop matters.
7. Batch: staying in JS beats many small native calls, even fast ones.

Benchmark for scale (from the repo, 100k calls): `addNumbers` — Expo 434ms,
Turbo 116ms, **Nitro 7.3ms**. That is method throughput in an extreme case, not app-level
behaviour; per the repo's own caveat, treat it as an upper bound on what the boundary
costs, not a prediction.

## Prop names collide with `ViewProps` — silently

A Hybrid View's generated props class **inherits `react::ViewProps`**, so React
Native's own prop parser reads the same raw props your view does. Give a prop a
name RN already owns and RN will act on it too, with no warning from either
side.

This cost real time here. RN 0.76+ added `outlineColor`, `outlineWidth`,
`outlineStyle` and `outlineOffset` as CSS-outline *style* props on every view.
A Nitro view declaring `outlineColor` / `outlineWidth` gets RN drawing its own
square outline at the view's bounds, in the colour and width you meant for
something else — regardless of what your own code does with them.

The symptoms are confusing because the drawing is not yours:

- it ignores your `variant` / feature flags entirely;
- it ignores your corner radius, because a CSS outline is square unless
  `outlineStyle` says otherwise;
- it appears even on a code path where you explicitly set `strokeColor = nil`.

That last one is the tell: if a stroke you never drew still tracks your prop,
the parser reading it is not yours.

**Check a spec against the names RN owns before shipping it.** The set that
matters is `ViewStyle` and everything it extends (`FlexStyle`,
`ShadowStyleIOS`, `TransformsStyle`) — 127 names in RN 0.86:

```bash
# every property name a View parses
sed -n '/interface \(ViewStyle\|FlexStyle\|ShadowStyleIOS\|TransformsStyle\)/,/^}/p' \
  node_modules/react-native/Libraries/StyleSheet/StyleSheetTypes.d.ts \
  | grep -oE '^  [a-zA-Z]+\??:' | tr -d ' ?:' | sort -u > /tmp/rn.txt
# your view's props
grep -oE '^  [a-zA-Z]+\??:' src/specs/YourView.nitro.ts | tr -d ' ?:' | sort -u > /tmp/ours.txt
comm -12 /tmp/rn.txt /tmp/ours.txt
```

Text style names (`fontSize`, `color`, `textAlign`…) are safe on a view — a
View does not parse `TextStyle`. It is the `ViewStyle` family that bites.

In this repo: `NitroInput` was hit by `outlineColor`/`outlineWidth` and now uses
`strokeColor` / `focusedStrokeColor` / `strokeWidth` / `cornerRadius`.
`RollingNumber` still declares **`direction`**, which is a Yoga layout prop
(`'inherit' | 'ltr' | 'rtl'`); its own values (`'auto' | 'up' | 'down'`) do not
overlap, so Yoga ignores them today, but the name is shared.

## What changed in 0.37 — and what it means for BENCHMARKS/parity

v0.37.0 (2026-08-20) is essentially a **view-layer release**. The relevant items:

| change | effect |
| --- | --- |
| `Props` and `ComponentDescriptor` moved into core as C++ templates | less generated code per view |
| `CachedProp` → `ReactProp`, data made immutable | props share a `shared_ptr<const Entry>`; identity comparison |
| "View prop snapshots truly immutable via diffing" | `hasSameProps` / `hasAnyProvidedProps` gate the whole Swift/Kotlin update block |
| several recycling fixes (reset before prop updates, report drops, RN fallback) | recycling is materially more correct than in 0.36.x |
| preserve native prop defaults; avoid dangling props reference | correctness |

**Applied to the findings in
[TEXTINPUT-PARITY.md](./packages/react-native-nitro-input/TEXTINPUT-PARITY.md):**

- "One C++→Swift call per prop, strings converting `std::string` ⇄ `String`" — now
  skipped entirely on transactions where no prop changed. But **on first mount every prop
  is provided**, so `hasAnyProvidedProps()` returns true and the full block runs. The
  ~0.6 ms/view mount floor measured there should therefore be *unchanged* by 0.37; the
  gain is on updates. Worth re-measuring rather than assuming either way.
- "`beforeUpdate` / `afterUpdate` could batch props into one struct" — the brackets exist,
  the batching does not. Still a live suggestion.
- "`std::dynamic_pointer_cast` in the generated component's `init` should be
  `static_pointer_cast`" — **still present at HEAD**
  (`SwiftHybridViewManager.ts:110`). Still a one-line codegen change, still unfixed.
  This is the cheapest upstream PR available if you want one.
- "`Unmanaged.passRetained(view)` + `setContentView:` — one more `UIView` than RN's own
  components" — confirmed structural, not going away; it is how `view` is handed across
  the Swift/C++ boundary.

## Local checkout

```bash
git clone --depth 1 https://github.com/mrousavy/nitro.git
```

Worth knowing where things are:

| what | where |
| --- | --- |
| Core C++ | `packages/react-native-nitro-modules/cpp/{core,prototype,views,registry,threading}` |
| JS surface | `packages/react-native-nitro-modules/src/` (`getHostComponent.ts`, `NitroModules.ts`) |
| Codegen templates | `packages/nitrogen/src/{syntax,views}` — the view templates are the readable ones |
| Docs source | `docs/docs/` |
| Test module | `packages/react-native-nitro-test` — exercises every supported type |
