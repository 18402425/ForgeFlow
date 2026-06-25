# ForgeFlow Data Model

ForgeFlow is intentionally small. It does not need a full ERP to run.

It needs four standard tables plus one optional alias table.

## Core Contract

```text
orders: what customers are waiting for
sku_catalog: how each SKU is produced
material_inventory: what material is available
equipment_calendar: what printer capacity is available today
sku_aliases: how platform product names map to internal SKU IDs
```

## orders.csv

Required fields:

| Field | Meaning |
|---|---|
| `snapshot_date` | Planning snapshot date, such as `2026-06-24`. |
| `order_id` | Internal anonymized order ID. |
| `order_created_at` | Order creation or payment time. |
| `due_at` | Promised ship deadline. |
| `sku_id` | Internal SKU ID. Must exist in `sku_catalog.csv`. |
| `quantity` | Ordered quantity. |

Useful optional fields:

| Field | Meaning |
|---|---|
| `source_order_ref` | Masked source platform order reference. |
| `manual_sequence` | Imported platform order order or manual baseline sequence. |
| `manual_actual_ship_at` | Historical ship time, only for historical replay. Leave empty for live planning. |
| `sku_name` | Human-readable product name. |
| `sku_spec` | Human-readable spec. |
| `platform_tags` | Pipe-separated tags, such as `催发货|缺货`. |
| `notes` | Import notes or operational context. |

## sku_catalog.csv

Required fields:

| Field | Meaning |
|---|---|
| `sku_id` | Internal SKU ID owned by this merchant. |
| `sku_name` | Product name. |
| `sku_spec` | Product spec. |
| `material_id` | Main material ID. Must exist in `material_inventory.csv`. |
| `standard_print_hours` | Standard print time for one unit. |
| `standard_material_g` | Standard material grams for one unit. |
| `recommended_equipment` | Pipe-separated printer IDs, such as `PRN-A1-01|PRN-P1S-01`. |

Useful optional fields:

| Field | Meaning |
|---|---|
| `post_process_minutes` | Estimated post-processing minutes. |
| `package_minutes` | Estimated packing minutes. |
| `revenue_estimate` | Revenue estimate for review. |
| `profit_estimate` | Profit estimate for review. |
| `calibration_sample_count` | Number of samples used to trust this SKU recipe. |

Different merchants should not share one global SKU catalog. Each merchant owns their own `sku_id` namespace.

## material_inventory.csv

Required fields:

| Field | Meaning |
|---|---|
| `material_id` | Internal material ID. |
| `material_name` | Material display name. |
| `available_g` | Current available grams. |

Useful optional fields:

| Field | Meaning |
|---|---|
| `roll_spec_g` | Standard roll size. |
| `full_roll_count` | Full unopened roll count. |
| `opened_remaining_g` | Remaining grams in opened rolls. |
| `safety_line_g` | Safety stock line. |
| `same_day_arrival_available` | Whether replenishment can arrive today. |
| `unit_price` | Estimated material unit cost. |

## equipment_calendar.csv

Required fields:

| Field | Meaning |
|---|---|
| `equipment_id` | Printer ID. |
| `equipment_name` | Printer display name. |
| `equipment_type` | Printer type, such as `FDM`. |
| `status` | `available`, `unavailable`, `maintenance`, or `offline`. |
| `available_start` | Today's available start time. |
| `available_end` | Today's available end time. |

Useful optional fields:

| Field | Meaning |
|---|---|
| `daily_available_hours` | Planned available hours today. |
| `status_updated_at` | Time this status was last checked. |

## sku_aliases.csv

Use this table when platform product names differ from your internal SKU names.

| Field | Meaning |
|---|---|
| `platform_product_name` | Product name from the platform export. |
| `platform_sku_spec` | SKU/spec text from the platform export. |
| `sku_id` | Internal SKU ID in `sku_catalog.csv`. |

Example:

```csv
platform_product_name,platform_sku_spec,sku_id
恶魔叮彩色编织绳钥匙扣,黑色,SKU-016
恶魔叮钥匙扣,黑色,SKU-016
```

When `import_xhs_orders.py` cannot map a row, it writes that row to `unknown_sku.csv`. Add the mapping once, then import again.

## Validation Rule

Before planning, ForgeFlow checks:

- Every order has a known `sku_id`.
- Every SKU has positive print hours and material grams.
- Every SKU material exists in inventory.
- Every recommended printer exists in equipment.
- Equipment time windows are valid.
- Inventory is not negative before planning starts.
