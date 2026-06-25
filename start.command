#!/bin/zsh
cd "$(dirname "$0")"

APP_URL="http://127.0.0.1:4173/outputs/forgeflow-p0b-decision-console.html"

if ! command -v node >/dev/null 2>&1; then
  echo "ForgeFlow needs Node.js 20 or newer."
  echo "Install Node.js from https://nodejs.org/ and run this file again."
  read "?Press Enter to close..."
  exit 1
fi

if lsof -nP -iTCP:4173 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "ForgeFlow Local is already running."
  echo "Opening $APP_URL"
  open "$APP_URL" >/dev/null 2>&1 || true
  read "?Press Enter to close..."
  exit 0
fi

echo "Starting ForgeFlow Local..."
echo "Open $APP_URL"
echo ""
open "$APP_URL" >/dev/null 2>&1 || true
node server.js
