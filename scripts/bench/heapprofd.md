# Native heap profiles on Android

Where a mounted view's memory comes from, by call site, on a real phone.
The in-app `footprint` benchmark says how many KB a mounted copy costs;
this says which allocations they are. It found, for instance, that a
A reflowing NitroInput on a Galaxy A22 costs about 27 KB of malloc more than a plain
NitroInput, in Hermes handle objects and Fabric props rather than in the
glyph engine, after a single footprint run had suggested four times as much.

## One command

```sh
python3 -m venv .venv && .venv/bin/pip install perfetto      # once; it fetches trace_processor_shell on first use
node scripts/bench/run.mjs --android <serial> --plan quick --impls text --build   # once: the release app on the phone
node scripts/bench/heap.mjs --android <serial> --impl morph-text                  # or nitro-prop, nitro-text, rn-text, text …
```

`heap.mjs` starts a Perfetto trace with `heapprofd.cfg` (malloc and the ART
heap sampled every 2 KB from process start), launches the app with a
one-scenario `footprint` plan (50 fields or 100 numbers mounted at once,
memory read after forced collections), pulls the trace when the 60 s are
up, prints the in-app per-copy figure for the same mount, and runs
`heap-attribute.py`, which prints net retained bytes by library and by the
first non-allocator frame of each call chain, as KB per copy, with an
example chain each. Traces go to `scripts/bench/results/heap/`, ignored by
git.

## What makes it work

- The bench app's `AndroidManifest.xml` has `<profileable android:shell="true"/>`,
  so the shell may attach heapprofd to the release build. Debug builds work
  without it.
- The trace covers the whole process life, launch included, so absolute
  numbers carry startup (shader compiles, ART, the JS bundle). Compare two
  implementations recorded the same way, or two builds; the difference is
  the signal.
- Symbols resolve for `libNitroInput.so` (both components),
  `libreactnative.so`, `libhwui.so` and `libhermesvm.so` (exported names
  only, so some frames print as `?`, with the next named frame in the
  example chain).

## What it cannot do

- Bracket by time on its own: the `android.log` data source captured no
  `BENCH` lines on the Samsung, so the attribution is over the whole trace.
  `heap-attribute.py` is small; add a `where ts between …` if a trace
  needs it.
- Say what the JavaScript heap holds: Hermes maps its own segments. A
  malloc made on behalf of a JS object (a `HostObject`, a shadow node)
  shows under the C++ frame that made it.
- Run on iOS: use Instruments' Allocations template there.
