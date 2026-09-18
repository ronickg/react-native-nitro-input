#!/usr/bin/env bash
# Turns raw device screen captures into the assets the docs and the README use.
#
# Inputs, in $RAW (default ./raw), as produced by scripts/record-demos.md:
#   ios-rolling.mov      iPhone, 60 fps, native resolution
#   ios-reveal.mov
#   android-rolling.mp4  Pixel, 120 fps, native resolution
#   android-reveal.mp4
#
# Everything ships at 60 fps. The Android capture is 120 so halving it is a
# clean 2:1 with no resampling; iPhone screen capture tops out at 60.
#
# TRIM picks the window out of each raw capture: "<start> <duration>", both in
# seconds. Re-derive these after re-recording, for two reasons: the reveal clips
# loop count -> spin -> count forever, so the start has to sit just before a
# count begins, and iOS drops a Focus/notification banner over the top of the
# screen every so often, so the window has to miss those.
set -euo pipefail

TRIM_ios_rolling="10.4 12.0"
TRIM_ios_reveal="11.3 15.0"
TRIM_android_rolling="2.0 12.0"
TRIM_android_reveal="2.2 15.0"

# The README animations are separate windows: the market ticker is a loop, so a
# shorter one keeps the README light, while the reveal needs a whole
# count -> spin cycle to make sense.
README_ios_rolling="10.4 8.0"
README_android_rolling="2.0 8.0"
README_ios_reveal="11.3 15.0"
README_android_reveal="2.2 15.0"

RAW=${RAW:-raw}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
VIDEO="$ROOT/docs/static/video"
README_IMG="$ROOT/docs/static/img/readme"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

trim_for() { eval "echo \"\$TRIM_$1\""; }

# The docs render each clip in a 9:19.5 phone frame with object-fit: cover at
# 250 CSS px, so 540 wide is 2x for that frame.
encode_video() {
  local key=$1 src=$2 out=$3
  read -r ss t <<<"$(trim_for "$key")"
  ffmpeg -y -v error -ss "$ss" -t "$t" -i "$src" \
    -vf "fps=60,scale=540:-2:flags=lanczos" \
    -c:v libx264 -crf 20 -preset slow -pix_fmt yuv420p \
    -movflags +faststart -an "$out"
  echo "  $(basename "$out")  $(du -h "$out" | cut -f1)"
}

# The README pairs both platforms in one animation, 268 px per phone. Animated
# WebP rather than GIF: GIF caps at 50 fps and quantises to 256 colours, which
# is most of what made the old ones judder. Leave the encoder on its default
# effort: -m 6 costs minutes on the market clip, which has thirty numbers
# rolling at once, and buys about 3%.
encode_pair() {
  local ikey=$1 ios=$2 akey=$3 android=$4 out=$5
  read -r iss it <<<"$(eval "echo \"\$README_$ikey\"")"
  read -r ass at <<<"$(eval "echo \"\$README_$akey\"")"
  rm -rf "$TMP/f"; mkdir -p "$TMP/f"
  ffmpeg -y -v error -ss "$iss" -t "$it" -i "$ios" -ss "$ass" -t "$at" -i "$android" \
    -filter_complex "[0:v]fps=50,scale=-2:600:flags=lanczos,crop=268:600[l];\
[1:v]fps=50,scale=-2:600:flags=lanczos,crop=268:600[r];[l][r]hstack=inputs=2[v]" \
    -map "[v]" "$TMP/f/%05d.png"
  img2webp -loop 0 -d 20 -lossy -q 60 "$TMP"/f/*.png -o "$out" >/dev/null
  echo "  $(basename "$out")  $(du -h "$out" | cut -f1)"
}

echo "docs videos (60 fps):"
encode_video ios_rolling     "$RAW/ios-rolling.mov"     "$VIDEO/ios-rolling.mp4"
encode_video ios_reveal      "$RAW/ios-reveal.mov"      "$VIDEO/ios-reveal.mp4"
encode_video android_rolling "$RAW/android-rolling.mp4" "$VIDEO/android-rolling.mp4"
encode_video android_reveal  "$RAW/android-reveal.mp4"  "$VIDEO/android-reveal.mp4"

echo "README animations (50 fps):"
encode_pair ios_rolling "$RAW/ios-rolling.mov" android_rolling "$RAW/android-rolling.mp4" "$README_IMG/market.webp"
encode_pair ios_reveal  "$RAW/ios-reveal.mov"  android_reveal  "$RAW/android-reveal.mp4"  "$README_IMG/reveal.webp"
