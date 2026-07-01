#!/usr/bin/env python3
"""Summarize Lichuang EDA/JLCPCB .eprj2 SQLite project files read-only."""

from __future__ import annotations

import argparse
import base64
import collections
import gzip
import json
import sqlite3
import sys
from pathlib import Path
from typing import Any, Iterable


TABLES = ("documents", "components", "devices", "attributes")
STRUCTURE_TABLES = (
    "project_structures",
    "history_data",
    "project_images",
    "branches",
)
INTERESTING_DOC_TYPES = (
    "CANVAS",
    "COMPONENT",
    "WIRE",
    "CONNECT",
    "TEARDROP",
    "LAYER",
    "LAYER_PHYS",
    "NET",
    "RULE",
    "RULE_SELECTOR",
    "PAD_NET",
    "VIA",
    "PAD",
    "LINE",
    "POUR",
    "POURED",
    "POLY",
    "PRIMITIVE",
    "STRING",
)
METADATA_KEYS = (
    "Supplier Part",
    "Manufacturer",
    "Manufacturer Part",
    "Supplier Footprint",
    "JLCPCB Part Class",
    "Datasheet",
    "Add into BOM",
    "Convert to PCB",
    "Designator",
    "Footprint",
    "Value",
)


def connect_readonly(path: Path) -> sqlite3.Connection:
    resolved = path.expanduser().resolve()
    if not resolved.exists():
        raise FileNotFoundError(resolved)
    uri = resolved.as_uri() + "?mode=ro"
    con = sqlite3.connect(uri, uri=True)
    con.row_factory = sqlite3.Row
    return con


def decode_datastr(value: str | None) -> str:
    if not value:
        return ""
    if not value.startswith("base64"):
        return value
    raw = base64.b64decode(value[6:])
    try:
        raw = gzip.decompress(raw)
    except OSError:
        pass
    return raw.decode("utf-8", errors="replace")


def iter_records(data_str: str | None) -> list[list[Any]]:
    records: list[list[Any]] = []
    for line in decode_datastr(data_str).splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(record, list) and record:
            records.append(record)
    return records


def scalar(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float):
        return f"{value:.4f}".rstrip("0").rstrip(".")
    return str(value)


def count_table(cur: sqlite3.Cursor, table: str) -> int:
    try:
        return int(cur.execute(f"select count(*) from {table}").fetchone()[0])
    except sqlite3.Error:
        return 0


def print_kv(title: str, rows: Iterable[tuple[Any, Any]], indent: str = "  ") -> None:
    print(title)
    any_row = False
    for key, value in rows:
        any_row = True
        print(f"{indent}{key}: {value}")
    if not any_row:
        print(f"{indent}(none)")


def record_value(record: list[Any], index: int, default: Any = "") -> Any:
    return record[index] if len(record) > index else default


def layer_records(records: list[list[Any]]) -> dict[Any, list[Any]]:
    return {record[1]: record for record in records if record[0] == "LAYER" and len(record) > 1}


def layer_label(layers: dict[Any, list[Any]], layer_id: Any) -> str:
    layer = layers.get(layer_id)
    if not layer:
        return f"{scalar(layer_id)}:?"
    code = scalar(record_value(layer, 2))
    display = scalar(record_value(layer, 3))
    name = code if code in {"TOP", "BOTTOM"} else display or code
    return f"{scalar(layer_id)}:{name or '?'}"


def is_active_copper_layer(record: list[Any]) -> bool:
    if len(record) < 5:
        return False
    layer_kind = record[2]
    enabled = record[4]
    return layer_kind in {"TOP", "BOTTOM", "SIGNAL"} and enabled not in (0, "0", False, None, "")


def number(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def mil_to_mm(value: float) -> float:
    return value * 0.0254


def format_dimension(raw_value: float, canvas_unit: str | None) -> str:
    if canvas_unit == "mil":
        return f"{scalar(raw_value)} mil (~{mil_to_mm(raw_value):.3f} mm)"
    return f"{scalar(raw_value)} raw (~{mil_to_mm(raw_value):.3f} mm if raw is mil)"


def format_outline_shape(shape: Any, canvas_unit: str | None) -> str:
    if not isinstance(shape, list) or not shape:
        return json.dumps(shape, ensure_ascii=False)

    kind = str(shape[0])
    if kind == "CIRCLE" and len(shape) > 3:
        radius = number(shape[3])
        if radius is not None:
            diameter = radius * 2
            return (
                f"CIRCLE radius={format_dimension(radius, canvas_unit)}, "
                f"diameter={format_dimension(diameter, canvas_unit)}"
            )
    if kind == "R" and len(shape) > 4:
        width = number(shape[3])
        height = number(shape[4])
        radius = number(shape[6] if len(shape) > 6 else None)
        if width is not None and height is not None:
            details = [
                f"rounded_rect width={format_dimension(width, canvas_unit)}",
                f"height={format_dimension(height, canvas_unit)}",
            ]
            if radius is not None:
                details.append(f"corner_radius={format_dimension(radius, canvas_unit)}")
            return ", ".join(details)

    return json.dumps(shape, ensure_ascii=False)


def designator_family(value: str | None) -> str:
    if not value:
        return "(blank/none)"
    stripped = value.strip()
    if not stripped:
        return "(blank/none)"
    return stripped[:1]


def summarize_documents(cur: sqlite3.Cursor) -> None:
    try:
        docs = cur.execute(
            "select title, display_title, docType, dataStr from documents order by docType, title"
        ).fetchall()
    except sqlite3.Error:
        print("Documents: unavailable")
        return

    print("Documents:")
    if not docs:
        print("  (none)")
        return

    for doc in docs:
        records = iter_records(doc["dataStr"])
        counts = collections.Counter(record[0] for record in records)
        interesting = {key: counts[key] for key in INTERESTING_DOC_TYPES if counts[key]}
        print(
            f"  {doc['display_title']} ({doc['title']}), docType={doc['docType']}, "
            f"records={len(records)}"
        )
        print(f"    record_counts: {json.dumps(interesting, ensure_ascii=False)}")
        if int(doc["docType"]) == 3:
            summarize_pcb(records)


def summarize_project_structures(cur: sqlite3.Cursor) -> None:
    try:
        rows = cur.execute(
            """
            select id, ticket, branch_uuid, structure
            from project_structures
            order by id
            """
        ).fetchall()
    except sqlite3.Error:
        return

    if not rows:
        return

    print(f"Project structures: {len(rows)} rows")
    latest = rows[-1]
    print(f"  latest_id: {latest['id']}")
    print(f"  latest_ticket: {latest['ticket']}")
    print(f"  latest_branch_uuid: {latest['branch_uuid']}")

    try:
        data = json.loads(latest["structure"])
    except (TypeError, json.JSONDecodeError):
        print("  latest_structure: unavailable JSON")
        return

    for key in ("boards", "schematics", "sheets", "pcbs", "panels", "blockSymbols"):
        value = data.get(key, {})
        if isinstance(value, dict):
            print(f"  {key}: {len(value)}")
            for uuid, item in list(value.items())[:10]:
                if isinstance(item, dict):
                    title = item.get("title") or item.get("name") or ""
                    board = item.get("board") or item.get("schematic_uuid") or ""
                    version = item.get("version") or ""
                    print(
                        f"    {uuid}: title={title}, board_or_parent={board}, "
                        f"version={version}"
                    )
        elif value:
            print(f"  {key}: {type(value).__name__}")


def summarize_auxiliary_storage(cur: sqlite3.Cursor) -> None:
    rows: list[tuple[str, int]] = []
    for table in STRUCTURE_TABLES:
        count = count_table(cur, table)
        if count:
            rows.append((table, count))
    if rows:
        print_kv("Auxiliary project storage:", rows, indent="  ")


def summarize_pcb(records: list[list[Any]]) -> None:
    layers = layer_records(records)
    nets = [record[1] for record in records if record[0] == "NET" and len(record) > 1 and record[1]]
    rules = [record for record in records if record[0] == "RULE"]
    vias = [record for record in records if record[0] == "VIA"]
    pads = [record for record in records if record[0] == "PAD"]
    lines = [record for record in records if record[0] == "LINE"]
    pours = [record for record in records if record[0] == "POUR"]

    canvas_unit = None
    canvas = next((record for record in records if record[0] == "CANVAS"), None)
    if canvas:
        canvas_unit = scalar(record_value(canvas, 3))
        print(f"    canvas: unit={canvas_unit}, raw={json.dumps(canvas, ensure_ascii=False)}")

    active_layers = [record for record in layers.values() if is_active_copper_layer(record)]
    if active_layers:
        active_layers.sort(key=lambda record: record[1])
        labels = [layer_label(layers, record[1]) for record in active_layers]
        print(f"    active_copper_layers ({len(labels)}): {', '.join(labels)}")

    layer_phys = [record for record in records if record[0] == "LAYER_PHYS"]
    if layer_phys:
        print("    layer_phys:")
        for record in layer_phys[:20]:
            layer_id = scalar(record_value(record, 1))
            name = scalar(record_value(record, 2))
            thickness = scalar(record_value(record, 3))
            material = scalar(record_value(record, 4))
            enabled = scalar(record_value(record, 6))
            print(
                f"      id={layer_id}, name={name or '(blank)'}, "
                f"thickness={thickness}, material={material}, enabled={enabled}"
            )

    outline_shapes = [
        record_value(record, 6)
        for record in records
        if record[0] == "POLY" and record_value(record, 4) == 11
    ]
    if outline_shapes:
        print("    outline_shapes:")
        for shape in outline_shapes:
            print(f"      {format_outline_shape(shape, canvas_unit)}")

    if nets:
        print(f"    named_nets ({len(nets)}): {', '.join(map(str, nets))}")

    if rules:
        print("    rules:")
        for rule in rules:
            rule_id = scalar(rule[1] if len(rule) > 1 else "")
            name = scalar(rule[2] if len(rule) > 2 else "")
            enabled = scalar(rule[3] if len(rule) > 3 else "")
            payload = rule[4] if len(rule) > 4 else ""
            print(f"      {rule_id} {name}, enabled={enabled}, values={json.dumps(payload, ensure_ascii=False)}")

    line_widths = collections.Counter()
    for line in lines:
        if len(line) > 9:
            line_widths[scalar(line[9])] += 1
    if line_widths:
        print_kv("    line_widths:", line_widths.most_common(10), indent="      ")

    line_widths_by_layer = collections.Counter()
    for line in lines:
        if len(line) > 9:
            line_widths_by_layer[(record_value(line, 4), scalar(line[9]))] += 1
    if line_widths_by_layer:
        print("    line_widths_by_layer:")
        for (layer_id, width), count in line_widths_by_layer.most_common(20):
            print(f"      {layer_label(layers, layer_id)}, width={width}: {count}")

    pour_layers = collections.Counter()
    for pour in pours:
        if len(pour) > 4:
            pour_layers[(record_value(pour, 4), scalar(record_value(pour, 3)))] += 1
    if pour_layers:
        print("    pours_by_layer_net:")
        for (layer_id, net), count in pour_layers.most_common(20):
            print(f"      {layer_label(layers, layer_id)}, net={net}: {count}")

    via_sizes = collections.Counter()
    for via in vias:
        if len(via) > 8:
            via_sizes[(scalar(via[7]), scalar(via[8]), scalar(via[3] if len(via) > 3 else ""))] += 1
    if via_sizes:
        print("    via_size_by_net (drill, diameter, net):")
        for (drill, diameter, net), count in via_sizes.most_common(20):
            print(f"      {drill}, {diameter}, {net}: {count}")

    if pads:
        pad_shapes_by_layer = collections.Counter()
        for pad in pads:
            shape = json.dumps(record_value(pad, 10), ensure_ascii=False)
            pad_shapes_by_layer[(record_value(pad, 4), shape)] += 1
        print("    standalone_pad_shapes_by_layer:")
        for (layer_id, shape), count in pad_shapes_by_layer.most_common(20):
            print(f"      {layer_label(layers, layer_id)}, shape={shape}: {count}")

        print("    standalone_pads:")
        for pad in pads:
            shape = record_value(pad, 10)
            print(
                f"      id={scalar(record_value(pad, 1))}, "
                f"layer={layer_label(layers, record_value(pad, 4))}, "
                f"net={scalar(record_value(pad, 3))}, "
                f"shape={json.dumps(shape, ensure_ascii=False)}"
            )


def summarize_parts(cur: sqlite3.Cursor) -> None:
    try:
        rows = cur.execute(
            """
            select d.uuid, d.title, d.display_title, a.key, a.value
            from devices d
            left join attributes a on a.device_uuid = d.uuid
            order by d.title, a.key
            """
        ).fetchall()
    except sqlite3.Error:
        print("Parts: unavailable")
        return

    devices: dict[str, dict[str, Any]] = {}
    for row in rows:
        device = devices.setdefault(
            row["uuid"],
            {"title": row["title"], "display_title": row["display_title"], "attrs": {}},
        )
        if row["key"]:
            device["attrs"][row["key"]] = row["value"] or ""

    print(f"Devices summarized: {len(devices)}")
    if not devices:
        return

    classes = collections.Counter(
        device["attrs"].get("JLCPCB Part Class") or "(blank/none)" for device in devices.values()
    )
    footprints = collections.Counter(
        device["attrs"].get("Supplier Footprint")
        or device["attrs"].get("3D Model Title")
        or device["attrs"].get("Footprint")
        or "(blank/none)"
        for device in devices.values()
    )
    designators = collections.Counter(
        designator_family(device["attrs"].get("Designator")) for device in devices.values()
    )

    print_kv("JLCPCB part classes:", classes.most_common(), indent="  ")
    print_kv("Top footprints:", footprints.most_common(20), indent="  ")
    print_kv("Designator families:", designators.most_common(), indent="  ")

    print("Metadata coverage:")
    for key in METADATA_KEYS:
        count = sum(1 for device in devices.values() if device["attrs"].get(key))
        print(f"  {key}: {count}/{len(devices)}")

    print("Top attribute keys:")
    key_counts = collections.Counter()
    for device in devices.values():
        key_counts.update(device["attrs"].keys())
    for key, count in key_counts.most_common(30):
        print(f"  {key}: {count}")


def summarize_project(path: Path) -> None:
    print(f"=== {path} ===")
    with connect_readonly(path) as con:
        cur = con.cursor()
        try:
            projects = cur.execute("select name, updated_at, pcb_count, boards from projects").fetchall()
        except sqlite3.Error:
            projects = []

        if projects:
            for project in projects:
                print(f"Project: {project['name']}")
                print(f"Updated: {project['updated_at']}")
                print(f"PCB count: {project['pcb_count']}")
                print(f"Boards: {project['boards']}")
        else:
            print("Project: unavailable")

        print("Table counts:")
        for table in TABLES:
            print(f"  {table}: {count_table(cur, table)}")
        summarize_auxiliary_storage(cur)
        summarize_project_structures(cur)

        summarize_documents(cur)
        summarize_parts(cur)
    print()


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Read-only summary for Lichuang EDA/JLCPCB .eprj2 SQLite project files."
    )
    parser.add_argument("paths", nargs="+", help="Path(s) to .eprj2 files.")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    exit_code = 0
    for raw_path in args.paths:
        try:
            summarize_project(Path(raw_path))
        except Exception as exc:  # Keep multi-file summaries useful.
            exit_code = 1
            print(f"ERROR: {raw_path}: {exc}", file=sys.stderr)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
