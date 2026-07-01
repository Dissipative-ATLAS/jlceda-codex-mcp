# Project Lessons

This reference distills reusable design facts from:

`<workspace>\headstage\蒸馏资源`

Observed projects and outputs:

- `LFP采集器-RHS2116-电池.eprj2`: complete schematic and PCB.
- `LFP采集器-RHS2116-电池-排针.eprj2`: complete schematic and PCB, same extracted structure as the battery project, later update timestamp.
- `LFP采集器-RHS2116-质量测试.eprj2`: not a fully empty database. Its core design tables (`documents`, `components`, `devices`, `attributes`) are empty in the inspected copy, but it contains `project_structures`, `history_data`, project images, and branch records. The latest visible structure has `Board1`, `Schematic1`, sheet `P1`, and `PCB1`.
- `LFP采集器-RHS2116-质量测试_PCB1_20260514_155725`: valid manufacturing output folder with Gerbers, Excellon drills, and `FlyingProbeTesting.json`; use it to understand the quality-test board because the matching `.eprj2` does not expose layout/net/component records through the standard core design tables.
- `80channel_v2_bottom.eprj2`: complete four-copper-layer circular electrode/contact-side PCB.
- `80channel_v2_top.eprj2`: complete four-copper-layer circular control/connector-side PCB.
- `power.eprj2`: complete two-copper-layer power and wireless-supply PCB.

## Board Families

### LFP/RHS2116 two-layer acquisition boards

The complete LFP/RHS2116 projects are compact two-layer headstage-style acquisition boards. Extracted named nets show these functional areas:

- Battery and power input: `BAT`, `VBUS+5`.
- Switched and regulated rails: `VCC`, `VCC_SW`, `VCC3V3`.
- Ground/reference: `GND`.
- USB: `USB_D+`, `USB_D-`, `VBUS+5`.
- SPI/control: `MISO1`, `MOSI`, `SCK`, `CS_N`.
- Other named/project nets: `VSTM-5`, `VCTR`, `NET1` through `NET16`, and generated `$1N...` nets.

Use named nets as the main clue for design intent. Generated `$1N...` nets usually need schematic context before they can be interpreted.

### Quality-test CAM export

The quality-test source `.eprj2` and CAM export need to be interpreted separately:

- The `.eprj2` main `projects` row still reports `pcb_count=0` and `boards={}`.
- The core design tables `documents`, `components`, `devices`, and `attributes` have zero rows.
- `project_structures` has 54 rows; the latest row exposes one board (`Board1`), one schematic (`Schematic1`), one sheet (`P1`), and one PCB (`PCB1`) linked to the board.
- `history_data` has 69 rows and `project_images` has 2 rows. The observed `history_data.dataStr` payloads are not directly decoded by the current `base64` + gzip `.eprj2` document parser.
- Treat this as a project with visible structure/history metadata but without parser-visible core design records. Do not call it a completely empty database.

The quality-test CAM export adds the usable manufacturing facts for this board variant:

- Board outline is a 24 mm diameter circle in Gerber board-outline output.
- CAM layer files include top, bottom, and `InnerLayer1` through `InnerLayer4`, so treat that export as a six-copper-layer manufacturing package.
- Drill output uses metric units and a 0.300 mm plated drill tool.
- Flying-probe output reports 192 component rows and 352 SMD pin rows.
- Extra nets visible in the CAM/test output include `AGND`, `VOUT1`, `VOUT2`, and `VBAT`.

Do not assume the two-layer `.eprj2` design rules apply unchanged to the six-layer CAM export. When asked about the quality-test board's geometry, layer count, pads, or nets, prefer the CAM export facts over the standard `.eprj2` core-table extraction.

### `80channel_v2_bottom`

This is the dense electrode/contact-side half of an 80-channel circular board:

- Active copper layers are `TOP`, `BOTTOM`, `Inner1`, and `Inner2`.
- The outline record is a circle with about 25 mm diameter when the raw coordinate is interpreted as mil.
- The board uses four pours: `VCC3V3` on `Inner1`, `GND` on `Inner2`, and `GND` on both outer copper layers.
- Standalone pads are all on `BOTTOM`: 80 circular/elliptical pads about `9.8425 mil` across plus three larger rectangular pads about `78.7402 mil` on `VCC3V3`, `GND`, and `VSTM-5`.
- Important nets include `A0` through `A63`, generated `$1N1062` through `$1N1077` style contact nets, `MISO1`, `MOSI1`, `SCK1`, `CS1`, `MISO2`, `MOSI2`, `SCK2`, `CS2`, `VCC3V3`, `GND`, and `VSTM-5`.
- Notable device metadata includes `RHD2164` on `BGA-104`, an `RHS2116` local/custom footprint entry, a `TFBGA-315` memory-like part, 0201/0402 decoupling, and multiple board-to-board/header connector options.

Review this board as an electrode/contact breakout and escape-routing problem first. The small bottom pads and 4 mil routing dominate manufacturability risk; the inner `VCC3V3` and `GND` planes are the main return and power reference assumptions to verify visually.

### `80channel_v2_top`

This is the control, connector, USB, and digital side of the 80-channel pair:

- Active copper layers are `TOP`, `BOTTOM`, `Inner1`, and `Inner2`.
- The outline record is a circle with about 25 mm diameter when the raw coordinate is interpreted as mil.
- The board uses four pours: `VCC3V3` on `Inner1`, `GND` on `Inner2`, and `GND` on both outer copper layers.
- Standalone pads are two top-side rectangular pads on `USB_D-` and `USB_D+`.
- Important nets include `USB_D-`, `USB_D+`, `IO0`, `IO3`, `IO18`, `IO45`, `IO46`, `CHIP_PU`, `CLK`, `VCC1V2`, `VCC3V3`, `GND`, `CS1`, `SCK1`, `MOSI1`, `MISO1`, `CS2`, `SCK2`, `MOSI2`, `MISO2`, `SPI_SI`, `SPI_SS`, `SPI_SCK`, `SPI_SO`, `CDONE`, `NTRST`, `FE0` through `FE9`, and `VSTM-5`.
- Notable device metadata includes `ESP32-S3-MINI-1U-N4R2`, `ICE40UP5K-SG48I`, external flash candidates such as `AT25SF321B` and `GD25Q127`, USB-C, FPC connectors, BTB connectors, fine-pitch headers, and 0201/0402 passives.

Review this board as a mixed MCU/FPGA/USB connector board. Check USB pair routing and return path, FPGA `VCC1V2` and configuration nets, ESP32 boot/configuration nets, flash wiring, connector orientation, and whether the control-side pinout matches the bottom contact-side map.

### `power`

This is a separate power and wireless-supply board:

- Active copper layers are `TOP` and `BOTTOM`; inner signal layers are present in the template but disabled.
- The outline record is a rounded rectangle about 32 mm by 22 mm with about 5 mm corner radius when the raw coordinates are interpreted as mil.
- Important nets include `RING1`, `RING2`, `V_WL`, `VCC3V3`, `VSTM-5`, `GND`, and generated `$1N...` nets.
- Standalone pads are on `MULTI`: circular `RING1`/`RING2` pads and larger oval `VCC3V3`, `GND`, and `VSTM-5` pads.
- Notable device metadata includes `TPS63001DRCR`, `LTC1983ES6-5#TRPBF`, `NU1680`, `FTC201610S2R2MBCA`, an NTC part, 0402/0603/0805 capacitors, and 0201/0402 resistors.

Review this board as a power integrity and connector/contact board. Check wireless input or ring-contact intent, high-current loop area, boost/inverter placement, inductor and diode return loops, output rail naming, thermal/current margin, and the physical accessibility of the `RING1`/`RING2` and rail pads.

## Review Heuristics

Power-tree review:

- Trace `BAT`, `VBUS+5`, `RING1`, `RING2`, and `V_WL` through charge/protection/switching/conversion circuitry before checking signal routing.
- Confirm `VBUS+5` cannot back-feed unintended rails and that USB power behavior matches the intended usage.
- Check that `VCC3V3` and `VCC1V2` have local high-frequency and bulk decoupling near RHS/RHD devices, ESP32, FPGA, flash, connector banks, and logic loads.
- Treat `VCC_SW`, `VSTM-5`, and generated power nets as controlled rails until schematic context proves otherwise.

Analog and electrode/contact review:

- Keep RHS/RHD decoupling close and connected to a quiet return path.
- Keep high-impedance or electrode-side routes short and guarded from USB and switching power routes where practical.
- For `80channel_v2_bottom`, verify every `A0` through `A63` and generated contact net against the intended electrode map before layout signoff.
- Check connector orientation and pin naming against the intended headstage/electrode harness before layout signoff.

USB, SPI, and digital review:

- Review `USB_D+` and `USB_D-` as a pair: similar routing environment, minimal stubs, sensible via use, and no unnecessary layer changes.
- Keep SPI lines short and readable; check chip-select routing and any level/power-domain assumptions.
- For the 80channel control board, check ESP32 boot pins, FPGA configuration pins, flash nets, `CDONE`, `NTRST`, and FE nets against datasheets and firmware expectations.
- If USB, SPI, or clock routes cross split return paths or sparse pour, treat that as a review finding.

Compact manufacturability review:

- The project relies heavily on 0201/0402 passives, BGA/QFN/VSON packages, fine-pitch FPC/BTB connectors, and many extended JLCPCB parts. Treat assembly capability, rework difficulty, and part availability as first-class risks.
- For tiny passives, check tombstoning risk: symmetric pads, reasonable thermal balance, and no oversized copper pull on only one side.
- Preserve accessible pads for power, ground, ring/contact, and test points.
- Keep silkscreen minimal and non-overlapping because dense headstage boards do not have enough area for decorative labels.

## How To Use These Lessons

When asked to improve a design, produce a prioritized checklist:

1. Power and safety issues.
2. Analog/electrode/contact integrity issues.
3. USB/SPI/FPGA/MCU signal integrity and return path.
4. Stackup, planes, and manufacturability risks.
5. BOM, footprint, connector, and assembly risks.
6. Cosmetic cleanup.

State whether each point is extracted from this project or is a general PCB engineering inference.
