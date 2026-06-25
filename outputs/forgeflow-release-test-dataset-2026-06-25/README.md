# ForgeFlow Release Test Dataset - 2026-06-25

这套数据用于 ForgeFlow 初版发版前验收。重点不是证明算法能跑，而是验证老板视角的核心流程：

```text
导入订单 -> 看懂今日结论 -> 处理缺料/异常 -> 确认或调整今日生产
```

## 文件说明

订单场景：

- `orders_00_empty.csv`：空订单池，验证首次打开和无订单导入引导。
- `orders_01_happy_path.csv`：正常可排，验证基础排产和无待处理状态。
- `orders_02_due_priority.csv`：临期优先，验证系统不是按导入顺序排。
- `orders_03_material_shortage_leadtime.csv`：缺料 + 3 天到货，验证补货不等于今天可排。
- `orders_04_multi_material.csv`：多耗材 SKU，验证一个 SKU 多材料时任一材料不足都应阻断。
- `orders_05_ams_required.csv`：AMS 多色打印，验证多色订单需要带 AMS 的设备。
- `orders_06_equipment_unavailable.csv`：设备不可用，验证维修设备不参与今日排产。
- `orders_07_capacity_pressure.csv`：产能压力，验证总工时超过设备容量时会取舍。
- `orders_08_unknown_sku.csv`：未知 SKU，验证 unknown SKU 不会静默排产。
- `orders_09_dirty_inventory.csv`：脏库存，验证库存异常会阻断可信计划。
- `orders_10_web_paste_core.csv`：网页粘贴版，验证导入订单 UI 的简化表头。

配置文件：

- `sku_catalog.csv`：主 SKU 工艺库。保留旧字段以兼容命令行；`material_details`、`requires_ams` 是前端/人工验收参考。
- `material_inventory.csv`：正常库存。
- `material_inventory_shortage_leadtime.csv`：缺料 + 3 天到货场景专用库存。
- `material_inventory_dirty_probe.csv`：负库存/脏数据场景专用库存。
- `equipment_calendar.csv`：正常设备。
- `equipment_calendar_unavailable_probe.csv`：设备维修场景专用设备表。
- `equipment_calendar_no_ams_probe.csv`：无 AMS 设备场景专用设备表。
- `expected_outcomes.csv`：每个场景的老板可见预期。
- `ui_workflow_cases.csv`：前端交互验收清单。

## 推荐测试顺序

1. 先打开空状态，验证 `orders_00_empty.csv` 对应的无订单引导。
2. 跑 `orders_01_happy_path.csv`，确认基础链路。
3. 跑 `orders_02_due_priority.csv`，看“为什么这样排”。
4. 跑 `orders_03_material_shortage_leadtime.csv` + `material_inventory_shortage_leadtime.csv`。
5. 在前端点击“确认补货并顺延”，确认状态变成“确认到货入库”。
6. 测 `orders_08_unknown_sku.csv` 和 `orders_09_dirty_inventory.csv`，确认异常进入待处理。
7. 最后测 `ui_workflow_cases.csv` 里的调整计划、追加/替换、刷新持久化。

## 命令行校验

正常场景：

```bash
python3 scripts/run_forgeflow.py \
  --orders outputs/forgeflow-release-test-dataset-2026-06-25/orders_01_happy_path.csv \
  --sku outputs/forgeflow-release-test-dataset-2026-06-25/sku_catalog.csv \
  --materials outputs/forgeflow-release-test-dataset-2026-06-25/material_inventory.csv \
  --equipment outputs/forgeflow-release-test-dataset-2026-06-25/equipment_calendar.csv \
  --out-dir outputs/forgeflow-release-test-dataset-2026-06-25/run-01-happy
```

缺料场景：

```bash
python3 scripts/run_forgeflow.py \
  --orders outputs/forgeflow-release-test-dataset-2026-06-25/orders_03_material_shortage_leadtime.csv \
  --sku outputs/forgeflow-release-test-dataset-2026-06-25/sku_catalog.csv \
  --materials outputs/forgeflow-release-test-dataset-2026-06-25/material_inventory_shortage_leadtime.csv \
  --equipment outputs/forgeflow-release-test-dataset-2026-06-25/equipment_calendar.csv \
  --out-dir outputs/forgeflow-release-test-dataset-2026-06-25/run-03-shortage
```

未知 SKU 探针预期会校验失败：

```bash
python3 scripts/validate_inputs.py \
  --orders outputs/forgeflow-release-test-dataset-2026-06-25/orders_08_unknown_sku.csv \
  --sku outputs/forgeflow-release-test-dataset-2026-06-25/sku_catalog.csv \
  --materials outputs/forgeflow-release-test-dataset-2026-06-25/material_inventory.csv \
  --equipment outputs/forgeflow-release-test-dataset-2026-06-25/equipment_calendar.csv \
  --out-dir outputs/forgeflow-release-test-dataset-2026-06-25/validation-08-unknown
```

## 口径提醒

- 命令行规则当前仍保留 `post_process_minutes`、`package_minutes` 字段，但这套数据统一填 `0`，避免把后处理/包装混进打印机排产。
- 多耗材和 AMS 是当前前端/产品口径的重点，命令行旧规则只读取主 `material_id`。因此 `orders_04_multi_material.csv`、`orders_05_ams_required.csv` 要结合前端配置和 `expected_outcomes.csv` 做验收。
- “确认补货”只是记录下单和顺延；只有“确认到货入库”才应该恢复受影响订单排产。
