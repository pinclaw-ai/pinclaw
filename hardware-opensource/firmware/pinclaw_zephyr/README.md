# Nexting Firmware

Zephyr RTOS firmware for the Nexting wearable AI device, built on nRF Connect SDK 2.7.0.

## Hardware

| Component | Model | Notes |
|-----------|-------|-------|
| MCU | Seeed XIAO nRF52840 Sense | 21x17.5mm. ARM Cortex-M4 @ 64MHz. Built-in BLE 5.0, PDM mic, RGB LED, LiPo charger. |
| Button | Tactile switch on D4 (P0.04) | Active LOW with internal pull-up. 100nF debounce cap recommended. |
| Speaker | I2S + MAX98357A (Adafruit 5769 Audio BFF) | SCK=A3, LRCK=A2, SDOUT=A1, SD/Enable=D6 |
| Battery | 3.7V LiPo 200mAh | Onboard BQ25101 charge management via USB-C |
| Microphone | Onboard PDM | Built into XIAO Sense module |

## Flashing

### Method 1: Automated (recommended)

```bash
cd firmware
./test-device.sh 10           # flash + assign device ID + serial verify + BLE test
./test-device.sh 10 --quick   # flash + verify (skip button and reconnect tests)
./test-device.sh 10 --no-flash # already flashed, run tests only
```

The script will:

1. Wait for you to double-tap Reset to enter bootloader
2. Copy the UF2 firmware to the device
3. Write the device ID via serial (BLE name becomes "Pinclaw 010")
4. Verify boot logs (firmware version, button state, LED, Bluetooth)
5. Run full BLE tests (device info, battery, heartbeat, mic, speaker, reconnect)

Dependency: `pip3 install bleak`

### Method 2: Manual

1. **Double-tap Reset** — quickly double-tap the Reset button. The orange LED pulses.
2. A USB drive named `XIAO-SENSE` appears on your computer.
3. Copy the firmware:
   ```bash
   cp pinclaw_v2.2.0.uf2 /Volumes/XIAO-SENSE/fw.uf2
   ```
4. The device reboots automatically.

### First-time flash (new boards)

New boards need a bootloader upgrade first:

1. Double-tap Reset to enter bootloader
2. `cp bootloader0.9.0.uf2 /Volumes/XIAO-SENSE/`
3. Wait for reboot, double-tap Reset again
4. Flash firmware (same as above)

## Building from Source

### Prerequisites

Install in order:

#### 1. nRF Connect SDK 2.7.0

```bash
pip3 install west
west init -m https://github.com/nrfconnect/sdk-nrf --mr v2.7.0 ~/ncs
cd ~/ncs
west update
```

#### 2. ARM GCC Toolchain

On macOS, the easiest way is via the Seeed Arduino package:

1. Install [Arduino IDE](https://www.arduino.cc/en/software)
2. Preferences → Additional Board Manager URLs, add:
   ```
   https://files.seeedstudio.com/arduino/package_seeeduino_boards_index.json
   ```
3. Board Manager → search "Seeed nRF52" → install

Toolchain path: `~/Library/Arduino15/packages/Seeeduino/tools/arm-none-eabi-gcc/9-2019q4`

Or download [ARM GNU Toolchain](https://developer.arm.com/downloads/-/gnu-rm) (9-2019-q4-major) directly.

#### 3. CMake (must be 3.x)

Zephyr / NCS 2.7.0 is **not compatible with CMake 4.x**.

```bash
cmake --version  # if 4.x, downgrade:
pip3 install cmake==3.31.6
export PATH="$HOME/Library/Python/3.9/bin:$PATH"
```

#### 4. Other dependencies

```bash
brew install ninja
brew install dtc  # optional, warnings are safe to ignore
```

### Build commands

```bash
export ZEPHYR_TOOLCHAIN_VARIANT=gnuarmemb
export GNUARMEMB_TOOLCHAIN_PATH=~/Library/Arduino15/packages/Seeeduino/tools/arm-none-eabi-gcc/9-2019q4
export ZEPHYR_BASE=~/ncs/zephyr

cd firmware/pinclaw_zephyr

# Full rebuild
west build -b xiao_ble/nrf52840/sense . \
  -DDTC_OVERLAY_FILE="$(pwd)/overlay/xiao_ble_sense_devkitv2-adafruit.overlay" \
  --pristine

# Incremental build
west build
```

Output: `build/zephyr/zephyr.uf2`

### Build troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `picolibc.cmake` / `try_compile` failure | CMake 4.x incompatible | Downgrade to CMake 3.x |
| `west: unknown command "build"` | Not in NCS workspace | `export ZEPHYR_BASE=~/ncs/zephyr` |
| `Could NOT find Dtc` | Missing dtc | `brew install dtc` (warning is safe) |
| `GNUARMEMB_TOOLCHAIN_PATH` error | Wrong toolchain path | Verify `arm-none-eabi-gcc` exists at that path |

## Features

| Feature | Status | Notes |
|---------|--------|-------|
| BLE connection | Done | Auto-advertise, up to 3 simultaneous connections |
| Hardware button record | Done | Hold D4 > 0.5s to record, release to stop |
| Hardware button play | Done | Tap D4 < 0.5s to replay last AI response |
| iPhone hold-to-talk | Done | App sends 0x01/0x00 to control recording |
| Opus encoding | Done | 16kHz mono, CELT mode, 32kbps VBR |
| Battery monitoring | Done | BAS service + heartbeat voltage reporting |
| Heartbeat keepalive | Done | 10s interval, dedicated thread |
| Device ID (NVS) | Done | Persistent storage, BLE name "Pinclaw XXX" |
| I2S Speaker | Done | MAX98357A via I2S, boot chime on startup |
| SD Card | Not enabled | |
| Accelerometer | Not enabled | |

## LED Status

| Color | Pattern | Meaning |
|-------|---------|---------|
| Red → Green → Blue | Sequential blink | Booting up |
| Red | Slow blink (1s on/off) | Waiting for BLE connection |
| Blue | Solid | BLE connected, idle |
| Green | Solid | Recording (button held) |
| Green | Blinking | USB charging |

## Button Behavior

| Action | Effect |
|--------|--------|
| Hold >= 0.5s | Green LED on, start recording. Release to stop. |
| Tap < 0.5s | Send PLAY command (0x20) to app |

## BLE Protocol

### Services

| Service | UUID | Purpose |
|---------|------|---------|
| Audio | `12345678-1234-1234-1234-123456789ABC` | Recording / commands / heartbeat |
| Button | `23BA7924-0000-1000-7450-346EAC492E92` | Button events |
| Speaker | `CAB1AB95-2EA5-4F4D-BB56-874B72CFC984` | Speaker / haptic feedback |
| Battery | `180F` (standard BAS) | Battery percentage |
| Device Info | `180A` (standard DIS) | Firmware / hardware version |

### Audio Characteristics

| UUID suffix | Property | Description |
|-------------|----------|-------------|
| `...9ABE` | notify | Audio data packets (START/DATA/END) |
| `...9ABD` | read/write/notify | Commands (record/stop/shutdown) |
| `...9ABF` | notify | Heartbeat packets |

### Commands (write to ...9ABD)

| Byte | Description |
|------|-------------|
| `0x01` | Start recording |
| `0x00` | Stop recording |
| `0x20` | Play (simulate tap) |
| `0x40` | Shutdown |

### Audio packet format (...9ABE notify)

```
START: [0x01][codec:1B][0x00 x4]     codec: 0x14=Opus
DATA:  [0x02][seqNo:2B BE][opus...]
END:   [0x03][totalFrames:4B BE]
```

### Heartbeat packet format (...9ABF notify, every 10s)

```
[0x04][counter:2B BE][flags:1B][battery_mV:2B BE]

flags:
  bit 0 = recording
  bit 1 = USB charging
```

### Button events (Button characteristic notify)

```
[state:1B][0x00]

state:
  4 = PRESS
  5 = RELEASE
```
