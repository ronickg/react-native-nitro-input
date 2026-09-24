#!/usr/bin/env bash
# Turns raw screen captures into the assets the docs and the README use.
#
# Inputs, in $RAW (default ./raw), as produced by scripts/record-demos.md, all
# from a Samsung Galaxy A22 (a budget phone, MediaTek Helio G80, 90 Hz panel):
#   android-market.mp4
#   android-reveal.mp4
#   android-transfer.mp4
#
# The docs videos keep the panel's 90 fps. The README animations are 50 fps
# animated WebP (a whole-millisecond frame delay).
#
# TRIM picks the window out of each raw capture: "<start> <duration>", both in
# seconds. Re-derive these after re-recording: the reward and transfer
# showcases loop, so a window should be one whole turn from its start.
set -euo pipefail

TRIM_market="2.0 12.0"
# The reward showcase loops one count reveal: the window starts as the gift
# appears and runs one whole round (12 s), which the <video loop> repeats.
TRIM_reveal="11.2 12.0"
# The transfer showcase types, switches currency, backspaces, reshapes and
# clears on a 10.6 s loop; the window is one whole turn from the empty field.
TRIM_transfer="7.83 10.6"

README_market="2.0 8.0"
README_reveal="11.2 12.0"
README_transfer="7.83 10.6"

RAW=${RAW:-raw}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
VIDEO="$ROOT/docs/static/video"
README_IMG="$ROOT/docs/static/img/readme"
mkdir -p "$VIDEO" "$README_IMG"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

window() { eval "echo \"\$$1_$2\""; }

# The A22 draws its three-button navigation bar over the bottom 90 px of its
# 720x1600 screen, and screenrecord captures it; the clips end above it.
CROP="crop=720:1510:0:0"

# The docs render each clip in a 9:19.5 phone frame with object-fit: cover at
# 320 CSS px, so 640 wide is exactly 2x for that frame.
encode_video() {
  local name=$1
  read -r ss t <<<"$(window TRIM "$name")"
  ffmpeg -y -v error -ss "$ss" -t "$t" -i "$RAW/android-$name.mp4" \
    -vf "$CROP,fps=90,scale=640:-2:flags=lanczos" \
    -c:v libx264 -crf 23 -preset slow -pix_fmt yuv420p \
    -movflags +faststart -an "$VIDEO/$name.mp4"
  echo "  $name.mp4  $(du -h "$VIDEO/$name.mp4" | cut -f1)"
}

# One phone per animation, 300 px wide. Animated WebP rather than GIF: GIF
# caps at 50 fps and quantises to 256 colours, which is most of what made the
# old ones judder. Leave the encoder on its default effort: -m 6 costs minutes
# on the market clip, which has dozens of numbers moving at once, and buys
# about 3%.
encode_webp() {
  local name=$1
  read -r ss t <<<"$(window README "$name")"
  rm -rf "$TMP/f"; mkdir -p "$TMP/f"
  ffmpeg -y -v error -ss "$ss" -t "$t" -i "$RAW/android-$name.mp4" \
    -vf "$CROP,fps=50,scale=300:-2:flags=lanczos" "$TMP/f/%05d.png"
  img2webp -loop 0 -d 20 -lossy -q 50 "$TMP"/f/*.png -o "$README_IMG/$name.webp" >/dev/null
  echo "  $name.webp  $(du -h "$README_IMG/$name.webp" | cut -f1)"
}

echo "docs videos (90 fps):"
for name in market reveal transfer; do encode_video "$name"; done

echo "README animations (50 fps):"
for name in market reveal transfer; do encode_webp "$name"; done
