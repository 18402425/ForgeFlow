const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { readCsv } = require("./csv");

const MS_PER_HOUR = 60 * 60 * 1000;
const TZ_OFFSET_HOURS = 8;

function asNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(String(value).replace("%", ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asBoolean(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["true", "yes", "y", "1", "是"].includes(normalized);
}

function parseDate(value, fallbackTime = "00:00:00") {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const hasTime = /\d{1,2}:\d{2}/.test(raw);
  const normalized = raw.replace(" ", "T");
  const withTime = hasTime ? normalized : `${normalized}T${fallbackTime}`;
  return new Date(`${withTime}+08:00`);
}

function formatLocal(date) {
  if (!date) return "";
  const shifted = new Date(date.getTime() + TZ_OFFSET_HOURS * MS_PER_HOUR);
  const yyyy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(shifted.getUTCDate()).padStart(2, "0");
  const hh = String(shifted.getUTCHours()).padStart(2, "0");
  const mi = String(shifted.getUTCMinutes()).padStart(2, "0");
  const ss = String(shifted.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}+08:00`;
}

function dateOnly(date) {
  return formatLocal(date).slice(0, 10);
}

function addHours(date, hours) {
  return new Date(date.getTime() + hours * MS_PER_HOUR);
}

function hashRows(rows) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(rows))
    .digest("hex")
    .slice(0, 16);
}

function splitList(value) {
  return String(value || "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeSku(row) {
  return {
    sku_id: row.sku_id,
    sku_name: row.sku_name,
    sku_spec: row.sku_spec,
    material_id: row.material_id,
    standard_print_hours: asNumber(row.standard_print_hours),
    standard_material_g: asNumber(row.standard_material_g),
    recommended_equipment: splitList(row.recommended_equipment),
    post_process_minutes: asNumber(row.post_process_minutes),
    package_minutes: asNumber(row.package_minutes),
    revenue_estimate: asNumber(row.revenue_estimate, null),
    profit_estimate: asNumber(row.profit_estimate, null),
    calibration_sample_count: asNumber(row.calibration_sample_count),
  };
}

function normalizeMaterial(row) {
  return {
    material_id: row.material_id,
    material_name: row.material_name,
    roll_spec_g: asNumber(row.roll_spec_g),
    full_roll_count: asNumber(row.full_roll_count),
    opened_remaining_g: asNumber(row.opened_remaining_g),
    available_g: asNumber(row.available_g),
    safety_line_g: asNumber(row.safety_line_g),
    last_updated_at: parseDate(row.last_updated_at),
    min_purchase_unit: asNumber(row.min_purchase_unit, asNumber(row.roll_spec_g, 1000)),
    same_day_arrival_available: asBoolean(row.same_day_arrival_available),
    unit_price: row.unit_price === "" ? null : asNumber(row.unit_price, null),
  };
}

function normalizeEquipment(row, decisionStart) {
  const start = parseDate(row.available_start) || decisionStart;
  const dailyHours = asNumber(row.daily_available_hours);
  return {
    equipment_id: row.equipment_id,
    equipment_name: row.equipment_name,
    equipment_type: row.equipment_type,
    status: String(row.status || "").toLowerCase(),
    daily_available_hours: dailyHours,
    status_updated_at: parseDate(row.status_updated_at),
    available_start: start,
    available_end: parseDate(row.available_end) || addHours(start, dailyHours),
    next_available: start,
  };
}

function normalizeOrder(row) {
  return {
    snapshot_date: row.snapshot_date,
    order_id: row.order_id,
    source_order_ref: row.source_order_ref,
    manual_sequence: asNumber(row.manual_sequence, 9999),
    order_created_at: parseDate(row.order_created_at),
    due_at: parseDate(row.due_at),
    manual_actual_ship_at: parseDate(row.manual_actual_ship_at),
    sku_id: row.sku_id,
    sku_name: row.sku_name,
    sku_spec: row.sku_spec,
    quantity: asNumber(row.quantity, 1),
    revenue_estimate: row.revenue_estimate === "" ? null : asNumber(row.revenue_estimate, null),
    profit_estimate: row.profit_estimate === "" ? null : asNumber(row.profit_estimate, null),
    platform_tags: splitList(row.platform_tags),
    manual_shortage_flag: asBoolean(row.manual_shortage_flag),
    manual_equipment_changed: asBoolean(row.manual_equipment_changed),
    notes: row.notes || "",
  };
}

function dueScore(order, decisionStart) {
  if (!order.due_at) return 0;
  const hours = (order.due_at.getTime() - decisionStart.getTime()) / MS_PER_HOUR;
  if (hours <= 0) return 100;
  if (hours <= 12) return 95;
  if (hours <= 24) return 90;
  if (hours <= 48) return 78;
  if (hours <= 96) return 58;
  return 35;
}

function isEquipmentFresh(equipment, decisionStart) {
  if (!equipment.status_updated_at) return false;
  return decisionStart.getTime() - equipment.status_updated_at.getTime() <= 24 * MS_PER_HOUR;
}

function equipmentIsUsable(equipment, decisionStart) {
  return equipment && equipment.status === "available" && isEquipmentFresh(equipment, decisionStart);
}

function scoreOrder(order, sku, materialsById, equipmentById, decisionStart) {
  const reasonTags = [];
  const missing = [];
  const scoreBreakdown = {};
  let dataMissingPenalty = 0;

  if (!sku) missing.push("sku_not_matched");
  if (!order.due_at) missing.push("due_at_missing");
  if (sku && !sku.standard_print_hours) missing.push("standard_print_hours_missing");
  if (sku && !sku.standard_material_g) missing.push("standard_material_g_missing");

  if (missing.length > 0) {
    dataMissingPenalty = missing.some((tag) =>
      ["sku_not_matched", "due_at_missing", "standard_print_hours_missing", "standard_material_g_missing"].includes(tag)
    )
      ? 50
      : 20;
    reasonTags.push(...missing);
  }

  const due = dueScore(order, decisionStart);
  scoreBreakdown.due_score = due;
  if (order.due_at) {
    const hoursToDue = (order.due_at.getTime() - decisionStart.getTime()) / MS_PER_HOUR;
    if (hoursToDue <= 0) reasonTags.push("overdue");
    else if (hoursToDue <= 12) reasonTags.push("due_today");
    else if (hoursToDue <= 48) reasonTags.push("due_soon");
  }

  let readiness = 100 - dataMissingPenalty;
  if (sku && sku.calibration_sample_count < 3) {
    readiness -= 10;
    reasonTags.push("sku_low_sample");
  }
  scoreBreakdown.readiness_score = Math.max(0, readiness);

  const material = sku ? materialsById.get(sku.material_id) : null;
  const needG = sku ? sku.standard_material_g * order.quantity : 0;
  let materialPenalty = 0;
  if (sku && !material) {
    materialPenalty = 100;
    reasonTags.push("material_record_missing");
  } else if (sku && material.available_g < needG) {
    materialPenalty = 100;
    reasonTags.push("material_shortage_core");
  } else if (sku) {
    reasonTags.push("material_available");
  }
  scoreBreakdown.material_penalty = materialPenalty;

  const recommended = sku ? sku.recommended_equipment : [];
  const usableEquipment = recommended.filter((id) => equipmentIsUsable(equipmentById.get(id), decisionStart));
  const equipmentScore = usableEquipment.length > 0 ? 100 : 0;
  scoreBreakdown.equipment_score = equipmentScore;
  if (usableEquipment.length > 0) reasonTags.push("printer_slot_available");
  else if (sku) reasonTags.push("equipment_unavailable_or_stale");

  const delayPenalty = order.due_at && order.due_at < decisionStart ? 50 : 0;
  if (delayPenalty) reasonTags.push("delay_risk");
  scoreBreakdown.delay_penalty = delayPenalty;
  scoreBreakdown.finished_goods_score = 0;
  scoreBreakdown.data_missing_penalty = dataMissingPenalty;

  if (order.platform_tags.includes("催发货")) reasonTags.push("customer_urgent");
  if (order.platform_tags.includes("缺货") || order.manual_shortage_flag) reasonTags.push("manual_shortage_seen");

  const priorityScore =
    scoreBreakdown.due_score * 0.4 +
    scoreBreakdown.readiness_score * 0.35 +
    scoreBreakdown.equipment_score * 0.15 +
    scoreBreakdown.finished_goods_score * 0.1 -
    scoreBreakdown.material_penalty -
    scoreBreakdown.delay_penalty -
    scoreBreakdown.data_missing_penalty;

  scoreBreakdown.priority_score = Math.round(priorityScore * 100) / 100;

  return {
    order_id: order.order_id,
    score_breakdown: scoreBreakdown,
    reason_tags: [...new Set(reasonTags)],
    missing_fields: missing,
    material_need_g: needG,
  };
}

function processHoursForOrder(order, sku) {
  if (!sku) return 0;
  return sku.standard_print_hours * order.quantity + (sku.post_process_minutes + sku.package_minutes) / 60;
}

function inferManualStartAt(order, sku) {
  if (!order.manual_actual_ship_at || !sku) return null;
  return addHours(order.manual_actual_ship_at, -processHoursForOrder(order, sku));
}

function cloneMap(map, cloneValue) {
  const next = new Map();
  for (const [key, value] of map.entries()) next.set(key, cloneValue(value));
  return next;
}

function chooseEquipment(sku, equipmentById, processHours, decisionStart) {
  const candidates = sku.recommended_equipment
    .map((id) => equipmentById.get(id))
    .filter((equipment) => equipmentIsUsable(equipment, decisionStart))
    .map((equipment) => {
      const start = equipment.next_available > equipment.available_start ? equipment.next_available : equipment.available_start;
      const end = addHours(start, processHours);
      return { equipment, start, end };
    })
    .sort((a, b) => a.end.getTime() - b.end.getTime());

  return candidates[0] || null;
}

function addShortage(shortagesByMaterial, material, order, shortageG) {
  const existing =
    shortagesByMaterial.get(material.material_id) ||
    {
      material_id: material.material_id,
      material_name: material.material_name,
      shortage_g: 0,
      affected_order_ids: [],
    };
  existing.shortage_g += shortageG;
  existing.affected_order_ids.push(order.order_id);
  shortagesByMaterial.set(material.material_id, existing);
}

function simulateSequence({ sequenceName, orders, skuById, materialsById, equipmentById, scoresByOrder, decisionStart }) {
  const simMaterials = cloneMap(materialsById, (material) => ({ ...material }));
  const simEquipment = cloneMap(equipmentById, (equipment) => ({ ...equipment }));
  const tasks = [];
  const riskOrders = [];
  const missingDataActions = [];
  const shortagesByMaterial = new Map();

  for (const order of orders) {
    const sku = skuById.get(order.sku_id);
    const score = scoresByOrder.get(order.order_id);

    if (!sku || score.missing_fields.length > 0) {
      missingDataActions.push({
        order_id: order.order_id,
        action: "补齐 SKU / 交期 / 标准工时 / 标准耗材",
        missing_fields: score.missing_fields,
      });
      riskOrders.push({
        order_id: order.order_id,
        risk_level: "high",
        risk_type: "missing_data",
        facts: score.missing_fields,
        suggested_action: "人工确认后再进入排产",
      });
      continue;
    }

    const material = simMaterials.get(sku.material_id);
    const needG = sku.standard_material_g * order.quantity;

    if (!material) {
      riskOrders.push({
        order_id: order.order_id,
        risk_level: "high",
        risk_type: "material_record_missing",
        facts: [`sku ${sku.sku_id} 缺少 material_id=${sku.material_id} 的库存记录`],
        suggested_action: "补齐耗材库存",
      });
      continue;
    }

    if (material.available_g < needG) {
      addShortage(shortagesByMaterial, material, order, Math.max(0, needG - material.available_g));
      riskOrders.push({
        order_id: order.order_id,
        risk_level: "high",
        risk_type: "material_shortage",
        facts: [`需要 ${needG}g ${material.material_name}，当前剩余 ${material.available_g}g`],
        suggested_action: "处理缺料或顺延订单",
      });
      continue;
    }

    const processHours = sku.standard_print_hours + (sku.post_process_minutes + sku.package_minutes) / 60;
    const slot = chooseEquipment(sku, simEquipment, processHours, decisionStart);

    if (!slot) {
      riskOrders.push({
        order_id: order.order_id,
        risk_level: "high",
        risk_type: "equipment_unavailable",
        facts: [`推荐设备 ${sku.recommended_equipment.join("|") || "未配置"} 不可用或状态过期`],
        suggested_action: "确认设备状态或换设备",
      });
      continue;
    }

    const { equipment, start, end } = slot;
    if (end > equipment.available_end) {
      riskOrders.push({
        order_id: order.order_id,
        risk_level: "medium",
        risk_type: "capacity_exceeded",
        facts: [`${equipment.equipment_name} 今日可用到 ${formatLocal(equipment.available_end)}，预计完成 ${formatLocal(end)}`],
        suggested_action: "顺延或增加设备时长",
      });
      continue;
    }

    material.available_g -= needG;
    equipment.next_available = end;

    const delayed = order.due_at && end > order.due_at;
    const canFinishToday = dateOnly(end) === dateOnly(decisionStart);
    const canShipOnTime = canFinishToday && !delayed;
    const riskFlags = [];
    if (delayed) riskFlags.push("estimated_finish_after_due");
    if (material.available_g < material.safety_line_g) riskFlags.push("below_safety_line_after_task");

    const task = {
      task_id: `${sequenceName.toUpperCase()}-${String(tasks.length + 1).padStart(3, "0")}`,
      order_id: order.order_id,
      sku_id: sku.sku_id,
      equipment_id: equipment.equipment_id,
      planned_start: formatLocal(start),
      planned_end: formatLocal(end),
      status: delayed ? "异常" : "待生产",
      locked: false,
      can_finish_today: canFinishToday,
      can_ship_on_time: canShipOnTime,
      can_ship_today: canShipOnTime,
      reason_tags: score.reason_tags,
      risk_flags: riskFlags,
      score_breakdown: score.score_breakdown,
      material_after_task_g: Math.round(material.available_g * 100) / 100,
    };
    tasks.push(task);

    if (delayed) {
      riskOrders.push({
        order_id: order.order_id,
        risk_level: "high",
        risk_type: "delay_risk",
        facts: [`预计完成 ${formatLocal(end)} 晚于承诺发货 ${formatLocal(order.due_at)}`],
        suggested_action: "优先处理或与客户协商顺延",
      });
    }
  }

  const shipTodayOrderIds = tasks.filter((task) => task.can_ship_today).map((task) => task.order_id);
  const materialBlockedCount = riskOrders.filter((risk) => risk.risk_type === "material_shortage").length;
  const delayCount = riskOrders.filter((risk) => risk.risk_type === "delay_risk").length;
  const equipmentBlockedCount = riskOrders.filter((risk) =>
    ["equipment_unavailable", "capacity_exceeded"].includes(risk.risk_type)
  ).length;
  const planScore = shipTodayOrderIds.length * 20 - delayCount * 100 - materialBlockedCount * 30 - equipmentBlockedCount * 10;

  return {
    sequence_name: sequenceName,
    tasks,
    ship_today_order_ids: shipTodayOrderIds,
    ship_today_count: shipTodayOrderIds.length,
    risk_orders: riskOrders,
    missing_data_actions: missingDataActions,
    material_shortages: Array.from(shortagesByMaterial.values()).map((item) => ({
      ...item,
      shortage_g: Math.round(item.shortage_g * 100) / 100,
    })),
    metrics: {
      plan_score: planScore,
      delayed_order_count: delayCount,
      material_blocked_order_count: materialBlockedCount,
      equipment_blocked_order_count: equipmentBlockedCount,
      missing_data_order_count: missingDataActions.length,
    },
  };
}

function buildPurchaseSuggestions(shortages, materialsById, systemRun) {
  return shortages.map((shortage) => {
    const material = materialsById.get(shortage.material_id);
    const unit = material.min_purchase_unit || material.roll_spec_g;
    const suggestedUnits = Math.ceil(shortage.shortage_g / unit);
    const canAffectShipToday = Boolean(material.same_day_arrival_available);
    return {
      material_id: shortage.material_id,
      material_name: shortage.material_name,
      shortage_g: shortage.shortage_g,
      roll_spec_g: material.roll_spec_g,
      suggested_purchase_unit: suggestedUnits,
      suggested_purchase_g: suggestedUnits * unit,
      purchase_cost_estimate:
        material.unit_price === null || material.unit_price === undefined
          ? null
          : Math.round(suggestedUnits * unit * material.unit_price * 100) / 100,
      covered_order_ids: shortage.affected_order_ids,
      can_affect_ship_today: canAffectShipToday,
      arrival_assumption: canAffectShipToday ? "当天到货" : "非当天到货",
      affected_order_count: shortage.affected_order_ids.length,
      ship_today_delta: canAffectShipToday ? shortage.affected_order_ids.length : 0,
      delay_risk_delta: shortage.affected_order_ids.filter((orderId) =>
        systemRun.risk_orders.some((risk) => risk.order_id === orderId && risk.risk_type === "delay_risk")
      ).length,
      estimated_margin_impact: null,
      confidence_delta: "补齐后缺料阻断减少，计划可信度提升",
    };
  });
}

function rankMap(tasksOrOrders) {
  const map = new Map();
  tasksOrOrders.forEach((item, index) => map.set(item.order_id, index + 1));
  return map;
}

function buildDifferences(manualOrders, systemOrders, scoresByOrder, systemRun) {
  const manualRanks = rankMap(manualOrders);
  const systemRanks = rankMap(systemOrders);
  const differences = [];
  const seenTypes = new Set();

  function pushDifference(item) {
    differences.push(item);
    seenTypes.add(item.difference_type);
  }

  for (const order of systemOrders) {
    const manualRank = manualRanks.get(order.order_id);
    const systemRank = systemRanks.get(order.order_id);
    const score = scoresByOrder.get(order.order_id);
    const rankDelta = manualRank - systemRank;
    if (Math.abs(rankDelta) < 4 && !score.reason_tags.includes("material_shortage_core")) continue;

    let differenceType = "delivery_reorder";
    if (score.reason_tags.includes("material_shortage_core")) differenceType = "material_constraint";
    else if (score.reason_tags.includes("overdue") || score.reason_tags.includes("due_today")) differenceType = "due_date_priority";
    else if (score.reason_tags.includes("customer_urgent")) differenceType = "urgent_tag";

    pushDifference({
      order_id: order.order_id,
      manual_rank: manualRank,
      system_rank: systemRank,
      rank_delta: rankDelta,
      difference_type: differenceType,
      reason_tags: score.reason_tags,
      explanation:
        differenceType === "material_constraint"
          ? "系统发现当前耗材不足，不把它放进今日优先生产。"
          : differenceType === "due_date_priority"
            ? "系统把交期更近或已逾期的订单前置。"
            : differenceType === "urgent_tag"
              ? "系统识别平台催发货标签，但仍受物料和设备约束。"
        : "系统按交期、设备和物料可执行性重新排序。",
    });
  }

  if (systemRun.material_shortages.length > 0 && !seenTypes.has("material_constraint")) {
    pushDifference({
      order_id: systemRun.material_shortages.flatMap((item) => item.affected_order_ids).join(", "),
      manual_rank: null,
      system_rank: null,
      rank_delta: null,
      difference_type: "material_constraint",
      reason_tags: ["material_shortage"],
      explanation: "系统在回放过程中发现同一耗材被前序任务消耗后，后续订单进入缺料阻断。",
    });
  }

  const risksByType = new Set(systemRun.risk_orders.map((risk) => risk.risk_type));
  if (risksByType.has("capacity_exceeded") && !seenTypes.has("equipment_capacity")) {
    pushDifference({
      order_id: "MULTIPLE",
      manual_rank: null,
      system_rank: null,
      rank_delta: null,
      difference_type: "equipment_capacity",
      reason_tags: ["capacity_exceeded"],
      explanation: "系统在同一台设备日可用时长内回放任务，超出当日容量的订单不计入准时可发。",
    });
  }

  const selected = [];
  const selectedTypes = new Set();
  for (const item of differences) {
    if (!selectedTypes.has(item.difference_type)) {
      selected.push(item);
      selectedTypes.add(item.difference_type);
    }
  }
  for (const item of differences) {
    if (selected.length >= 12) break;
    if (!selected.includes(item)) selected.push(item);
  }
  return selected.slice(0, 12);
}

function buildOptimizationActions(systemRun, manualRun, allProfitComplete) {
  const actions = [
    {
      action_id: "delivery_first",
      strategy: "交付优先",
      expected_result: `比人工计划 ${systemRun.metrics.delayed_order_count <= manualRun.metrics.delayed_order_count ? "少或不增加" : "增加"}延期风险；准时可发 ${systemRun.ship_today_count} 单`,
      benefit: "优先处理交期近且物料设备满足的订单",
      tradeoff: "部分非临期订单会被后置",
      available: true,
    },
    {
      action_id: "material_min",
      strategy: "缺料最少",
      expected_result: `当前缺料阻断 ${systemRun.metrics.material_blocked_order_count} 单，先做不缺料订单`,
      benefit: "减少等料停工",
      tradeoff: "缺料订单需要采购或顺延",
      available: true,
    },
    {
      action_id: "capacity_fit",
      strategy: "产能可执行优先",
      expected_result: `当前设备容量阻断 ${systemRun.metrics.equipment_blocked_order_count} 单，先识别今日排不下的订单`,
      benefit: "避免把超出当天设备时长的订单误判为准时可发",
      tradeoff: "需要加机时、换机或主动顺延",
      available: true,
    },
  ];

  if (allProfitComplete) {
    actions.push({
      action_id: "profit_review",
      strategy: "利润复盘",
      expected_result: "利润字段完整，可用于复盘高利润订单是否被过度后置；P0a 主排序仍以交付、缺料、产能为主",
      benefit: "帮助业务负责人判断系统排序是否牺牲了重要订单",
      tradeoff: "只作为复盘视角，不直接改变本次 P0a 排序",
      available: true,
    });
  }

  return actions;
}

function reportTable(rows, columns) {
  const header = `| ${columns.map((column) => column.label).join(" | ")} |`;
  const sep = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${columns.map((column) => row[column.key] ?? "").join(" | ")} |`);
  return [header, sep, ...body].join("\n");
}

function zhDifferenceType(type) {
  const map = {
    due_date_priority: "交期前置",
    urgent_tag: "催发标签",
    delivery_reorder: "交付排序调整",
    material_constraint: "缺料约束",
    equipment_capacity: "设备容量约束",
  };
  return map[type] || type;
}

function zhRiskType(type) {
  const map = {
    delay_risk: "延期风险",
    material_shortage: "缺料",
    capacity_exceeded: "设备容量不足",
    equipment_unavailable: "设备不可用",
    missing_data: "数据缺失",
    material_record_missing: "耗材记录缺失",
  };
  return map[type] || type;
}

function sampleLabelFromOrdersPath(ordersPath, orderCount, decisionStart) {
  const base = path.basename(ordersPath);
  if (base.includes("orders_xhs_20260608_pending_7")) {
    return `小红书待配货 ${orderCount} 单 · ${dateOnly(decisionStart)}`;
  }
  if (base.includes("orders_xhs_20260608_full_mapped")) {
    return `小红书映射样本 ${orderCount} 单 · ${dateOnly(decisionStart)}`;
  }
  if (base.includes("orders_20")) {
    return `P0a 回测样本 ${orderCount} 单 · ${dateOnly(decisionStart)}`;
  }
  return `订单样本 ${orderCount} 单 · ${dateOnly(decisionStart)}`;
}

function zhRiskLevel(level) {
  const map = {
    high: "高",
    medium: "中",
    low: "低",
  };
  return map[level] || level;
}

function classifyRankDifference(score, rankDelta) {
  const tags = score.reason_tags || [];
  if (tags.includes("material_shortage_core")) {
    return {
      type: "缺料后置",
      reason: "当前核心耗材不足，系统把它后置，不强行放进优先生产。",
    };
  }
  if ((tags.includes("overdue") || tags.includes("due_today")) && rankDelta > 0) {
    return {
      type: "交期前置",
      reason: "交期更近或已逾期，系统把它提前处理。",
    };
  }
  if (tags.includes("customer_urgent") && rankDelta > 0) {
    return {
      type: "催发前置",
      reason: "平台有催发货标签，系统提高关注度，但仍受物料和设备约束。",
    };
  }
  if (rankDelta > 0) {
    return {
      type: "系统提前",
      reason: "系统按交期、物料和设备可执行性把它提前。",
    };
  }
  if (rankDelta < 0) {
    return {
      type: "系统后置",
      reason: "系统判断这单相对不紧急，或受物料、设备、交期约束影响，被后置。",
    };
  }
  return {
    type: "排序不变",
    reason: "系统排序和人工基线排序一致。",
  };
}

function generateReport({ orders, systemOrders, manualOrders, systemRun, manualRun, differences, result, sourceFiles, scoresByOrder }) {
  const systemRanks = rankMap(systemOrders);
  const shortageRows = result.deterministic_result.material_shortages.map((item) => ({
    material: item.material_name,
    shortage_g: item.shortage_g,
    orders: item.affected_order_ids.join(", "),
  }));

  const diffRows = differences.map((item) => ({
    type: zhDifferenceType(item.difference_type),
    order_id: item.order_id,
    manual_rank: item.manual_rank ?? "-",
    system_rank: item.system_rank ?? "-",
    reason: item.explanation,
  }));

  const fullComparisonRows = manualOrders.map((order, index) => {
    const manualRank = index + 1;
    const systemRank = systemRanks.get(order.order_id);
    const rankDelta = manualRank - systemRank;
    const score = scoresByOrder.get(order.order_id);
    const classified = classifyRankDifference(score, rankDelta);
    return {
      manual_rank: manualRank,
      order_id: order.order_id,
      system_rank: systemRank,
      rank_change: rankDelta > 0 ? `提前 ${rankDelta} 位` : rankDelta < 0 ? `后置 ${Math.abs(rankDelta)} 位` : "不变",
      type: classified.type,
      due_at: formatLocal(order.due_at),
      inferred_start_at: formatLocal(order.manual_inferred_start_at),
      reason: classified.reason,
    };
  });

  const benefitRows = [
    {
      item: "计划分数",
      manual: manualRun.metrics.plan_score,
      system: systemRun.metrics.plan_score,
      delta: `${systemRun.metrics.plan_score - manualRun.metrics.plan_score >= 0 ? "+" : ""}${systemRun.metrics.plan_score - manualRun.metrics.plan_score}`,
      meaning: "综合评分提升，说明在当前假设下系统计划更稳。",
    },
    {
      item: "准时可发单数",
      manual: manualRun.ship_today_count,
      system: systemRun.ship_today_count,
      delta: `${systemRun.ship_today_count - manualRun.ship_today_count >= 0 ? "+" : ""}${systemRun.ship_today_count - manualRun.ship_today_count}`,
      meaning: "系统多排出可在承诺发货时间前完成的订单。",
    },
    {
      item: "延期风险订单数",
      manual: manualRun.metrics.delayed_order_count,
      system: systemRun.metrics.delayed_order_count,
      delta: `${systemRun.metrics.delayed_order_count - manualRun.metrics.delayed_order_count}`,
      meaning: "负数代表延期风险减少。",
    },
    {
      item: "缺料阻断订单数",
      manual: manualRun.metrics.material_blocked_order_count,
      system: systemRun.metrics.material_blocked_order_count,
      delta: `${systemRun.metrics.material_blocked_order_count - manualRun.metrics.material_blocked_order_count}`,
      meaning: "缺料没有靠排序解决，必须补料或调整库存。",
    },
    {
      item: "设备容量阻断订单数",
      manual: manualRun.metrics.equipment_blocked_order_count,
      system: systemRun.metrics.equipment_blocked_order_count,
      delta: `${systemRun.metrics.equipment_blocked_order_count - manualRun.metrics.equipment_blocked_order_count}`,
      meaning: "产能不足没有靠排序解决，需要加机时、换机或顺延。",
    },
  ];

  const riskRows = result.deterministic_result.risk_orders.slice(0, 12).map((risk) => ({
    order_id: risk.order_id,
    type: zhRiskType(risk.risk_type),
    level: zhRiskLevel(risk.risk_level),
    fact: risk.facts.join("; "),
    action: risk.suggested_action,
  }));

  const foundRisks = result.deterministic_result.risk_orders.filter((risk) =>
    ["material_shortage", "delay_risk", "capacity_exceeded", "equipment_unavailable"].includes(risk.risk_type)
  );

  const manualBaselineRows = manualOrders.slice(0, 10).map((order, index) => ({
    rank: index + 1,
    order_id: order.order_id,
    ship_at: formatLocal(order.manual_actual_ship_at),
    inferred_start_at: formatLocal(order.manual_inferred_start_at),
    replay_result: manualRun.tasks.some((task) => task.order_id === order.order_id)
      ? "进入回放任务"
      : "被约束阻断",
  }));

  return `# ForgeFlow P0a 回测报告样例

## 1. 结论

这次 P0a 回测的结论是：系统已经可以用 ${orders.length} 条历史订单，自动跑出一份可复盘的排产建议和风险报告。

在当前假设下，系统计划分数是 **${systemRun.metrics.plan_score}**，人工计划基线分数是 **${manualRun.metrics.plan_score}**，系统高出 **${systemRun.metrics.plan_score - manualRun.metrics.plan_score}** 分。这个分差主要来自两点：系统多排出了 **${systemRun.ship_today_count - manualRun.ship_today_count}** 个可在承诺时间前完成的订单，同时少暴露了 **${manualRun.metrics.delayed_order_count - systemRun.metrics.delayed_order_count}** 个延期风险订单。

但这个结果不能直接理解为“系统一定比人聪明”。它真正证明的是：只要把订单、SKU、耗材、设备整理成结构化输入，系统就能说明每个订单为什么提前、为什么后置、为什么不能准时发，以及问题是卡在缺料、设备容量还是交期上。

## 2. 输入与假设

- 订单样本：${orders.length} 条，来自小红书订单 Excel 的历史订单行，已移除姓名、电话、地址等 PII。
- 人工基线：用历史发货时间倒推候选生产开始时间，再按同一套机台和耗材约束回放。
- SKU / 耗材 / 设备：P0a MVP 假设表，用于验证规则内核；真实试点需要由业务负责人确认。
- 决策日期：${result.deterministic_result.decision_date}。
- 源文件：${sourceFiles.map((file) => `\`${path.basename(file)}\``).join(", ")}。

## 2.1 可信度边界

这份报告证明的是“规则链路可运行”，不是“真实业务已经验证准确”。

- 订单数据来自真实小红书导出表。
- SKU 表只有商品名称、规格、价格可以从订单表推导；标准工时、标准耗材、推荐设备、预计毛利是 P0a 假设。
- 耗材表和设备表不是原始数据提供的事实，而是为了跑通规则引擎构造的 MVP 假设。
- “今日计划”是历史快照回测：用 \`${result.deterministic_result.decision_date}\` 模拟当天早上的排产，不是当前真实日期的生产计划。
- 这些订单已经完成，所以历史发货时间只能作为人工计划基线代理，不能证明系统当时真的影响了结果。

因此，当前结果不能直接用来宣称“系统优于人工”。它只能说明：如果给定订单、SKU、耗材、设备四类结构化输入，P0a 引擎可以输出可复盘的缺料、准时可发、风险订单和排序差异。

## 2.2 人工基线排序方法

当前 Excel 没有真实的 \`manual_plan_rank\`，所以人工计划不是原始字段，而是一个“人工基线代理”。

计算步骤：

1. 倒推候选生产开始时间：

\`\`\`text
manual_candidate_start_at =
历史发货时间
- SKU 标准打印时长
- 后处理时间
- 包装时间
\`\`\`

2. 按 \`manual_candidate_start_at\` 从早到晚排序，得到人工基线顺序。
3. 用同一套耗材库存、推荐设备、设备可用时段做资源约束回放。
4. 如果回放中出现缺料、设备容量不足、晚于承诺发货时间，就进入风险或阻断，不强行算作准时可发。

这个方法比“只按历史发货时间排序”更接近真实生产顺序，但它仍然是代理，不等同于老板当天真实人工计划。

人工基线前 10 个候选顺序：

${reportTable(manualBaselineRows, [
    { key: "rank", label: "人工基线排序" },
    { key: "order_id", label: "order_id" },
    { key: "ship_at", label: "历史发货时间" },
    { key: "inferred_start_at", label: "倒推生产开始时间" },
    { key: "replay_result", label: "资源回放结果" },
  ])}

## 2.3 \`plan_score\` 评分规则

P0a 用一个简单的初始评分规则比较人工计划和系统计划：

\`\`\`text
plan_score =
准时可发单数 * 20
- 延期订单数 * 100
- 缺料阻断订单数 * 30
- 设备容量阻断订单数 * 10
\`\`\`

权重含义：

- 准时可发单数 \`+20\`：按承诺发货时间前完成并可发出是正收益，但不能压过延期风险。
- 延期订单数 \`-100\`：延期最伤交付稳定性，所以惩罚最大。
- 缺料阻断订单数 \`-30\`：缺料会导致停工，但可以通过补料解决，所以惩罚中等。
- 设备容量阻断订单数 \`-10\`：设备排不下不一定是排产错误，可能只是当天产能有限，所以惩罚最低。

这套权重是 P0a 的 MVP 初始假设，不是行业标准，也不是从真实历史结果训练出来的最终规则。进入真实试点后，应根据店主对“延期、缺料、产能、利润复盘”的实际取舍重新校准。

## 3. 回测指标

${reportTable(
    [
      { metric: "计划分数 plan_score", manual: manualRun.metrics.plan_score, system: systemRun.metrics.plan_score },
      { metric: "准时可发单数", manual: manualRun.ship_today_count, system: systemRun.ship_today_count },
      { metric: "延期风险订单数", manual: manualRun.metrics.delayed_order_count, system: systemRun.metrics.delayed_order_count },
      { metric: "缺料阻断订单数", manual: manualRun.metrics.material_blocked_order_count, system: systemRun.metrics.material_blocked_order_count },
      { metric: "设备容量阻断订单数", manual: manualRun.metrics.equipment_blocked_order_count, system: systemRun.metrics.equipment_blocked_order_count },
      { metric: "原因标签覆盖率", manual: "-", system: result.backtest.reason_tag_coverage_pct },
    ],
    [
      { key: "metric", label: "指标" },
      { key: "manual", label: "人工计划" },
      { key: "system", label: "系统计划" },
    ]
  )}

## 3.1 系统排序收益

${reportTable(benefitRows, [
    { key: "item", label: "收益项" },
    { key: "manual", label: "人工基线" },
    { key: "system", label: "系统计划" },
    { key: "delta", label: "变化" },
    { key: "meaning", label: "怎么理解" },
  ])}

本次样本里，系统排序的主要收益是：计划分数提升 **${systemRun.metrics.plan_score - manualRun.metrics.plan_score}**，准时可发单数增加 **${systemRun.ship_today_count - manualRun.ship_today_count}** 单，延期风险订单减少 **${manualRun.metrics.delayed_order_count - systemRun.metrics.delayed_order_count}** 单。缺料和设备容量没有改善，说明这两类问题不是“换个排序”就能解决，必须补料、加机时或顺延。

## 4. ${orders.length} 条样本人工基线 vs 系统排序全量对照

这张表按“人工基线排序”从上到下排列，用来看每个样本在系统排序中被提前、后置还是不变。

${reportTable(fullComparisonRows, [
    { key: "manual_rank", label: "人工排序" },
    { key: "order_id", label: "order_id" },
    { key: "system_rank", label: "系统排序" },
    { key: "rank_change", label: "系统变化" },
    { key: "type", label: "差异类型" },
    { key: "due_at", label: "承诺发货时间" },
    { key: "inferred_start_at", label: "倒推生产开始时间" },
    { key: "reason", label: "原因" },
  ])}

典型差异类型覆盖：

${reportTable(diffRows, [
    { key: "type", label: "差异类型" },
    { key: "order_id", label: "示例 order_id" },
    { key: "reason", label: "解释" },
  ])}

## 5. 缺料与补料

${shortageRows.length
    ? reportTable(shortageRows, [
        { key: "material", label: "耗材" },
        { key: "shortage_g", label: "缺口克数" },
        { key: "orders", label: "影响订单" },
      ])
    : "本次样本没有缺料阻断。"}

## 6. 系统提前暴露的问题

${reportTable(riskRows, [
    { key: "order_id", label: "order_id" },
    { key: "type", label: "风险类型" },
    { key: "level", label: "风险等级" },
    { key: "fact", label: "事实" },
    { key: "action", label: "建议动作" },
  ])}

本次回测发现 ${foundRisks.length} 个可复盘风险点，其中包含缺料、延期或设备容量风险。P0a 的价值不是自动替老板做决定，而是把这些尾部问题提前摊在桌面上。

## 7. 失败原因归类

${result.backtest.failed_case_list.length
    ? reportTable(result.backtest.failed_case_list, [
        { key: "order_id", label: "order_id" },
        { key: "failure_type", label: "失败类型" },
        { key: "reason", label: "原因" },
      ])
    : "没有导入级失败；所有订单都进入了规则回放或风险归类。"}

## 8. 规则修正建议

1. 当前 \`plan_score\` 对延期惩罚很重，适合交付稳定性验证；进入 P0b 前需要让业务负责人确认延期、缺料、设备容量三类权重是否符合实际取舍。
2. 耗材库存来自假设表，不是 Excel 原始字段。进入 P0b 前必须让业务负责人确认库存快照，否则缺料结论只能作为演示证据。
3. 人工基线是“倒推开始时间 + 资源约束回放”的代理。真实试点要记录“人工计划顺序”和“未采纳原因”，否则系统赢了也可能只是赢在错误基线上。

就这样。
`;
}

function buildResult({ orders, skuRows, materialRows, equipmentRows, systemRun, manualRun, systemOrders, manualOrders, scoresByOrder, decisionStart, sourceFiles }) {
  const reasonTagged = orders.filter((order) => (scoresByOrder.get(order.order_id)?.reason_tags || []).length > 0).length;
  const reasonTagCoveragePct = Math.round((reasonTagged / orders.length) * 10000) / 100;
  const allProfitComplete = orders.every((order) => order.profit_estimate !== null) && skuRows.every((sku) => sku.profit_estimate !== null);
  const materialsById = new Map(materialRows.map((material) => [material.material_id, material]));
  const purchaseSuggestions = buildPurchaseSuggestions(systemRun.material_shortages, materialsById, systemRun);
  const differences = buildDifferences(manualOrders, systemOrders, scoresByOrder, systemRun);

  const failedCaseList = [
    ...systemRun.missing_data_actions.map((action) => ({
      order_id: action.order_id,
      failure_type: "missing_data",
      reason: action.missing_fields.join(", "),
    })),
    ...systemRun.risk_orders
      .filter((risk) => ["material_record_missing", "equipment_unavailable"].includes(risk.risk_type))
      .map((risk) => ({
        order_id: risk.order_id,
        failure_type: risk.risk_type,
        reason: risk.facts.join("; "),
      })),
  ];

  const decisionId = `DD-${dateOnly(decisionStart).replaceAll("-", "")}-P0A`;
  const inputSnapshotId = `SNAP-${hashRows([sourceFiles, orders.map((order) => order.order_id)])}`;
  const systemRanks = rankMap(systemOrders);
  const fullRankComparison = manualOrders.map((order, index) => {
    const manualRank = index + 1;
    const systemRank = systemRanks.get(order.order_id);
    const rankDelta = manualRank - systemRank;
    const classified = classifyRankDifference(scoresByOrder.get(order.order_id), rankDelta);
    return {
      manual_rank: manualRank,
      system_rank: systemRank,
      rank_delta: rankDelta,
      rank_change: rankDelta > 0 ? `提前 ${rankDelta} 位` : rankDelta < 0 ? `后置 ${Math.abs(rankDelta)} 位` : "不变",
      order_id: order.order_id,
      difference_type: classified.type,
      due_at: formatLocal(order.due_at),
      manual_actual_ship_at: formatLocal(order.manual_actual_ship_at),
      manual_inferred_start_at: formatLocal(order.manual_inferred_start_at),
      reason: classified.reason,
    };
  });

  const deterministicResult = {
    decision_id: decisionId,
    decision_version: 1,
    decision_date: dateOnly(decisionStart),
    generated_at: formatLocal(decisionStart),
    generated_by: "系统自动",
    input_snapshot_id: inputSnapshotId,
    changed_reason: "first_generate",
    precondition_status: failedCaseList.length > 0 ? "低可信" : "可生成",
    missing_data_actions: systemRun.missing_data_actions,
    priority_orders: systemRun.tasks,
    material_shortages: systemRun.material_shortages,
    purchase_suggestions: purchaseSuggestions,
    ship_today_count: systemRun.ship_today_count,
    ship_today_order_ids: systemRun.ship_today_order_ids,
    risk_orders: systemRun.risk_orders,
    optimization_actions: buildOptimizationActions(systemRun, manualRun, allProfitComplete),
    data_quality_flags: [
      {
        flag: "source_excel_pii_removed",
        level: "info",
        message: "订单样本已移除姓名、电话、地址等 PII。",
      },
      {
        flag: "manual_sequence_proxy",
        level: "warning",
        message: "人工计划序列使用历史发货时间倒推候选生产开始时间，再按资源约束回放；需在真实试点中替换为人工记录。",
      },
    ],
    plan_score: systemRun.metrics.plan_score,
    score_summary: {
      manual_plan_score: manualRun.metrics.plan_score,
      system_plan_score: systemRun.metrics.plan_score,
      score_delta: systemRun.metrics.plan_score - manualRun.metrics.plan_score,
      manual_metrics: manualRun.metrics,
      system_metrics: systemRun.metrics,
      reason_tag_coverage_pct: reasonTagCoveragePct,
    },
  };

  return {
    sample_meta: {
      label: sampleLabelFromOrdersPath(sourceFiles[0], orders.length, decisionStart),
      order_count: orders.length,
      decision_date: dateOnly(decisionStart),
      source_orders_file: path.basename(sourceFiles[0]),
    },
    deterministic_result: deterministicResult,
    input_snapshot: {
      input_snapshot_id: inputSnapshotId,
      decision_id: decisionId,
      order_snapshot_hash: hashRows(orders),
      sku_snapshot_hash: hashRows(skuRows),
      material_snapshot_hash: hashRows(materialRows),
      equipment_snapshot_hash: hashRows(equipmentRows),
      created_at: formatLocal(decisionStart),
    },
    backtest: {
      order_count: orders.length,
      manual_sequence_method: "manual_actual_ship_at - sku_process_hours, then resource-constrained replay",
      manual_sequence_order_ids: manualOrders.map((order) => order.order_id),
      manual_sequence_details: manualOrders.map((order, index) => ({
        rank: index + 1,
        order_id: order.order_id,
        manual_actual_ship_at: formatLocal(order.manual_actual_ship_at),
        manual_inferred_start_at: formatLocal(order.manual_inferred_start_at),
      })),
      system_sequence_order_ids: systemOrders.map((order) => order.order_id),
      manual_plan_score: manualRun.metrics.plan_score,
      system_plan_score: systemRun.metrics.plan_score,
      score_delta: systemRun.metrics.plan_score - manualRun.metrics.plan_score,
      reason_tag_coverage_pct: reasonTagCoveragePct,
      differences,
      full_rank_comparison: fullRankComparison,
      failed_case_list: failedCaseList,
      acceptance: {
        outputs_today_plan_json: true,
        outputs_backtest_report_md: true,
        no_ai_dependency: true,
        reason_tag_coverage_pass: reasonTagCoveragePct >= 80,
        differences_explainable: differences.length >= 3,
      },
    },
  };
}

async function runBacktest({ ordersPath, skuPath, materialsPath, equipmentPath, planOut, reportOut, decisionDate }) {
  const rawOrders = await readCsv(ordersPath);
  const rawSkus = await readCsv(skuPath);
  const rawMaterials = await readCsv(materialsPath);

  if (rawOrders.length === 0) throw new Error("orders.csv 为空。");
  const snapshotDate = decisionDate || rawOrders[0].snapshot_date;
  const decisionStart = parseDate(snapshotDate, "09:00:00");
  if (!decisionStart || Number.isNaN(decisionStart.getTime())) {
    throw new Error("orders.csv 中缺少有效 snapshot_date，或需要通过 --decision-date 指定。");
  }

  const rawEquipment = await readCsv(equipmentPath);
  const orders = rawOrders.map(normalizeOrder);
  const skuRows = rawSkus.map(normalizeSku);
  const materialRows = rawMaterials.map(normalizeMaterial);
  const equipmentRows = rawEquipment.map((row) => normalizeEquipment(row, decisionStart));

  const duplicateOrderIds = orders
    .map((order) => order.order_id)
    .filter((id, index, ids) => ids.indexOf(id) !== index);
  if (duplicateOrderIds.length > 0) {
    throw new Error(`发现重复 order_id：${[...new Set(duplicateOrderIds)].join(", ")}`);
  }

  const negativeMaterials = materialRows.filter((material) => material.available_g < 0);
  if (negativeMaterials.length > 0) {
    throw new Error(
      `库存为负数，阻断计算：${negativeMaterials
        .map((material) => `${material.material_id}=${material.available_g}`)
        .join(", ")}`
    );
  }

  const skuById = new Map(skuRows.map((sku) => [sku.sku_id, sku]));
  const materialsById = new Map(materialRows.map((material) => [material.material_id, material]));
  const equipmentById = new Map(equipmentRows.map((equipment) => [equipment.equipment_id, equipment]));
  const scoresByOrder = new Map();

  for (const order of orders) {
    scoresByOrder.set(order.order_id, scoreOrder(order, skuById.get(order.sku_id), materialsById, equipmentById, decisionStart));
  }

  const manualOrders = orders
    .map((order) => {
      const sku = skuById.get(order.sku_id);
      return {
        ...order,
        manual_inferred_start_at: inferManualStartAt(order, sku),
      };
    })
    .sort((a, b) => {
      const inferredA = a.manual_inferred_start_at?.getTime() ?? Infinity;
      const inferredB = b.manual_inferred_start_at?.getTime() ?? Infinity;
      if (inferredA !== inferredB) return inferredA - inferredB;
      const shipA = a.manual_actual_ship_at?.getTime() ?? Infinity;
      const shipB = b.manual_actual_ship_at?.getTime() ?? Infinity;
      if (shipA !== shipB) return shipA - shipB;
      return a.manual_sequence - b.manual_sequence;
    });
  const systemOrders = [...orders].sort((a, b) => {
    const scoreA = scoresByOrder.get(a.order_id).score_breakdown.priority_score;
    const scoreB = scoresByOrder.get(b.order_id).score_breakdown.priority_score;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return (a.due_at?.getTime() || Infinity) - (b.due_at?.getTime() || Infinity);
  });

  const simArgs = { skuById, materialsById, equipmentById, scoresByOrder, decisionStart };
  const manualRun = simulateSequence({ ...simArgs, sequenceName: "manual", orders: manualOrders });
  const systemRun = simulateSequence({ ...simArgs, sequenceName: "system", orders: systemOrders });

  const sourceFiles = [ordersPath, skuPath, materialsPath, equipmentPath];
  const result = buildResult({
    orders,
    skuRows,
    materialRows,
    equipmentRows,
    systemRun,
    manualRun,
    systemOrders,
    manualOrders,
    scoresByOrder,
    decisionStart,
    sourceFiles,
  });

  const report = generateReport({
    orders,
    systemOrders,
    manualOrders,
    systemRun,
    manualRun,
    differences: result.backtest.differences,
    result,
    sourceFiles,
    scoresByOrder,
  });

  await fs.mkdir(path.dirname(planOut), { recursive: true });
  await fs.mkdir(path.dirname(reportOut), { recursive: true });
  await fs.writeFile(planOut, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await fs.writeFile(reportOut, report, "utf8");

  return {
    planOut,
    reportOut,
    summary: {
      manual_plan_score: manualRun.metrics.plan_score,
      system_plan_score: systemRun.metrics.plan_score,
      reason_tag_coverage_pct: result.backtest.reason_tag_coverage_pct,
    },
  };
}

module.exports = { runBacktest };
