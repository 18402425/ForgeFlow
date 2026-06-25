# ForgeFlow P0a 证据包

这是 ForgeFlow 排产 Agent PRD 的可运行 P0a 回测包。

## 运行方式

在本目录运行：

```bash
node run-backtest.js fixtures/orders_20.csv fixtures/sku.csv fixtures/materials.csv fixtures/equipment.csv \
  --plan-out expected/today_plan_expected.json \
  --report-out reports/backtest_report_sample.md
```

在仓库根目录运行，PRD 里的入口形式也可以：

```bash
node run-backtest.js outputs/forgeflow-p0a-evidence-pack/fixtures/orders_20.csv \
  outputs/forgeflow-p0a-evidence-pack/fixtures/sku.csv \
  outputs/forgeflow-p0a-evidence-pack/fixtures/materials.csv \
  outputs/forgeflow-p0a-evidence-pack/fixtures/equipment.csv \
  --plan-out outputs/forgeflow-p0a-evidence-pack/expected/today_plan_expected.json \
  --report-out outputs/forgeflow-p0a-evidence-pack/reports/backtest_report_sample.md
```

## 这个包证明什么

- 4 个 CSV 文件可以生成兼容 `today_plan.json` 的结构化结果。
- 回测引擎不调用 AI。
- 每个优先订单都带有 `score_breakdown` 和 `reason_tags`。
- 人工计划和系统计划在同一套耗材、设备约束下回放。
- `backtest_report_sample.md` 能解释排序差异、缺料、风险订单和规则修正方向。

## 数据说明

- `orders_20.csv` 从你提供的小红书订单导出表中清洗得到。
- 客户姓名、电话、地址、证件信息和完整平台订单号没有保留。
- `sku.csv`、`materials.csv`、`equipment.csv` 是 MVP 假设表，因为原始订单导出表不包含标准工时、标准耗材、库存和设备日历。
- 人工基线不直接使用原始 `manual_sequence`，而是用历史发货时间倒推候选生产开始时间，再按资源约束回放。真实 7 天试点中，应替换为店主当天早上的人工计划顺序。

## 可信度边界

这个包只能证明 P0a 规则链路能运行，不能证明真实业务排产已经准确。

- 订单表是真实来源：来自小红书订单导出。
- SKU 表是半推导：商品名称、规格、价格来自订单表；标准工时、标准耗材、推荐设备、预计毛利是假设值。
- 耗材表是假设：原始订单表没有库存、剩余克重、采购到货能力。
- 设备表是假设：原始订单表没有设备数量、设备状态、可用时段。
- “今天计划”是历史回测快照：当前用 `snapshot_date=2026-05-07` 模拟当日早上的排产，不是 2026-06-12 今天的真实生产计划。
- 已完成订单用于回测：历史发货时间只用来构造人工计划基线和复盘结果，不代表系统当时真的参与了排产。

因此，当前结果适合展示“可运行证据包”和“评测方法”，不适合宣称“系统已证明优于人工”。要让结果可信，下一步必须补真实库存、设备、SKU 标准参数，或至少输出全量订单的数据体检和假设字段清单。

## 人工基线排序方法

当前 Excel 没有真实的 `manual_plan_rank`，所以人工计划不是原始字段，而是一个“人工基线代理”。

计算步骤：

1. 倒推候选生产开始时间：

```text
manual_candidate_start_at =
历史发货时间
- SKU 标准打印时长
- 后处理时间
- 包装时间
```

2. 按 `manual_candidate_start_at` 从早到晚排序，得到人工基线顺序。
3. 用同一套耗材库存、推荐设备、设备可用时段做资源约束回放。
4. 如果回放中出现缺料、设备容量不足、晚于承诺发货时间，就进入风险或阻断，不强行算作准时可发。

这个方法比“只按历史发货时间排序”更接近真实生产顺序，但它仍然是代理，不等同于老板当天真实人工计划。

## `plan_score` 评分规则

P0a 用一个简单的初始评分规则比较人工计划和系统计划：

```text
plan_score =
准时可发单数 * 20
- 延期订单数 * 100
- 缺料阻断订单数 * 30
- 设备容量阻断订单数 * 10
```

权重含义：

- 准时可发单数 `+20`：按承诺发货时间前完成并可发出是正收益，但不能压过延期风险。
- 延期订单数 `-100`：延期最伤交付稳定性，所以惩罚最大。
- 缺料阻断订单数 `-30`：缺料会导致停工，但可以通过补料解决，所以惩罚中等。
- 设备容量阻断订单数 `-10`：设备排不下不一定是排产错误，可能只是当天产能有限，所以惩罚最低。

这套权重是 P0a 的 MVP 初始假设，不是行业标准，也不是从真实历史结果训练出来的最终规则。进入真实试点后，应根据店主对“延期、缺料、产能、利润复盘”的实际取舍重新校准。

注意：预计毛利只用于复盘高利润订单是否被过度后置，不参与 P0a 主排序。

不要逞英雄。这个包故意做得很小，只验证一个确定性闭环。
