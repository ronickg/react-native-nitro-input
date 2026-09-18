# Re-recording the docs and README demos

The clips in `docs/static/video` and the animations in `docs/static/img/readme`
come from the example app's two showcase screens (`Showcase: Balance` and
`Showcase: Reveal` on the main screen — they are button-free and auto-playing,
built for exactly this).

Record on **real hardware**, not a simulator or emulator. The reasons are in
"Why not a simulator" below.

## 1. Build and install the example app

The showcase screens only exist in a current build, and a release build embeds
the JS bundle so no Metro is needed while recording.

```bash
# Android
ANDROID_HOME="$HOME/Library/Android/sdk" ./example/android/gradlew \
  -p example/android assembleRelease
adb -s <serial> install -r -d example/android/app/build/outputs/apk/release/app-release.apk

# iOS
(cd example/ios && pod install)
xcodebuild -workspace example/ios/RollingNumberExample.xcworkspace \
  -scheme RollingNumberExample -configuration Release \
  -destination "id=<device-udid>" -derivedDataPath example/ios/build-device \
  -allowProvisioningUpdates DEVELOPMENT_TEAM=<team> CODE_SIGN_STYLE=Automatic build
xcrun devicectl device install app --device <device-udid> \
  example/ios/build-device/Build/Products/Release-iphoneos/RollingNumberExample.app
```

## 2. Record

**Android** — `adb shell screenrecord` is a true display recorder: it encodes on
vsync at the panel's refresh rate and never pads with duplicate frames. Put the
panel in its 120 Hz mode first, or it records the app at 60.

```bash
adb -s <serial> shell settings put system min_refresh_rate 120
adb -s <serial> shell settings put system peak_refresh_rate 120
# open the showcase screen, then:
adb -s <serial> shell screenrecord --bit-rate 32M --time-limit 20 /sdcard/out.mp4
adb -s <serial> pull /sdcard/out.mp4 raw/android-rolling.mp4
# put the display preference back
adb -s <serial> shell settings delete system min_refresh_rate
adb -s <serial> shell settings delete system peak_refresh_rate
```

**iOS** — a cabled iPhone publishes its screen as a CoreMediaIO capture device,
which is what QuickTime's "Movie Recording" records. `scripts/iosrec/` is a
small AVFoundation recorder that does the same thing from the command line, at
the device's 60 Hz capture rate. Two things it has to do that are easy to miss:
it flips `kCMIOHardwarePropertyAllowScreenCaptureDevices` (without it the phone's
*screen* never appears in the device list, only its camera), and it holds a
`beginActivity` assertion (without it App Nap throttles the process and capture
silently stops after about five seconds).

```bash
swiftc -O -o scripts/iosrec/IosRec.app/Contents/MacOS/iosrec scripts/iosrec/iosrec.swift
codesign --force -s - scripts/iosrec/IosRec.app
# open the showcase screen, then (must go through LaunchServices so the
# camera permission prompt can appear the first time):
open -W scripts/iosrec/IosRec.app --args iPhone 20 "$PWD/raw/ios-rolling.mov"
```

Record 20 s or so for the market screen and 26 s+ for the reveal, which loops
count -> spin -> count about every 14 s and needs a whole cycle.

## 3. Encode

`scripts/encode-demos.sh` produces every shipped asset. Its `TRIM_*` and
`README_*` variables pick the window out of each raw capture; re-derive them
after re-recording by finding where a count reveal starts, e.g.

```bash
ffmpeg -v error -i raw/ios-reveal.mov \
  -vf "scale=160:-2,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-" \
  -f null -
```

then:

```bash
RAW=raw bash scripts/encode-demos.sh
```

Everything ships at 60 fps: that is the iPhone capture ceiling, most displays
cannot show more, and halving the 120 fps Android capture is a clean 2:1.

## Why not a simulator

The old clips were captured with a screenshot-stream recorder, which samples the
screen as JPEGs and pads a fixed 30 fps timeline with duplicates whenever a
sample is late. The files claimed 30 fps but carried roughly 16-19 fps of real
motion, unevenly spaced — that uneven spacing, not the frame rate, is what read
as lag.

The platform recorders avoid this entirely, but neither runs well headless:
`xcrun simctl io <udid> recordVideo` needs Simulator.app attached to the render
server and fails with `SimRenderServer error 2` without it, and a simulator caps
at 60 Hz anyway. A cabled phone has none of those problems and is what the
benchmarks already use.
