# ForgeFlow Input Templates

ForgeFlow uses a simple rule:

```text
orders = demand
sku_catalog = production recipe
material_inventory = material constraint
equipment_calendar = capacity constraint
sku_aliases = platform name to internal SKU mapping
```

Use these CSV files when you want to connect a new merchant's data:

- `standard_orders.csv`
- `sku_catalog.csv`
- `material_inventory.csv`
- `equipment_calendar.csv`
- `sku_aliases.csv`

For spreadsheet users, `forgeflow_setup_template.xlsx` contains the richer multi-sheet setup template used during P0b/P0.5 validation.

After filling the files, validate them:

```bash
python3 scripts/validate_inputs.py \
  --orders path/to/orders.csv \
  --sku path/to/sku_catalog.csv \
  --materials path/to/material_inventory.csv \
  --equipment path/to/equipment_calendar.csv \
  --out-dir outputs/merchant-check
```
