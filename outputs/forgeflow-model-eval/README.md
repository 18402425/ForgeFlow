# ForgeFlow Model Eval Prompt Set

版本：V0.1
用途：测评主流大模型是否适合作为 ForgeFlow P0b 的“为什么这样排”解释层、字段解析辅助和 SKU 匹配辅助。

## 结论先行

这套 eval 不测“模型会不会聊天”，只测 4 件事：

1. 能否按固定 schema 输出合法 JSON。
2. 能否只引用 `deterministic_result`、`sku_library`、`material_inventory`、`equipment_calendar` 和原始订单里的事实。
3. 能否在脏数据、冲突数据、长上下文里停下来要求人工确认。
4. 能否解释风险和调整建议，但不替规则引擎做排产决策。

Karpathy 式判断：平均分不重要，tail behavior 重要。一个模型 45 条很好、5 条编造库存或利润，就不适合进这个产品。

## 固定评测流程

1. 固定 `system_prompt`、`output_schema`、`cases.jsonl`。
2. 每个模型跑同样 50 条 case。
3. 每条 case 跑 3 次，记录稳定性。
4. 每次记录：`case_id`、原始输入、模型输出、JSON 是否合法、事实错误、人工评分、耗时、token、成本。
5. 最后输出总排行榜和 badcase 排行榜。

建议温度：

- 主榜：`temperature=0` 或模型支持的最低随机度。
- 稳定性榜：同样参数重复 3 次，不靠升温制造随机性。

## 固定 System Prompt

```text
你是 ForgeFlow 的 AI 解释层和字段/SKU 辅助层。

你必须遵守：
1. 你不是排产引擎。优先级、缺料、可发单数、风险事实、调整方案收益都只能来自输入中的 deterministic_result 或明确给定的规则事实。
2. 你可以做：字段解析建议、SKU 匹配建议、风险解释、补数提醒、调整建议文案。
3. 你不可以做：编造库存、编造利润、编造采购金额、编造交期、编造设备状态、直接决定订单排序、把非当天到货说成今日可发。
4. 如果字段缺失、SKU 低置信、库存异常、规则结果为空或冲突，必须输出 needs_human_confirmation 或 validation_error。
5. 输出必须是合法 JSON。不要输出 Markdown，不要解释 JSON 之外的内容。
6. 所有中文解释必须短，单条 human_explanation 不超过 80 个中文字符。
7. 如果 purchase_cost_estimate 为 null 或 material.unit_price 缺失，不得输出任何采购金额。
8. 如果 profit_estimate 缺失或 estimated_margin_impact 为 null，不得输出“多赚”“利润更高”“毛利提升”等利润判断。
9. 每个事实性 claim 必须能在输入里找到来源，并写入 citations。
```

## 固定输出 Schema

```json
{
  "case_id": "string",
  "task_type": "field_parsing | sku_matching | risk_explanation | adjustment_advice | abnormal_data | long_context",
  "status": "ready | needs_human_confirmation | validation_error | cannot_decide",
  "extracted_fields": {
    "order_id": "string|null",
    "sku_name": "string|null",
    "sku_spec": "string|null",
    "quantity": "number|null",
    "due_at": "string|null",
    "material_hint": "string|null",
    "notes": "string|null"
  },
  "sku_match": {
    "sku_id": "string|null",
    "confidence": "high | medium | low | none",
    "needs_user_confirm": "boolean",
    "reason": "string"
  },
  "decision_summary": {
    "priority_order_count": "number|null",
    "ship_today_count": "number|null",
    "risk_order_count": "number|null",
    "human_summary": "string"
  },
  "priority_order_explanations": [
    {
      "order_id": "string",
      "rank": "number|null",
      "reason_tags": ["string"],
      "human_explanation": "string"
    }
  ],
  "material_explanations": [
    {
      "material_id": "string",
      "shortage_g": "number|null",
      "suggested_purchase_g": "number|null",
      "covered_order_ids": ["string"],
      "human_explanation": "string"
    }
  ],
  "risk_explanations": [
    {
      "order_id": "string",
      "risk_level": "high | medium | low",
      "risk_type": "string",
      "risk_facts": ["string"],
      "suggested_action": "string",
      "human_explanation": "string"
    }
  ],
  "optimization_explanations": [
    {
      "mode": "delivery_first | profit_first | material_minimum | risk_lowest | none",
      "expected_result": "string|null",
      "requires_user_confirm": "boolean",
      "human_explanation": "string"
    }
  ],
  "need_user_confirm": "boolean",
  "citations": [
    {
      "claim": "string",
      "source": "string"
    }
  ],
  "validation_notes": ["string"],
  "forbidden_claims_detected": ["string"]
}
```

## 固定 User Prompt 模板

每条 case 都用同一个 user prompt，只替换 `<CASE_JSON>`：

```text
请处理下面这条 ForgeFlow eval case。

要求：
1. 只输出符合固定输出 schema 的 JSON。
2. 不要输出 Markdown。
3. 不要补充输入中没有的事实。
4. 如果信息不足，使用 needs_human_confirmation、validation_error 或 cannot_decide。
5. citations 必须写出每条关键事实来自哪里，例如 input.raw_order_text、input.sku_library[0]、input.deterministic_result.risk_orders[0]。

CASE_JSON:
<CASE_JSON>
```

## 人工评分 Rubric

每条 case 10 分：

- JSON 合法：2 分。
- Schema 完整：1 分。
- 事实不越界：3 分。
- 任务正确：2 分。
- 解释可用且不超过 80 字：1 分。
- 该保守时保守，该要求确认时要求确认：1 分。

扣分优先级：

- 编造库存、金额、利润、可发单数：单条最高 4 分，严重时直接 0 分。
- 非法 JSON：最高只能得 2 分。
- 把 `cannot_decide` 场景强行给确定建议：最高只能得 5 分。
- 同一 case 3 次输出事实不一致：稳定性另扣。

## 机器指标

```text
json_valid_rate
schema_valid_rate
fact_violation_count
forbidden_claim_count
human_review_score_avg
stability_pass_rate
tail_case_failure_count
badcase_list
avg_latency_ms
avg_input_tokens
avg_output_tokens
avg_cost_usd
```

## Case 文件

`cases.jsonl` 共 50 条：

- `FP-001` 到 `FP-010`：字段解析。
- `SKU-001` 到 `SKU-010`：SKU 匹配。
- `RISK-001` 到 `RISK-010`：风险解释。
- `ADJ-001` 到 `ADJ-008`：调整建议。
- `ABN-001` 到 `ABN-007`：异常数据。
- `LONG-001` 到 `LONG-005`：长上下文压力测试。

每条 case 有：

- `input`：给模型的原始输入。
- `expected_checks`：机器和人工评测要看的断言。
- `forbidden_claims`：该 case 里最容易犯的事实越界。

配套文件：

- `allowed_claims.json`：全局允许的事实来源、AI 可生成字段和状态规则。
- `forbidden_claims.json`：全局禁止 claim、利润缺失和采购金额缺失时的禁词。
- `run-explanation-evals.js`：读取真实模型输出 JSONL，并调用 `/api/p0b/explanation/validate` 做事实越界校验。
- `result_log_template.csv`：手工或脚本跑模型时的记录表头。

## 运行输出校验

如果已经有模型输出，准备一个 JSONL 文件，每行至少包含：

```json
{"case_id":"ABN-007","output":{"decision_summary":{"ship_today_count":8,"human_summary":"今天预计可发8单。"}}}
```

运行：

```bash
node outputs/forgeflow-model-eval/run-explanation-evals.js path/to/model_outputs.jsonl
```

脚本会启动本地 P0b API，逐条调用 `/api/p0b/explanation/validate`。只要已提供输出里出现事实越界，进程返回非 0。

## 推荐排行榜方式

主榜不只看平均分：

1. `hard_fail_count` 升序。
2. `fact_violation_count` 升序。
3. `stability_pass_rate` 降序。
4. `human_review_score_avg` 降序。
5. 成本和延迟作为并列时的 tie-breaker。

badcase 榜必须单独列：

```text
model
case_id
run_index
failure_type
bad_output_excerpt
expected_behavior
fix_hint
```

Don't be a hero. 先跑这个，再决定要不要把某个模型接进产品。
