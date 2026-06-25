#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    command = [
        sys.executable,
        "scripts/run_forgeflow.py",
        "--orders",
        "examples/standard/orders.csv",
        "--sku",
        "examples/standard/sku_catalog.csv",
        "--materials",
        "examples/standard/material_inventory.csv",
        "--equipment",
        "examples/standard/equipment_calendar.csv",
        "--out-dir",
        "outputs/demo",
    ]
    print("+ " + " ".join(command), flush=True)
    subprocess.run(command, cwd=ROOT, check=True)
    print("\nDemo complete:")
    print("  outputs/demo/today_plan.json")
    print("  outputs/demo/decision_report.md")
    print("  outputs/demo/validation_report.json")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as error:
        raise SystemExit(error.returncode)
