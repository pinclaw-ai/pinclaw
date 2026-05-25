#!/bin/bash
# Pinclaw Device Automated Test Script
# Usage: ./test-device.sh [device_number]
# Example: ./test-device.sh 10
#
# Flow:
#   1. Wait for XIAO-SENSE bootloader volume
#   2. Flash firmware (UF2)
#   3. Wait for reboot + serial port
#   4. Validate boot log (firmware version, D4 button, BLE)
#   5. Run full BLE test suite (device info, battery, heartbeat,
#      microphone, speaker, reconnection)
#
# Options:
#   --no-flash     Skip firmware flashing (device already flashed)
#   --no-button    Skip button test (needs physical press)
#   --quick        Skip button + reconnect tests
#
# Requirements: python3 with bleak (pip3 install bleak)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FW_FILE="$SCRIPT_DIR/pinclaw_zephyr/pinclaw_v2.2.0.uf2"
BLE_TEST="$SCRIPT_DIR/pinclaw_test.py"
BOOTLOADER_VOLUME="/Volumes/XIAO-SENSE"
SERIAL_BAUD=115200
BOOT_WAIT_TIMEOUT=30
SERIAL_CAPTURE_SECS=8

# Parse arguments
DEVICE_NUM=""
SKIP_FLASH=false
BLE_EXTRA_ARGS=""

for arg in "$@"; do
  case "$arg" in
    --no-flash)  SKIP_FLASH=true ;;
    --no-button) BLE_EXTRA_ARGS="$BLE_EXTRA_ARGS --no-button" ;;
    --quick)     BLE_EXTRA_ARGS="$BLE_EXTRA_ARGS --quick" ;;
    [0-9]*)      DEVICE_NUM="$arg" ;;
  esac
done
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✓ PASS${NC}: $1"; }
fail() { echo -e "  ${RED}✗ FAIL${NC}: $1"; FAILURES=$((FAILURES + 1)); }
info() { echo -e "${BLUE}→${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }

FAILURES=0

echo ""
echo "============================================"
echo "  Pinclaw Device Test — $(date '+%Y-%m-%d %H:%M')"
if [ -n "$DEVICE_NUM" ]; then
  echo "  Device: #${DEVICE_NUM} (PCL-2026-$(printf '%06d' "$DEVICE_NUM"))"
fi
echo "============================================"
echo ""

# ── Pre-checks ──
if [ "$SKIP_FLASH" = false ]; then
  if [ ! -f "$FW_FILE" ]; then
    echo -e "${RED}ERROR: Firmware not found: $FW_FILE${NC}"
    exit 1
  fi
  FW_SIZE=$(stat -f%z "$FW_FILE" 2>/dev/null || stat -c%s "$FW_FILE" 2>/dev/null)
  info "Firmware: $(basename "$FW_FILE") ($(( FW_SIZE / 1024 )) KB)"
fi

# ── Step 1: Flash firmware ──
echo ""
echo "━━━ Step 1: Flash Firmware ━━━"

if [ "$SKIP_FLASH" = true ]; then
  info "跳过烧录（--no-flash）"
else
  if [ -d "$BOOTLOADER_VOLUME" ]; then
    info "Bootloader volume already mounted"
  else
    echo ""
    echo "  >>> 请双击设备上的 Reset 按钮进入 bootloader 模式 <<<"
    echo "  >>> (橙色 LED 会脉冲闪烁，电脑上会出现 XIAO-SENSE 驱动器)"
    echo ""
    info "等待 XIAO-SENSE 卷挂载..."

    WAIT=0
    while [ ! -d "$BOOTLOADER_VOLUME" ] && [ $WAIT -lt 60 ]; do
      sleep 1
      WAIT=$((WAIT + 1))
      printf "\r  等待中... %ds " "$WAIT"
    done
    echo ""

    if [ ! -d "$BOOTLOADER_VOLUME" ]; then
      fail "超时 60 秒未检测到 bootloader"
      exit 1
    fi
  fi

  info "正在烧录固件..."
  cp -X "$FW_FILE" "$BOOTLOADER_VOLUME/fw.uf2"
  pass "固件已写入 ($FW_SIZE bytes)"

  # Wait for volume to unmount (device reboots)
  info "等待设备重启..."
  sleep 2
  WAIT=0
  while [ -d "$BOOTLOADER_VOLUME" ] && [ $WAIT -lt 10 ]; do
    sleep 1
    WAIT=$((WAIT + 1))
  done
fi

# ── Step 2: Serial port validation ──
echo ""
echo "━━━ Step 2: 串口启动验证 ━━━"

info "等待串口设备出现..."
SERIAL_PORT=""
WAIT=0
while [ -z "$SERIAL_PORT" ] && [ $WAIT -lt $BOOT_WAIT_TIMEOUT ]; do
  SERIAL_PORT=$(ls /dev/cu.usbmodem* 2>/dev/null | head -1) || true
  if [ -z "$SERIAL_PORT" ]; then
    sleep 1
    WAIT=$((WAIT + 1))
    printf "\r  等待中... %ds " "$WAIT"
  fi
done
echo ""

if [ -z "$SERIAL_PORT" ]; then
  fail "串口未出现（${BOOT_WAIT_TIMEOUT}s 超时）"
  warn "设备可能未正确重启，请检查 USB 连接"
  exit 1
fi

info "串口: $SERIAL_PORT"

# Configure serial port
stty -f "$SERIAL_PORT" $SERIAL_BAUD cs8 -cstopb -parenb raw 2>/dev/null || true

# ── Step 2a: Send device ID via serial ──
if [ -n "$DEVICE_NUM" ]; then
  info "发送设备编号: PINCLAW_ID=${DEVICE_NUM}"
  # Firmware listens for this command during the first 2 seconds after boot
  printf "PINCLAW_ID=%s\r\n" "$DEVICE_NUM" > "$SERIAL_PORT"
  sleep 1
  # Check for confirmation
  ID_RESPONSE=$(timeout 2 cat "$SERIAL_PORT" 2>/dev/null | grep -m1 "OK DEVICE_ID" || true)
  if [ -n "$ID_RESPONSE" ]; then
    pass "设备编号已写入: $ID_RESPONSE"
  else
    warn "未收到设备编号确认（固件可能不支持动态 ID，需要 v2.1.8+）"
  fi
fi

# Capture boot log
BOOT_LOG=$(mktemp /tmp/pinclaw_boot_XXXXXX.log)
info "捕获启动日志 (${SERIAL_CAPTURE_SECS}s)..."

# Use timeout to capture serial data; press reset if needed
timeout "$SERIAL_CAPTURE_SECS" cat "$SERIAL_PORT" > "$BOOT_LOG" 2>/dev/null || true

BOOT_CONTENT=$(cat "$BOOT_LOG")

if [ -z "$BOOT_CONTENT" ]; then
  warn "串口无输出，尝试触发重启重新捕获..."
  # Send break signal to reset, or just re-read
  sleep 2
  timeout "$SERIAL_CAPTURE_SECS" cat "$SERIAL_PORT" > "$BOOT_LOG" 2>/dev/null || true
  BOOT_CONTENT=$(cat "$BOOT_LOG")
fi

if [ -z "$BOOT_CONTENT" ]; then
  fail "串口无数据输出"
else
  # Display captured log
  echo ""
  echo "  ┌─ Boot Log ─────────────────────────────"
  echo "$BOOT_CONTENT" | head -30 | sed 's/^/  │ /'
  echo "  └────────────────────────────────────────"
  echo ""

  # Validate boot sequence
  # 1) Firmware version
  if echo "$BOOT_CONTENT" | grep -q "Firmware revision: 2.2.0"; then
    pass "固件版本 v2.2.0"
  else
    FW_VER=$(echo "$BOOT_CONTENT" | grep -o "Firmware revision: [0-9.]*" | head -1)
    if [ -n "$FW_VER" ]; then
      fail "固件版本不对: $FW_VER（期望 2.2.0）"
    else
      fail "未检测到固件版本号"
    fi
  fi

  # 2) Hardware model
  if echo "$BOOT_CONTENT" | grep -q "Model: Pinclaw"; then
    pass "硬件型号: Pinclaw"
  else
    fail "未检测到 Pinclaw 型号标识"
  fi

  # 3) D4 button initial value (CRITICAL)
  D4_LINE=$(echo "$BOOT_CONTENT" | grep "D4 initial value" | head -1)
  if [ -n "$D4_LINE" ]; then
    D4_VAL=$(echo "$D4_LINE" | grep -o "value: [0-9]" | grep -o "[0-9]")
    if [ "$D4_VAL" = "1" ]; then
      pass "D4 按钮初始值 = 1（正常，未按下）"
    else
      fail "D4 按钮初始值 = $D4_VAL（异常！应为 1，可能按钮短路）"
    fi
  else
    fail "未检测到 D4 初始值日志"
  fi

  # 4) TWIM1 fix
  if echo "$BOOT_CONTENT" | grep -q "TWIM1 disconnected"; then
    pass "TWIM1 引脚冲突修复已执行"
  else
    warn "未检测到 TWIM1 修复日志"
  fi

  # 5) LEDs
  if echo "$BOOT_CONTENT" | grep -q "LEDs started"; then
    pass "LED 初始化成功"
  else
    fail "LED 初始化未检测到"
  fi

  # 6) Speaker / I2S
  if echo "$BOOT_CONTENT" | grep -q "\[speaker\] OK"; then
    pass "扬声器 (I2S) 初始化成功"
  else
    warn "扬声器初始化未检测到或失败"
  fi

  # 7) No error spam (broadcast failures)
  ERROR_COUNT=$(echo "$BOOT_CONTENT" | grep -c "Failed to broadcast" || true)
  if [ "$ERROR_COUNT" -eq 0 ]; then
    pass "无音频广播错误"
  else
    fail "检测到 $ERROR_COUNT 条音频广播错误（按钮可能卡住）"
  fi

  # 8) BLE advertising
  if echo "$BOOT_CONTENT" | grep -qi "advertis\|Bluetooth initialized\|bt_hci_core"; then
    pass "蓝牙已启动"
  else
    warn "未检测到蓝牙启动日志（可能在捕获窗口之外）"
  fi
fi

rm -f "$BOOT_LOG"

# ── Step 3: BLE Full Test Suite ──
echo ""
echo "━━━ Step 3: BLE 全面测试 ━━━"
echo "  测试项: 设备信息 / 电池 / 心跳 / 麦克风 / 扬声器 / 重连"
echo ""

if [ ! -f "$BLE_TEST" ]; then
  warn "BLE 测试脚本不存在: $BLE_TEST"
  warn "跳过 BLE 测试"
else
  if ! command -v python3 &>/dev/null; then
    warn "python3 未安装，跳过 BLE 测试"
  elif ! python3 -c "import bleak" 2>/dev/null; then
    warn "bleak 未安装 (pip3 install bleak)，跳过 BLE 测试"
  else
    DEVICE_ARG=""
    if [ -n "$DEVICE_NUM" ]; then
      DEVICE_ARG="--device-num $DEVICE_NUM"
    fi

    # BLE test returns exit code = number of failures
    if python3 "$BLE_TEST" $DEVICE_ARG $BLE_EXTRA_ARGS; then
      pass "BLE 全面测试通过"
    else
      BLE_FAILURES=$?
      fail "BLE 测试有 ${BLE_FAILURES} 项失败"
      FAILURES=$((FAILURES + BLE_FAILURES - 1))  # -1 because fail() already added 1
    fi
  fi
fi

# ── Summary ──
echo ""
echo "============================================"
if [ -n "$DEVICE_NUM" ]; then
  echo "  Device #${DEVICE_NUM} 测试结果"
else
  echo "  测试结果"
fi
echo "============================================"

if [ $FAILURES -eq 0 ]; then
  echo -e "  ${GREEN}全部通过${NC}"
  echo ""
  echo "  设备可以发货。"
else
  echo -e "  ${RED}${FAILURES} 项失败${NC}"
  echo ""
  echo "  请检查失败项后再发货。"
fi

echo ""
exit $FAILURES
