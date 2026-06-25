# ForgeFlow Local

一个给小型 3D 打印工作室用的本地排产决策台。

每天早上它只回答一件事：

```text
今天先做什么？
什么订单被卡住？
为什么这样排？
```

ForgeFlow is a local-first daily decision console for small 3D printing shops. It turns orders, SKU recipes, material inventory, printer capacity, and due dates into one clear production plan.

> Rules decide. AI explains. The user confirms.

## Download

Current version: **v0.1.0**

- [Download ForgeFlow Local v0.1.0](https://github.com/18402425/ForgeFlow/releases/download/v0.1.0/forgeflow-local-v0.1.0.zip)
- [View release notes](https://github.com/18402425/ForgeFlow/releases/tag/v0.1.0)
- [Watch the 10-second intro video](outputs/forgeflow-intro-video/renders/forgeflow-intro-10s-final.mp4)

After downloading, unzip the package and start it locally. No cloud account is required.

## Why ForgeFlow Exists

很多小型 3D 打印店的真实工作流并不是完整 ERP，而是：

- 平台导出的订单
- Excel 里的 SKU 和工艺
- 人脑记住的库存
- 几台打印机的空闲时间
- 临时补料、插单、顺延和交期压力

订单一多，最痛苦的不是“没有数据”，而是数据散在各处，老板每天都要凭经验判断：

- 哪几单今天必须先做？
- 哪几单其实被缺料卡住？
- 补货后要顺延到哪一天？
- 为什么系统说这单排在前面？
- 今天的计划到底能不能确认？

ForgeFlow 的目标不是做一个大而全的 ERP，而是先把这个高频、具体、每天都要做的判断变清楚。

## What It Does

ForgeFlow takes four kinds of local data:

```text
orders.csv
sku_catalog.csv
material_inventory.csv
equipment_calendar.csv
```

Then it gives you:

- **今日结论**: 今天可做几单，哪些订单需要等料或顺延。
- **待处理事项**: 只显示会阻塞排产的动作，例如补货确认、数据复核。
- **今日生产清单**: 哪台设备、什么时间、先做哪一单。
- **为什么这样排**: 用老板能看懂的话解释排序和风险。
- **AI 解释层**: 可选。排产仍由本地规则完成，AI 只负责把确定结果讲清楚。

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

Sample release test files:

```text
outputs/forgeflow-release-test-dataset-2026-06-25/
```

Blank templates:

```text
templates/
```

### 3. Optional: Enable AI Explanation

Open **数据配置 -> 3 AI 解释层**.

Choose **OpenAI** or **DeepSeek**, paste your API Key, then click **测试并开启**.

AI explanation rules:

- AI does not create the schedule.
- AI does not change orders, materials, or printers.
- AI only explains the local deterministic result in plain language.
- Your API Key is stored in your own browser localStorage.

See [PRIVACY.md](PRIVACY.md).

## Product Boundary

ForgeFlow is:

- a local daily production decision console
- an order / SKU / material / equipment checker
- a shortage and delay-risk explainer
- an optional AI explanation layer
- a downloadable local product that can run without a backend

ForgeFlow is not:

- a full ERP / MES
- cloud order management
- printer firmware automation
- automatic purchasing
- a multi-user SaaS backend

## Data Model

Input templates:

```text
templates/
```

Data model reference:

```text
DATA_MODEL.md
```

Release validation dataset:

```text
outputs/forgeflow-release-test-dataset-2026-06-25/
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
