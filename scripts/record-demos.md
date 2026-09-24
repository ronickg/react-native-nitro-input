# Re-recording the docs and README demos

The clips in `docs/static/video` and the animations in `docs/static/img/readme`
come from the example app's three showcase screens (`Showcase: Market`,
`Showcase: Reward` and `Showcase: Transfer` under Open demo — they are
button-free and auto-playing, built for exactly this).

They are recorded on a **Samsung Galaxy A22** (MediaTek Helio G80, 90 Hz), a
budget phone, on purpose: what the library does on the hardware most people
have. Record on the phone itself, not an emulator; the reasons are in "Why not
a simulator" below.

## 1. Build and install the example app

The showcase screens only exist in a current build, and a release build embeds
the JS bundle so no Metro is needed while recording.

```bash
ANDROID_HOME="$HOME/Library/Android/sdk" ./example/android/gradlew \
  -p example/android assembleRelease
adb -s <serial> install -r -d example/android/app/build/outputs/apk/release/app-release.apk
```

## 2. Record

`adb shell screenrecord` is a true display recorder: it encodes on vsync at the
panel's refresh rate and never pads with duplicate frames. Pin the panel at its
90 Hz first, or it may record the app at 60. The recorder takes a share of the
A22's GPU while it runs (the market screen draws about 45 fps recorded); its
bit rate and size make no difference to that.

```bash
adb -s <serial> shell settings put system min_refresh_rate 90
adb -s <serial> shell settings put system peak_refresh_rate 90
# open the showcase screen, then:
adb -s <serial> shell screenrecord --bit-rate 32M --time-limit 20 /sdcard/out.mp4
adb -s <serial> pull /sdcard/out.mp4 raw/android-market.mp4
# put the display preference back
adb -s <serial> shell settings delete system min_refresh_rate
adb -s <serial> shell settings delete system peak_refresh_rate
```

Record 20 s or so for the market screen (`raw/android-market.mp4`), 30 s for
the reward (`raw/android-reveal.mp4`; one round is 12 s and the window starts
as a gift appears) and 26 s for the transfer (`raw/android-transfer.mp4`, a
10.6 s loop).

## 3. Encode

`scripts/encode-demos.sh` produces every shipped asset, and crops off the
navigation bar the recorder captures. Its `TRIM_*` and `README_*` variables
pick the window out of each raw capture; re-derive them after re-recording by
finding where a loop starts: where the reward's gift appears, and where the
transfer's field is cleared. A frame-difference trace shows the cuts:

```bash
ffmpeg -v error -i raw/android-reveal.mp4 \
  -vf "scale=160:-2,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-" \
  -f null -
```

then:

```bash
RAW=raw bash scripts/encode-demos.sh
```

The docs videos keep the panel's 90 fps; the README animations are 50 fps
animated WebP.

`scripts/iosrec/` records a cabled iPhone's screen the same way QuickTime does,
for when an iPhone clip is wanted; the shipped demos do not use it.

## Why not a simulator

The old clips were captured with a screenshot-stream recorder, which samples the
screen as JPEGs and pads a fixed 30 fps timeline with duplicates whenever a
sample is late. The files claimed 30 fps but carried roughly 16-19 fps of real
motion, unevenly spaced — that uneven spacing, not the frame rate, is what read
as lag.

The platform recorders avoid this entirely, but neither runs well headless:
`xcrun simctl io <udid> recordVideo` needs Simulator.app attached to the render
server and fails with `SimRenderServer error 2` without it, and a simulator caps
at 60 Hz anyway. A phone has none of those problems and is what the benchmarks
already use.
