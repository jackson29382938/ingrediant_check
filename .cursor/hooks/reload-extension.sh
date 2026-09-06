#!/bin/bash
# After an agent or Tab edit, reload the unpacked extension in the Chrome session.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REQ="/tmp/ingredient-check-reload.stamp"
input="$(cat || true)"

should_reload=1
if command -v python3 >/dev/null 2>&1; then
  path="$(printf '%s' "$input" | python3 -c '
import json, sys
raw = sys.stdin.read()
try:
    data = json.loads(raw) if raw.strip() else {}
except Exception:
    data = {}
print(data.get("file_path") or data.get("path") or data.get("file") or "")
' 2>/dev/null || true)"
  case "$path" in
    "") ;;
    *"/src/"*|*"/icons/"*|*/manifest.json|*/manifest.json) ;;
    *)
      # Ignore edits outside the extension payload (scripts, hooks, tests).
      should_reload=0
      ;;
  esac
fi

if [ "$should_reload" -eq 0 ]; then
  printf '%s\n' '{}'
  exit 0
fi

stamp="$(python3 -c 'import time; print(int(time.time() * 1000))' 2>/dev/null || date +%s)"
printf '%s\n' "$stamp" > "$REQ"
sleep 0.7
if [ "$(cat "$REQ" 2>/dev/null || true)" != "$stamp" ]; then
  printf '%s\n' '{}'
  exit 0
fi

node "$ROOT/scripts/reload-extension.mjs" >/tmp/ingredient-check-reload.log 2>&1 || true
printf '%s\n' '{}'
exit 0
