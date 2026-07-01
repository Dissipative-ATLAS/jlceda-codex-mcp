# Lichuang EDA `.eprj2` Format Notes

The inspected `.eprj2` files are SQLite databases.

Important tables:

- `projects`: project name, update timestamp, board mapping, PCB count.
- `schematics`: schematic container metadata.
- `documents`: schematic and PCB documents in `dataStr`.
- `components`: symbol and footprint library objects in `dataStr`.
- `devices`: logical parts and metadata.
- `attributes`: BOM, footprint, supplier, designator, and value fields keyed by `device_uuid`.
- `project_structures`: project tree snapshots. These can expose board, schematic, sheet, and PCB objects even when `documents` and other core design tables are empty.
- `history_data`: branch-history payload chunks. The inspected quality-test file stores many base64-looking binary chunks here, but they are not decoded by the current `base64` + gzip document parser.
- `project_images`: embedded project thumbnails or previews.
- `branches`: branch metadata and current branch history UUIDs.

## Encoded Payloads

`documents.dataStr` and `components.dataStr` commonly store:

1. A literal `base64` prefix.
2. Base64 data.
3. Gzip-compressed UTF-8 text.
4. Text containing one JSON array per line.

The decoded text is not a single JSON document. Parse it line by line.

Example decoded prefixes:

```text
["DOCTYPE","SCH","1.1"]
["HEAD",{"originX":0,"originY":0,"version":"2","maxId":5812}]
```

```text
["DOCTYPE","PCB","1.8"]
["HEAD",{"editorVersion":"2.2.43.4","importFlag":0}]
["CANVAS",0,0,"mil",5,5,5,5,1,1,2,0,5]
```

## Document Types

Observed `docType` values:

- `1`: schematic document.
- `3`: PCB document.
- `2`: symbol component.
- `4`: footprint component.
- `18`: ground/global-net symbol.
- `19`: net-port symbols.
- `20`: drawing/title-block symbol.

## PCB Records Used By The Parser

Common PCB records:

- `CANVAS`: includes the declared unit string, usually `mil` or `mm`. Some inspected projects declare `mm` while coordinates still behave like mil-derived values, so preserve raw values and state assumptions when converting.
- `LAYER`: maps numeric layer IDs to names. Active copper layers are records whose kind is `TOP`, `BOTTOM`, or `SIGNAL` and whose enabled/status field is nonzero. In `80channel_v2_top/bottom`, layer IDs `15` and `16` are active `Inner1` and `Inner2`.
- `LAYER_PHYS`: physical stackup records. Use these to distinguish real enabled inner copper from template-only inner layer names.
- `POLY`: board outline records. For the inspected boards, outline polygons on layer `11` include `CIRCLE` and rounded-rectangle `R` shape payloads.
- `POUR`: copper pour definition. In the inspected 80channel boards, `Inner1` is `VCC3V3` and `Inner2` is `GND`.
- `POURED`: generated pour geometry. Use it as evidence that a pour exists, not as a substitute for visual DRC.
- `LINE`: routed copper. The parser groups line width by layer.
- `VIA`: via net, coordinate, drill, and diameter fields.
- `PAD`: standalone pad records. The parser groups pad shape by layer and lists pad net names.
- `PAD_NET`: component pad to net assignment.
- `RULE`: design rule record. Treat extracted values as project settings, not fabrication limits.

## Empty Core Tables Versus Empty Project

Do not equate empty `documents`, `components`, `devices`, and `attributes` tables with a completely empty `.eprj2` file.

The inspected `LFP采集器-RHS2116-质量测试.eprj2` has:

- `documents/components/devices/attributes`: `0` rows.
- `projects.pcb_count`: `0`.
- `project_structures`: `54` rows.
- `history_data`: `69` rows.
- `project_images`: `2` rows.
- Latest `project_structures.structure`: one board (`Board1`), one schematic (`Schematic1`), one sheet (`P1`), and one PCB (`PCB1`).

For this storage shape, report both facts: the core design tables are empty, but project structure/history metadata exists. Use CAM/Gerber/FlyingProbe output for manufacturable layout facts unless a future parser decodes the history payloads.

## Sidecar Files

`.eprj2-wal` and `.eprj2-shm` are SQLite sidecar files. Do not include them in the skill and do not treat them as design references.

## Parser Script

Use:

```bash
python scripts/extract_eprj2_summary.py "C:\path\to\project.eprj2"
```

The script:

- opens SQLite read-only;
- handles Chinese paths through Python `pathlib` when the path is passed as a command-line argument;
- decodes `base64` + gzip payloads;
- counts record types;
- reports auxiliary project storage and latest `project_structures` board/schematic/sheet/PCB summaries;
- reports `CANVAS`, active copper layers, and `LAYER_PHYS` records;
- extracts outline shape summaries with raw values and mil-to-mm approximations;
- extracts PCB rules, named nets, via sizes, line widths by layer, pours by layer/net, standalone pad shape by layer, footprint distribution, and BOM metadata coverage.

Use the parser for fact gathering. Keep design conclusions in the response separate from extracted facts.
