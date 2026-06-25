#!/bin/zsh
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "ForgeFlow needs Node.js 20 or newer."
  echo "Install Node.js from https://nodejs.org/ and run this file again."
  read "?Press Enter to close..."
  exit 1
fi

echo "Starting ForgeFlow Local..."
echo "Open http://127.0.0.1:4173/outputs/forgeflow-p0b-decision-console.html"
echo ""
node server.js
