# ForgeFlow Local

一个给小型 3D 打印工作室用的本地排产决策台。  
A local-first daily production decision console for small 3D printing shops.

每天早上它只回答一件事：  
Every morning, it answers one practical question:

```text
今天先做什么？
什么订单被卡住？
为什么这样排？

What should we print first today?
Which orders are blocked?
Why is the plan arranged this way?
```

ForgeFlow 会把订单、SKU 工艺、耗材库存、设备产能和交期，整理成一份清晰的今日生产计划。  
ForgeFlow turns orders, SKU recipes, material inventory, printer capacity, and due dates into one clear daily production plan.

> 规则做决策，AI 做解释，用户做确认。  
> Rules decide. AI explains. The user confirms.

## 下载 / Download

当前版本：**v0.1.0**  
Current version: **v0.1.0**

- [下载 ForgeFlow Local v0.1.0 / Download ForgeFlow Local v0.1.0](https://github.com/18402425/ForgeFlow/releases/download/v0.1.0/forgeflow-local-v0.1.0.zip)
- [查看发布说明 / View release notes](https://github.com/18402425/ForgeFlow/releases/tag/v0.1.0)
- [观看 10 秒介绍视频 / Watch the 10-second intro video](outputs/forgeflow-intro-video/renders/forgeflow-intro-10s-final.mp4)

下载后解压，在本地启动即可使用；不需要云端账号。  
After downloading, unzip the package and start it locally. No cloud account is required.

## 项目介绍 / Project Overview

很多小型 3D 打印店的真实工作流并不是完整 ERP，而是：  
Many small 3D printing shops do not run on a full ERP. Their real workflow is usually:

- 平台导出的订单 / exported marketplace orders
- Excel 里的 SKU 和工艺 / SKU and process data in spreadsheets
- 人脑记住的库存 / material inventory remembered by the operator
- 几台打印机的空闲时间 / available time across a few printers
- 临时补料、插单、顺延和交期压力 / replenishment, urgent orders, delays, and due-date pressure

订单一多，最痛苦的不是“没有数据”，而是数据散在各处，老板每天都要凭经验判断：  
When orders increase, the real pain is not lack of data. It is scattered data, forcing the owner to make daily decisions by instinct:

- 哪几单今天必须先做？ / Which orders must be printed first today?
- 哪几单其实被缺料卡住？ / Which orders are actually blocked by material shortage?
- 补货后要顺延到哪一天？ / After replenishment, which date should delayed orders move to?
- 为什么系统说这单排在前面？ / Why does the system put this order first?
- 今天的计划到底能不能确认？ / Can today's production plan be confirmed?

ForgeFlow 的目标不是做一个大而全的 ERP，而是先把这个高频、具体、每天都要做的判断变清楚。  
ForgeFlow is not trying to become a large ERP. Its first job is to make this frequent, concrete, daily decision clear.

## 它能做什么 / What It Does

ForgeFlow 读取四类本地数据：  
ForgeFlow uses four kinds of local input data:

```text
orders.csv
sku_catalog.csv
material_inventory.csv
equipment_calendar.csv
```

然后给你一份可执行的今日判断：  
Then it gives you an actionable daily decision:

- **今日结论 / Today's decision**: 今天可做几单，哪些订单需要等料或顺延。  
  How many orders can be produced today, and which ones need material or delay handling.
- **待处理事项 / Pending actions**: 只显示会阻塞排产的动作，例如补货确认、数据复核。  
  Only shows actions that block production, such as replenishment confirmation or data review.
- **今日生产清单 / Today's production list**: 哪台设备、什么时间、先做哪一单。  
  Which printer runs which order, at what time, and in what sequence.
- **为什么这样排 / Why this plan**: 用老板能看懂的话解释排序和风险。  
  Explains the order sequence and risks in plain business language.
- **AI 解释层 / AI explanation layer**: 可选。排产仍由本地规则完成，AI 只负责把确定结果讲清楚。  
  Optional. The schedule is still computed by local rules; AI only explains the confirmed result.

## 快速开始 / Quick Start

### 1. 启动 ForgeFlow / Start ForgeFlow

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

然后打开：  
Then open:

```text
http://127.0.0.1:4173/outputs/forgeflow-p0b-decision-console.html
```

### 2. 导入订单 / Import Orders

在应用里打开 **数据配置**，然后选择以下两种导入方式之一：  
Open **数据配置** in the app, then choose one of two import actions:

- **追加到今天订单池 / Append to today's order pool**
- **替换今天订单池 / Replace today's order pool**

发布测试数据：  
Sample release test files:

```text
outputs/forgeflow-release-test-dataset-2026-06-25/
```

空白模板：  
Blank templates:

```text
templates/
```

### 3. 可选：开启 AI 解释层 / Optional: Enable AI Explanation

打开 **数据配置 -> 3 AI 解释层**。  
Open **数据配置 -> 3 AI 解释层**.

选择 **OpenAI** 或 **DeepSeek**，粘贴 API Key，然后点击 **测试并开启**。  
Choose **OpenAI** or **DeepSeek**, paste your API Key, then click **测试并开启**.

AI 解释层规则：  
AI explanation rules:

- AI 不生成排产计划。 / AI does not create the schedule.
- AI 不修改订单、耗材或设备。 / AI does not change orders, materials, or printers.
- AI 只把本地规则已经算出的结果解释成人话。 / AI only explains the local deterministic result in plain language.
- API Key 只保存在你自己的浏览器 localStorage。 / Your API Key is stored in your own browser localStorage.

详见 [PRIVACY.md](PRIVACY.md)。  
See [PRIVACY.md](PRIVACY.md).

## 产品边界 / Product Boundary

ForgeFlow 是：  
ForgeFlow is:

- 本地每日排产决策台 / a local daily production decision console
- 订单、SKU、耗材、设备检查器 / an order / SKU / material / equipment checker
- 缺料和顺延风险解释器 / a shortage and delay-risk explainer
- 可选 AI 解释层 / an optional AI explanation layer
- 不依赖后端的本地下载版产品 / a downloadable local product that can run without a backend

ForgeFlow 不是：  
ForgeFlow is not:

- 完整 ERP / MES / a full ERP / MES
- 云端订单管理系统 / cloud order management
- 打印机固件自动化工具 / printer firmware automation
- 自动采购系统 / automatic purchasing
- 多用户 SaaS 后端 / a multi-user SaaS backend

## 数据模型 / Data Model

输入模板：  
Input templates:

```text
templates/
```

数据模型说明：  
Data model reference:

```text
DATA_MODEL.md
```

发布验证数据集：  
Release validation dataset:

```text
outputs/forgeflow-release-test-dataset-2026-06-25/
```

## 开发命令 / Developer Commands

启动本地应用：  
Run the local app:

```bash
npm start
```

运行确定性演示：  
Run the deterministic demo:

```bash
npm run demo
```

运行发布 smoke test：  
Run release smoke tests:

```bash
npm test
```

构建干净的本地下载包：  
Build a clean downloadable release folder and zip:

```bash
npm run release:build
```

发布包生成目录：  
The release package is generated under:

```text
dist/forgeflow-local-v0.1.0/
```

## 发布检查 / Release Checklist

发布前运行：  
Before publishing:

```bash
npm test
npm run release:build
```

然后检查：  
Then check:

- 没有提交 API Key / no API keys are committed
- 没有提交本地 SQLite 或状态 JSON / no local SQLite or state JSON files are committed
- 示例数据可以导入 / sample data can be imported
- 本地数据备份、恢复、重置可用 / local data backup, restore, and reset work from the app
- AI 调用失败时能回退到规则解释 / AI connection failure falls back to rule explanation
- README 和 Quickstart 与当前 UI 一致 / README and Quickstart match the current UI

完整清单：  
Full checklist:

```text
RELEASE_CHECKLIST.md
```

## 仓库结构 / Repository Map

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

## 核心原则 / Core Principle

```text
规则做决策。
AI 做解释。
用户做确认。

Rules decide.
AI explains.
The user confirms.
```