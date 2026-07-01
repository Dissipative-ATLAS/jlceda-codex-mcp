# CAM Output Notes

This reference summarizes the manufacturing export folder:

`<workspace>\headstage\蒸馏资源\LFP采集器-RHS2116-质量测试_PCB1_20260514_155725`

Use this data when the user asks about Gerber files, JLCPCB ordering output, drill files, flying-probe test data, layer count, board outline, or manufacturing verification.

The matching `LFP采集器-RHS2116-质量测试.eprj2` is not a fully empty database: it has project structure/history rows. However, its standard core design tables (`documents`, `components`, `devices`, `attributes`) are empty in the inspected copy, so this CAM folder remains the reliable source for manufacturable geometry, layers, pad distribution, and testable nets.

## Files Observed

Gerber/CAM files:

- Board outline: `Gerber_BoardOutlineLayer.GKO`
- Copper: `Gerber_TopLayer.GTL`, `Gerber_BottomLayer.GBL`, `Gerber_InnerLayer1.G1`, `Gerber_InnerLayer2.G2`, `Gerber_InnerLayer3.G3`, `Gerber_InnerLayer4.G4`
- Solder mask: `Gerber_TopSolderMaskLayer.GTS`, `Gerber_BottomSolderMaskLayer.GBS`
- Paste mask: `Gerber_TopPasteMaskLayer.GTP`, `Gerber_BottomPasteMaskLayer.GBP`
- Silkscreen: `Gerber_TopSilkscreenLayer.GTO`, `Gerber_BottomSilkscreenLayer.GBO`
- Documentation/drill drawing: `Gerber_DocumentLayer.GDL`, `Gerber_DrillDrawingLayer.GDD`
- Drills: `Drill_PTH_Through.DRL`, `Drill_PTH_Through_Via.DRL`
- Test data: `FlyingProbeTesting.json`

The Gerber headers report EasyEDA Pro v3.2.69, generated 2026-05-14 15:57:25, metric units, leading-zero omitted absolute coordinates, and format `FSLAX45`.

## Extracted Manufacturing Facts

- Board outline is circular, approximately 24 mm diameter.
- Copper output has six layers: top, four inner layers, and bottom.
- The inspected drill files are plated-through drill files using metric units.
- Drill tool `T01` is 0.30000 mm.
- `Drill_PTH_Through.DRL` contains 86 coordinate rows.
- `Drill_PTH_Through_Via.DRL` contains 86 coordinate rows.
- Top copper has more coordinate activity than bottom copper in the inspected export.
- Top and bottom paste, solder-mask, and silkscreen files are present.

## Flying Probe Data

`FlyingProbeTesting.json` has:

- `lengthUnit`: `mil`
- `components.fields`: `COMPONENT_NO`, `COMPONENT_NAME`, `LAYER`, `X_COORDINATE`, `Y_COORDINATE`, `ANGLE`
- `components.rows`: 192 rows
- `pins.fields`: `PIN_NO`, `PIN_NAME`, `PIN_X`, `PIN_Y`, `LAYER`, `PIN_TYPE`, `NET_NAME`, `NET_TYPE`, `PAD_SHAPE`, `PAD_SIZEX`, `PAD_SIZEY`, `HOLE_SIZE`, `HOLE_LEN`, `PAD_ANGLE`
- `pins.rows`: 352 rows

Observed distributions:

- Components: 102 top-side rows, 90 bottom-side rows.
- Pins: 187 top-side rows, 165 bottom-side rows.
- Pin type: all 352 rows are `SMD`.
- Pad shape: all 352 rows are rectangular (`R`).
- Net type: 108 pin rows are marked `GND`; the rest have blank `NET_TYPE`.
- Pin coordinate extent is about x `-8.500` to `9.311` mm, y `-10.692` to `10.348` mm.

Frequent or important nets in flying-probe data:

- `GND`: 108 pins
- `AGND`: 26 pins
- `VOUT2`: 20 pins
- `VOUT1`: 20 pins
- `VCC_SW`: 16 pins
- `VBAT`: 7 pins
- `VSTM-5`: 6 pins
- `USB_D-`, `USB_D+`
- `CS_N`, `SCK`, `MOSI`, `MISO1`

## Review Guidance

Use CAM output to answer questions that source `.eprj2` extraction cannot answer:

- Confirm what was actually exported for manufacturing, especially layer count and outline.
- Check whether paste, solder mask, silkscreen, drill, and flying-probe files are present.
- Use `FlyingProbeTesting.json` to infer testable nets and pad distribution.
- Compare `AGND` and `GND` handling carefully; the CAM data exposes both.
- Treat `VOUT1`, `VOUT2`, `VBAT`, and `VCC_SW` as power-tree review anchors for the quality-test variant.
- Do not infer schematic intent from Gerber geometry alone when a named net or source design is unavailable.

Use `scripts/summarize_cam_folder.py` for repeatable summaries.
