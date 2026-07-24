#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -d .git ]; then
  git init -b baseline
  git add -A
  git -c user.email=fixture@local -c user.name=fixture commit -m "baseline: query states"
fi
echo "Fixture git ready: $(pwd)"
