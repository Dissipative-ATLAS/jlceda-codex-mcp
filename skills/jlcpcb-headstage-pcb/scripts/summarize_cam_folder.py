#!/usr/bin/env python3
"""Summarize EasyEDA/JLCPCB Gerber, drill, and flying-probe export folders."""

from __future__ import annotations

import argparse
import collections
import json
import math
import re
import sys
from pathlib import Path
from typing import Any, Iterable


GERBER_EXTENSIONS = {
    ".gko",
    ".gtl",
    ".gbl",
    ".g1",
    ".g2",
    ".g3",
    ".g4",
    ".gts",
    ".gbs",
    ".gtp",
    ".gbp",
    ".gto",
    ".gbo",
    ".gdl",
    ".gdd",
}


def read_text(path: Path) -> str:
    return path.read_text(encoding="ascii", errors="ignore")


def gerber_format_scale(text: str) -> int:
    match = re.search(r"%FSLAX(\d)(\d)Y(\d)(\d)\*%", text)
    if not match:
        return 100000
    return 10 ** int(match.group(2))


def gerber_units(text: str) -> str:
    if "%MOMM*%" in text or "millimeters" in text:
        return "mm"
    if "%MOIN*%" in text or "inches" in text:
        return "inch"
    return "unknown"


def parse_gerber_coords(text: str) -> list[tuple[float, float]]:
    scale = gerber_format_scale(text)
    coords: list[tuple[float, float]] = []
    for match in re.finditer(r"X(-?\d+)Y(-?\d+)", text):
        coords.append((int(match.group(1)) / scale, int(match.group(2)) / scale))
    return coords


def infer_circle_outline(text: str) -> dict[str, float] | None:
    if "Circle Start" not in text:
        return None
    scale = gerber_format_scale(text)
    coords = parse_gerber_coords(text)
    radii: list[float] = []
    for match in re.finditer(r"I(-?\d+)J(-?\d+)", text):
        i_value = int(match.group(1)) / scale
        j_value = int(match.group(2)) / scale
        radius = math.hypot(i_value, j_value)
        if radius:
            radii.append(radius)
    if radii:
        radius = max(radii)
        return {"radius": radius, "diameter": radius * 2}
    if len(coords) >= 2:
        xs = [coord[0] for coord in coords]
        width = max(xs) - min(xs)
        if width > 0:
            return {"radius": width / 2, "diameter": width}
    return None


def format_extent(coords: list[tuple[float, float]]) -> str:
    if not coords:
        return "(none)"
    xs = [coord[0] for coord in coords]
    ys = [coord[1] for coord in coords]
    return (
        f"x={min(xs):.5f}..{max(xs):.5f}, "
        f"y={min(ys):.5f}..{max(ys):.5f}, "
        f"w={max(xs) - min(xs):.5f}, h={max(ys) - min(ys):.5f}"
    )


def summarize_gerbers(folder: Path) -> None:
    gerbers = [
        path
        for path in sorted(folder.iterdir(), key=lambda item: item.name.lower())
        if path.is_file() and path.suffix.lower() in GERBER_EXTENSIONS
    ]
    print("Gerber files:")
    if not gerbers:
        print("  (none)")
        return

    copper_names = []
    for path in gerbers:
        text = read_text(path)
        coords = parse_gerber_coords(text)
        apertures = re.findall(r"%ADD(\d+)([A-Z]),?([^*]*)\*%", text)
        units = gerber_units(text)
        d01 = text.count("D01*")
        d02 = text.count("D02*")
        d03 = text.count("D03*")
        print(
            f"  {path.name}: size={path.stat().st_size}, units={units}, "
            f"apertures={len(apertures)}, coords={len(coords)}, D01={d01}, D02={d02}, D03={d03}"
        )
        print(f"    extent: {format_extent(coords)}")
        if path.suffix.lower() in {".gtl", ".gbl", ".g1", ".g2", ".g3", ".g4"}:
            copper_names.append(path.name)
        if path.suffix.lower() == ".gko":
            circle = infer_circle_outline(text)
            if circle:
                print(
                    f"    circular_outline: radius={circle['radius']:.5f} {units}, "
                    f"diameter={circle['diameter']:.5f} {units}"
                )
        if apertures:
            preview = ", ".join(f"{code}{kind}:{value}" for code, kind, value in apertures[:8])
            print(f"    aperture_preview: {preview}")

    if copper_names:
        print(f"Copper layer files ({len(copper_names)}): {', '.join(copper_names)}")


def summarize_drills(folder: Path) -> None:
    drills = sorted(folder.glob("*.DRL"), key=lambda item: item.name.lower())
    print("Drill files:")
    if not drills:
        print("  (none)")
        return

    coordinate_sets: dict[str, set[tuple[str, str]]] = {}
    for path in drills:
        text = read_text(path)
        units = "mm" if "METRIC" in text.upper() else "inch" if "INCH" in text.upper() else "unknown"
        drill_type_match = re.search(r";TYPE=([^\r\n]+)", text)
        layer_match = re.search(r";Layer:\s*([^\r\n]+)", text)
        tools = re.findall(r"^T\d+C([0-9.]+)", text, flags=re.MULTILINE)
        coords = re.findall(r"^X([-+0-9.]+)Y([-+0-9.]+)", text, flags=re.MULTILINE)
        coordinate_sets[path.name] = set(coords)
        print(
            f"  {path.name}: type={drill_type_match.group(1) if drill_type_match else ''}, "
            f"layer={layer_match.group(1) if layer_match else ''}, units={units}, "
            f"tools={tools}, holes={len(coords)}"
        )

    if len(coordinate_sets) > 1:
        names = list(coordinate_sets)
        base_name = names[0]
        base = coordinate_sets[base_name]
        for other_name in names[1:]:
            same = base == coordinate_sets[other_name]
            print(f"  coordinate_set_equal({base_name}, {other_name}): {same}")


def row_dicts(table: dict[str, Any]) -> list[dict[str, Any]]:
    fields = table.get("fields", [])
    return [dict(zip(fields, row)) for row in table.get("rows", [])]


def counter_preview(counter: collections.Counter[Any], limit: int = 20) -> str:
    if not counter:
        return "(none)"
    return ", ".join(f"{key}:{value}" for key, value in counter.most_common(limit))


def numeric(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def summarize_flying_probe(folder: Path) -> None:
    path = folder / "FlyingProbeTesting.json"
    print("FlyingProbeTesting.json:")
    if not path.exists():
        print("  (none)")
        return

    data = json.loads(path.read_text(encoding="utf-8-sig"))
    print(f"  lengthUnit: {data.get('lengthUnit', '')}")

    components = row_dicts(data.get("components", {}))
    pins = row_dicts(data.get("pins", {}))
    print(f"  components: {len(components)}")
    print(f"  pins: {len(pins)}")

    print(f"  component_layers: {counter_preview(collections.Counter(row.get('LAYER') for row in components))}")
    print(f"  pin_layers: {counter_preview(collections.Counter(row.get('LAYER') for row in pins))}")
    print(f"  pin_types: {counter_preview(collections.Counter(row.get('PIN_TYPE') for row in pins))}")
    print(f"  pad_shapes: {counter_preview(collections.Counter(row.get('PAD_SHAPE') for row in pins))}")
    print(f"  net_types: {counter_preview(collections.Counter(row.get('NET_TYPE') or '(blank)' for row in pins))}")
    print(f"  top_nets: {counter_preview(collections.Counter(row.get('NET_NAME') or '(blank)' for row in pins), 40)}")

    xs = [numeric(row.get("PIN_X")) for row in pins]
    ys = [numeric(row.get("PIN_Y")) for row in pins]
    xs = [value for value in xs if value is not None]
    ys = [value for value in ys if value is not None]
    if xs and ys:
        print(f"  pin_extent_mil: x={min(xs):.4f}..{max(xs):.4f}, y={min(ys):.4f}..{max(ys):.4f}")
        print(
            "  pin_extent_mm: "
            f"x={min(xs) * 0.0254:.3f}..{max(xs) * 0.0254:.3f}, "
            f"y={min(ys) * 0.0254:.3f}..{max(ys) * 0.0254:.3f}"
        )

    for field in ("PAD_SIZEX", "PAD_SIZEY", "HOLE_SIZE", "HOLE_LEN"):
        values = [numeric(row.get(field)) for row in pins]
        nonzero = [round(value, 4) for value in values if value not in (None, 0)]
        print(f"  {field}: count={len(nonzero)}, top={counter_preview(collections.Counter(nonzero), 15)}")


def summarize_folder(path: Path) -> None:
    folder = path.expanduser().resolve()
    if not folder.exists():
        raise FileNotFoundError(folder)
    if not folder.is_dir():
        raise NotADirectoryError(folder)

    print(f"=== {folder} ===")
    print("Files:")
    for child in sorted(folder.iterdir(), key=lambda item: item.name.lower()):
        if child.is_file():
            print(f"  {child.name}: {child.stat().st_size} bytes")
    summarize_gerbers(folder)
    summarize_drills(folder)
    summarize_flying_probe(folder)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Summarize EasyEDA/JLCPCB Gerber, drill, and flying-probe export folders."
    )
    parser.add_argument("folder", help="Path to a Gerber/CAM export folder.")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    try:
        summarize_folder(Path(args.folder))
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
