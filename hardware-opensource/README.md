# Nexting PIN — Open-Source Hardware

This is the complete, open-source hardware design for the Nexting PIN: a wearable AI device you can 3D-print and assemble yourself.

Press the button, say what you need, let go. Your AI agent handles the rest — scheduling, messaging, reminders, whatever — while you keep your hands free and your phone in your pocket.

## Build Your Own

You'll need a 3D printer, a soldering iron, and about an hour.

### Parts

| Part | What to Buy | Approx. Cost |
|------|-------------|-------------|
| MCU | [Seeed XIAO nRF52840 Sense](https://www.seeedstudio.com/XIAO-BLE-Sense-nRF52840-p-5253.html) | ~$16 |
| Audio amplifier | [Adafruit I2S Audio BFF](https://www.adafruit.com/product/5769) (MAX98357A) | ~$6 |
| Speaker | Any small 4-8 ohm speaker with JST SUR 0.8mm connector | ~$2 |
| Battery | 3.7V LiPo with JST SH 1.0mm connector (200mAh or larger) | ~$5 |
| Button | Any tactile switch (we use SMG-01T-H065A0) | ~$0.50 |
| RGB LED | WS2812B / SK6812 mini (optional — the XIAO has built-in LEDs too) | ~$0.30 |
| Micro SD card | Any micro SD (installed on the PCB, firmware support coming in a future update) | ~$3 |
| 3D-printed enclosure | Print the STL files from `enclosure/current-version/` | — |
| Wire | 28-30 AWG silicone wire | ~$3 |

**Total: ~$36** plus your time and a 3D printer.

### Assembly

1. **Print** three parts: `base.stl`, `cover.stl`, `button.stl` from [`enclosure/current-version/`](enclosure/current-version/)
2. **Solder** 9 wire connections between the XIAO, audio amplifier, button, LED, and battery — no custom PCB needed. Full wiring diagram: [`docs/SCH_pinclaw_v1.0_diy.pdf`](docs/SCH_pinclaw_v1.0_diy.pdf)
3. **Flash** the firmware: double-tap the Reset button on the XIAO, then drag [`pinclaw_v2.2.0.uf2`](firmware/pinclaw_zephyr/pinclaw_v2.2.0.uf2) onto the USB drive that appears
4. **Download** the [Nexting app](https://apps.apple.com/app/pinclaw/id6760344343) on your iPhone, sign in, and pair via Bluetooth

For step-by-step photos and troubleshooting, see the [full hardware guide on pinclaw.ai](https://pinclaw.ai/doc).

## What's in This Repo

| Directory | Contents |
|-----------|----------|
| [`firmware/pinclaw_zephyr/`](firmware/pinclaw_zephyr/) | Zephyr RTOS firmware — full source code and a pre-built `.uf2` binary. Flash by drag-and-drop, no programmer needed. |
| [`enclosure/current-version/`](enclosure/current-version/) | The three STL files we ship to customers right now. |
| [`enclosure/designs/`](enclosure/designs/) | Parametric OpenSCAD source files if you want to modify the enclosure. |
| [`docs/`](docs/) | Schematic PDF and design brief. |

## How It Works

```
  You speak
      |
  [ PDM mic ]  -->  [ Opus encode ]  -->  [ BLE 5.0 ]  -->  iPhone App
                                                                  |
                                                           Cloud AI Agent
                                                                  |
  You hear   <--  [ I2S speaker ]  <--  [ BLE 5.0 ]  <--   AI Response
```

The XIAO's built-in PDM microphone captures your voice. The firmware encodes it to Opus in real-time and streams it over BLE to the Nexting iOS app. The app sends it to the cloud, where an AI agent processes your request and responds. The response plays back through the I2S speaker on the device.

One button. No screen. No wake word.

## Schematic

The full schematic is at [`docs/SCH_pinclaw_v1.0_diy.pdf`](docs/SCH_pinclaw_v1.0_diy.pdf), designed in LCEDA (EasyEDA).

Key pin assignments on the XIAO nRF52840:

| Pin | Function |
|-----|----------|
| D1 (P0.03) | I2S DIN (audio data to amplifier) |
| D2 (P0.28) | I2S LRCLK |
| D3 (P0.29) | I2S BCLK |
| D4 (P0.04) | Button input (active LOW, internal pull-up) |
| D5 (P0.05) | WS2812B LED data |
| D0, D8-D10 | Micro SD card (SPI) |

## Design Lineage

The enclosure design is inspired by [OMI](https://github.com/BasedHardware/omi) (formerly Friend), an open-source AI wearable. We redesigned the geometry to improve button feel and pin ergonomics — the button sits more naturally under your thumb and the pin grips thinner fabrics better.

The firmware is written from scratch for Nexting on Zephyr RTOS. It handles push-to-talk recording with a 500ms confirmation threshold (short taps trigger playback instead), real-time Opus encoding, BLE audio streaming, I2S speaker output, and battery monitoring — all tailored for voice-first interaction.

## License

MIT — build it, modify it, sell it, whatever you want.
