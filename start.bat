@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo ForgeFlow needs Node.js 20 or newer.
  echo Install Node.js from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)
echo Starting ForgeFlow Local...
echo Open http://127.0.0.1:4173/outputs/forgeflow-p0b-decision-console.html
node server.js
