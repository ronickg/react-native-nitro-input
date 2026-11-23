#!/bin/zsh
# Touch hand-off between a NitroInput and the scroll views around it, on an
# Android emulator or phone, driven with raw `input motionevent` touches. Each
# gesture starts on a field in "Fields in a pager" (Home -> Fields in a pager:
# fields in a vertical ScrollView in a horizontal pager) and must go to whoever
# it is for:
#
#   select-drift  long-press a word, drag right drifting down: the selection grows
#   select-flat   long-press a word, drag right: the selection grows
#   cursor-*      long-press past the end, drag left: in a focused field the cursor
#                 moves to the start (flat and drifting down); in an unfocused one
#                 Android drags no cursor, and the drag must not page the pager
#   scroll        a vertical swipe that starts on a field scrolls the page
#   page          a horizontal swipe that starts on a field pages the pager
#   type          tap, then type: the text lands in the field
#   mask          Uno: masked inputs, CLABE typed in: formatted in groups
#   masked-select-drift  the same drifting selection drag on the filled CLABE
#
# A selection or cursor is checked by typing over it and reading the field's
# text back from the UI hierarchy, so nothing here reads pixels.
#
#   bun run start                       # Metro for the example, in another terminal
#   ./e2e/touch-handoff-android.sh      # every check once; ANDROID_SERIAL picks the device
#   RUNS=3 ./e2e/touch-handoff-android.sh select-drift page
#
# 0.4.2 (#74) fails select-drift: its first move handed the touch back to the
# ScrollView after the long-press had started a selection drag.

set -u
export ANDROID_SERIAL=${ANDROID_SERIAL:-$(adb devices | awk 'NR==2 {print $1}')}
PKG=${PKG:-com.nitroinput.example}
RUNS=${RUNS:-1}
FAILS=0
PASSES=0
DENSITY=$(adb shell wm density | grep -oE '[0-9]+' | tail -1)
dp() { echo $(( $1 * DENSITY / 160 )); }

SIZE=($(adb shell wm size | tail -1 | grep -oE '[0-9]+'))

# The element tree comes from argent (https://github.com/software-mansion/argent):
# its UiAutomation helper holds the device's only UiAutomation connection, so
# `uiautomator dump` returns nothing while argent drives the device.
# "left top right bottom<TAB>label" in px of the element picked by $1:
#   id:<testID>   the element with that testID
#   field:<n>     the field of page one whose text carries "0-<n>"
#   nth:<k>       the k-th field on screen (field k-1 of page one, whatever its text)
node() {
  argent run describe --udid $ANDROID_SERIAL 2>/dev/null | python3 -c '
import json, re, sys
want, w, h = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
kind, _, arg = want.partition(":")
nth = 0
for line in json.load(sys.stdin)["description"].splitlines():
    m = re.search(r"\(([\d.]+),([\d.]+),([\d.]+),([\d.]+)\)\s*$", line)
    if not m: continue
    label = re.search(r"^\s*\S+\s+\"(.*?)\"(?=\s+(?:id=|\[|\())", line)
    label = label.group(1) if label else ""
    field = line.strip().startswith("TextField")
    nth = nth + 1 if field else nth
    if kind == "id" and f"id=\"{arg}\"" in line or \
       kind == "field" and field and re.search(rf"(?<![\d-])0-{arg}(?!\d)", label) or \
       kind == "nth" and field and nth == int(arg):
        x, y, fw, fh = map(float, m.groups())
        print(f"{round(x*w)} {round(y*h)} {round((x+fw)*w)} {round((y+fh)*h)}\t{label}")
        break
' "$1" ${SIZE[1]} ${SIZE[2]}
}
bounds() { local r=$(node $1); echo ${r%%$'\t'*}; }
text_of() { local r=$(node $1); [[ $r == *$'\t'* ]] && echo ${r#*$'\t'}; }
visible() { [[ -n $(node $1) ]]; }

fail() { echo "  FAIL: $1"; FAILS=$((FAILS + 1)); }
pass() { echo "  ok: $1"; PASSES=$((PASSES + 1)); }

# A touch the way a finger makes one: down, hold, then moves to the end point
# in $5 steps, up. Coordinates in px; hold in seconds.
touch() {
  local x0=$1 y0=$2 x1=$3 y1=$4 steps=$5 hold=$6
  local cmd="input motionevent DOWN $x0 $y0; sleep $hold"
  for i in $(seq 1 $steps); do
    cmd+="; input motionevent MOVE $(( x0 + (x1 - x0) * i / steps )) $(( y0 + (y1 - y0) * i / steps ))"
  done
  cmd+="; input motionevent UP $x1 $y1"
  adb shell "$cmd"
  sleep 1
}

# Opens the screen behind the home button with testID $1 (default: the pager).
open_screen() {
  local button=${1:-home-pager-fields} ready=${2:-field:0}
  adb shell am force-stop $PKG
  adb shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
  for _ in $(seq 1 30); do visible id:home-features && break; sleep 2; done
  for _ in 1 2 3 4 5; do visible id:$button && break; adb shell input swipe $(( SIZE[1] / 2 )) $(( SIZE[2] * 3 / 4 )) $(( SIZE[1] / 2 )) $(( SIZE[2] / 4 )) 300; sleep 1; done
  local b=($(bounds id:$button))
  [[ ${#b} -eq 4 ]] || { fail "no $button button on the home screen"; return 1; }
  adb shell input tap $(( (b[1] + b[3]) / 2 )) $(( (b[2] + b[4]) / 2 ))
  for _ in $(seq 1 10); do visible $ready && return 0; sleep 1; done
  fail "$button did not open its screen"; return 1
}


# Long-press "bravo" in "alpha bravo charlie delta 0-N" and drag right by 120dp
# and down by $2 dp. Typing then replaces the selection: a selection that grew
# past "charlie" leaves no "charlie".
select_drag() {
  local id=$1 drift=$2 label=$3
  local b=($(bounds $id)) before=$(text_of $id)
  local x=$(( b[1] + $(dp 62) )) y=$(( (b[2] + b[4]) / 2 ))
  touch $x $y $(( x + $(dp 120) )) $(( y + $(dp $drift) )) 12 1.2
  adb shell input text Z; sleep 0.8
  local after=$(text_of $id)
  if [[ $after != *charlie* && $after == alpha* && $after == *Z* ]]; then pass "$label: '$before' -> '$after'"
  else fail "$label: the selection did not grow: '$before' -> '$after'"; fi
}

# Long-press past the end of the text and drag to the field's left edge; the
# cursor follows. Typing lands at the start.
cursor_drag() {
  local id=$1 focused=$2 drift=$3 label=$4
  local b=($(bounds $id))
  local y=$(( (b[2] + b[4]) / 2 ))
  if [[ $focused == focused ]]; then adb shell input tap $(( b[3] - $(dp 8) )) $y; sleep 1; fi
  touch $(( b[3] - $(dp 8) )) $y $(( b[1] + 2 )) $(( y + $(dp $drift) )) 14 1.2
  adb shell input text Z; sleep 0.8
  local after=$(text_of $id) page=$(text_of id:pager-status)
  if [[ $focused == focused ]]; then
    if [[ $after == Z* ]]; then pass "$label: '$after'"
    else fail "$label: the cursor did not reach the start: '$after' ($page)"; fi
  else
    # Android drags the cursor only in a focused field (the Editor's
    # InsertionPointCursorController checks isFocused), so here the long-press
    # just places the cursor. The drag after it must not page the pager.
    if [[ $page == "page 1 of 3" && $after == *Z ]]; then pass "$label: stayed on the field: '$after'"
    else fail "$label: the drag left the field: '$after' ($page)"; fi
  fi
}

# Uno's masked inputs, CLABE filled in from the keyboard.
type_clabe() {
  local b=($(bounds nth:1))
  adb shell input tap $(( (b[1] + b[3]) / 2 )) $(( (b[2] + b[4]) / 2 )); sleep 1
  adb shell input text 012345678901234567; sleep 1
}

check() {
  case $1 in
    select-drift) select_drag nth:2 30 "long-press drag drifting down" ;;
    select-flat) select_drag nth:3 0 "flat long-press drag" ;;
    cursor-unfocused) cursor_drag nth:4 unfocused 0 "long-press past the end of an unfocused field, drag left" ;;
    cursor-focused) cursor_drag nth:5 focused 0 "cursor drag, focused" ;;
    cursor-drift) cursor_drag nth:6 focused 30 "cursor drag drifting down, focused" ;;
    scroll)
      local top0=($(bounds field:0)) b=($(bounds field:4))
      local x=$(( (b[1] + b[3]) / 2 )) y=$(( (b[2] + b[4]) / 2 ))
      touch $x $y $x $(( y - $(dp 220) )) 8 0
      local top1=($(bounds field:0))
      if [[ ${#top1} -eq 0 || ${top1[2]} -lt $(( top0[2] - $(dp 60) )) ]]; then pass "vertical swipe from a field scrolled the page"
      else fail "vertical swipe from a field did not scroll the page (top ${top0[2]} -> ${top1[2]:-gone})"; fi
      touch $x $(( y - $(dp 220) )) $x $y 8 0   # back
      ;;
    page)
      local b=($(bounds nth:3))
      local y=$(( (b[2] + b[4]) / 2 ))
      touch $(( b[3] - $(dp 20) )) $y $(( b[1] + $(dp 10) )) $y 8 0
      sleep 1
      local s=$(text_of id:pager-status)
      if [[ $s == "page 2 of 3" ]]; then pass "horizontal swipe from a field paged ($s)"
      else fail "horizontal swipe from a field did not page ('$s')"; fi
      touch $(( b[1] + $(dp 10) )) $y $(( b[3] - $(dp 20) )) $y 8 0   # back
      ;;
    type)
      local b=($(bounds nth:7))
      adb shell input tap $(( b[3] - $(dp 8) )) $(( (b[2] + b[4]) / 2 )); sleep 1
      adb shell input text '+typed'; sleep 0.8
      local after=$(text_of nth:7)
      if [[ $after == *+typed ]]; then pass "tap and type: '$after'"; else fail "tap and type: '$after'"; fi
      ;;
    mask)
      type_clabe
      local raw=$(text_of id:uno-mask-clabe-raw) shown=$(text_of nth:1)
      if [[ $raw == *012345678901234567* && $shown == "0123 4567 8901 2345 67" ]]; then pass "mask: '$shown' ($raw)"
      else fail "mask: '$shown' ($raw)"; fi
      ;;
    masked-select-drift)
      # The tester's repro from 0.4.2: Uno's masked CLABE field in a
      # KeyboardAwareScrollView. Long-press "4567" and drag right drifting
      # down; a digit typed then replaces every group the selection covers.
      type_clabe
      local b=($(bounds nth:1))
      local x=$(( b[1] + $(dp 60) )) y=$(( (b[2] + b[4]) / 2 ))
      touch $x $y $(( x + $(dp 120) )) $(( y + $(dp 30) )) ${STEPS:-12} 1.2
      adb shell input text 9; sleep 0.8
      local raw=$(text_of id:uno-mask-clabe-raw) digits
      digits=${raw//[^0-9]/}
      if (( ${#digits} <= 13 )); then pass "masked long-press drag drifting down: '$(text_of nth:1)'"
      else fail "masked long-press drag drifting down: the selection did not grow: '$(text_of nth:1)'"; fi
      ;;
    *) echo "unknown check $1"; FAILS=$((FAILS + 1)) ;;
  esac
}

CHECKS=(select-drift select-flat cursor-unfocused cursor-focused cursor-drift scroll page type mask masked-select-drift)
(( $# )) && CHECKS=($@)
for run in $(seq 1 $RUNS); do
  echo "run $run/$RUNS"
  for c in $CHECKS; do
    if [[ $c == mask* ]]; then open_screen home-uno-masks id:uno-mask-clabe-raw || continue
    else open_screen || continue; fi
    echo "$c"
    check $c
  done
done
echo "$PASSES passed, $FAILS failed"
(( FAILS == 0 ))
