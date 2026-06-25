#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const pkg = require(path.join(ROOT, "package.json"));
const releaseName = `forgeflow-local-v${pkg.version}`;
const distRoot = path.join(ROOT, "dist");
const releaseDir = path.join(distRoot, releaseName);

function copyFile(relativePath) {
  const source = path.join(ROOT, relativePath);
  const target = path.join(releaseDir, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function copyFileAs(sourceRelativePath, targetRelativePath) {
  const source = path.join(ROOT, sourceRelativePath);
  const target = path.join(releaseDir, targetRelativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function copyDir(relativePath, filter = () => true) {
  const source = path.join(ROOT, relativePath);
  const target = path.join(releaseDir, relativePath);
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
fs.mkdirSync(releaseDir, { recursive: true });

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
].forEach(copyFile);

copyFileAs("start.command", "Start ForgeFlow.command");
copyFileAs("start.bat", "Start ForgeFlow.bat");

copyDir("templates");
copyDir("examples");
copyDir("docs");
copyDir("scripts", (rel) => {
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
copyDir("outputs/forgeflow-release-test-dataset-2026-06-25", (rel) => {
  return !/\/run-|\/validation-/.test(rel) && !rel.includes(".DS_Store");
});
copyDir("outputs/forgeflow-model-eval");
copyDir("outputs/forgeflow-p0a-evidence-pack", (rel) => {
  return !rel.includes(".DS_Store");
});

try {
  fs.chmodSync(path.join(releaseDir, "start.command"), 0o755);
  fs.chmodSync(path.join(releaseDir, "Start ForgeFlow.command"), 0o755);
  fs.chmodSync(path.join(releaseDir, "scripts", "smoke-test.js"), 0o755);
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
