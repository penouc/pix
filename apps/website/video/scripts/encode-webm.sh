#!/usr/bin/env bash
# Convert rendered MP4 hero clips to VP9/Opus WebM (smaller for Chromium).
set -euo pipefail
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:${PATH:-}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VID="$ROOT/../public/videos"

for name in workbench agent-run usage; do
  src="$VID/${name}.mp4"
  out="$VID/${name}.webm"
  if [[ ! -f "$src" ]]; then
    echo "missing $src" >&2
    exit 1
  fi
  echo "→ $out"
  ffmpeg -y -hide_banner -loglevel error -i "$src" \
    -c:v libvpx-vp9 -b:v 0 -crf 34 -row-mt 1 -cpu-used 3 -pix_fmt yuv420p \
    -c:a libopus -b:a 96k \
    "$out"
done
echo "Done."
