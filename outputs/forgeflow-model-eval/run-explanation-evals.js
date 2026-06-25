const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const casesPath = path.join(__dirname, "cases.jsonl");
const outputsPath = process.env.P0B_MODEL_OUTPUTS || process.argv[2] || "";
const externalBaseUrl = process.env.P0B_BASE_URL || "";
const port = Number(process.env.P0B_EVAL_PORT || 4184);
const host = "127.0.0.1";
const baseUrl = externalBaseUrl || `http://${host}:${port}`;
const sqlitePath = path.join(root, "outputs", ".tmp-p0b-eval-state.sqlite");
const statePath = path.join(root, "outputs", ".tmp-p0b-eval-state.json");

function readJsonl(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(method, pathname, body, expectedStatuses = [200]) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!expectedStatuses.includes(response.status)) {
    throw new Error(`${method} ${pathname} got ${response.status}: ${text.slice(0, 300)}`);
  }
  return payload;
}

async function waitForServer() {
  let lastError = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await request("GET", "/api/p0b/state");
      return;
    } catch (error) {
      lastError = error;
      await wait(100);
    }
  }
  throw lastError || new Error("server_not_ready");
}

function outputsByCase(records) {
  const map = new Map();
  for (const record of records) {
    const caseId = record.case_id || record.caseId;
    if (!caseId) continue;
    map.set(caseId, record.output || record.ai_output || record.model_output || record);
  }
  return map;
}

function fallbackOutputFromCase(testCase) {
  if (testCase.input?.ai_draft_to_validate) return testCase.input.ai_draft_to_validate;
  return null;
}

async function main() {
  const cases = readJsonl(casesPath);
  const outputRecords = readJsonl(outputsPath);
  const outputMap = outputsByCase(outputRecords);
  let child = null;
  if (!externalBaseUrl) {
    fs.rmSync(sqlitePath, { force: true });
    fs.rmSync(statePath, { force: true });
    child = spawn(process.execPath, ["server.js"], {
      cwd: root,
      env: {
        ...process.env,
        HOST: host,
        PORT: String(port),
        P0B_SQLITE_PATH: sqlitePath,
        P0B_STATE_PATH: statePath
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
  }

  try {
    await waitForServer();
    const results = [];
    for (const testCase of cases) {
      const output = outputMap.get(testCase.case_id) || fallbackOutputFromCase(testCase);
      if (!output) {
        results.push({
          case_id: testCase.case_id,
          task_type: testCase.task_type,
          status: "missing_output",
          valid: false,
          issue_count: 1,
          issues: ["missing_model_output"]
        });
        continue;
      }
      const payload = await request("POST", "/api/p0b/explanation/validate", {
        deterministic_result: testCase.input?.deterministic_result || {},
        output
      }, [200, 422]);
      results.push({
        case_id: testCase.case_id,
        task_type: testCase.task_type,
        status: payload.validation.status,
        valid: payload.validation.valid,
        issue_count: payload.validation.issue_count,
        issues: payload.validation.issues,
        forbidden_claims_detected: payload.validation.forbidden_claims_detected
      });
    }
    const validatedResults = results.filter((item) => item.status !== "missing_output");
    const hasExternalOutputs = outputRecords.length > 0;
    const summary = {
      ok: hasExternalOutputs ? validatedResults.every((item) => item.valid) : true,
      mode: hasExternalOutputs ? "external_model_outputs" : "smoke_without_model_outputs",
      evaluated_at: new Date().toISOString(),
      case_count: cases.length,
      output_count: outputRecords.length,
      validated_output_count: results.filter((item) => item.status !== "missing_output").length,
      missing_output_count: results.filter((item) => item.status === "missing_output").length,
      fact_violation_count: validatedResults.reduce((sum, item) => sum + (item.valid ? 0 : item.issue_count), 0),
      hard_fail_count: validatedResults.filter((item) => (item.issues || []).some((issue) => String(issue).startsWith("hard_fail"))).length,
      badcase_list: (hasExternalOutputs ? validatedResults : validatedResults.filter((item) => !item.valid)).filter((item) => !item.valid).slice(0, 20)
    };
    console.log(JSON.stringify({ summary, results }, null, 2));
    if (hasExternalOutputs && summary.fact_violation_count > 0 && summary.validated_output_count > 0) process.exitCode = 1;
  } finally {
    if (child) {
      child.kill();
      fs.rmSync(sqlitePath, { force: true });
      fs.rmSync(`${sqlitePath}-wal`, { force: true });
      fs.rmSync(`${sqlitePath}-shm`, { force: true });
      fs.rmSync(statePath, { force: true });
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
