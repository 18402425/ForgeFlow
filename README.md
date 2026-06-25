# ForgeFlow Local

ForgeFlow turns a small 3D printing shop's orders, materials, printers, and due dates into one daily production decision.

```text
orders + SKU recipes + material inventory + printer capacity
=> what to print today, what is blocked, what can ship, and why
```

ForgeFlow is local-first. The schedule is computed by deterministic rules on your computer. AI is optional and only explains the already computed plan in plain language.

## Quick Start

### 1. Start ForgeFlow

macOS:

```bash
./start.command
```

Windows:

```bat
start.bat
```

Terminal:

```bash
npm start
```

Then open:

```text
http://127.0.0.1:4173/outputs/forgeflow-p0b-decision-console.html
```

### 2. Import Orders

Open **数据配置** in the app, then use one of two actions:

- **追加到今天订单池**
- **替换今天订单池**

Sample files live in:

```text
outputs/forgeflow-release-test-dataset-2026-06-25/
```

### 3. Optional: Enable AI Explanation

Open **数据配置 -> 3 AI 解释层**.

Choose OpenAI or DeepSeek, paste your API Key, then click **测试并开启**.

AI explanation rules:

- AI does not create the schedule.
- AI does not change orders, materials, or printers.
- AI only turns the local deterministic result into boss-readable explanation.
- Your API Key is stored in your own browser localStorage.

See [PRIVACY.md](PRIVACY.md).

## Product Boundary

ForgeFlow is:

- a local daily production decision console
- an order / SKU / material / equipment checker
- a shortage and delay-risk explainer
- an optional AI explanation layer

ForgeFlow is not:

- a full ERP / MES
- cloud order management
- printer firmware automation
- automatic purchasing
- a multi-user SaaS backend

## Data Model

ForgeFlow needs four standard inputs:

```text
orders.csv
sku_catalog.csv
material_inventory.csv
equipment_calendar.csv
```

Templates:

```text
templates/
```

Data model reference:

```text
DATA_MODEL.md
```

Release test data:

```text
outputs/forgeflow-release-test-dataset-2026-06-25/
```

Intro video:

```text
outputs/forgeflow-intro-video/renders/forgeflow-intro-10s-final.mp4
```

## Developer Commands

Run the local app:

```bash
npm start
```

Run the deterministic demo:

```bash
npm run demo
```

Run release smoke tests:

```bash
npm test
```

Build a clean downloadable release folder and zip:

```bash
npm run release:build
```

The release package is generated under:

```text
dist/forgeflow-local-v0.1.0/
```

## Release Checklist

Before publishing:

```bash
npm test
npm run release:build
```

Then check:

- no API keys are committed
- no local SQLite or state JSON files are committed
- sample data can be imported
- local data backup, restore, and reset work from the app
- AI connection failure falls back to rule explanation
- README and Quickstart match the current UI

Full checklist:

```text
RELEASE_CHECKLIST.md
```

## Repository Map

```text
server.js                                      local server and AI proxy
outputs/forgeflow-p0b-decision-console.html   main local app
outputs/forgeflow-release-test-dataset-*/      release validation dataset
outputs/forgeflow-intro-video/renders/         10-second product intro video
templates/                                    blank CSV templates
examples/                                     minimal sample inputs
scripts/smoke-test.js                         release smoke test
scripts/build-release.js                      clean release package builder
PRIVACY.md                                    local data and API key boundary
QUICKSTART.md                                 step-by-step local use
DATA_MODEL.md                                 CSV schema reference
```

## Core Principle

```text
Rules decide.
AI explains.
The user confirms.
```
