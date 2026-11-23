#!/bin/zsh
# CI entry for touch-handoff-android.sh (.github/workflows/harness.yml): the
# debug app installed on a booted emulator, Metro started for it, then every
# check. A hosted emulator is slow and now and then drops a keystroke, so a
# check that fails runs once more and fails the job only if it fails again;
# 0.4.2's selection-drag regression fails every time.
#
#   ./e2e/touch-handoff-ci.sh android/app/build/outputs/apk/debug/app-debug.apk

set -u
cd ${0:A:h}/..
APK=$1
adb wait-for-device
adb install -r -g $APK
adb reverse tcp:8081 tcp:8081

bun run start > metro.log 2>&1 &
METRO=$!
trap 'kill $METRO 2>/dev/null' EXIT
for _ in $(seq 1 60); do curl -sf http://localhost:8081/status >/dev/null && break; sleep 2; done
# The first bundle takes minutes on a hosted runner; build it before the app asks.
curl -sf -o /dev/null --max-time 900 'http://localhost:8081/index.bundle?platform=android&dev=true&minify=false' \
  || { echo "Metro did not bundle"; tail -50 metro.log; exit 1; }

# cursor-drift stays out: on the hosted API 35 emulator a focused cursor drag
# whose finger drifts 30dp off the line leaves the cursor where it was, on
# 0.4.2 and on the fix alike (both pass it on an API 36 emulator), so here it
# tells nothing apart. Run it locally: ./e2e/touch-handoff-android.sh cursor-drift
CHECKS=(select-drift select-flat cursor-unfocused cursor-focused scroll scroll-long page type mask masked-select-drift)
# The app's first start on a hosted emulator can sit on a black screen for
# minutes (one run never got past it in 90 s). Warm it up first: up to 4
# minutes for the home screen, relaunching once halfway.
warm=0
for attempt in 1 2; do
  adb shell am force-stop com.nitroinput.example
  adb shell monkey -p com.nitroinput.example -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
  for _ in $(seq 1 24); do
    adb shell uiautomator dump /sdcard/warm.xml >/dev/null 2>&1 \
      && adb shell cat /sdcard/warm.xml 2>/dev/null | grep -q 'home-features' && { warm=1; break 2; }
    sleep 5
  done
  echo "no home screen after 2 minutes (attempt $attempt)"
done
if (( ! warm )); then
  echo "the app never showed its home screen; last logcat:"
  adb logcat -d -t 200 | grep -iE 'ReactNative|AndroidRuntime|FATAL|nitroinput|ANR' | tail -60
  adb exec-out screencap -p > touch-handoff-last.png
  tail -50 metro.log
  exit 1
fi
echo "app is up"

# Each run of a check gets 4 minutes (a wedged emulator can block
# `adb shell` for good). Exit 3 (the app never showed its home screen) or 124
# (timed out) is the emulator or the app, not a touch: stop right there.
run_check() {
  timeout 240 env BOOT_WAIT=90 ./e2e/touch-handoff-android.sh $1
  local rc=$?
  if (( rc == 3 || rc == 124 )); then
    echo "$1: $([[ $rc == 3 ]] && echo 'the app never showed its home screen' || echo 'timed out'); stopping"
    adb exec-out screencap -p > touch-handoff-last.png
    tail -50 metro.log
    exit 1
  fi
  return $rc
}
FAILED=()
for c in $CHECKS; do
  run_check $c && continue
  echo "$c failed; once more"
  run_check $c || FAILED+=($c)
done
if (( ${#FAILED} )); then
  echo "failed twice: $FAILED"
  adb exec-out screencap -p > touch-handoff-last.png
  exit 1
fi
echo "touch hand-off: all ${#CHECKS} checks passed"
