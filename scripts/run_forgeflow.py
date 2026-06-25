#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def run_command(command: list[str], cwd: Path) -> None:
    print("+ " + " ".join(command), flush=True)
    subprocess.run(command, cwd=cwd, check=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate inputs and run the ForgeFlow deterministic planner.")
    parser.add_argument("--orders", type=Path, default=Path("examples/standard/orders.csv"))
    parser.add_argument("--sku", type=Path, default=Path("examples/standard/sku_catalog.csv"))
    parser.add_argument("--materials", type=Path, default=Path("examples/standard/material_inventory.csv"))
    parser.add_argument("--equipment", type=Path, default=Path("examples/standard/equipment_calendar.csv"))
    parser.add_argument("--out-dir", type=Path, default=Path("outputs/demo"))
    parser.add_argument("--skip-validation", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    out_dir = (ROOT / args.out_dir).resolve() if not args.out_dir.is_absolute() else args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    orders = (ROOT / args.orders).resolve() if not args.orders.is_absolute() else args.orders
    sku = (ROOT / args.sku).resolve() if not args.sku.is_absolute() else args.sku
    materials = (ROOT / args.materials).resolve() if not args.materials.is_absolute() else args.materials
    equipment = (ROOT / args.equipment).resolve() if not args.equipment.is_absolute() else args.equipment

    if not args.skip_validation:
        run_command(
            [
                sys.executable,
                "scripts/validate_inputs.py",
                "--orders",
                str(orders),
                "--sku",
                str(sku),
                "--materials",
                str(materials),
                "--equipment",
                str(equipment),
                "--out-dir",
                str(out_dir),
            ],
            ROOT,
        )

    plan_out = out_dir / "today_plan.json"
    report_out = out_dir / "decision_report.md"
    run_command(
        [
            "node",
            "run-backtest.js",
            str(orders),
            str(sku),
            str(materials),
            str(equipment),
            "--plan-out",
            str(plan_out),
            "--report-out",
            str(report_out),
        ],
        ROOT,
    )

    summary = {
        "plan": str(plan_out),
        "report": str(report_out),
        "validation": str(out_dir / "validation_report.json"),
        "unknown_sku": str(out_dir / "unknown_sku.csv"),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as error:
        raise SystemExit(error.returncode)
