#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const pkg = require(path.join(ROOT, "package.json"));
const releaseName = `forgeflow-local-v${pkg.version}`;
const distRoot = path.join(ROOT, "dist");
const releaseDir = path.join(distRoot, releaseName);
const appDir = path.join(releaseDir, "app");
const appUrl = "http://127.0.0.1:4173/outputs/forgeflow-p0b-decision-console.html";

function writeFile(targetRelativePath, content, mode) {
  const target = path.join(releaseDir, targetRelativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  if (mode) fs.chmodSync(target, mode);
}

function copyFile(sourceRelativePath, targetRelativePath = sourceRelativePath) {
  const source = path.join(ROOT, sourceRelativePath);
  const target = path.join(appDir, targetRelativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function copyFileToRoot(sourceRelativePath, targetRelativePath = sourceRelativePath) {
  const source = path.join(ROOT, sourceRelativePath);
  const target = path.join(releaseDir, targetRelativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function copyDir(sourceRelativePath, targetRelativePath = sourceRelativePath, filter = () => true) {
  const source = path.join(ROOT, sourceRelativePath);
  const target = path.join(appDir, targetRelativePath);
  fs.cpSync(source, target, {
    recursive: true,
    filter: (item) => {
      const rel = path.relative(ROOT, item);
      return filter(rel);
    }
  });
}

function copyDirToRoot(sourceRelativePath, targetRelativePath = sourceRelativePath, filter = () => true) {
  const source = path.join(ROOT, sourceRelativePath);
  const target = path.join(releaseDir, targetRelativePath);
  fs.cpSync(source, target, {
    recursive: true,
    filter: (item) => {
      const rel = path.relative(ROOT, item);
      return filter(rel);
    }
  });
}

function removeIfExists(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

removeIfExists(releaseDir);
fs.mkdirSync(appDir, { recursive: true });

[
  "README.md",
  "START_HERE.md",
  "QUICKSTART.md",
  "LICENSE"
].forEach((file) => copyFileToRoot(file));

writeFile(
  "Start ForgeFlow.command",
  `#!/bin/zsh
cd "$(dirname "$0")/app"

APP_URL="${appUrl}"

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
`,
  0o755
);

writeFile(
  "Start ForgeFlow.bat",
  `@echo off
cd /d "%~dp0app"
set APP_URL=${appUrl}
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
`,
  0o644
);

copyDirToRoot("templates");
copyDirToRoot("examples");
copyDirToRoot("outputs/forgeflow-release-test-dataset-2026-06-25", "sample-data", (rel) => {
  return !/\/run-|\/validation-/.test(rel) && !rel.includes(".DS_Store");
});

[
  "package.json",
  "server.js",
  "README.md",
  "START_HERE.md",
  "QUICKSTART.md",
  "DATA_MODEL.md",
  "PRIVACY.md",
  "CHANGELOG.md",
  "RELEASE_CHECKLIST.md",
  "LICENSE",
  "start.command",
  "start.bat",
  "run-backtest.js"
].forEach((file) => copyFile(file));

copyDir("templates");
copyDir("examples");
copyDir("docs");
copyDir("scripts", "scripts", (rel) => {
  const keep = [
    "scripts/run_demo.py",
    "scripts/run_forgeflow.py",
    "scripts/validate_inputs.py",
    "scripts/import_xhs_orders.py",
    "scripts/smoke-test.js",
    "scripts/build-release.js"
  ];
  return rel === "scripts" || keep.includes(rel);
});

copyFile("outputs/forgeflow-p0b-decision-console.html");
copyFile("outputs/forgeflow-intro-video/renders/forgeflow-intro-10s-final.mp4");
copyDir("outputs/forgeflow-release-test-dataset-2026-06-25", "outputs/forgeflow-release-test-dataset-2026-06-25", (rel) => {
  return !/\/run-|\/validation-/.test(rel) && !rel.includes(".DS_Store");
});
copyDir("outputs/forgeflow-model-eval");
copyDir("outputs/forgeflow-p0a-evidence-pack", "outputs/forgeflow-p0a-evidence-pack", (rel) => {
  return !rel.includes(".DS_Store");
});

try {
  fs.chmodSync(path.join(appDir, "start.command"), 0o755);
  fs.chmodSync(path.join(appDir, "scripts", "smoke-test.js"), 0o755);
} catch (error) {
  // chmod is best-effort on non-POSIX systems.
}

const zipPath = path.join(distRoot, `${releaseName}.zip`);
removeIfExists(zipPath);
const zip = childProcess.spawnSync("zip", ["-qr", `${releaseName}.zip`, releaseName], {
  cwd: distRoot,
  stdio: "inherit"
});
if (zip.status !== 0) {
  console.log(`Release folder created: ${releaseDir}`);
  console.log("zip command not available or failed; folder is still ready.");
  process.exit(0);
}

console.log(`Release folder created: ${releaseDir}`);
console.log(`Release zip created: ${zipPath}`);
