#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [ -d .git ]; then exit 0; fi
git init -q
git config user.email "fixture@pi-desktop.test"
git config user.name "Pi Desktop Fixture"
git add -A
git commit -q -m "baseline"
# Simulate pre-existing uncommitted work: update header.js title
sed -i.bak "s/My App/My Application/" src/header.js && rm -f src/header.js.bak
