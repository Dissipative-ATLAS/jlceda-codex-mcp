# Part Library And BOM Notes

This reference summarizes component/device metadata extracted from the user's complete `.eprj2` source projects. Counts and package names are observed project data, not a recommendation to use the same parts in new designs.

## LFP/RHS2116 Library Coverage

Counts per complete LFP/RHS2116 project:

- Components: `79`
- Devices: `50`
- Attributes: `1055`
- Devices with `Symbol`: `50`
- Devices with `Footprint`: `48`
- Devices with `Designator`: `42`
- Devices marked `Add into BOM`: `42`
- Devices marked `Convert to PCB`: `42`
- Devices with LCSC/JLCPCB supplier metadata: `40`

JLCPCB part class distribution:

- `扩展库`: `35`
- `基础库`: `2`
- `Extended Part`: `1`
- blank/none: `12`

Most frequent supplier footprints:

- `0201`: `15`
- `0402`: `7`
- no supplier footprint or custom/local metadata: `8`
- `SOT-23`: `2`
- `ESOP-8`: `2`

Other observed packages include `SOD-323`, `TSOT-23-3`, `QFN-12(2.5x2.5)`, `SMD,1.6x2mm`, `SOT-23-6`, `SOD-523`, `TSOT-23-6`, `VSON-10-EP(3x3)`, `SMD,0.8x1.6mm`, `SMD,12.5x13.2mm`, `VFQFN-56-EP`, and `插件,P=1mm`.

Notable parts and roles:

- `RHS2116`: Intan front-end target device.
- `ESP32-C3-MINI-1U-N4`, `ESP32-S3-MINI-1U-N8`: MCU/radio module candidates.
- `TP4056`, `TP4057`: lithium battery charging related parts.
- `TPS63001DRCR`, `TPS63051RMWR`, `LTC1983ES6-5#TRPBF`: power conversion/inversion related parts.
- `CJ3401`, `NX2301P`: P-channel MOSFET/switching roles.
- `B5817WS`, `LESD5D5.0CT1G`: diode/ESD protection roles.
- `FTC160808S2R2MBCA`, `FTC201610S1R5MBCA`: inductors.
- `MICROXNJ`: Micro-USB connector.
- `HX PZ1.0-1X3P ZZ`: 1 mm pitch connector.
- `CC6201ST`, `TMR3102SO`: sensor/switch-like devices.

## `80channel_v2_bottom` BOM Notes

Extracted coverage:

- Components: `27`
- Devices: `16`
- Attributes: `346`
- Supplier metadata coverage: `11/16`
- Devices marked `Add into BOM`: `12/16`
- Devices marked `Convert to PCB`: `12/16`

JLCPCB part class distribution:

- `扩展库`: `10`
- `基础库`: `1`
- blank/none: `5`

Frequent or important footprints:

- no supplier footprint or custom/local metadata: `4`
- `插件,P=2.54mm`: `3`
- `0201`: `2`
- `SMD,P=1.27mm(交错脚)`: `2`
- `0402`: `1`
- `TFBGA-315`: `1`
- `BGA-104`: `1`
- local/custom RHS footprint entry: `1`
- `SMD,P=2.54mm(交错脚)`: `1`

Notable parts and review implications:

- `RHD2164` on `BGA-104`: verify ball map, escape routing, assembly capability, and rework expectations.
- `RHS2116` local/custom footprint entry: verify footprint, pinout, and whether it is intentionally retained in the bottom-side library.
- `H9JCNNNBK3MLYR-N6E` on `TFBGA-315`: treat as a high-risk fine-pitch BGA part until datasheet and assembly constraints are checked.
- 0201/0402 decoupling: check placement, tombstoning risk, and LCSC availability.
- Multiple 2.54 mm and 1.27 mm connector options: verify which are actual fitted parts and which are library alternatives.

## `80channel_v2_top` BOM Notes

Extracted coverage:

- Components: `118`
- Devices: `68`
- Attributes: `1819`
- Supplier metadata coverage: `61/68`
- Devices marked `Add into BOM`: `61/68`
- Devices marked `Convert to PCB`: `61/68`

JLCPCB part class distribution:

- `扩展库`: `56`
- `基础库`: `4`
- blank/none: `8`

Frequent or important footprints:

- `0402`: `8`
- `SMD,P=0.5mm,卧贴`: `7`
- no supplier footprint or custom/local metadata: `7`
- `插件,P=2.54mm`: `6`
- `SMD,P=1.27mm`: `4`
- `SMD,P=1.27mm(交错脚)`: `4`
- `0201`: `3`
- `SMD,P=0.35mm`: `3`
- `插件,P=1.27mm`: `3`
- `QFN-48-EP(7x7)`: `1`
- `SMD,15.4x15.4mm`: `1`
- USB-C/FPC/BTB connector footprints appear in several pitch and orientation variants.

Notable parts and review implications:

- `ESP32-S3-MINI-1U-N4R2`: verify boot straps, USB pins, antenna/module keepout, 3.3 V decoupling, and firmware pin assignment.
- `ICE40UP5K-SG48I`: verify `VCC1V2`, `VCC3V3`, configuration flash, `CDONE`, reset/test pins, and thermal/assembly constraints for QFN.
- `AT25SF321B-MHB-T`, `GD25Q127CSIGR`, `GD25Q127CYIGR`: verify only the intended flash option is populated and that footprint choice matches the selected package.
- `TYPE-C-31-M-12`: verify USB-C orientation, shell grounding, CC/power behavior, and mechanical clearance.
- FPC/BTB connectors such as `AFC01-*`, `AFH34-*`, `BTB0.408-*`, and `GT-B0353*`: verify pitch, mated-height, pin count, orientation, side, and sourcing.
- 0201/0402 passives and many extended-library connectors make assembly and lifecycle checks mandatory.

## `power` BOM Notes

Extracted coverage:

- Components: `52`
- Devices: `43`
- Attributes: `790`
- Supplier metadata coverage: `31/43`
- Devices marked `Add into BOM`: `32/43`
- Devices marked `Convert to PCB`: `32/43`

JLCPCB part class distribution:

- `扩展库`: `14`
- `基础库`: `8`
- `Basic Part`: `6`
- `Extended Part`: `3`
- blank/none: `12`

Frequent or important footprints:

- `0402`: `15`
- no supplier footprint or custom/local metadata: `11`
- `0603`: `6`
- `0201`: `2`
- `0805`: `2`
- `TSOT-23-6`: `2`
- `VSON-10-EP(3x3)`: `2`
- `SMD,1.6x2mm`: `1`
- local/custom NU1680 footprint entry: `1`

Notable parts and review implications:

- `TPS63001DRCR`: buck-boost converter, verify inductor, input/output capacitor placement, feedback routing, and switch-loop area.
- `LTC1983ES6-5#TRPBF`: switched-capacitor inverter or negative rail generator, verify flying capacitors and return loop.
- `NU1680`: local/custom footprint entry, likely tied to wireless or power-transfer behavior; verify exact datasheet and footprint.
- `FTC201610S2R2MBCA`: 2.2 uH inductor, verify saturation current, DCR, footprint, and proximity to converter pins.
- `KNTC0603/100KF4250`: NTC or temperature-sense part, verify whether firmware/charger logic expects it.
- 0402/0603/0805 capacitor mix suggests multiple power-loop and bulk-cap roles; verify voltage rating and derating, not just nominal capacitance.

## BOM Review Rules

When reviewing this project family:

- Preserve `Supplier Part`, `Manufacturer`, `Manufacturer Part`, `Supplier Footprint`, `JLCPCB Part Class`, `Datasheet`, `Add into BOM`, and `Convert to PCB`.
- Treat `扩展库`, `Extended Part`, and blank/custom metadata as procurement and assembly-risk signals.
- Check whether blank or custom `Footprint` fields are intentional for local/custom parts such as RHS/RHD devices, NU1680, or connector experiments.
- Prefer `基础库` or `Basic Part` parts when the electrical, mechanical, and lifecycle requirements allow it.
- Treat 0201 passives, BGA, QFN/VSON exposed-pad packages, and 0.35 mm to 0.5 mm connector pitch as first-class manufacturing risks.
- Verify footprints against datasheets for RHS2116, RHD2164, ESP32-S3, iCE40UP5K, USB connectors, FPC/BTB connectors, power ICs, inductors, and all custom connector/contact footprints.
- Check that 3D model transforms are not being mistaken for footprint truth; footprint and datasheet dimensions are authoritative.
- For boards with multiple library alternatives for the same functional role, explicitly identify which option is intended to be populated before BOM export or JLCPCB assembly.
