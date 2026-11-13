#!/usr/bin/env bash
#
# The headless harness's test video (docs/headless-ui.md): two minutes of
# 1280×720 at 25 fps, ffmpeg's testsrc pattern with the timecode burnt in, as
# H.264 with the index up front, plus a poster PNG of its first frame.
#
# Generated, never committed (the repo is public; headless/fixtures/ is
# ignored). Idempotent: an existing video and poster are left alone; FORCE=1
# makes them again. install-mocks.ts answers probe_video with these numbers,
# so change both together.
#
#   apps/desktop/headless/make-fixture.sh
#
# Uses the app's own sidecar (src-tauri/binaries/ffmpeg-<arch>-apple-darwin,
# which has drawtext) when it is there, else ffmpeg on PATH.
set -euo pipefail
trap 'echo "make-fixture.sh: failed at line $LINENO" >&2' ERR

cd "$(dirname "$0")"
OUT="fixtures"
VIDEO="$OUT/game.mp4"
POSTER="$OUT/poster.png"

if [[ -z "${FORCE:-}" && -s "$VIDEO" && -s "$POSTER" ]]; then
  echo "# Fixture present: $PWD/$VIDEO"
  exit 0
fi

ARCH="$(uname -m)"; [[ "$ARCH" == "arm64" ]] && ARCH="aarch64"
FFMPEG=""
for candidate in "../src-tauri/binaries/ffmpeg-$ARCH-apple-darwin" ../src-tauri/binaries/ffmpeg-universal-apple-darwin; do
  if [[ -x "$candidate" ]]; then FFMPEG="$candidate"; break; fi
done
FFMPEG="${FFMPEG:-$(command -v ffmpeg || true)}"
if [[ -z "$FFMPEG" ]]; then echo "No ffmpeg: neither src-tauri/binaries/ffmpeg-* nor ffmpeg on PATH." >&2; exit 1; fi

# The timecode needs drawtext (libfreetype) and a font file; without either,
# testsrc's own seconds counter is the only clock on the frame.
FILTER="null"
FONT="/System/Library/Fonts/Menlo.ttc"
if "$FFMPEG" -hide_banner -filters 2>/dev/null | grep -q " drawtext " && [[ -f "$FONT" ]]; then
  FILTER="drawtext=fontfile=$FONT:timecode='00\:00\:00\:00':rate=25:fontsize=48:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=12:x=(w-tw)/2:y=h-th-48"
else
  echo "# $FFMPEG has no drawtext (or $FONT is missing): no burnt-in timecode" >&2
fi

mkdir -p "$OUT"
echo "# Writing $PWD/$VIDEO with $FFMPEG"
"$FFMPEG" -hide_banner -loglevel error -y \
  -f lavfi -i testsrc=duration=120:size=1280x720:rate=25 \
  -vf "$FILTER" \
  -c:v libx264 -pix_fmt yuv420p -movflags +faststart \
  "$VIDEO"
"$FFMPEG" -hide_banner -loglevel error -y -i "$VIDEO" -frames:v 1 "$POSTER"
echo "# Done: $(du -h "$VIDEO" | cut -f1) video, poster at $PWD/$POSTER"
