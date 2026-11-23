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

CHECKS=(select-drift select-flat cursor-unfocused cursor-focused cursor-drift scroll scroll-long page type mask masked-select-drift)
FAILED=()
for c in $CHECKS; do
  BOOT_WAIT=90 ./e2e/touch-handoff-android.sh $c && continue
  echo "$c failed; once more"
  BOOT_WAIT=90 ./e2e/touch-handoff-android.sh $c || FAILED+=($c)
done
if (( ${#FAILED} )); then
  echo "failed twice: $FAILED"
  adb exec-out screencap -p > touch-handoff-last.png
  exit 1
fi
echo "touch hand-off: all ${#CHECKS} checks passed"
