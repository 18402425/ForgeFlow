#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import sys
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Iterable


ORDER_REQUIRED = [
    "snapshot_date",
    "order_id",
    "order_created_at",
    "due_at",
    "sku_id",
    "quantity",
]

SKU_REQUIRED = [
    "sku_id",
    "sku_name",
    "sku_spec",
    "material_id",
    "standard_print_hours",
    "standard_material_g",
    "recommended_equipment",
]

MATERIAL_REQUIRED = [
    "material_id",
    "material_name",
    "available_g",
]

EQUIPMENT_REQUIRED = [
    "equipment_id",
    "equipment_name",
    "equipment_type",
    "status",
    "available_start",
    "available_end",
]


@dataclass
class Issue:
    severity: str
    file: str
    row: int | None
    field: str
    message: str
    value: str = ""


def read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    if not path.exists():
        raise FileNotFoundError(path)
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        headers = reader.fieldnames or []
        rows = [{key: (value or "").strip() for key, value in row.items()} for row in reader]
    return headers, rows


def write_csv(path: Path, rows: list[dict[str, str]], headers: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=headers)
        writer.writeheader()
        writer.writerows(rows)


def parse_number(value: str) -> float | None:
    if value is None or str(value).strip() == "":
        return None
    try:
        return float(str(value).replace("%", "").strip())
    except ValueError:
        return None


def parse_datetime(value: str) -> datetime | None:
    if not value:
        return None
    raw = value.strip().replace("T", " ")
    if raw.endswith("Z"):
        raw = raw[:-1]
    if "+" in raw:
        raw = raw.split("+", 1)[0].strip()
    formats = [
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d",
    ]
    for fmt in formats:
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            pass
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def split_ids(value: str) -> list[str]:
    return [item.strip() for item in str(value or "").split("|") if item.strip()]


def missing_columns(headers: Iterable[str], required: Iterable[str]) -> list[str]:
    existing = set(headers)
    return [field for field in required if field not in existing]


def add_missing_column_issues(issues: list[Issue], path: Path, headers: list[str], required: list[str]) -> None:
    for field in missing_columns(headers, required):
        issues.append(Issue("error", str(path), None, field, "required column is missing"))


def validate_orders(
    path: Path,
    headers: list[str],
    rows: list[dict[str, str]],
    sku_ids: set[str],
) -> tuple[list[Issue], list[dict[str, str]]]:
    issues: list[Issue] = []
    unknown_skus: list[dict[str, str]] = []
    add_missing_column_issues(issues, path, headers, ORDER_REQUIRED)

    seen_order_ids: set[str] = set()
    for index, row in enumerate(rows, start=2):
        order_id = row.get("order_id", "")
        if not order_id:
            issues.append(Issue("error", str(path), index, "order_id", "order_id is required"))
        elif order_id in seen_order_ids:
            issues.append(Issue("error", str(path), index, "order_id", "duplicate order_id", order_id))
        seen_order_ids.add(order_id)

        sku_id = row.get("sku_id", "")
        if not sku_id:
            issues.append(Issue("error", str(path), index, "sku_id", "sku_id is required"))
        elif sku_id not in sku_ids:
            issues.append(Issue("error", str(path), index, "sku_id", "sku_id is not in sku_catalog", sku_id))
            unknown_skus.append(
                {
                    "order_id": order_id,
                    "sku_id": sku_id,
                    "sku_name": row.get("sku_name", ""),
                    "sku_spec": row.get("sku_spec", ""),
                }
            )

        quantity = parse_number(row.get("quantity", ""))
        if quantity is None or quantity <= 0:
            issues.append(Issue("error", str(path), index, "quantity", "quantity must be greater than 0", row.get("quantity", "")))

        created_at = parse_datetime(row.get("order_created_at", ""))
        due_at = parse_datetime(row.get("due_at", ""))
        if created_at is None:
            issues.append(Issue("error", str(path), index, "order_created_at", "invalid datetime", row.get("order_created_at", "")))
        if due_at is None:
            issues.append(Issue("error", str(path), index, "due_at", "invalid datetime", row.get("due_at", "")))
        if created_at and due_at and due_at <= created_at:
            issues.append(Issue("warning", str(path), index, "due_at", "due_at is not after order_created_at", row.get("due_at", "")))

    return issues, unknown_skus


def validate_skus(
    path: Path,
    headers: list[str],
    rows: list[dict[str, str]],
    material_ids: set[str],
    equipment_ids: set[str],
) -> list[Issue]:
    issues: list[Issue] = []
    add_missing_column_issues(issues, path, headers, SKU_REQUIRED)

    seen_sku_ids: set[str] = set()
    for index, row in enumerate(rows, start=2):
        sku_id = row.get("sku_id", "")
        if not sku_id:
            issues.append(Issue("error", str(path), index, "sku_id", "sku_id is required"))
        elif sku_id in seen_sku_ids:
            issues.append(Issue("error", str(path), index, "sku_id", "duplicate sku_id", sku_id))
        seen_sku_ids.add(sku_id)

        print_hours = parse_number(row.get("standard_print_hours", ""))
        if print_hours is None or print_hours <= 0:
            issues.append(
                Issue("error", str(path), index, "standard_print_hours", "standard_print_hours must be greater than 0", row.get("standard_print_hours", ""))
            )

        material_g = parse_number(row.get("standard_material_g", ""))
        if material_g is None or material_g <= 0:
            issues.append(
                Issue("error", str(path), index, "standard_material_g", "standard_material_g must be greater than 0", row.get("standard_material_g", ""))
            )

        material_id = row.get("material_id", "")
        if material_id not in material_ids:
            issues.append(Issue("error", str(path), index, "material_id", "material_id is not in material_inventory", material_id))

        recommended = split_ids(row.get("recommended_equipment", ""))
        if not recommended:
            issues.append(Issue("error", str(path), index, "recommended_equipment", "recommended_equipment is required"))
        for equipment_id in recommended:
            if equipment_id not in equipment_ids:
                issues.append(
                    Issue("error", str(path), index, "recommended_equipment", "equipment_id is not in equipment_calendar", equipment_id)
                )

    return issues


def validate_materials(path: Path, headers: list[str], rows: list[dict[str, str]]) -> list[Issue]:
    issues: list[Issue] = []
    add_missing_column_issues(issues, path, headers, MATERIAL_REQUIRED)

    seen_material_ids: set[str] = set()
    for index, row in enumerate(rows, start=2):
        material_id = row.get("material_id", "")
        if not material_id:
            issues.append(Issue("error", str(path), index, "material_id", "material_id is required"))
        elif material_id in seen_material_ids:
            issues.append(Issue("error", str(path), index, "material_id", "duplicate material_id", material_id))
        seen_material_ids.add(material_id)

        available = parse_number(row.get("available_g", ""))
        if available is None or available < 0:
            issues.append(Issue("error", str(path), index, "available_g", "available_g must be 0 or greater", row.get("available_g", "")))

        safety = parse_number(row.get("safety_line_g", ""))
        if safety is not None and safety < 0:
            issues.append(Issue("warning", str(path), index, "safety_line_g", "safety_line_g is negative", row.get("safety_line_g", "")))

    return issues


def validate_equipment(path: Path, headers: list[str], rows: list[dict[str, str]]) -> list[Issue]:
    issues: list[Issue] = []
    add_missing_column_issues(issues, path, headers, EQUIPMENT_REQUIRED)

    seen_equipment_ids: set[str] = set()
    available_count = 0
    for index, row in enumerate(rows, start=2):
        equipment_id = row.get("equipment_id", "")
        if not equipment_id:
            issues.append(Issue("error", str(path), index, "equipment_id", "equipment_id is required"))
        elif equipment_id in seen_equipment_ids:
            issues.append(Issue("error", str(path), index, "equipment_id", "duplicate equipment_id", equipment_id))
        seen_equipment_ids.add(equipment_id)

        status = row.get("status", "").lower()
        if status not in {"available", "unavailable", "maintenance", "offline"}:
            issues.append(Issue("warning", str(path), index, "status", "unexpected status", row.get("status", "")))
        if status == "available":
            available_count += 1

        start = parse_datetime(row.get("available_start", ""))
        end = parse_datetime(row.get("available_end", ""))
        if start is None:
            issues.append(Issue("error", str(path), index, "available_start", "invalid datetime", row.get("available_start", "")))
        if end is None:
            issues.append(Issue("error", str(path), index, "available_end", "invalid datetime", row.get("available_end", "")))
        if start and end and end <= start:
            issues.append(Issue("error", str(path), index, "available_end", "available_end must be after available_start", row.get("available_end", "")))

    if rows and available_count == 0:
        issues.append(Issue("error", str(path), None, "status", "at least one equipment row must be available"))
    return issues


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate ForgeFlow standard input CSV files.")
    parser.add_argument("--orders", type=Path, required=True)
    parser.add_argument("--sku", type=Path, required=True)
    parser.add_argument("--materials", type=Path, required=True)
    parser.add_argument("--equipment", type=Path, required=True)
    parser.add_argument("--out-dir", type=Path, default=Path("outputs/demo"))
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)

    try:
        order_headers, orders = read_csv(args.orders)
        sku_headers, skus = read_csv(args.sku)
        material_headers, materials = read_csv(args.materials)
        equipment_headers, equipment = read_csv(args.equipment)
    except FileNotFoundError as error:
        print(f"Input file not found: {error}", file=sys.stderr)
        return 2

    material_ids = {row.get("material_id", "") for row in materials}
    equipment_ids = {row.get("equipment_id", "") for row in equipment}
    sku_ids = {row.get("sku_id", "") for row in skus}

    issues: list[Issue] = []
    issues.extend(validate_materials(args.materials, material_headers, materials))
    issues.extend(validate_equipment(args.equipment, equipment_headers, equipment))
    issues.extend(validate_skus(args.sku, sku_headers, skus, material_ids, equipment_ids))
    order_issues, unknown_skus = validate_orders(args.orders, order_headers, orders, sku_ids)
    issues.extend(order_issues)

    error_count = sum(1 for issue in issues if issue.severity == "error")
    warning_count = sum(1 for issue in issues if issue.severity == "warning")
    report = {
        "ok": error_count == 0,
        "counts": {
            "orders": len(orders),
            "skus": len(skus),
            "materials": len(materials),
            "equipment": len(equipment),
            "unknown_skus": len(unknown_skus),
            "errors": error_count,
            "warnings": warning_count,
        },
        "issues": [asdict(issue) for issue in issues],
    }

    report_path = args.out_dir / "validation_report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    unknown_path = args.out_dir / "unknown_sku.csv"
    write_csv(unknown_path, unknown_skus, ["order_id", "sku_id", "sku_name", "sku_spec"])

    print(json.dumps({"validation_report": str(report_path), **report["counts"], "ok": report["ok"]}, ensure_ascii=False, indent=2))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
