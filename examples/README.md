# ForgeFlow Examples

`examples/standard/` is the smallest reusable demo dataset for ForgeFlow.

It contains four standard input tables:

- `orders.csv`: order demand.
- `sku_catalog.csv`: SKU production recipe.
- `material_inventory.csv`: material and stock constraints.
- `equipment_calendar.csv`: printer capacity constraints.

It also contains `sku_aliases.csv`, which maps messy platform product names to internal SKU IDs for order imports.

Run the demo from the repository root:

```bash
python3 scripts/run_demo.py
```

Outputs are written to `outputs/demo/`.
