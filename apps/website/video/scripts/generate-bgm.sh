#!/usr/bin/env bash
# Generate PiX hero BGM via ElevenLabs Music, then mux into the three marketing MP4s.
# Requires ELEVENLABS_API_KEY with music_generation permission (from repo .env.local).
set -euo pipefail

export PATH="/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:${PATH:-}"

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT"

ELEVENLABS_API_KEY="${ELEVENLABS_API_KEY:-}"
if [[ -z "$ELEVENLABS_API_KEY" && -f .env.local ]]; then
  ELEVENLABS_API_KEY="$(python3 - <<'PY'
from pathlib import Path
for line in Path(".env.local").read_text().splitlines():
    if line.startswith("ELEVENLABS_API_KEY="):
        print(line.split("=", 1)[1].strip().strip('"').strip("'"))
PY
)"
fi
export ELEVENLABS_API_KEY

if [[ -z "${ELEVENLABS_API_KEY}" ]]; then
  echo "Missing ELEVENLABS_API_KEY" >&2
  exit 1
fi

AUDIO_DIR="apps/website/public/audio"
VIDEO_DIR="apps/website/public/videos"
mkdir -p "$AUDIO_DIR"
BGM="$AUDIO_DIR/pix-bgm.mp3"
BODY_JSON="$AUDIO_DIR/pix-bgm.request.json"

python3 - <<'PY' >"$BODY_JSON"
import json
print(json.dumps({
    "prompt": (
        "Instrumental only. Soft organic ambient underscore for a calm coding-agent "
        "product demo. Warm sage mood: gentle analog pads, sparse clean electric piano, "
        "very light soft kick and brushed rim at 86 BPM, airy high shimmer, restrained "
        "and trustworthy, modern minimal tech but not cold. No vocals, no lyrics, no EDM "
        "drops, no cinematic trailer. Short loop-friendly bed under UI motion."
    ),
    "music_length_ms": 15000,
    "model_id": "music_v2",
    "force_instrumental": True,
}))
PY

echo "→ Composing BGM (music_v2, ~15s instrumental)…"
HTTP=$(curl -sS -X POST "https://api.elevenlabs.io/v1/music?output_format=mp3_44100_192" \
  -H "xi-api-key: ${ELEVENLABS_API_KEY}" \
  -H "Content-Type: application/json" \
  --data-binary @"$BODY_JSON" \
  --output "$BGM" -w "%{http_code}")
rm -f "$BODY_JSON"

if [[ "$HTTP" != "200" ]]; then
  echo "ElevenLabs music failed HTTP $HTTP:" >&2
  head -c 500 "$BGM" >&2 || true
  echo >&2
  echo "Fix: ElevenLabs → Developers → API Keys → edit this key → enable Music (music_generation)." >&2
  echo "Music API usually needs a paid plan that includes Eleven Music." >&2
  exit 1
fi

file "$BGM"

mux() {
  local name="$1"
  local dur="$2"
  local src="$VIDEO_DIR/${name}.mp4"
  local tmp="$VIDEO_DIR/${name}.with-audio.tmp.mp4"
  local fade_start
  fade_start="$(python3 -c "print(max(0, float('${dur}') - 1.2))")"
  echo "→ Mux $name (${dur}s)…"
  ffmpeg -y -hide_banner -loglevel error -i "$src" -i "$BGM" \
    -filter_complex "[1:a]atrim=0:${dur},afade=t=in:st=0:d=0.45,afade=t=out:st=${fade_start}:d=1.2,volume=-12dB,apad=whole_dur=${dur}[a]" \
    -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 160k -shortest -movflags +faststart "$tmp"
  mv "$tmp" "$src"
  echo "  ✓ $src"
}

mux workbench 13.056
mux agent-run 13.056
mux usage 12.053

echo "Done."
