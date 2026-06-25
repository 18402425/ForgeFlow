#!/usr/bin/env node
const childProcess = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.FORGEFLOW_SMOKE_PORT || 4183);
const HOST = "127.0.0.1";
const BASE = `http://${HOST}:${PORT}`;

function run(command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, ...options.env }
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with ${result.status}`);
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body ? Buffer.from(options.body) : null;
    const req = http.request(url, {
      method: options.method || "GET",
      headers: {
        ...(body ? { "content-type": "application/json", "content-length": body.length } : {}),
        ...(options.headers || {})
      }
    }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null });
        } catch (error) {
          reject(new Error(`Invalid JSON from ${url}: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function requestText(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    }).on("error", reject);
  });
}

async function waitForServer(child) {
  const deadline = Date.now() + 10000;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early with ${child.exitCode}`);
    try {
      const result = await requestJson(`${BASE}/api/p0b/state`);
      if (result.status === 200 && result.body?.ok) return;
    } catch (error) {
      lastError = error;
    }
    await wait(250);
  }
  throw lastError || new Error("server did not become ready");
}

async function main() {
  console.log("ForgeFlow smoke: syntax");
  run("node", ["--check", "server.js"]);

  console.log("ForgeFlow smoke: demo planner");
  run("python3", ["scripts/run_demo.py"]);

  console.log("ForgeFlow smoke: start local server");
  const smokeStateJson = path.join(ROOT, "outputs", ".smoke-state.json");
  const smokeStateSqlite = path.join(ROOT, "outputs", ".smoke-state.sqlite");
  fs.rmSync(smokeStateJson, { force: true });
  fs.rmSync(smokeStateSqlite, { force: true });
  const child = childProcess.spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PORT: String(PORT),
      P0B_STATE_PATH: smokeStateJson,
      P0B_SQLITE_PATH: smokeStateSqlite,
      FORGEFLOW_PROXY_REEXEC: "1"
    }
  });
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));

  try {
    await waitForServer(child);

    const page = await requestText(`${BASE}/outputs/forgeflow-p0b-decision-console.html`);
    if (page.status !== 200 || !page.body.includes("今日决策台")) {
      throw new Error("decision console did not load");
    }

    const contract = await requestJson(`${BASE}/api/p0b/explanation-contract`);
    if (contract.status !== 200 || !contract.body?.ok) {
      throw new Error("explanation contract API failed");
    }

    const aiMissingKey = await requestJson(`${BASE}/api/ai/chat-completions`, {
      method: "POST",
      body: JSON.stringify({ provider: "openai", apiKey: "", messages: [] })
    });
    if (aiMissingKey.status !== 400 || !aiMissingKey.body?.reason) {
      throw new Error("AI proxy missing-key validation failed");
    }

    const reset = await requestJson(`${BASE}/api/p0b/reset`, { method: "POST", body: "{}" });
    if (reset.status !== 200 || !reset.body?.ok) {
      throw new Error("reset API failed");
    }

    console.log("ForgeFlow smoke: PASS");
  } finally {
    child.kill("SIGTERM");
    await wait(300);
    fs.rmSync(smokeStateJson, { force: true });
    fs.rmSync(smokeStateSqlite, { force: true });
  }
}

main().catch((error) => {
  console.error(`ForgeFlow smoke: FAIL - ${error.message}`);
  process.exit(1);
});
