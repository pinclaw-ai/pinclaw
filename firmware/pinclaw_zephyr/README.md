# Pinclaw Firmware

基于 Zephyr RTOS (nRF Connect SDK 2.7.0) 的 Pinclaw 硬件固件。

## 固件版本

| 版本 | 文件 | 说明 |
|------|------|------|
| v1.1.1 | `pinclaw_v1.1.1.uf2` | **推荐** — BLE 名 "Pinclaw 003"，含 heartbeat |
| v1.1.0 | `pinclaw_v1.1.0-heartbeat.uf2` | BLE 名 "Pinclaw"，含 heartbeat |
| v1.0.0 | `pinclaw_v1.0.0.uf2` | 基础版本，无 heartbeat |

### 版本差异

- **v1.0.0 → v1.1.0**：新增 Heartbeat 心跳机制（每 5 秒发送电池电压、充电状态等遥测数据）
- **v1.1.0 → v1.1.1**：仅修改 BLE 广播名称为 "Pinclaw 003"

## 硬件要求

- **主控**: Seeed XIAO nRF52840 Sense
- **按钮**: D4 (P0.04) → GND，active LOW
- **扬声器**: I2S (D1/D2/D3) + PAM8302A
- **电池**: 3.7V LiPo
- **麦克风**: 板载 PDM（XIAO Sense 自带）

## 快速烧录（不需要编译）

### 第一次烧录（需要升级 bootloader）

1. **升级 Bootloader**
   - 双击 Reset 按钮（快速双击），进入 bootloader 模式
   - 电脑上会出现 `XIAO-SENSE` USB 驱动器
   - 将 `bootloader0.9.0.uf2` 拷贝到驱动器
   - 等待设备自动重启

2. **烧录固件**
   - 再次双击 Reset 进入 bootloader
   - 将 `pinclaw_v1.1.1.uf2` 拷贝到 `XIAO-SENSE` 驱动器
   - 等待设备自动重启

### 后续烧录（已升级过 bootloader）

1. 双击 Reset 进入 bootloader
2. 将 UF2 文件拷贝到 `XIAO-SENSE` 驱动器

### macOS 命令行烧录

```bash
# 进入 bootloader 后：
cp pinclaw_v1.1.1.uf2 /Volumes/XIAO-SENSE/
```

## 从源码编译

### 前置条件

- nRF Connect SDK 2.7.0 + Zephyr SDK 0.16.8

### 本地编译

```bash
# 安装 Zephyr SDK
curl -L -o /tmp/zephyr-sdk.tar.xz "https://github.com/zephyrproject-rtos/sdk-ng/releases/download/v0.16.8/zephyr-sdk-0.16.8_macos-aarch64_minimal.tar.xz"
cd /tmp && tar xf zephyr-sdk.tar.xz

# 编译
cd <ncs-workspace>
export ZEPHYR_SDK_INSTALL_DIR=/tmp/zephyr-sdk-0.16.8
export ZEPHYR_TOOLCHAIN_VARIANT=zephyr
west build -b xiao_ble/nrf52840 <path-to-firmware>/firmware/pinclaw_zephyr --pristine -- -DCONFIG_BUILD_OUTPUT_UF2=y
```

编译输出：`build/zephyr/zephyr.uf2`

## 功能

| 功能 | 状态 | 说明 |
|------|------|------|
| BLE 连接 | ✅ | 自动广播，UUID 12345678-...-ABC |
| Heartbeat | ✅ | 每 5s 上报电池、充电状态 (v1.1.0+) |
| iPhone hold-to-talk | ✅ | iPhone 发 0x01/0x00 控制录音 |
| 硬件按钮录音 | ✅ | 长按 D4 > 0.5s 开始录音 |
| 硬件按钮播放 | ✅ | 短按 D4 < 0.5s 触发 PLAY |
| Opus 编码 | ✅ | 32kbps VBR, 16kHz mono |
| 扬声器 | ✅ | I2S + PAM8302A |
| 电池监测 | ✅ | Heartbeat 包含电压 |

## BLE 协议

### Service UUID

`12345678-1234-1234-1234-123456789ABC`

### Characteristics

| UUID 后缀 | 名称 | 属性 | 说明 |
|-----------|------|------|------|
| `...9ABE` | Audio | notify | 音频数据 (Opus) |
| `...9ABD` | Text | read/write/notify | 命令 + PLAY |
| `...9ABF` | Heartbeat | notify/write | 心跳 + 扬声器音频 |

### 命令协议 (写入 ABD)

| 字节 | 说明 |
|------|------|
| `0x01` | 开始录音 |
| `0x00` | 停止录音 |
| `0x40` | 关机 |

### Heartbeat 包格式 (ABF notify, v1.1.0+)

```
[0x04][seq:2B BE][flags:1B][battMv:2B BE]
flags: bit0 = 录音中, bit1 = 充电中
```

### 音频包格式 (ABE notify)

```
START: [0x01][0x14][0x00][0x00][0x00][0x00]
DATA:  [0x02][seqNo:2B BE][opus_data...]
END:   [0x03][totalFrames:4B BE]
```

## 按钮行为

| 操作 | 引脚 | 行为 |
|------|------|------|
| 短按 (< 0.5s) | D4 | PLAY — 发 0x20 给 iPhone |
| 长按 (≥ 0.5s) | D4 | 录音 — 发 START, 松开发 END |

## LED 状态

| 颜色 | 含义 |
|------|------|
| 蓝色常亮 | 已连接 BLE |
| 红色常亮 | 未连接 / 录音中 |
| 绿色闪烁 | 充电中 |
| 红绿蓝依次闪 | 启动中 |
