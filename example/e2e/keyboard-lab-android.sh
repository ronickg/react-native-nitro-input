#!/bin/zsh
# Touch-level keyboard checks on a cabled Android phone, for NitroInput and
# TextInput alike: the flows of the input lab (Home -> Input lab) driven with
# real touches over adb, each step checked against the IME state and the lab's
# status line. What Harness cannot do (a real tap on a row while the keyboard is
# up, a real drag of a list, the keyboard's own Next key), this does.
#
#   bun run start                  # Metro for the example, in another terminal
#   ./e2e/keyboard-lab-android.sh  # ANDROID_SERIAL picks the phone
#   ./e2e/keyboard-lab-android.sh form ours   # one flow, one component
#
# The debug app must be installed. The Next key is pressed where Samsung's
# keyboard has it (the bottom-right key); on another keyboard, move NEXT_X/Y.
# Nothing here reads pixels: elements are found in the UI hierarchy by testID.

set -u
export ANDROID_SERIAL=${ANDROID_SERIAL:-$(adb devices | awk 'NR==2 {print $1}')}
PKG=com.nitroinput.example
ACTIVITY=com.rollingnumberexample.MainActivity
TMP=$(mktemp -d)
FAILS=0

dump() {
  for _ in 1 2 3 4; do
    adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 && adb shell cat /sdcard/ui.xml > $TMP/ui.xml && return 0
    sleep 0.5
  done
  return 1
}
# centre, testID and text of every node, one per line
nodes() {
  python3 - "$TMP/ui.xml" <<'EOF'
import re, sys, xml.etree.ElementTree as ET
for n in ET.parse(sys.argv[1]).getroot().iter('node'):
    b = list(map(int, re.findall(r'\d+', n.get('bounds', ''))))
    if len(b) == 4:
        print(f"{(b[0]+b[2])//2} {(b[1]+b[3])//2}\t{n.get('resource-id','')}\t{n.get('text','')}\t{n.get('focused')}\t{b[1]}")
EOF
}
# Taps the element with testID $1 (a prefix), where a finger would: its
# centre, or the part above the keyboard when the keyboard covers the centre.
tap() {
  local row=""
  for _ in 1 2 3 4; do
    dump && row=$(nodes | awk -F'\t' -v id="$1" 'index($2, id) == 1 {print $1 "\t" $5; exit}')
    [[ -n $row ]] && break
    sleep 0.6
  done
  [[ -z $row ]] && { fail "no element $1 on screen"; return 1; }
  local xy=${row%%$'\t'*} top=${row##*$'\t'}
  local x=${xy%% *} y=${xy##* }
  local kb=$(ime_top)
  (( kb > 0 && y >= kb )) && y=$(( (top + kb) / 2 ))
  adb shell input tap $x $y
  sleep 1.2
}
# The keyboard's top edge, or 0 when it is down.
ime_top() {
  [[ $(ime) == true ]] || { echo 0; return; }
  adb shell dumpsys window InputMethod | grep -m1 -oE "touchable region=SkRegion\(\([0-9]+,[0-9]+" | grep -oE "[0-9]+$"
}
ime() { adb shell dumpsys input_method | grep -m1 -oE "mInputShown=(true|false)" | cut -d= -f2; }
status() { dump && nodes | awk -F'\t' '$2 == "lab-status" {print $3; exit}'; }
visible() { dump && nodes | awk -F'\t' -v id="$1" 'index($2, id) == 1 {found=1} END {exit !found}'; }
# A drag in the content, above whatever keyboard is up.
drag() {
  local kb=$(ime_top) start=900
  (( kb > 0 && kb - 180 < start )) && start=$(( kb - 180 ))  # above a sticky footer too
  adb shell input swipe 360 $start 360 $(( start - 350 )) 250
  sleep 1.2
}
back() { adb shell input keyevent KEYCODE_BACK; sleep 1.3; }
# The keyboard's action key (Next / Done), from its window's touchable region.
next() {
  local region=$(adb shell dumpsys window InputMethod | grep -m1 -oE "touchable region=SkRegion\(\([0-9]+,[0-9]+,[0-9]+,[0-9]+\)\)" | grep -oE "[0-9]+" | tr '\n' ' ')
  local r=(${=region})
  local x=${NEXT_X:-$(( r[3] - r[3] * 52 / 720 ))} y=${NEXT_Y:-$(( r[4] - 55 ))}
  adb shell input tap $x $y
  sleep 1.2
}

fail() { echo "  FAIL: $1"; FAILS=$((FAILS + 1)); }
expect_ime() { [[ $(ime) == $1 ]] || fail "$2: keyboard shown should be $1"; }
expect_status() { local s=$(status); [[ $s == *"$1"* ]] || fail "$2: status '$s' lacks '$1'"; }

home() {
  adb shell am force-stop $PKG
  adb shell am start -W -n $PKG/$ACTIVITY >/dev/null
  for _ in $(seq 1 30); do visible home- && break; sleep 2; done
  for _ in 1 2 3 4; do visible home-lab-form-rn && return 0; adb shell input swipe 360 1200 360 500 300; sleep 1; done
  fail "the input lab is not on the home screen"
}

search_flow() {
  local impl=$1
  echo "search list ($impl)"
  home
  tap home-lab-search-$impl
  expect_status "focus: none · keyboard: down" "opened"
  tap lab-search
  expect_ime true "tapped the field"; expect_status "focus: search · keyboard: up" "tapped the field"
  adb shell input text an; sleep 1
  expect_ime true "typed"; expect_status "focus: search" "typed"
  drag
  # As on iOS: the drag closes the keyboard and the field lets go of focus
  # (Samsung's own apps keep the focus; this app follows iOS on purpose).
  expect_ime false "dragged the list (keyboardDismissMode on-drag)"
  expect_status "focus: none · keyboard: down" "dragged the list"
  tap lab-search
  expect_ime true "refocused"
  tap lab-row-
  visible lab-detail || fail "one tap on a row with the keyboard up did not open it"
  expect_ime false "opened a row"
  back
  visible lab-search || fail "back did not return to the list"
  # Samsung Settings search returns the same way: results kept, keyboard down.
  expect_ime false "back from the row"
  back
}

form_flow() {
  local impl=$1
  echo "form ($impl)"
  home
  tap home-lab-form-$impl
  expect_ime true "autoFocus"; expect_status "focus: first · keyboard: up" "autoFocus"
  local fields=(first last company email phone)
  local texts=(Ada Lovelace Acme ada@acme.io)
  for i in 1 2 3 4; do
    adb shell input text ${texts[$i]}; sleep 0.8
    next
    expect_ime true "Next from ${fields[$i]}"
    expect_status "focus: ${fields[$((i + 1))]} · keyboard: up" "Next from ${fields[$i]}"
  done
  tap lab-form-label
  visible lab-detail || fail "one tap on the label row with the keyboard up did not open it"
  back
  visible lab-phone || fail "back did not return to the form"
  # Back on Android leaves the keyboard down and no field focused, as Samsung
  # Contacts and Settings do; the app refocuses if it wants the keyboard back.
  expect_status "focus: none · keyboard: down" "back from the label screen"
  tap lab-notes
  expect_ime true "tapped a field again"
  drag
  expect_ime false "dragged the form (keyboardDismissMode on-drag)"
  expect_status "focus: none · keyboard: down" "dragged the form"
  back
}

motion_flow() {
  local impl=$1
  echo "motion ($impl)"
  home
  tap home-lab-motion-$impl
  expect_status "focus: none · keyboard: down" "opened"
  visible lab-cta || fail "no sticky button"
  tap lab-first
  expect_ime true "tapped the first field"
  # Next through every keyboard: text, email, decimal pad, password, a
  # TextInput in the middle, phone pad, text, multiline. The keyboard stays up.
  local fields=(first email amount password referral phone city notes)
  local texts=(Ada ada@acme.io 12.5 hunter2 FRIEND 0612345678 Lisbon)
  for i in 1 2 3 4 5 6 7; do
    adb shell input text ${texts[$i]}; sleep 0.6
    next
    expect_ime true "Next from ${fields[$i]}"
    expect_status "focus: ${fields[$((i + 1))]} · keyboard: up" "Next from ${fields[$i]}"
  done
  # A push to a step that focuses its own field, from a field with the keyboard.
  tap lab-cta
  visible lab-step-code || fail "Continue did not open the next step"
  expect_ime true "the next step's field took the keyboard"
  expect_status "focus: code · keyboard: up" "the next step"
  back   # Android: the first back closes the keyboard
  back
  visible lab-motion || fail "back did not return to the form"
  sleep 1
  expect_ime false "back on the form (Android leaves the keyboard down)"
  # A form sheet with its own field, opened from a field with the keyboard.
  tap lab-notes
  tap lab-open-sheet
  visible lab-sheet-note || fail "the sheet did not open"
  expect_ime true "the sheet's field took the keyboard"
  expect_status "focus: note · keyboard: up" "the sheet"
  back
  back
  visible lab-motion || fail "the sheet did not close"
  back
}

rows_flow() {
  local impl=$1
  echo "rows ($impl)"
  home
  tap home-lab-motion-$impl
  tap lab-open-rows
  tap lab-row-1
  expect_ime true "tapped row 1"
  # Next down the list, past the rows the list renders at first: a row that
  # does not exist yet is scrolled in and focused as it mounts.
  for i in $(seq 1 18); do
    adb shell input text $i; sleep 0.4
    next
  done
  expect_ime true "Next down 18 rows"
  expect_status "focus: row 19 · keyboard: up" "Next down 18 rows"
  drag
  expect_ime false "dragged the rows"
  back
  back
}

# The width of an element with testID $1 (a prefix), from the UI hierarchy.
width_of() {
  dump && python3 - "$TMP/ui.xml" "$1" <<'EOF2'
import re, sys, xml.etree.ElementTree as ET
for n in ET.parse(sys.argv[1]).getroot().iter('node'):
    if n.get('resource-id', '').startswith(sys.argv[2]):
        b = list(map(int, re.findall(r'\d+', n.get('bounds', ''))))
        print(b[2] - b[0]); break
EOF2
}

morph_flow() {
  local impl=$1
  echo "morphing button ($impl)"
  home
  visible home-lab-morph-$impl || adb shell input swipe 360 1200 360 700 300
  tap home-lab-morph-$impl
  local full=$(width_of lab-cta)
  tap lab-first
  sleep 0.5
  local circle=$(width_of lab-cta)
  (( circle < full / 3 )) || fail "with the keyboard up the button should be a circle (width $circle of $full)"
  tap lab-cta
  expect_ime false "the circle closes the keyboard"
  sleep 0.5
  local back=$(width_of lab-cta)
  (( back > full * 9 / 10 )) || fail "with the keyboard down the button should be full width again (width $back of $full)"
  back
}

for impl in ${=${2:-ours rn}}; do
  [[ ${1:-all} == (all|search) ]] && search_flow $impl
  [[ ${1:-all} == (all|form) ]] && form_flow $impl
  [[ ${1:-all} == (all|motion) ]] && motion_flow $impl
  [[ ${1:-all} == (all|rows) ]] && rows_flow $impl
  [[ ${1:-all} == (all|morph) ]] && morph_flow $impl
done

rm -rf $TMP
if (( FAILS )); then echo "$FAILS check(s) failed"; exit 1; fi
echo "all checks passed"
