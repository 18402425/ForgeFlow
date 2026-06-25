#!/usr/bin/env node

const { main } = require("./outputs/forgeflow-p0a-evidence-pack/run-backtest");

main(process.argv.slice(2)).catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
