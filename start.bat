@echo off
cd /d "%~dp0"
set APP_URL=http://127.0.0.1:4173/outputs/forgeflow-p0b-decision-console.html
where node >nul 2>nul
if errorlevel 1 (
  echo ForgeFlow needs Node.js 20 or newer.
  echo Install Node.js from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)
netstat -ano | findstr /R /C:"127.0.0.1:4173 .*LISTENING" >nul 2>nul
if not errorlevel 1 (
  echo ForgeFlow Local is already running.
  echo Opening %APP_URL%
  start "" "%APP_URL%"
  pause
  exit /b 0
)
echo Starting ForgeFlow Local...
echo Open %APP_URL%
start "" "%APP_URL%"
node server.js
