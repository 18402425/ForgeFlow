# ForgeFlow Local Quickstart

This guide gets the local downloadable version running.

## 1. Requirements

- Node.js 20 or newer
- Python 3 for demo and validation scripts
- A browser
- Optional: OpenAI or DeepSeek API Key for AI explanations

## 2. Start The App

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

Open:

```text
http://127.0.0.1:4173/outputs/forgeflow-p0b-decision-console.html
```

## 3. Try The Release Dataset

Open **数据配置 -> 1 导入订单**.

Use:

```text
outputs/forgeflow-release-test-dataset-2026-06-25/orders_01_happy_path.csv
```

Then confirm:

```text
sku_catalog.csv
material_inventory.csv
equipment_calendar.csv
```

For a shortage test, use:

```text
orders_03_material_shortage_leadtime.csv
material_inventory_shortage_leadtime.csv
equipment_calendar.csv
```

Expected behavior: replenishment should not make blocked orders available today if the material arrives later.

## 4. Use Your Own Data

Copy the templates:

```bash
cp templates/standard_orders.csv my_orders.csv
cp templates/sku_catalog.csv my_sku_catalog.csv
cp templates/material_inventory.csv my_material_inventory.csv
cp templates/equipment_calendar.csv my_equipment_calendar.csv
```

Validate:

```bash
python3 scripts/validate_inputs.py \
  --orders my_orders.csv \
  --sku my_sku_catalog.csv \
  --materials my_material_inventory.csv \
  --equipment my_equipment_calendar.csv \
  --out-dir outputs/my-shop-check
```

Run the deterministic planner:

```bash
python3 scripts/run_forgeflow.py \
  --orders my_orders.csv \
  --sku my_sku_catalog.csv \
  --materials my_material_inventory.csv \
  --equipment my_equipment_calendar.csv \
  --out-dir outputs/my-shop-plan
```

## 5. Enable AI Explanation

Open **数据配置 -> 3 AI 解释层**.

1. Choose OpenAI or DeepSeek.
2. Paste your API Key.
3. Click **测试并开启**.
4. Click **生成解释**.

If the provider returns quota, billing, network, or authentication errors, ForgeFlow keeps the rule explanation and does not change the schedule.

## 6. Backup Or Reset Local Data

Open **数据配置 -> 本地数据**.

- **导出本地备份** saves the current local browser configuration as JSON.
- **导入本地备份** restores a previously exported JSON backup.
- **清空本地数据** removes local browser state and reloads the app.

## 7. Developer Checks

```bash
npm test
npm run release:build
```

The clean downloadable package is created under:

```text
dist/forgeflow-local-v0.1.0/
```
