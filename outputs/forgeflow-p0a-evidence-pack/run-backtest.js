#!/usr/bin/env node

const path = require("node:path");
const { runBacktest } = require("./src/backtest");

function parseArgs(argv) {
  const positional = [];
  const options = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out-dir") {
      options.outDir = argv[++i];
    } else if (arg === "--plan-out") {
      options.planOut = argv[++i];
    } else if (arg === "--report-out") {
      options.reportOut = argv[++i];
    } else if (arg === "--decision-date") {
      options.decisionDate = argv[++i];
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      positional.push(arg);
    }
  }

  return { positional, options };
}

function printUsage() {
  console.log(`ForgeFlow P0a 回测

用法：
  node run-backtest.js orders.csv sku.csv materials.csv equipment.csv [options]

选项：
  --out-dir <dir>        today_plan.json 和 backtest_report.md 的输出目录
  --plan-out <path>      指定 JSON 输出路径
  --report-out <path>    指定 Markdown 报告输出路径
  --decision-date <date> 覆盖 orders.csv 中的 snapshot_date，例如 2026-05-07
`);
}

async function main(argv) {
  const { positional, options } = parseArgs(argv);

  if (options.help) {
    printUsage();
    return;
  }

  if (positional.length !== 4) {
    printUsage();
    throw new Error("需要正好 4 个 CSV 输入：orders、sku、materials、equipment。");
  }

  const [ordersPath, skuPath, materialsPath, equipmentPath] = positional;
  const outDir = options.outDir || process.cwd();
  const planOut = options.planOut || path.join(outDir, "today_plan.json");
  const reportOut = options.reportOut || path.join(outDir, "backtest_report.md");

  const result = await runBacktest({
    ordersPath,
    skuPath,
    materialsPath,
    equipmentPath,
    planOut,
    reportOut,
    decisionDate: options.decisionDate,
  });

  console.log(`已写入 ${result.planOut}`);
  console.log(`已写入 ${result.reportOut}`);
  console.log(
    `系统计划分数 ${result.summary.system_plan_score}；人工计划分数 ${result.summary.manual_plan_score}；原因标签覆盖率 ${result.summary.reason_tag_coverage_pct}%`
  );
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = { main };
