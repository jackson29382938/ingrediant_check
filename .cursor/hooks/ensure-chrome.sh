#!/bin/bash
# Start the headed Chrome + extension session if it is not already running.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
if node "$ROOT/scripts/ab.mjs" get url >/tmp/ingredient-check-chrome.url 2>/dev/null; then
  printf '%s\n' '{}'
  exit 0
fi

node "$ROOT/scripts/dev-chrome.mjs" --no-watch >/tmp/ingredient-check-chrome.log 2>&1 &
printf '%s\n' '{}'
exit 0
