# PCB Rules Extracted From Source Projects

These values are extracted from the user's Lichuang EDA Pro `.eprj2` projects and CAM output. Use them as observed project baselines, not as official JLCPCB manufacturing limits.

## LFP/RHS2116 Two-Layer Baseline

Each complete LFP/RHS2116 `.eprj2` project contains:

- Documents: `2`
- Schematic document: `P1`, `docType=1`
- PCB document: `PCB1`, `docType=3`
- Components: `79`
- Devices: `50`
- Attributes: `1055`

Schematic record counts:

- `COMPONENT`: `101`
- `WIRE`: `89`
- `ATTR`: `761`

PCB record counts:

- `LINE`: `437`
- `PAD_NET`: `252`
- `POURED`: `176`
- `ATTR`: `129`
- `LAYER`: `95`
- `VIA`: `51`
- `NET`: `47`
- `RULE_SELECTOR`: `47`
- `COMPONENT`: `43`
- `PRIMITIVE`: `37`
- `RULE`: `14`
- `POUR`: `4`
- `POLY`: `4`
- `PAD`: `2`

Board setup:

- Canvas unit: `mil`.
- Active copper layers: `TOP` and `BOTTOM`.
- Normal routed line width in examples is commonly `10 mil`.
- Two large standalone rectangular pads are on `GND` and `BAT`, about `78.7402 mil` by `78.7402 mil`.

Extracted enabled rules:

- `copperThickness1oz`: enabled.
- `copperThickness2oz`: present but disabled.
- `otherClearance`: enabled, default clearance `11.811 mil`.
- Track-width rule for 1 oz copper: `4 mil` minimum, `10 mil` preferred/default, `100 mil` maximum.
- `netLength`: enabled, baseline values `0, 0`.
- `differentialPair`: enabled, values include `5, 10, 100, 6, 6, 0, 10 mil`.
- `blindVia`: enabled with an empty rule payload.
- `viaSize`: enabled, payload includes `5.9055, 12, 196.8504, 5.9055, 6.0039, 124.0157 mil`.
- `pasteMaskExpansion`: enabled, explicit expansion `0`.
- `solderMaskExpansion`: enabled, expansion `2 mil`.

Observed via objects indicate about `12 mil` drill and `24 mil` diameter on ordinary signal and power nets.

## `80channel_v2_bottom` Four-Layer Baseline

Project structure:

- Documents: `2`
- Components: `27`
- Devices: `16`
- Attributes: `346`
- Schematic records: `408`
- PCB records: `1848`

Board and stackup:

- Active copper layers: `TOP`, `BOTTOM`, `Inner1`, `Inner2`.
- The outline is circular, about 25 mm diameter when raw coordinates are interpreted as mil.
- Physical layer records include 1 oz outer copper and two enabled inner copper layers.
- Pours: `VCC3V3` on `Inner1`, `GND` on `Inner2`, `GND` on `TOP`, and `GND` on `BOTTOM`.

Routing and pads:

- Line widths by layer: `BOTTOM` has mostly `4 mil` routes, `TOP` has a mix of `10 mil` and `4 mil`, and `Inner1` has several `30 mil` routes.
- Dominant via object size is `11.811 mil` drill by `15.748 mil` diameter; smaller `7.874 mil` drill by `11.811 mil` diameter vias appear on contact nets.
- Standalone pads are all on `BOTTOM`: 80 circular/elliptical pads about `9.8425 mil` plus three larger rectangular pads about `78.7402 mil` for `VCC3V3`, `GND`, and `VSTM-5`.
- Named net count is `94`, including `A0` through `A63`, dual SPI buses, `VCC3V3`, `GND`, and `VSTM-5`.

Review implication:

- Treat the bottom board as a four-layer dense contact breakout. Its small pads and 4 mil routes are deliberate project practice, not a generic recommendation.

## `80channel_v2_top` Four-Layer Baseline

Project structure:

- Documents: `2`
- Components: `118`
- Devices: `68`
- Attributes: `1819`
- Schematic records: `854`
- PCB records: `1128`

Board and stackup:

- Active copper layers: `TOP`, `BOTTOM`, `Inner1`, `Inner2`.
- The outline is circular, about 25 mm diameter when raw coordinates are interpreted as mil.
- Physical layer records include 1 oz outer copper and two enabled inner copper layers.
- Pours: `VCC3V3` on `Inner1`, `GND` on `Inner2`, `GND` on `TOP`, and `GND` on `BOTTOM`.

Routing and pads:

- Line widths by layer: `BOTTOM`, `TOP`, `Inner1`, and `Inner2` mostly use `10 mil`; `BOTTOM` also has `5 mil` routes and `TOP` has some `20 mil` and `9 mil` routes.
- Dominant via object size is `11.811 mil` drill by `15.748 mil` diameter.
- Standalone pads are two `TOP` rectangular pads about `59.0551 mil` by `78.7402 mil` on `USB_D-` and `USB_D+`.
- Named net count is `41`, including USB, ESP32 IO, FPGA/configuration, FE, SPI, `VCC1V2`, `VCC3V3`, `GND`, and `VSTM-5` nets.

Review implication:

- Treat the top board as a four-layer MCU/FPGA/USB connector board. Verify the intended stackup and plane assignment before applying USB, SPI, or FPGA routing judgments.

## `power` Two-Layer Baseline

Project structure:

- Documents: `2`
- Components: `52`
- Devices: `43`
- Attributes: `790`
- Schematic records: `439`
- PCB records: `797`

Board and stackup:

- Active copper layers: `TOP` and `BOTTOM`; inner layers are template records and are not enabled.
- The outline is a rounded rectangle about 32 mm by 22 mm with about 5 mm corner radius when raw coordinates are interpreted as mil.
- Pours: `GND` on `TOP` and `GND` on `BOTTOM`.

Routing and pads:

- Dominant route width is `10 mil`; wider `20 mil`, `30 mil`, `39.3701 mil`, and `78.7402 mil` routes are used for power/contact features.
- Observed via objects include `12.0078 mil` drill by `24.0158 mil` diameter, plus some `GND` vias at `12.0078 mil` drill by `19.685 mil` diameter.
- Standalone pads are on `MULTI`: circular `RING1`/`RING2` pads about `78.7402 mil`, and oval `VCC3V3`, `GND`, and `VSTM-5` pads about `78.7402 mil` by `118.1102 mil`.
- Named net count is `20`, including `RING1`, `RING2`, `V_WL`, `VCC3V3`, `VSTM-5`, `GND`, and generated nets.

Review implication:

- Treat this as a two-layer power/contact board. Current path width, converter loop area, ring-contact mechanics, and rail-pad accessibility matter more than dense signal escape.

## Applying These Rules

- Choose the baseline by board family before reviewing: LFP/RHS2116 two-layer, 80channel_v2 four-layer, power two-layer, or quality-test six-layer CAM.
- Treat `4 mil`, small vias, and `9.8425 mil` contact pads as extracted project practice for dense 80channel geometry, not as preferred defaults for all boards.
- Treat `10 mil` as the ordinary route width for less constrained signals unless the extracted board clearly uses finer escape routing.
- Treat `11.811 mil` clearance as an observed baseline unless a net class, stackup, or current official fab rule says otherwise.
- Re-check USB routing manually in the editor; the extracted differential-pair rule alone does not prove controlled impedance.
- Verify pour connectivity, thermal reliefs, active layer count, and board outline visually in Lichuang EDA before final fabrication output.
