# Pinclaw DIY Kit — Open-Source Hardware

Everything you need to build your own Pinclaw Clip.

## What's Inside

```
hardware-opensource/
├── firmware/              # Zephyr RTOS firmware (nRF52840)
│   └── pinclaw_zephyr/    #   Source code + pre-built UF2 binary
├── enclosure/
│   ├── current-version/   #   Shipping STL files (base, cover, button)
│   └── designs/           #   OpenSCAD parametric designs
├── models/                # STEP component models
├── wiring/                # Wiring guides (English + Chinese)
└── docs/
    ├── SCH_pinclaw_v1.0_diy.pdf  # Schematic
    └── design-brief-v3.md        # Design brief
```

## Hardware Specs

| Component | Model | Notes |
|-----------|-------|-------|
| MCU | Seeed XIAO nRF52840 Sense | ARM Cortex-M4 @ 64MHz, BLE 5.0, built-in PDM mic |
| Audio amp | MAX98357AETE+T | I2S to speaker output |
| Speaker connector | SM02B-SURS-TF (JST SUR 0.8mm) | External speaker |
| RGB LED | XL-2121RGBC-2812B (WS2812B) | Programmable status indicator |
| Micro SD | 1040310811 | Installed, not yet enabled in firmware |
| Button | SMG-01T-H065A0 | Single push-to-talk on D4 (P0.04) |
| Battery connector | SH1.0-02AWB (JST SH 1.0mm) | 3.7V LiPo |
| Charging | USB-C (onboard BQ25101) | Via XIAO board |

## Acknowledgments

The 3D-printable enclosure design is inspired by the [OMI](https://github.com/BasedHardware/omi) open-source wearable. We optimized the geometry for a better button feel and improved clip ergonomics.

The firmware is written from scratch for Pinclaw using Zephyr RTOS — purpose-built for push-to-talk voice interaction with Opus audio streaming over BLE.

## Getting Started

1. **Print** the three STL files from `enclosure/current-version/`
2. **Wire** the components per `wiring/pinclaw-clip-wiring.md`
3. **Flash** — double-tap Reset, drag `pinclaw_zephyr/pinclaw_v2.2.0.uf2` to the USB drive
4. **Pair** with the [Pinclaw iOS app](https://apps.apple.com/app/pinclaw/id6760344343)

See the [full hardware guide](https://pinclaw.ai/doc/specs#hardware) for detailed assembly instructions.

## License

MIT
