#!/usr/bin/env bash
# Make this fixture a standalone Git project for Desktop open/trust flows.
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -d .git ]; then
  git init -b main
  git add -A
  git -c user.email=fixture@local -c user.name=fixture commit -m "baseline: Submit button fixture"
fi
echo "Fixture git ready: $(pwd)"
