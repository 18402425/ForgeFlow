const http = require("node:http");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const childProcess = require("node:child_process");
let DatabaseSync = null;
try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch (error) {
  DatabaseSync = null;
}

function detectMacProxyEnv() {
  if (process.platform !== "darwin") return null;
  if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY) return null;
  try {
    const output = childProcess.execFileSync("scutil", ["--proxy"], { encoding: "utf8" });
    const httpsEnabled = /HTTPSEnable\s*:\s*1/.test(output);
    const httpEnabled = /HTTPEnable\s*:\s*1/.test(output);
    const httpsHost = output.match(/HTTPSProxy\s*:\s*([^\n]+)/)?.[1]?.trim();
    const httpsPort = output.match(/HTTPSPort\s*:\s*(\d+)/)?.[1]?.trim();
    const httpHost = output.match(/HTTPProxy\s*:\s*([^\n]+)/)?.[1]?.trim();
    const httpPort = output.match(/HTTPPort\s*:\s*(\d+)/)?.[1]?.trim();
    const proxyHost = httpsHost || httpHost;
    const proxyPort = httpsPort || httpPort;
    if (!(httpsEnabled || httpEnabled) || !proxyHost || !proxyPort) return null;
    const proxyUrl = `http://${proxyHost}:${proxyPort}`;
    return {
      NODE_USE_ENV_PROXY: "1",
      HTTPS_PROXY: proxyUrl,
      HTTP_PROXY: proxyUrl,
      NO_PROXY: process.env.NO_PROXY || "127.0.0.1,localhost,::1"
    };
  } catch (error) {
    return null;
  }
}

const autoProxyEnv = detectMacProxyEnv();
if (autoProxyEnv && process.env.FORGEFLOW_PROXY_REEXEC !== "1") {
  const child = childProcess.spawnSync(process.execPath, process.argv.slice(1), {
    stdio: "inherit",
    env: {
      ...process.env,
      ...autoProxyEnv,
      FORGEFLOW_PROXY_REEXEC: "1"
    }
  });
  process.exit(child.status ?? 0);
}

const root = __dirname;
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const backendStatePath = process.env.P0B_STATE_PATH || path.join(root, "outputs", "forgeflow-p0b-backend-state.json");
const sqliteStatePath = process.env.P0B_SQLITE_PATH || path.join(root, "outputs", "forgeflow-p0b-backend-state.sqlite");
const baselinePath = process.env.P0B_BASELINE_PATH || path.join(root, "outputs", "forgeflow-p0a-evidence-pack", "expected", "today_plan_xhs_20260608_pending_7.json");
const skuFixturePath = process.env.P0B_SKU_FIXTURE_PATH || path.join(root, "outputs", "forgeflow-p0a-evidence-pack", "fixtures", "sku_xhs_20260608.csv");
const allowedClaimsPath = process.env.P0B_ALLOWED_CLAIMS_PATH || path.join(root, "outputs", "forgeflow-model-eval", "allowed_claims.json");
const forbiddenClaimsPath = process.env.P0B_FORBIDDEN_CLAIMS_PATH || path.join(root, "outputs", "forgeflow-model-eval", "forbidden_claims.json");

const EVENT_SCHEMA_VERSION = "p0b.event.v2";
const LEDGER_SCHEMA_VERSION = "p0b.ledger.v1";
const EXPLANATION_CONTRACT_VERSION = "p0b.explanation_contract.v1";
const PLANNER_RULE = "server_planner_replay_contract_v1";
const STATE_STORE_VERSION = "p0b.sqlite_state.v1";
const P05_GATE_VERSION = "p0b_to_p05_gate.v1";
const P05_PREWORK_VERSION = "p05.prework.v1";
const P05_REAL_7_DAY_PILOT_REQUIRED = process.env.P05_REAL_7_DAY_PILOT_REQUIRED === "true";
const CALIBRATION_MIN_SAMPLES = 3;
const CALIBRATION_DELTA_THRESHOLD_G = 5;
const EVIDENCE_ONLY_EVENT_TYPES = new Set(["decision_outcome_submit"]);
const OUTCOME_SOURCES = new Set(["real", "demo"]);

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function hashObject(value) {
  return `H-${hashString(stableStringify(value))}`;
}

function versionNumber(value) {
  const normalized = String(value ?? "1").replace(/^v/i, "");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 1;
}

function nextBackendId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function isEvidenceOnlyEvent(eventType) {
  return EVIDENCE_ONLY_EVENT_TYPES.has(eventType);
}

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const normalized = path.normalize(decoded === "/" ? "/outputs/forgeflow-p0b-decision-console.html" : decoded);
  const fullPath = path.join(root, normalized);
  const relative = path.relative(root, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return fullPath;
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" && fallback !== undefined) return clone(fallback);
    throw error;
  }
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`);
  await fs.rename(tmpPath, filePath);
}

function sqliteEnabled() {
  return Boolean(DatabaseSync) && process.env.P0B_STATE_BACKEND !== "json";
}

async function ensureSqliteDir() {
  await fs.mkdir(path.dirname(sqliteStatePath), { recursive: true });
}

function openStateDb() {
  if (!sqliteEnabled()) return null;
  const db = new DatabaseSync(sqliteStatePath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS p0b_state (
      state_key TEXT PRIMARY KEY,
      schema_version TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS decision_events (
      event_id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL,
      event_type TEXT NOT NULL,
      decision_id TEXT,
      decision_version_before INTEGER,
      decision_version_after INTEGER,
      backend_status TEXT,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inventory_movements (
      movement_id TEXT PRIMARY KEY,
      event_id TEXT,
      material_id TEXT NOT NULL,
      movement_type TEXT NOT NULL,
      before_g REAL,
      delta_g REAL,
      after_g REAL,
      status TEXT,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS planner_runs (
      planner_run_id TEXT PRIMARY KEY,
      planner_rule TEXT NOT NULL,
      input_event_count INTEGER,
      current_decision_version INTEGER,
      ship_today_count INTEGER,
      output_hash TEXT,
      payload_json TEXT NOT NULL,
      replayed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS decision_outcomes (
      outcome_id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      pilot_day TEXT,
      mode TEXT,
      actual_ship_count INTEGER,
      actual_delay_count INTEGER,
      predicted_ship_count INTEGER,
      prediction_error INTEGER,
      adopted_system_plan INTEGER,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

async function readSqliteState() {
  if (!sqliteEnabled()) return null;
  await ensureSqliteDir();
  const db = openStateDb();
  try {
    const row = db.prepare("SELECT payload_json FROM p0b_state WHERE state_key = ?").get("current");
    return row ? JSON.parse(row.payload_json) : null;
  } finally {
    db.close();
  }
}

async function writeSqliteState(state) {
  if (!sqliteEnabled()) return false;
  await ensureSqliteDir();
  const db = openStateDb();
  const now = new Date().toISOString();
  try {
    db.exec("BEGIN");
    db.prepare(`
      INSERT INTO p0b_state (state_key, schema_version, payload_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(state_key) DO UPDATE SET
        schema_version = excluded.schema_version,
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at
    `).run("current", STATE_STORE_VERSION, JSON.stringify(state), now);
    const eventInsert = db.prepare(`
      INSERT OR IGNORE INTO decision_events (
        event_id, idempotency_key, event_type, decision_id,
        decision_version_before, decision_version_after, backend_status,
        payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const event of state.decision_events || []) {
      eventInsert.run(
        event.event_id,
        event.idempotency_key,
        event.event_type,
        event.decision_id || "",
        versionNumber(event.decision_version_before),
        versionNumber(event.decision_version_after),
        event.backend_status || "",
        JSON.stringify(event),
        event.created_at || event.backend_received_at || now
      );
    }
    const movementInsert = db.prepare(`
      INSERT OR IGNORE INTO inventory_movements (
        movement_id, event_id, material_id, movement_type,
        before_g, delta_g, after_g, status, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const movement of state.inventory_movements || []) {
      movementInsert.run(
        movement.movement_id,
        movement.event_id || "",
        movement.material_id,
        movement.movement_type,
        Number(movement.before_g || 0),
        Number(movement.delta_g || 0),
        Number(movement.after_g || 0),
        movement.status || "",
        JSON.stringify(movement),
        movement.created_at || now
      );
    }
    const runInsert = db.prepare(`
      INSERT OR IGNORE INTO planner_runs (
        planner_run_id, planner_rule, input_event_count, current_decision_version,
        ship_today_count, output_hash, payload_json, replayed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const run of state.planner_runs || []) {
      runInsert.run(
        run.planner_run_id,
        run.planner_rule,
        Number(run.input_event_count || 0),
        Number(run.current_decision_version || 0),
        Number(run.ship_today_count || 0),
        run.output_hash || "",
        JSON.stringify(run),
        run.replayed_at || now
      );
    }
    const outcomeInsert = db.prepare(`
      INSERT OR IGNORE INTO decision_outcomes (
        outcome_id, event_id, pilot_day, mode, actual_ship_count,
        actual_delay_count, predicted_ship_count, prediction_error,
        adopted_system_plan, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const outcome of state.decision_outcomes || []) {
      outcomeInsert.run(
        outcome.outcome_id,
        outcome.event_id,
        outcome.pilot_day || "",
        outcome.mode || "",
        Number(outcome.actual_ship_count || 0),
        Number(outcome.actual_delay_count || 0),
        Number(outcome.predicted_ship_count || 0),
        Number(outcome.prediction_error || 0),
        outcome.adopted_system_plan ? 1 : 0,
        JSON.stringify(outcome),
        outcome.created_at || now
      );
    }
    db.exec("COMMIT");
    return true;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}

async function persistBackendState(state) {
  state.state_store = {
    schema_version: STATE_STORE_VERSION,
    mode: sqliteEnabled() ? "sqlite" : "json",
    ledger_write_mode: sqliteEnabled() ? "append_or_ignore_plus_current_snapshot" : "json_snapshot",
    sqlite_path: sqliteEnabled() ? path.relative(root, sqliteStatePath) : "",
    json_export_path: path.relative(root, backendStatePath)
  };
  if (Array.isArray(state.decision_events)) {
    state.pilot_metrics = computePilotMetrics(state);
    state.p05_gate = buildP05GateReport(state);
  }
  if (sqliteEnabled()) await writeSqliteState(state);
  await writeJson(backendStatePath, state);
}

async function readBaselinePack() {
  return readJson(baselinePath);
}

async function readBaselineResult() {
  const pack = await readBaselinePack();
  return clone(pack.deterministic_result || {});
}

async function readExplanationContract() {
  const [allowedClaims, forbiddenClaims] = await Promise.all([
    readJson(allowedClaimsPath),
    readJson(forbiddenClaimsPath)
  ]);
  const contract = {
    schema_version: EXPLANATION_CONTRACT_VERSION,
    source_files: {
      allowed_claims: path.relative(root, allowedClaimsPath),
      forbidden_claims: path.relative(root, forbiddenClaimsPath)
    },
    input_contract: [
      "deterministic_result",
      "reason_tags",
      "risk_facts",
      "missing_fields"
    ],
    output_contract: [
      "decision_summary",
      "priority_order_explanations",
      "material_explanations",
      "risk_explanations",
      "need_user_confirm",
      "citations",
      "validation_notes"
    ],
    allowed_fact_sources: allowedClaims.allowed_fact_sources || [],
    allowed_ai_generated_fields: allowedClaims.allowed_ai_generated_fields || [],
    allowed_fact_fields: allowedClaims.allowed_fact_fields || [],
    allowed_status_rules: allowedClaims.allowed_status_rules || {},
    max_explanation_chars: allowedClaims.max_explanation_chars || 80,
    forbidden_claims: forbiddenClaims.global_forbidden_claims || [],
    forbidden_terms_when_profit_missing: forbiddenClaims.forbidden_terms_when_profit_missing || [],
    forbidden_terms_when_purchase_cost_null: forbiddenClaims.forbidden_terms_when_purchase_cost_null || [],
    hard_fail_patterns: forbiddenClaims.hard_fail_patterns || [],
    failure_policy: {
      on_schema_invalid: "hide_explanation_keep_rule_labels",
      on_fact_violation: "hide_explanation_record_ai_fact_violation",
      on_timeout: "hide_explanation_keep_today_plan_available"
    }
  };
  contract.contract_hash = hashObject({
    schema_version: contract.schema_version,
    allowed_fact_sources: contract.allowed_fact_sources,
    allowed_ai_generated_fields: contract.allowed_ai_generated_fields,
    allowed_fact_fields: contract.allowed_fact_fields,
    allowed_status_rules: contract.allowed_status_rules,
    forbidden_claims: contract.forbidden_claims,
    hard_fail_patterns: contract.hard_fail_patterns,
    failure_policy: contract.failure_policy
  });
  return contract;
}

function buildSampleMeta(pack, result) {
  return {
    label: process.env.P0B_SAMPLE_LABEL || pack?.sample_meta?.label || `订单样本 ${Number(pack?.backtest?.order_count || 0)} 单 · ${result.decision_date || "待确认"}`,
    baseline_path: path.relative(root, baselinePath),
    order_count: Number(pack?.backtest?.order_count || 0),
    baseline_ship_today_count: Number(result.ship_today_count || 0),
    decision_date: result.decision_date || "",
    input_snapshot_id: result.input_snapshot_id || ""
  };
}

function collectText(value, out = []) {
  if (value == null) return out;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    out.push(String(value));
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectText(item, out));
    return out;
  }
  if (typeof value === "object") {
    Object.values(value).forEach((item) => collectText(item, out));
  }
  return out;
}

function collectTopLevelFieldIssues(output, contract) {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return ["schema_invalid:output_not_object"];
  }
  const allowed = new Set([
    "case_id",
    "task_type",
    "status",
    "extracted_fields",
    "sku_match",
    "decision_summary",
    "priority_order_explanations",
    "material_explanations",
    "risk_explanations",
    "optimization_explanations",
    "need_user_confirm",
    "citations",
    "validation_notes",
    "forbidden_claims_detected",
    ...(contract.output_contract || [])
  ]);
  return Object.keys(output)
    .filter((field) => !allowed.has(field))
    .map((field) => `schema_invalid:unknown_field:${field}`);
}

function deterministicFactSummary(deterministicResult) {
  const result = deterministicResult || {};
  const materialShortages = result.material_shortages || [];
  const purchaseSuggestions = result.purchase_suggestions || [];
  const purchaseCostValues = purchaseSuggestions
    .map((item) => Number(item.purchase_cost_estimate))
    .filter(Number.isFinite);
  const riskByOrderId = {};
  for (const risk of result.risk_orders || []) {
    if (risk.order_id) riskByOrderId[risk.order_id] = risk;
  }
  return {
    ship_today_count: Number(result.ship_today_count || 0),
    shortage_g_values: new Set(materialShortages.map((item) => Number(item.shortage_g)).filter(Number.isFinite)),
    material_ids: new Set(materialShortages.map((item) => item.material_id).filter(Boolean)),
    purchase_cost_values: new Set(purchaseCostValues),
    risk_by_order_id: riskByOrderId,
    order_ids: new Set([
      ...(result.priority_orders || []).map((item) => item.order_id),
      ...(result.risk_orders || []).map((item) => item.order_id),
      ...(result.ship_today_order_ids || [])
    ].filter(Boolean)),
    has_profit: Boolean(result.profit_review || result.estimated_margin_impact),
    has_null_purchase_cost: purchaseSuggestions.some((item) => item.purchase_cost_estimate == null),
    next_day_material_ids: new Set(purchaseSuggestions
      .filter((item) => item.arrival_assumption === "next_day" || item.can_affect_ship_today === false || Number(item.ship_today_delta || 0) === 0)
      .map((item) => item.material_id)
      .filter(Boolean))
  };
}

function validateExplanationOutput(deterministicResult, output, contract) {
  const issues = [];
  const forbiddenClaimsDetected = [];
  issues.push(...collectTopLevelFieldIssues(output, contract));
  const text = collectText(output).join("\n");
  const facts = deterministicFactSummary(deterministicResult);
  const maxChars = Number(contract.max_explanation_chars || 80);
  const explanationFields = [];
  (function collectExplanationFields(value, pathName = "") {
    if (value == null) return;
    if (typeof value === "string" && /(human_explanation|human_summary|reason|suggested_action|expected_result)$/i.test(pathName)) {
      explanationFields.push({ path: pathName, value });
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => collectExplanationFields(item, `${pathName}[${index}]`));
    } else if (typeof value === "object") {
      Object.entries(value).forEach(([key, item]) => collectExplanationFields(item, pathName ? `${pathName}.${key}` : key));
    }
  })(output);
  explanationFields.forEach((field) => {
    if ([...field.value].length > maxChars) issues.push(`explanation_too_long:${field.path}`);
  });

  const shipTodayMatches = [...text.matchAll(/(?:今日可发|今天(?:预计)?可发|能发)\s*(\d+)\s*单/g)];
  shipTodayMatches.forEach((match) => {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value !== facts.ship_today_count) {
      issues.push(`fact_violation:ship_today_count:${value}/${facts.ship_today_count}`);
      forbiddenClaimsDetected.push("Changing ship_today_count from deterministic_result.");
    }
  });
  const structuredShipToday = Number(output?.decision_summary?.ship_today_count);
  if (Number.isFinite(structuredShipToday) && structuredShipToday !== facts.ship_today_count) {
    issues.push(`fact_violation:decision_summary.ship_today_count:${structuredShipToday}/${facts.ship_today_count}`);
    forbiddenClaimsDetected.push("Changing structured ship_today_count from deterministic_result.");
  }

  const shortageMatches = [...text.matchAll(/缺(?:口)?\s*(\d+(?:\.\d+)?)\s*g/gi)];
  shortageMatches.forEach((match) => {
    const value = Number(match[1]);
    if (Number.isFinite(value) && facts.shortage_g_values.size && !facts.shortage_g_values.has(value)) {
      issues.push(`fact_violation:shortage_g:${value}`);
    }
  });
  for (const explanation of output?.material_explanations || []) {
    const shortageG = Number(explanation.shortage_g);
    if (Number.isFinite(shortageG) && facts.shortage_g_values.size && !facts.shortage_g_values.has(shortageG)) {
      issues.push(`fact_violation:material_explanations.shortage_g:${shortageG}`);
    }
    if (explanation.purchase_cost_estimate != null) {
      const purchaseCost = Number(explanation.purchase_cost_estimate);
      if (!facts.purchase_cost_values.has(purchaseCost)) {
        issues.push(`fact_violation:purchase_cost_estimate:${explanation.purchase_cost_estimate}`);
      }
    }
    if (facts.next_day_material_ids.has(explanation.material_id) && /今日可发|今天可发|今天能发|当天可发/.test(collectText(explanation).join("\n"))) {
      issues.push(`hard_fail:material_arrival_overwrite:${explanation.material_id}`);
    }
  }

  if (!facts.has_profit) {
    for (const term of contract.forbidden_terms_when_profit_missing || []) {
      if (text.includes(term)) {
        issues.push(`forbidden_profit_term:${term}`);
        forbiddenClaimsDetected.push(`profit_missing:${term}`);
      }
    }
  }
  if (facts.has_null_purchase_cost) {
    for (const term of contract.forbidden_terms_when_purchase_cost_null || []) {
      if (text.includes(term)) {
        issues.push(`forbidden_purchase_cost_term:${term}`);
        forbiddenClaimsDetected.push(`purchase_cost_missing:${term}`);
      }
    }
  }
  if ((/明天|次日|next_day/i.test(text)) && (/今日可发|今天可发|今天能发|当天可发/.test(text))) {
    issues.push("hard_fail:material_arrival_overwrite");
    forbiddenClaimsDetected.push("Treating next-day material arrival as same-day shippable.");
  }
  if (output?.sku_match && Number(output.sku_match.confidence) < 0.8 && output.need_user_confirm !== true) {
    issues.push("hard_fail:low_confidence_sku_match_requires_user_confirm");
    forbiddenClaimsDetected.push("Low confidence SKU match must require user confirmation.");
  }
  for (const explanation of output?.risk_explanations || []) {
    const orderId = explanation.order_id;
    const deterministicRisk = facts.risk_by_order_id[orderId];
    if (orderId && !deterministicRisk) {
      issues.push(`fact_violation:risk_order_not_found:${orderId}`);
      continue;
    }
    if (deterministicRisk && explanation.risk_level && explanation.risk_level !== deterministicRisk.risk_level) {
      issues.push(`fact_violation:risk_level:${orderId}:${explanation.risk_level}/${deterministicRisk.risk_level}`);
    }
  }

  const status = issues.length ? "validation_error" : "passed";
  return {
    schema_version: "p0b.explanation_validation.v1",
    validated_at: new Date().toISOString(),
    status,
    valid: status === "passed",
    issue_count: issues.length,
    issues,
    forbidden_claims_detected: Array.from(new Set(forbiddenClaimsDetected)),
    failure_policy: status === "passed" ? "show_explanation" : contract.failure_policy?.on_fact_violation || "hide_explanation_record_ai_fact_violation",
    contract_hash: contract.contract_hash,
    deterministic_hash: hashObject(deterministicResult || {})
  };
}

async function computeExplanationSafety(result) {
  try {
    const contract = await readExplanationContract();
    const suggestion = (result.purchase_suggestions || [])[0] || {};
    const safeOutput = {
      decision_summary: {
        ship_today_count: Number(result.ship_today_count || 0),
        human_summary: `今日可发${Number(result.ship_today_count || 0)}单。`
      },
      material_explanations: suggestion.material_id ? [{
        material_id: suggestion.material_id,
        shortage_g: suggestion.shortage_g,
        purchase_cost_estimate: suggestion.purchase_cost_estimate,
        human_explanation: `缺${suggestion.shortage_g}g，需人工确认。`
      }] : [],
      priority_order_explanations: (result.ship_today_order_ids || []).slice(0, 2).map((orderId) => ({
        order_id: orderId,
        human_explanation: "材料和设备满足。"
      })),
      risk_explanations: [],
      need_user_confirm: true,
      citations: [{ claim: "今日可发和缺料数据", source: "deterministic_result" }],
      validation_notes: ["canonical_gate_smoke"]
    };
    const validation = validateExplanationOutput(result, safeOutput, contract);
    return {
      schema_version: "p0b.explanation_safety.v1",
      checked_at: validation.validated_at,
      valid: validation.valid,
      status: validation.status,
      issue_count: validation.issue_count,
      failure_policy: validation.failure_policy,
      contract_hash: contract.contract_hash,
      deterministic_hash: validation.deterministic_hash
    };
  } catch (error) {
    return {
      schema_version: "p0b.explanation_safety.v1",
      checked_at: new Date().toISOString(),
      valid: false,
      status: "unavailable",
      issue_count: 1,
      failure_policy: "hide_explanation_keep_rule_labels",
      deterministic_hash: hashObject(result || {}),
      last_error: error.message || "explanation_safety_unavailable"
    };
  }
}

function inferMaterialBalances(result) {
  const balances = {};
  for (const shortage of result.material_shortages || []) {
    const materialId = shortage.material_id;
    const relatedRisk = (result.risk_orders || []).find((risk) => {
      const factText = (risk.facts || []).join(" ");
      return risk.risk_type === "material_shortage" && factText.includes(shortage.material_name || "");
    });
    const factText = (relatedRisk?.facts || []).join(" ");
    const match = factText.match(/当前剩余\s*(\d+(?:\.\d+)?)g/);
    balances[materialId] = match ? Number(match[1]) : 35;
  }
  return balances;
}

function emptyBackendState(result) {
  return {
    schema_version: "p0b.backend_state.v1",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    baseline_decision_id: result.decision_id || "unknown",
    current_decision_version: versionNumber(result.decision_version),
    current_result: clone(result),
    material_balances: inferMaterialBalances(result),
    decision_events: [],
    decision_outcomes: [],
    inventory_movements: [],
    planner_runs: [],
    feedback_learning_stats: {},
    calibration_decisions: [],
    explanation_safety: {},
    pilot_metrics: {},
    p05_gate: {},
    invariant_status: {
      inventory_non_negative: true,
      duplicate_idempotency_rejected: true,
      stale_version_rejected: true
    },
    state_hash: hashObject(result)
  };
}

async function resetBackendState() {
  const pack = await readBaselinePack();
  const result = clone(pack.deterministic_result || {});
  const state = emptyBackendState(result);
  state.sample_meta = buildSampleMeta(pack, result);
  state.explanation_safety = await computeExplanationSafety(result);
  state.pilot_metrics = computePilotMetrics(state);
  state.p05_gate = buildP05GateReport(state);
  await persistBackendState(state);
  return state;
}

async function loadBackendState() {
  const pack = await readBaselinePack();
  const result = clone(pack.deterministic_result || {});
  const fallback = emptyBackendState(result);
  fallback.sample_meta = buildSampleMeta(pack, result);
  const state = (await readSqliteState()) || await readJson(backendStatePath, fallback);
  if (!state.current_result || !Array.isArray(state.decision_events)) {
    return resetBackendState();
  }
  if (!state.sample_meta) state.sample_meta = buildSampleMeta(pack, result);
  if (!state.state_store) {
    state.state_store = {
      schema_version: STATE_STORE_VERSION,
      mode: sqliteEnabled() ? "sqlite" : "json",
      ledger_write_mode: sqliteEnabled() ? "append_or_ignore_plus_current_snapshot" : "json_snapshot",
      sqlite_path: sqliteEnabled() ? path.relative(root, sqliteStatePath) : "",
      json_export_path: path.relative(root, backendStatePath)
    };
  }
  if (!Array.isArray(state.calibration_decisions)) state.calibration_decisions = [];
  if (!Array.isArray(state.decision_outcomes)) state.decision_outcomes = [];
  if (!state.explanation_safety?.schema_version || state.explanation_safety.deterministic_hash !== hashObject(state.current_result || result)) {
    state.explanation_safety = await computeExplanationSafety(state.current_result || result);
  }
  state.pilot_metrics = computePilotMetrics(state);
  state.p05_gate = buildP05GateReport(state);
  return state;
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization,x-p0b-admin-token"
  });
  res.end(JSON.stringify(payload, null, 2));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("request_body_too_large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function addUniqueOrderIds(result, orderIds) {
  const current = new Set(result.ship_today_order_ids || []);
  for (const orderId of orderIds || []) current.add(orderId);
  result.ship_today_order_ids = Array.from(current);
  result.ship_today_count = result.ship_today_order_ids.length;
}

function removeOrderIds(result, orderIds) {
  const removeSet = new Set(orderIds || []);
  result.ship_today_order_ids = (result.ship_today_order_ids || []).filter((orderId) => !removeSet.has(orderId));
  result.ship_today_count = result.ship_today_order_ids.length;
}

function updateRiskMetrics(result) {
  const risks = result.risk_orders || [];
  const materialBlocked = risks.filter((risk) => risk.risk_type === "material_shortage").length;
  const delayed = risks.filter((risk) => risk.risk_type === "delay_risk").length;
  if (result.score_summary?.system_metrics) {
    result.score_summary.system_metrics.material_blocked_order_count = materialBlocked;
    result.score_summary.system_metrics.delayed_order_count = delayed;
  }
}

function coveredOrderIdsForEvent(result, event) {
  const payload = event.payload || {};
  if (Array.isArray(payload.covered_order_ids)) return payload.covered_order_ids;
  if (Array.isArray(event.covered_order_ids)) return event.covered_order_ids;
  const suggestion = (result.purchase_suggestions || []).find((item) => item.material_id === payload.material_id || item.material_id === event.material_id);
  return suggestion?.covered_order_ids || [];
}

function applyPlanEvent(result, event, index) {
  const payload = event.payload || {};
  const eventType = event.event_type || event.action_type;
  let changedReason = event.changed_reason || eventType;

  if (eventType === "material_replenished" || eventType === "mark_material_done") {
    const materialId = payload.material_id || event.material_id;
    const coveredOrderIds = coveredOrderIdsForEvent(result, event);
    result.material_shortages = (result.material_shortages || []).filter((item) => item.material_id !== materialId);
    result.purchase_suggestions = (result.purchase_suggestions || []).filter((item) => item.material_id !== materialId);
    result.risk_orders = (result.risk_orders || []).filter((risk) => {
      return !(coveredOrderIds.includes(risk.order_id) && risk.risk_type === "material_shortage");
    });
    addUniqueOrderIds(result, coveredOrderIds);
    changedReason = eventType === "material_replenished" ? "material_replenished" : "material_done";
  }

  if (eventType === "order_postpone") {
    const orderIds = payload.order_ids || [payload.order_id || event.order_id].filter(Boolean);
    const overrideReasonTags = Array.isArray(payload.override_reason_tags) ? payload.override_reason_tags : [];
    result.priority_orders = (result.priority_orders || []).map((order) => {
      if (!orderIds.includes(order.order_id)) return order;
      const riskFlags = Array.from(new Set([...(order.risk_flags || []), ...overrideReasonTags]));
      return { ...order, status: "已顺延", can_ship_today: false, risk_flags: riskFlags };
    });
    result.risk_orders = (result.risk_orders || []).filter((risk) => !orderIds.includes(risk.order_id));
    removeOrderIds(result, orderIds);
    changedReason = "order_postponed";
  }

  if (eventType === "order_lock") {
    const orderId = payload.order_id || event.order_id;
    result.priority_orders = (result.priority_orders || []).map((order) => {
      if (order.order_id !== orderId) return order;
      return { ...order, locked: true };
    });
    changedReason = "order_locked";
  }

  if (eventType === "feedback_submit") {
    const orderId = payload.order_id || event.order_id;
    result.priority_orders = (result.priority_orders || []).map((order) => {
      if (order.order_id !== orderId) return order;
      return { ...order, status: payload.outcome === "完成" ? "已完成" : payload.outcome || "已反馈", can_ship_today: false };
    });
    removeOrderIds(result, [orderId]);
    changedReason = "feedback_submitted";
  }

  if (eventType === "inventory_deduction_confirm") changedReason = "inventory_deduction_confirmed";
  if (eventType === "inventory_deduction_exception") changedReason = "inventory_deduction_exception";
  if (eventType === "inventory_deduction_reject") changedReason = "inventory_deduction_rejected";
  if (eventType === "plan_confirm") changedReason = "plan_confirmed";
  if (eventType === "mark_waiting_material") changedReason = "waiting_material";
  if (eventType === "recalculate" || eventType === "missing_data_action_complete") changedReason = "manual_recalculate";

  result.decision_version = versionNumber(result.decision_version) + 1;
  result.generated_at = event.created_at || new Date().toISOString();
  result.changed_reason = changedReason;
  updateRiskMetrics(result);

  return {
    applied_index: index,
    event_id: event.event_id,
    event_type: eventType,
    changed_reason: changedReason,
    decision_version: result.decision_version,
    ship_today_count: result.ship_today_count || 0,
    material_blocked_order_count: result.score_summary?.system_metrics?.material_blocked_order_count ?? null
  };
}

function replayPlanner(baselineResult, events) {
  const result = clone(baselineResult);
  const applied = [];
  events.forEach((event, index) => {
    applied.push(applyPlanEvent(result, event, index));
  });
  const run = {
    planner_run_id: nextBackendId("BRC"),
    planner_rule: PLANNER_RULE,
    replayed_at: new Date().toISOString(),
    input_event_count: events.length,
    current_decision_version: versionNumber(result.decision_version),
    ship_today_count: result.ship_today_count || 0,
    material_blocked_order_count: result.score_summary?.system_metrics?.material_blocked_order_count ?? null,
    applied_events: applied.slice(-8),
    output_hash: hashObject(result),
    invariants: {
      no_negative_ship_count: Number(result.ship_today_count || 0) >= 0,
      purchase_suggestions_have_material_id: (result.purchase_suggestions || []).every((item) => Boolean(item.material_id))
    }
  };
  return { result, run };
}

function movementFromEvent(state, event) {
  const payload = event.payload || {};
  const eventType = event.event_type || event.action_type;
  const materialId = payload.material_id || event.material_id;
  if (!materialId) return null;

  const beforeG = Number(state.material_balances[materialId] || 0);
  if (eventType === "material_replenished" || eventType === "mark_material_done") {
    const deltaG = Number(payload.suggested_purchase_g || event.suggested_purchase_g || 0);
    const afterG = beforeG + deltaG;
    state.material_balances[materialId] = afterG;
    return {
      movement_id: nextBackendId("BMV"),
      created_at: new Date().toISOString(),
      event_id: event.event_id,
      decision_id: event.decision_id,
      material_id: materialId,
      material_name: payload.material_name || event.material_name || materialId,
      movement_type: "replenishment",
      before_g: beforeG,
      delta_g: deltaG,
      after_g: afterG,
      status: "accepted",
      reason: "backend replay replenishment"
    };
  }

  if (eventType === "inventory_deduction_confirm") {
    const deductionG = Number(payload.deduction_g || event.deduction_g || 0);
    if (deductionG > beforeG) {
      return {
        movement_id: nextBackendId("BMV"),
        created_at: new Date().toISOString(),
        event_id: event.event_id,
        decision_id: event.decision_id,
        order_id: payload.order_id || event.order_id || "",
        material_id: materialId,
        material_name: payload.material_name || event.material_name || materialId,
        movement_type: "deduction_exception",
        before_g: beforeG,
        delta_g: 0,
        after_g: beforeG,
        status: "review_required",
        reason: "deduction_exceeds_snapshot"
      };
    }
    const afterG = beforeG - deductionG;
    state.material_balances[materialId] = afterG;
    return {
      movement_id: nextBackendId("BMV"),
      created_at: new Date().toISOString(),
      event_id: event.event_id,
      decision_id: event.decision_id,
      order_id: payload.order_id || event.order_id || "",
      material_id: materialId,
      material_name: payload.material_name || event.material_name || materialId,
      movement_type: "deduction",
      before_g: beforeG,
      delta_g: -deductionG,
      after_g: afterG,
      status: "accepted",
      reason: "backend replay deduction"
    };
  }

  if (eventType === "inventory_deduction_exception" || eventType === "inventory_deduction_reject") {
    return {
      movement_id: nextBackendId("BMV"),
      created_at: new Date().toISOString(),
      event_id: event.event_id,
      decision_id: event.decision_id,
      order_id: payload.order_id || event.order_id || "",
      material_id: materialId,
      material_name: payload.material_name || event.material_name || materialId,
      movement_type: eventType === "inventory_deduction_exception" ? "deduction_exception" : "deduction_rejected",
      before_g: beforeG,
      delta_g: 0,
      after_g: beforeG,
      status: eventType === "inventory_deduction_exception" ? "review_required" : "rejected",
      reason: payload.exception_reason || "no_inventory_mutation"
    };
  }

  return null;
}

function updateFeedbackLearning(state, event) {
  const payload = event.payload || {};
  if ((event.event_type || event.action_type) !== "feedback_submit") return;
  const completed = payload.completed === true || payload.outcome === "完成";
  const actualDeduction = Number(payload.actual_deduction_g);
  const suggestedDeduction = Number(payload.suggested_deduction_g);
  if (!completed || !Number.isFinite(actualDeduction) || !Number.isFinite(suggestedDeduction)) return;
  const skuId = payload.sku_id || event.sku_id || "UNKNOWN";
  const stats = state.feedback_learning_stats[skuId] || {
    sku_id: skuId,
    sample_count: 0,
    completed_count: 0,
    failed_count: 0,
    suggested_total_g: 0,
    actual_total_g: 0,
    average_actual_g: 0,
    average_delta_g: 0,
    calibration_status: "insufficient_samples",
    calibration_suggestion: null,
    last_updated_at: ""
  };
  const currentStandardG = Number(suggestedDeduction || stats.current_standard_g || 0);
  stats.sample_count += 1;
  stats.completed_count += 1;
  stats.failed_count += 0;
  stats.suggested_total_g += suggestedDeduction;
  stats.actual_total_g += actualDeduction;
  stats.average_actual_g = Number((stats.actual_total_g / Math.max(1, stats.sample_count)).toFixed(1));
  stats.average_delta_g = Number(((stats.actual_total_g - stats.suggested_total_g) / Math.max(1, stats.sample_count)).toFixed(1));
  stats.current_standard_g = currentStandardG;
  const suggestedStandardG = Math.max(0, Math.round(stats.average_actual_g));
  const enoughSamples = stats.completed_count >= CALIBRATION_MIN_SAMPLES;
  const enoughDelta = Math.abs(suggestedStandardG - currentStandardG) >= CALIBRATION_DELTA_THRESHOLD_G;
  stats.calibration_status = enoughSamples && enoughDelta ? "suggested" : (enoughSamples ? "watching" : "insufficient_samples");
  stats.calibration_suggestion = stats.calibration_status === "suggested" ? {
    suggestion_id: `CAL-${skuId}-${hashString(`${currentStandardG}:${suggestedStandardG}:${stats.sample_count}`)}`,
    sku_id: skuId,
    current_standard_g: currentStandardG,
    suggested_standard_g: suggestedStandardG,
    average_actual_g: stats.average_actual_g,
    average_delta_g: stats.average_delta_g,
    sample_count: stats.sample_count,
    min_samples: CALIBRATION_MIN_SAMPLES,
    requires_user_confirm: true,
    reason: `最近 ${stats.sample_count} 次反馈的平均实际耗材为 ${stats.average_actual_g}g`
  } : null;
  stats.last_updated_at = new Date().toISOString();
  state.feedback_learning_stats[skuId] = stats;
}

function listCalibrationSuggestions(state) {
  const decisionsBySuggestionId = new Map((state.calibration_decisions || [])
    .map((decision) => [decision.suggestion_id, decision]));
  return Object.values(state.feedback_learning_stats || {})
    .map((stats) => stats.calibration_suggestion)
    .filter(Boolean)
    .map((suggestion) => {
      const decision = decisionsBySuggestionId.get(suggestion.suggestion_id);
      return {
        ...suggestion,
        decision_status: decision?.decision || "pending",
        decision_note: decision?.note || "",
        decided_at: decision?.decided_at || "",
        applies_to_p05: true,
        auto_applied: false
      };
    });
}

function computeActiveDayCount(events) {
  const days = new Set();
  for (const event of events || []) {
    const stamp = event.created_at || event.backend_received_at;
    if (stamp) days.add(String(stamp).slice(0, 10));
  }
  return days.size;
}

function isGateCountingOutcome(outcome) {
  return outcome && outcome.source === "real" && outcome.counts_for_gate === true;
}

function validateDecisionOutcomePayload(inputEvent) {
  const payload = inputEvent.payload || {};
  const source = payload.outcome_source || payload.source;
  if (!OUTCOME_SOURCES.has(source)) {
    return {
      ok: false,
      reason: "decision_outcome_source_required",
      detail: "decision_outcome_submit requires payload.outcome_source to be real or demo."
    };
  }
  if (!["shadow", "assisted"].includes(payload.mode || payload.pilot_mode || "")) {
    return {
      ok: false,
      reason: "decision_outcome_mode_required",
      detail: "decision_outcome_submit requires mode to be shadow or assisted."
    };
  }
  if (source === "real") {
    const required = ["actual_ship_count", "actual_delay_count", "adopted_system_plan"];
    const missing = required.filter((field) => payload[field] == null);
    if (payload.predicted_ship_count == null && payload.system_ship_count == null) missing.push("predicted_ship_count");
    if (missing.length) {
      return {
        ok: false,
        reason: "real_decision_outcome_missing_fields",
        missing_fields: missing
      };
    }
  }
  return { ok: true };
}

function normalizeDecisionOutcome(state, event) {
  const payload = event.payload || {};
  const submittedAtServer = event.backend_received_at || new Date().toISOString();
  const predictedShipCount = Number(
    payload.predicted_ship_count ?? payload.system_ship_count ?? event.before_state?.ship_today_count ?? state.current_result?.ship_today_count ?? 0
  );
  const actualShipCount = Number(payload.actual_ship_count ?? 0);
  const actualDelayCount = Number(payload.actual_delay_count ?? 0);
  const mode = payload.mode || payload.pilot_mode || (payload.adopted_system_plan ? "assisted" : "shadow");
  const source = payload.outcome_source || payload.source;
  const manualShipCount = payload.manual_ship_count == null ? null : Number(payload.manual_ship_count);
  const systemShipCount = payload.system_ship_count == null ? predictedShipCount : Number(payload.system_ship_count);
  return {
    outcome_id: nextBackendId("BOUT"),
    event_id: event.event_id,
    decision_id: event.decision_id || state.baseline_decision_id,
    decision_version_observed: versionNumber(payload.decision_version_observed ?? event.expected_decision_version ?? state.current_decision_version),
    source,
    counts_for_gate: source !== "demo",
    pilot_day: String(submittedAtServer).slice(0, 10),
    payload_pilot_day: payload.pilot_day || "",
    submitted_at_server: submittedAtServer,
    mode,
    predicted_ship_count: predictedShipCount,
    actual_ship_count: actualShipCount,
    prediction_error: actualShipCount - predictedShipCount,
    actual_delay_count: actualDelayCount,
    manual_ship_count: Number.isFinite(manualShipCount) ? manualShipCount : null,
    system_ship_count: Number.isFinite(systemShipCount) ? systemShipCount : predictedShipCount,
    adopted_system_plan: Boolean(payload.adopted_system_plan),
    adoption_reason: payload.adoption_reason || "",
    rejection_reason: payload.rejection_reason || "",
    missing_material_downtime_minutes: Number(payload.missing_material_downtime_minutes || 0),
    planning_minutes_before: Number(payload.planning_minutes_before || 0),
    planning_minutes_after: Number(payload.planning_minutes_after || 0),
    notes: payload.notes || "",
    created_at: submittedAtServer
  };
}

function updateDecisionOutcomes(state, event) {
  if ((event.event_type || event.action_type) !== "decision_outcome_submit") return null;
  const outcome = normalizeDecisionOutcome(state, event);
  state.decision_outcomes = (state.decision_outcomes || []).filter((item) => item.event_id !== event.event_id);
  state.decision_outcomes.push(outcome);
  return outcome;
}

function computeOutcomeMetrics(state) {
  const allOutcomes = state.decision_outcomes || [];
  const outcomes = allOutcomes.filter(isGateCountingOutcome);
  const predictionErrors = outcomes.map((item) => Number(item.prediction_error || 0));
  const absoluteErrors = predictionErrors.map((value) => Math.abs(value));
  const avgAbsError = absoluteErrors.length
    ? Number((absoluteErrors.reduce((sum, value) => sum + value, 0) / absoluteErrors.length).toFixed(2))
    : null;
  const adopted = outcomes.filter((item) => item.adopted_system_plan).length;
  const planningBefore = outcomes.map((item) => Number(item.planning_minutes_before || 0)).filter((value) => value > 0);
  const planningAfter = outcomes.map((item) => Number(item.planning_minutes_after || 0)).filter((value) => value > 0);
  const avgBefore = planningBefore.length ? planningBefore.reduce((sum, value) => sum + value, 0) / planningBefore.length : null;
  const avgAfter = planningAfter.length ? planningAfter.reduce((sum, value) => sum + value, 0) / planningAfter.length : null;
  const realPilotDays = new Set(outcomes.map((item) => item.pilot_day).filter(Boolean));
  return {
    total_outcome_count: allOutcomes.length,
    demo_outcome_count: allOutcomes.filter((item) => item.source === "demo" || item.counts_for_gate === false).length,
    unknown_source_outcome_count: allOutcomes.filter((item) => !OUTCOME_SOURCES.has(item.source)).length,
    outcome_count: outcomes.length,
    real_outcome_count: outcomes.length,
    real_pilot_day_count: realPilotDays.size,
    shadow_count: outcomes.filter((item) => item.mode === "shadow").length,
    assisted_count: outcomes.filter((item) => item.mode === "assisted").length,
    adoption_count: adopted,
    adoption_rate: outcomes.length ? Number((adopted / outcomes.length).toFixed(3)) : 0,
    average_abs_ship_error: avgAbsError,
    total_actual_ship_count: outcomes.reduce((sum, item) => sum + Number(item.actual_ship_count || 0), 0),
    total_actual_delay_count: outcomes.reduce((sum, item) => sum + Number(item.actual_delay_count || 0), 0),
    missing_material_downtime_minutes: outcomes.reduce((sum, item) => sum + Number(item.missing_material_downtime_minutes || 0), 0),
    planning_minutes_saved: avgBefore != null && avgAfter != null ? Number((avgBefore - avgAfter).toFixed(1)) : null
  };
}

function computePilotMetrics(state) {
  const events = state.decision_events || [];
  const byType = (type) => events.filter((event) => event.event_type === type).length;
  const feedbackEvents = events.filter((event) => event.event_type === "feedback_submit");
  const completedFeedback = feedbackEvents.filter((event) => event.payload?.outcome === "完成").length;
  const overrideEvents = events.filter((event) => ["order_postpone", "order_lock", "mark_waiting_material", "sku_parameters_saved"].includes(event.event_type));
  const acceptedBackendEvents = events.filter((event) => event.backend_status === "accepted").length;
  const latestRun = (state.planner_runs || []).at(-1) || {};
  const baselineShipToday = Number(state.sample_meta?.baseline_ship_today_count ?? 2);
  const currentShipToday = Number(state.current_result?.ship_today_count || 0);
  const outcomeMetrics = computeOutcomeMetrics(state);
  const compressedShadowReplayReady = outcomeMetrics.total_outcome_count >= 3
    && outcomeMetrics.demo_outcome_count >= 2
    && outcomeMetrics.outcome_count >= 1
    && feedbackEvents.length >= 3;
  return {
    schema_version: "p0b.pilot_metrics.v1",
    updated_at: new Date().toISOString(),
    decision_event_count: events.length,
    backend_accept_rate: events.length ? Number((acceptedBackendEvents / events.length).toFixed(3)) : 1,
    main_action_taken_count: byType("material_replenished") + byType("plan_confirm"),
    replenishment_count: byType("material_replenished"),
    feedback_count: feedbackEvents.length,
    completed_feedback_count: completedFeedback,
    plan_confirm_count: byType("plan_confirm"),
    decision_outcome_count: outcomeMetrics.outcome_count,
    total_decision_outcome_count: outcomeMetrics.total_outcome_count,
    demo_decision_outcome_count: outcomeMetrics.demo_outcome_count,
    real_pilot_day_count: outcomeMetrics.real_pilot_day_count,
    shadow_outcome_count: outcomeMetrics.shadow_count,
    assisted_outcome_count: outcomeMetrics.assisted_count,
    system_adoption_rate: outcomeMetrics.adoption_rate,
    average_abs_ship_error: outcomeMetrics.average_abs_ship_error,
    planning_minutes_saved: outcomeMetrics.planning_minutes_saved,
    missing_material_downtime_minutes: outcomeMetrics.missing_material_downtime_minutes,
    active_day_count: computeActiveDayCount(events),
    override_count: overrideEvents.length,
    inventory_review_required_count: (state.inventory_movements || []).filter((movement) => movement.status === "review_required").length,
    calibration_suggestion_count: Object.values(state.feedback_learning_stats || {}).filter((stats) => stats.calibration_status === "suggested").length,
    calibration_pending_count: listCalibrationSuggestions(state).filter((item) => item.decision_status === "pending").length,
    ship_today_baseline: baselineShipToday,
    ship_today_current: currentShipToday,
    ship_today_delta_observed: currentShipToday - baselineShipToday,
    planner_rule: latestRun.planner_rule || PLANNER_RULE,
    compressed_shadow_replay_ready: compressedShadowReplayReady,
    seven_day_pilot_ready: outcomeMetrics.real_pilot_day_count >= 5 && feedbackEvents.length >= 7 && outcomeMetrics.outcome_count >= 5,
    next_metric_to_collect: compressedShadowReplayReady
      ? "P0.5 开发准入已满足；真实 7 天 pilot 本轮按项目约束跳过"
      : feedbackEvents.length < 7
      ? "先补压缩 shadow replay：demo/real outcome 和反馈样本"
      : "补齐真实 decision_outcome_submit，复盘 override 原因并确认 SKU 校准建议"
  };
}

function buildP05GateReport(state) {
  const metrics = computePilotMetrics(state);
  const calibrationSuggestions = listCalibrationSuggestions(state);
  const explanationSafety = state.explanation_safety || {};
  const engineeringChecks = [
    {
      id: "P0B-ENG-001",
      label: "产品化决策台闭环",
      passed: Boolean(state.current_result?.decision_id && Array.isArray(state.decision_events)),
      evidence: "首页决策、抽屉动作、事件账本和服务端 replay 已接入。"
    },
    {
      id: "P0B-ENG-002",
      label: "状态持久化",
      passed: state.state_store?.mode === "sqlite",
      evidence: state.state_store?.mode === "sqlite"
        ? `SQLite 账本 ${state.state_store.ledger_write_mode || "append_or_ignore"}，JSON 仅作当前快照。`
        : "当前不是 SQLite 持久化。"
    },
    {
      id: "P0B-ENG-003",
      label: "解释安全",
      passed: explanationSafety.valid === true,
      evidence: explanationSafety.valid === true
        ? `解释契约 ${explanationSafety.contract_hash || "unknown"} 已通过 canonical 校验。`
        : `解释安全未通过：${explanationSafety.status || explanationSafety.last_error || "not_checked"}。`
    },
    {
      id: "P0B-ENG-004",
      label: "反馈校准建议",
      passed: calibrationSuggestions.length > 0,
      evidence: calibrationSuggestions.length
        ? `${calibrationSuggestions.length} 个 SKU 校准建议待人工确认。`
        : "尚无足够真实反馈样本生成校准建议。"
    }
  ];
  const businessChecks = [
    {
      id: "PILOT-002",
      label: "7 天内至少 5 天可生成今日计划",
      passed: metrics.real_pilot_day_count >= 5,
      evidence: `当前真实 outcome 覆盖 ${metrics.real_pilot_day_count} 天；全部操作活跃 ${metrics.active_day_count} 天。`
    },
    {
      id: "PILOT-005",
      label: "Shadow 对比记录",
      passed: metrics.decision_outcome_count >= 2,
      evidence: `真实 decision_outcome_submit ${metrics.decision_outcome_count} 条，demo ${metrics.demo_decision_outcome_count || 0} 条不计入。`
    },
    {
      id: "PILOT-006",
      label: "Assisted 采纳或未采纳原因",
      passed: metrics.plan_confirm_count >= 2 || metrics.override_count >= 2,
      evidence: `确认计划 ${metrics.plan_confirm_count} 次，人工覆盖 ${metrics.override_count} 次。`
    },
    {
      id: "ROI-DATA",
      label: "ROI 和预测误差数据",
      passed: metrics.decision_outcome_count >= 5 && metrics.feedback_count >= 7,
      evidence: `反馈 ${metrics.feedback_count} 条，真实结果日志 ${metrics.decision_outcome_count} 条，demo ${metrics.demo_decision_outcome_count || 0} 条不计入。`
    }
  ];
  const engineeringReady = engineeringChecks.filter((item) => item.id !== "P0B-ENG-004").every((item) => item.passed);
  const businessReady = businessChecks.every((item) => item.passed);
  const realPilotSkipped = !P05_REAL_7_DAY_PILOT_REQUIRED;
  const p05DevReady = engineeringReady && (businessReady || (realPilotSkipped && metrics.compressed_shadow_replay_ready === true));
  const entryBasis = businessReady ? "real_7_day_pilot" : (p05DevReady ? "compressed_shadow_replay" : "prework_only");
  const realPilotStatus = businessReady ? "passed" : (realPilotSkipped ? "skipped_by_project_constraint" : "required");
  const developmentGateStatus = p05DevReady ? "passed" : (engineeringReady ? "prework_only" : "blocked");
  const businessValidationStatus = businessReady ? "passed" : (realPilotSkipped ? "skipped_not_passed" : "required_not_passed");
  return {
    schema_version: P05_GATE_VERSION,
    updated_at: new Date().toISOString(),
    recommendation: p05DevReady ? "ready_for_p05_development" : (engineeringReady ? "prepare_p05_only" : "continue_p0b"),
    entry_basis: entryBasis,
    evidence_basis: entryBasis,
    reliability_level: businessReady ? "business_validated" : (p05DevReady ? "dev_replay_only" : "prework_only"),
    engineering_ready: engineeringReady,
    business_ready: businessReady,
    p05_dev_ready: p05DevReady,
    development_gate_status: developmentGateStatus,
    business_validation_status: businessValidationStatus,
    real_7_day_pilot_required: P05_REAL_7_DAY_PILOT_REQUIRED,
    real_7_day_pilot_status: realPilotStatus,
    can_start_p05_prework: engineeringReady,
    can_enter_p05_development: p05DevReady,
    checks: [...engineeringChecks, ...businessChecks],
    metrics,
    next_actions: p05DevReady
      ? [
          entryBasis === "real_7_day_pilot"
            ? "启动 P0.5 生产化建设：简化时间轴、换设备调整、实际耗材/工时反馈。"
            : "启动 P0.5 正常开发：本轮以 compressed shadow replay 作为开发准入，真实 7 天 pilot 标记为跳过。"
        ]
      : [
          "补齐压缩 shadow replay：至少 2 条 demo outcome、1 条 real outcome 和 3 条反馈。",
          "把反馈样本转成待确认 SKU 校准建议，确认后再进入 P0.5 商品资产库。"
        ]
  };
}

function addMinutes(isoValue, minutes) {
  const date = new Date(isoValue || Date.now());
  if (Number.isNaN(date.getTime())) return isoValue || "";
  return new Date(date.getTime() + Number(minutes || 0) * 60_000).toISOString();
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function readSkuCapabilityIndex() {
  if (!fsSync.existsSync(skuFixturePath)) return {};
  const lines = fsSync.readFileSync(skuFixturePath, "utf8").trim().split(/\r?\n/);
  const headers = parseCsvLine(lines.shift() || "");
  const index = {};
  for (const line of lines) {
    const values = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, itemIndex) => [header, values[itemIndex] || ""]));
    if (!row.sku_id) continue;
    index[row.sku_id] = {
      sku_id: row.sku_id,
      material_id: row.material_id || "",
      standard_print_hours: Number(row.standard_print_hours || 0),
      compatible_equipment_ids: String(row.recommended_equipment || "")
        .split("|")
        .map((item) => item.trim())
        .filter(Boolean)
    };
  }
  return index;
}

function equipmentSwitchCandidateForOrder(order, skuCapabilities) {
  const capability = skuCapabilities[order.sku_id];
  if (!capability) {
    return {
      blocked: true,
      reason: "sku_capability_missing",
      order_id: order.order_id,
      task_id: order.task_id,
      sku_id: order.sku_id,
      from_equipment_id: order.equipment_id || "UNASSIGNED"
    };
  }
  const currentEquipment = order.equipment_id || "UNASSIGNED";
  const targetEquipmentId = capability.compatible_equipment_ids.find((item) => item !== currentEquipment);
  if (!targetEquipmentId) {
    return {
      blocked: true,
      reason: "no_compatible_alternative_equipment",
      order_id: order.order_id,
      task_id: order.task_id,
      sku_id: order.sku_id,
      from_equipment_id: currentEquipment,
      compatible_equipment_ids: capability.compatible_equipment_ids
    };
  }
  return {
    blocked: false,
    suggestion_id: `SW-${order.order_id}-${targetEquipmentId}`,
    task_id: order.task_id,
    order_id: order.order_id,
    sku_id: order.sku_id,
    from_equipment_id: currentEquipment,
    to_equipment_id: targetEquipmentId,
    validation_status: "capability_checked",
    compatible_equipment_ids: capability.compatible_equipment_ids,
    estimated_work_hours: capability.standard_print_hours,
    material_id: capability.material_id,
    expected_effect: "recalculate_conflict_only",
    requires_user_confirm: true,
    auto_applied: false,
    reason: "目标设备在 SKU 推荐设备白名单内；P0.5 仍需用户确认后 replay。"
  };
}

function buildP05Timeline(state) {
  const result = state.current_result || {};
  const orders = result.priority_orders || [];
  const lanes = new Map();
  for (const order of orders) {
    const equipmentId = order.equipment_id || order.recommended_equipment || "UNASSIGNED";
    const lane = lanes.get(equipmentId) || {
      equipment_id: equipmentId,
      equipment_name: equipmentId,
      total_minutes: 0,
      tasks: [],
      conflict_count: 0
    };
    const plannedStart = order.planned_start || result.generated_at || new Date().toISOString();
    const plannedEnd = order.planned_end || addMinutes(plannedStart, 90);
    const durationMinutes = Math.max(1, Math.round((new Date(plannedEnd).getTime() - new Date(plannedStart).getTime()) / 60_000) || 90);
    const conflicts = [];
    if (order.can_ship_today === false) conflicts.push("not_ship_today");
    if ((order.risk_flags || []).length) conflicts.push(...order.risk_flags);
    lane.total_minutes += durationMinutes;
    lane.conflict_count += conflicts.length ? 1 : 0;
    lane.tasks.push({
      task_id: order.task_id,
      order_id: order.order_id,
      sku_id: order.sku_id,
      planned_start: plannedStart,
      planned_end: plannedEnd,
      duration_minutes: durationMinutes,
      status: order.status || "待生产",
      can_ship_today: order.can_ship_today !== false,
      conflicts
    });
    lanes.set(equipmentId, lane);
  }
  return Array.from(lanes.values()).map((lane) => ({
    ...lane,
    utilization_hours: Number((lane.total_minutes / 60).toFixed(1)),
    tasks: lane.tasks.slice(0, 8)
  }));
}

function buildP05EquipmentSwitches(state) {
  const result = state.current_result || {};
  const orders = result.priority_orders || [];
  const skuCapabilities = readSkuCapabilityIndex();
  return orders
    .filter((order) => (order.risk_flags || []).includes("capacity_exceeded"))
    .map((order) => equipmentSwitchCandidateForOrder(order, skuCapabilities))
    .filter((candidate) => !candidate.blocked)
    .slice(0, 5)
}

function buildP05EquipmentSwitchBlocked(state) {
  const result = state.current_result || {};
  const orders = result.priority_orders || [];
  const skuCapabilities = readSkuCapabilityIndex();
  return orders
    .filter((order) => (order.risk_flags || []).includes("capacity_exceeded"))
    .map((order) => equipmentSwitchCandidateForOrder(order, skuCapabilities))
    .filter((candidate) => candidate.blocked)
    .slice(0, 5);
}

function buildP05FeedbackSchema() {
  return {
    schema_version: "p05.actual_feedback_contract.v1",
    required_fields: [
      "order_id",
      "task_id",
      "sku_id",
      "actual_work_minutes",
      "actual_material_g",
      "outcome"
    ],
    optional_fields: [
      "failure_reason",
      "equipment_id",
      "operator_note"
    ],
    safety_rules: [
      "实际耗材和工时只进入校准建议，不自动覆盖 SKU 标准。",
      "换设备调整必须用户确认后重新计算。",
      "P0.5 时间轴服务今日主判断，不替代 P0b 首屏。"
    ]
  };
}

function buildP05Prework(state) {
  const gate = buildP05GateReport(state);
  const outcomeMetrics = computeOutcomeMetrics(state);
  const timeline = buildP05Timeline(state);
  const switches = buildP05EquipmentSwitches(state);
  const blockedSwitches = buildP05EquipmentSwitchBlocked(state);
  return {
    schema_version: P05_PREWORK_VERSION,
    updated_at: new Date().toISOString(),
    gate_recommendation: gate.recommendation,
    entry_basis: gate.entry_basis,
    evidence_basis: gate.evidence_basis,
    reliability_level: gate.reliability_level,
    development_gate_status: gate.development_gate_status,
    business_validation_status: gate.business_validation_status,
    mode: gate.can_enter_p05_development ? "development_allowed" : "prework_only",
    can_build_without_breaking_p0b: gate.can_start_p05_prework,
    development_entry_blocked_by: gate.can_enter_p05_development
      ? []
      : gate.checks.filter((check) => !check.passed).map((check) => check.id),
    modules: [
      {
        id: "timeline",
        name: "任务泳道草图",
        status: "prework_ready",
        contract: "equipment lanes -> tasks -> conflicts",
        evidence: `${timeline.length} 条设备泳道，服务今日主判断，不抢首页。`
      },
      {
        id: "equipment_switch",
        name: "换设备调整",
        status: switches.length ? "candidate_ready" : "waiting_for_conflict_sample",
        contract: "candidate -> user confirm -> replay",
        evidence: `${switches.length} 个已校验候选，${blockedSwitches.length} 个因设备能力不兼容或 SKU 能力缺失被拦截。`
      },
      {
        id: "actual_feedback",
        name: "实际耗材 / 工时反馈",
        status: "contract_ready",
        contract: "actuals -> calibration suggestion -> user decision",
        evidence: "反馈只生成建议，不自动改 SKU 标准。"
      },
      {
        id: "roi_outcomes",
        name: "Shadow/Assisted/ROI 结果日志",
        status: outcomeMetrics.outcome_count >= 5 ? "pilot_ready" : "collecting",
        contract: "decision_outcome_submit",
        evidence: `真实结果日志 ${outcomeMetrics.outcome_count} 条，demo ${outcomeMetrics.demo_outcome_count} 条不计入；平均可发误差 ${outcomeMetrics.average_abs_ship_error ?? "待积累"} 单。`
      }
    ],
    timeline,
    equipment_switch_candidates: switches,
    equipment_switch_blocked: blockedSwitches,
    actual_feedback_contract: buildP05FeedbackSchema(),
    roi_snapshot: {
      ...outcomeMetrics,
      next_metric_to_collect: gate.business_ready
        ? "业务验证已通过，可以进入 P0.5 生产化验证"
        : "继续补 Shadow/Assisted outcome、实际发货误差和排产耗时"
    }
  };
}

async function decideCalibrationSuggestion(body) {
  const state = await loadBackendState();
  const suggestionId = body.suggestion_id;
  const decision = body.decision;
  if (!suggestionId || !["accept", "reject"].includes(decision)) {
    return {
      status: 400,
      payload: { ok: false, reason: "suggestion_id_and_decision_required" }
    };
  }
  const suggestion = listCalibrationSuggestions(state).find((item) => item.suggestion_id === suggestionId);
  if (!suggestion) {
    return {
      status: 404,
      payload: { ok: false, reason: "calibration_suggestion_not_found" }
    };
  }
  const record = {
    decision_id: nextBackendId("BCAL"),
    suggestion_id: suggestionId,
    sku_id: suggestion.sku_id,
    decision,
    note: body.note || "",
    current_standard_g: suggestion.current_standard_g,
    suggested_standard_g: suggestion.suggested_standard_g,
    auto_applied: false,
    next_scope: "P0.5_SKU_standard_update",
    decided_at: new Date().toISOString()
  };
  state.calibration_decisions = (state.calibration_decisions || []).filter((item) => item.suggestion_id !== suggestionId);
  state.calibration_decisions.push(record);
  const stats = state.feedback_learning_stats?.[suggestion.sku_id];
  if (stats) {
    stats.calibration_status = decision === "accept" ? "accepted_pending_p05_update" : "rejected";
    if (stats.calibration_suggestion) {
      stats.calibration_suggestion.decision_status = decision;
      stats.calibration_suggestion.auto_applied = false;
    }
    stats.last_updated_at = record.decided_at;
  }
  state.pilot_metrics = computePilotMetrics(state);
  state.p05_gate = buildP05GateReport(state);
  await persistBackendState(state);
  return {
    status: 200,
    payload: { ok: true, decision: record, suggestions: listCalibrationSuggestions(state), p05_gate: state.p05_gate, state }
  };
}

async function appendBackendEvent(inputEvent) {
  const state = await loadBackendState();
  const baseline = await readBaselineResult();
  const eventType = inputEvent.event_type || inputEvent.action_type;
  const idempotencyKey = inputEvent.idempotency_key || inputEvent.payload?.idempotency_key;
  if (!eventType || !idempotencyKey) {
    return {
      status: 400,
      payload: {
        accepted: false,
        reason: "event_type_and_idempotency_key_required"
      }
    };
  }

  if (eventType === "decision_outcome_submit") {
    const outcomeValidation = validateDecisionOutcomePayload(inputEvent);
    if (!outcomeValidation.ok) {
      return {
        status: 400,
        payload: {
          accepted: false,
          ...outcomeValidation
        }
      };
    }
  }

  const duplicate = state.decision_events.find((event) => event.idempotency_key === idempotencyKey);
  if (duplicate) {
    state.invariant_status.duplicate_idempotency_rejected = true;
    state.pilot_metrics = computePilotMetrics(state);
    state.p05_gate = buildP05GateReport(state);
    await persistBackendState(state);
    return {
      status: 200,
      payload: {
        accepted: false,
        reason: "duplicate_event_ignored",
        existing_event: duplicate,
        state
      }
    };
  }

  const expectedVersion = versionNumber(inputEvent.expected_decision_version ?? inputEvent.decision_version_before ?? state.current_decision_version);
  if (expectedVersion !== state.current_decision_version) {
    state.invariant_status.stale_version_rejected = true;
    state.pilot_metrics = computePilotMetrics(state);
    state.p05_gate = buildP05GateReport(state);
    await persistBackendState(state);
    return {
      status: 409,
      payload: {
        accepted: false,
        reason: "stale_event_rejected",
        expected_decision_version: expectedVersion,
        current_decision_version: state.current_decision_version,
        state
      }
    };
  }

  const event = {
    ...clone(inputEvent),
    event_id: inputEvent.event_id || nextBackendId("BEVT"),
    backend_event_id: nextBackendId("BEVT"),
    event_schema_version: inputEvent.event_schema_version || EVENT_SCHEMA_VERSION,
    ledger_schema_version: inputEvent.ledger_schema_version || LEDGER_SCHEMA_VERSION,
    ledger_status: "accepted",
    backend_status: "accepted",
    backend_received_at: new Date().toISOString(),
    idempotency_key: idempotencyKey,
    event_type: eventType,
    action_type: inputEvent.action_type || eventType,
    expected_decision_version: expectedVersion,
    decision_version_before: state.current_decision_version
  };
  event.backend_state_hash_before = state.state_hash;

  const movement = movementFromEvent(state, event);
  if (movement) {
    movement.movement_hash = hashObject(movement);
    state.inventory_movements.push(movement);
  }
  updateFeedbackLearning(state, event);
  const decisionOutcome = updateDecisionOutcomes(state, event);

  state.decision_events.push(event);
  const evidenceOnly = isEvidenceOnlyEvent(eventType);
  const replay = evidenceOnly ? null : replayPlanner(baseline, state.decision_events);
  if (replay) {
    state.current_result = replay.result;
    state.current_decision_version = replay.run.current_decision_version;
    event.backend_recompute_report = replay.run;
    event.backend_state_hash_after = replay.run.output_hash;
    state.planner_runs.push(replay.run);
  } else {
    event.backend_recompute_report = {
      planner_rule: "evidence_event_no_plan_replay",
      reason: "decision_outcome_submit records pilot evidence and must not mutate the active plan.",
      current_decision_version: state.current_decision_version,
      input_event_count: state.decision_events.length,
      recorded_at: new Date().toISOString()
    };
    event.backend_state_hash_after = hashObject({
      current_decision_version: state.current_decision_version,
      current_result: state.current_result,
      decision_event_count: state.decision_events.length,
      decision_outcome_count: (state.decision_outcomes || []).length,
      inventory_movement_count: state.inventory_movements.length,
      material_balances: state.material_balances
    });
  }
  event.decision_version_after = state.current_decision_version;
  event.backend_event_hash = hashObject({
    idempotency_key: event.idempotency_key,
    event_type: event.event_type,
    payload: event.payload || {},
    backend_state_hash_before: event.backend_state_hash_before,
    backend_state_hash_after: event.backend_state_hash_after
  });

  state.updated_at = new Date().toISOString();
  state.state_hash = hashObject({
    current_decision_version: state.current_decision_version,
    current_result: state.current_result,
    decision_event_count: state.decision_events.length,
    decision_outcome_count: (state.decision_outcomes || []).length,
    inventory_movement_count: state.inventory_movements.length,
    material_balances: state.material_balances
  });
  state.invariant_status.inventory_non_negative = Object.values(state.material_balances).every((value) => Number(value) >= 0);
  if (state.explanation_safety?.deterministic_hash !== hashObject(state.current_result || {})) {
    state.explanation_safety = await computeExplanationSafety(state.current_result);
  }
  state.pilot_metrics = computePilotMetrics(state);
  state.p05_gate = buildP05GateReport(state);

  await persistBackendState(state);
  return {
    status: 201,
    payload: {
      accepted: true,
      event,
      decision_outcome: decisionOutcome,
      inventory_movement: movement,
      planner_run: replay?.run || null,
      state
    }
  };
}

async function handleApi(req, res, url) {
  if (req.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
    sendJson(res, 204, {});
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/ai/chat-completions") {
    const body = await parseBody(req);
    const providerDefaults = {
      openai: {
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4.1-mini"
      },
      deepseek: {
        baseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-chat"
      }
    };
    const provider = providerDefaults[body.provider] ? body.provider : "openai";
    const defaults = providerDefaults[provider];
    const apiKey = String(body.apiKey || "").trim();
    const baseUrl = String(body.baseUrl || defaults.baseUrl).trim().replace(/\/+$/, "");
    const model = String(body.model || defaults.model).trim();
    if (!apiKey) {
      sendJson(res, 400, { ok: false, reason: "missing_api_key" });
      return true;
    }
    const requestBody = {
      model,
      messages: Array.isArray(body.messages) ? body.messages : [],
      temperature: Number.isFinite(Number(body.temperature)) ? Number(body.temperature) : 0.2
    };
    if (body.response_format) requestBody.response_format = body.response_format;
    const callProvider = (payload) => fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });
    let upstream;
    let text;
    try {
      upstream = await callProvider(requestBody);
      text = await upstream.text();
      if (!upstream.ok && text.toLowerCase().includes("response_format")) {
        const fallbackBody = { ...requestBody };
        delete fallbackBody.response_format;
        upstream = await callProvider(fallbackBody);
        text = await upstream.text();
      }
    } catch (error) {
      sendJson(res, 502, {
        ok: false,
        provider,
        reason: error.cause?.code === "UND_ERR_CONNECT_TIMEOUT"
          ? "模型服务连接超时，请检查网络或代理"
          : (error.message || "模型服务连接失败")
      });
      return true;
    }
    let payload;
    try {
      payload = JSON.parse(text || "{}");
    } catch (error) {
      payload = { raw: text };
    }
    if (!upstream.ok) {
      sendJson(res, upstream.status, {
        ok: false,
        provider,
        status: upstream.status,
        reason: payload.error?.message || payload.message || "upstream_model_error",
        upstream: payload.error ? { type: payload.error.type, code: payload.error.code } : undefined
      });
      return true;
    }
    sendJson(res, 200, { ok: true, provider, response: payload });
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/p0b/state") {
    sendJson(res, 200, { ok: true, state: await loadBackendState() });
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/p0b/explanation-contract") {
    sendJson(res, 200, { ok: true, contract: await readExplanationContract() });
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/p0b/explanation/validate") {
    const body = await parseBody(req);
    const state = await loadBackendState();
    const contract = await readExplanationContract();
    const deterministicResult = body.deterministic_result || state.current_result || await readBaselineResult();
    const validation = validateExplanationOutput(deterministicResult, body.output || body.ai_output || {}, contract);
    sendJson(res, validation.valid ? 200 : 422, { ok: validation.valid, validation });
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/p0b/pilot-metrics") {
    const state = await loadBackendState();
    const metrics = computePilotMetrics(state);
    sendJson(res, 200, { ok: true, metrics });
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/p0b/p05-gate") {
    const state = await loadBackendState();
    sendJson(res, 200, { ok: true, gate: buildP05GateReport(state) });
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/p05/prework") {
    const state = await loadBackendState();
    sendJson(res, 200, { ok: true, prework: buildP05Prework(state) });
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/p0b/calibration-suggestions") {
    const state = await loadBackendState();
    sendJson(res, 200, { ok: true, suggestions: listCalibrationSuggestions(state) });
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/p0b/calibration-decisions") {
    const result = await decideCalibrationSuggestion(await parseBody(req));
    sendJson(res, result.status, result.payload);
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/p0b/reset") {
    const tokenRequired = process.env.NODE_ENV === "production" && process.env.P0B_ADMIN_TOKEN;
    const providedToken = req.headers["x-p0b-admin-token"];
    if (tokenRequired && providedToken !== process.env.P0B_ADMIN_TOKEN) {
      sendJson(res, 403, { ok: false, reason: "reset_requires_admin_token" });
      return true;
    }
    sendJson(res, 200, {
      ok: true,
      reset_policy: tokenRequired ? "admin_token_required" : "dev_mode_allowed",
      state: await resetBackendState()
    });
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/p0b/events") {
    const event = await parseBody(req);
    const result = await appendBackendEvent(event);
    sendJson(res, result.status, result.payload);
    return true;
  }
  if (url.pathname.startsWith("/api/")) {
    sendJson(res, 404, { ok: false, reason: "api_not_found" });
    return true;
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${host}:${port}`);
    if (await handleApi(req, res, url)) return;

    const filePath = safePath(req.url || "/");
    if (!filePath) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    const body = await fs.readFile(filePath);
    res.writeHead(200, { "content-type": types[path.extname(filePath)] || "application/octet-stream" });
    res.end(body);
  } catch (error) {
    if (error.message === "request_body_too_large") {
      sendJson(res, 413, { ok: false, reason: "request_body_too_large" });
      return;
    }
    if (error instanceof SyntaxError) {
      sendJson(res, 400, { ok: false, reason: "invalid_json" });
      return;
    }
    res.writeHead(error.code === "ENOENT" ? 404 : 500);
    res.end(error.code === "ENOENT" ? "Not found" : "Server error");
  }
});

server.listen(port, host, () => {
  console.log(`ForgeFlow P0b preview: http://${host}:${port}/outputs/forgeflow-p0b-decision-console.html`);
  console.log(`ForgeFlow P0b API: http://${host}:${port}/api/p0b/state`);
  console.log(`ForgeFlow P0b explanation contract: http://${host}:${port}/api/p0b/explanation-contract`);
  console.log(`ForgeFlow P0.5 prework: http://${host}:${port}/api/p05/prework`);
  console.log(`ForgeFlow P0b state store: ${sqliteEnabled() ? `sqlite:${sqliteStatePath}` : `json:${backendStatePath}`}`);
});
