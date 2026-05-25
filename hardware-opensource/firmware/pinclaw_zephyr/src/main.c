#include <stdlib.h>
#include <string.h>
#include <zephyr/drivers/uart.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/pm/device.h>

#include "button.h"
#include "codec.h"
#include "config.h"
#include "device_id.h"
#include "led.h"
#include "mic.h"
#include "sdcard.h"
#include "speaker.h"
#include "storage.h"
#include "transport.h"
#include "usb.h"
#include "utils.h"
#include "wdog_facade.h"
#ifdef CONFIG_BOOTLOADER_MCUBOOT
#include <zephyr/dfu/mcuboot.h>
#endif
#define BOOT_BLINK_DURATION_MS 600
#define BOOT_PAUSE_DURATION_MS 200
#define VBUS_DETECT (1U << 20)
#define WAKEUP_DETECT (1U << 16)
LOG_MODULE_REGISTER(main, CONFIG_LOG_DEFAULT_LEVEL);

static void codec_handler(uint8_t *data, size_t len)
{
    int err = broadcast_audio_packets(data, len);
    if (err) {
        LOG_ERR("Failed to broadcast audio packets: %d", err);
    }
}

static void mic_handler(int16_t *buffer)
{
    int err = codec_receive_pcm(buffer, MIC_BUFFER_SAMPLES);
    if (err) {
        LOG_ERR("Failed to process PCM data: %d", err);
    }
}

void bt_ctlr_assert_handle(char *name, int type)
{
    LOG_INF("Bluetooth assert: %s (type %d)", name ? name : "NULL", type);
}

static void print_reset_reason(void)
{
    uint32_t reas = NRF_POWER->RESETREAS;

    // Clear the reset reason register
    NRF_POWER->RESETREAS = reas;

    if (reas & POWER_RESETREAS_DOG_Msk) {
        printk("Reset by WATCHDOG\n");
    } else if (reas & POWER_RESETREAS_NFC_Msk) {
        printk("Wake up by NFC field detect\n");
    } else if (reas & POWER_RESETREAS_RESETPIN_Msk) {
        printk("Reset by pin-reset\n");
    } else if (reas & POWER_RESETREAS_SREQ_Msk) {
        printk("Reset by soft-reset\n");
    } else if (reas & POWER_RESETREAS_LOCKUP_Msk) {
        printk("Reset by CPU LOCKUP\n");
    } else if (reas) {
        printk("Reset by a different source (0x%08X)\n", reas);
    } else {
        printk("Power-on-reset\n");
    }
}

bool is_connected = false;
bool is_charging = false;
extern bool is_off;
extern bool usb_charge;
extern volatile bool recording_active;
static void boot_led_sequence(void)
{
    // Red blink
    set_led_red(true);
    k_msleep(BOOT_BLINK_DURATION_MS);
    set_led_red(false);
    k_msleep(BOOT_PAUSE_DURATION_MS);
    // Green blink
    set_led_green(true);
    k_msleep(BOOT_BLINK_DURATION_MS);
    set_led_green(false);
    k_msleep(BOOT_PAUSE_DURATION_MS);
    // Blue blink
    set_led_blue(true);
    k_msleep(BOOT_BLINK_DURATION_MS);
    set_led_blue(false);
    k_msleep(BOOT_PAUSE_DURATION_MS);
    // All LEDs on
    set_led_red(true);
    set_led_green(true);
    set_led_blue(true);
    k_msleep(BOOT_BLINK_DURATION_MS);
    // All LEDs off
    set_led_red(false);
    set_led_green(false);
    set_led_blue(false);
}

void set_led_state()
{
    // Recording and connected state - BLUE

    if (usb_charge) {
        is_charging = !is_charging;
        if (is_charging) {
            set_led_green(true);
        } else {
            set_led_green(false);
        }
    } else {
        set_led_green(false);
    }
    if (is_off) {
        set_led_red(false);
        set_led_blue(false);
        return;
    }
    // Recording — GREEN
    if (recording_active) {
        set_led_green(true);
        set_led_red(false);
        set_led_blue(false);
        return;
    }

    if (is_connected) {
        set_led_blue(true);
        set_led_red(false);
        return;
    }

    // Not connected — RED slow blink (1s on, 1s off)
    if (!is_connected) {
        bool blink = (k_uptime_get() / 1000) % 2 == 0;
        set_led_red(blink);
        set_led_blue(false);
        return;
    }
}

int main(void)
{
    int err;

    // Print and clear reset reason
    print_reset_reason();

    NRF_POWER->DCDCEN = 1;
    NRF_POWER->DCDCEN0 = 1;

    LOG_INF("Booting...\n");

    LOG_INF("Model: %s", CONFIG_BT_DIS_MODEL);
    LOG_INF("Firmware revision: %s", CONFIG_BT_DIS_FW_REV_STR);
    LOG_INF("Hardware revision: %s", CONFIG_BT_DIS_HW_REV_STR);
    // QSPI flash is used by MCUboot for secondary slot (OTA updates).
    // MCUmgr SMP writes new firmware images there.
    // Do NOT suspend QSPI flash — it must remain accessible for OTA.
    LOG_PRINTK("\n");
    LOG_INF("Initializing LEDs...\n");

    err = led_start();
    if (err) {
        LOG_ERR("Failed to initialize LEDs (err %d)", err);
        return err;
    }

    // Run the boot LED sequence
    boot_led_sequence();

    // Initialize watchdog early to catch any freezes during boot
    err = watchdog_init();
    if (err) {
        LOG_WRN("Watchdog init failed (err %d), continuing without watchdog", err);
    }

    // Enable battery
#ifdef CONFIG_OMI_ENABLE_BATTERY
    err = battery_init();
    if (err) {
        LOG_ERR("Battery init failed (err %d)", err);
        return err;
    }

    err = battery_charge_start();
    if (err) {
        LOG_ERR("Battery failed to start (err %d)", err);
        return err;
    }
    LOG_INF("Battery initialized");
#endif

    // Enable speaker FIRST (before button, so logs are visible)
    printk("\n=== SPEAKER INIT ===\n");
#ifdef CONFIG_OMI_ENABLE_SPEAKER
    err = speaker_init();
    if (err) {
        printk("[speaker] FAILED err=%d\n", err);
    } else {
        printk("[speaker] OK\n");
    }
#endif

    // Enable button
#ifdef CONFIG_OMI_ENABLE_BUTTON
    err = button_init();
    if (err) {
        LOG_ERR("Failed to initialize Button (err %d)", err);
        return err;
    }
    LOG_INF("Button initialized");
    activate_button_work();
    LOG_INF("Button work queue activated (D4=power, D5=input)");
#endif

    // Enable accelerometer
#ifdef CONFIG_OMI_ENABLE_ACCELEROMETER
    err = accel_start();
    if (err) {
        LOG_ERR("Accelerometer failed to activated (err %d)", err);
        return err;
    }
    LOG_INF("Accelerometer initialized");
#endif

    // Enable sdcard
#ifdef CONFIG_OMI_ENABLE_OFFLINE_STORAGE
    LOG_PRINTK("\n");
    LOG_INF("Mount SD card...\n");

    err = mount_sd_card();
    if (err) {
        LOG_ERR("Failed to mount SD card (err %d) — continuing without SD", err);
    }
    k_msleep(500);

    LOG_PRINTK("\n");
    LOG_INF("Initializing storage...\n");

    if (!err) {
        err = storage_init();
        if (err) {
            LOG_ERR("Failed to initialize storage (err %d) — continuing without storage", err);
        }
    } else {
        LOG_WRN("Skipping storage init (no SD card)");
    }
#endif

    // Haptic feedback is now via speaker (no motor).
    // init_haptic_pin() is a no-op but kept for BLE service compatibility.
    init_haptic_pin();

    // Enable usb
#ifdef CONFIG_OMI_ENABLE_USB
    LOG_PRINTK("\n");
    LOG_INF("Initializing power supply check...\n");

    err = init_usb();
    if (err) {
        LOG_ERR("Failed to initialize power supply (err %d)", err);
        return err;
    }
#endif

    // Initialize device ID from NVS (must be before transport_start)
    err = device_id_init();
    if (err) {
        LOG_WRN("Device ID init failed (err %d), using default name", err);
    }

    // Check serial port for device ID command (2 second window)
    // Format: "PINCLAW_ID=XXX\n" where XXX is 1-999
    {
        const struct device *uart = DEVICE_DT_GET(DT_CHOSEN(zephyr_console));
        if (device_is_ready(uart)) {
            LOG_INF("Listening for device ID command (2s)...");
            uint8_t cmd_buf[32];
            int cmd_pos = 0;
            int64_t deadline = k_uptime_get() + 2000;

            while (k_uptime_get() < deadline) {
                uint8_t c;
                int ret = uart_poll_in(uart, &c);
                if (ret == 0) {
                    if (c == '\n' || c == '\r') {
                        cmd_buf[cmd_pos] = '\0';
                        if (cmd_pos > 11 && strncmp((char *)cmd_buf, "PINCLAW_ID=", 11) == 0) {
                            int num = atoi((char *)cmd_buf + 11);
                            if (num > 0 && num <= 999) {
                                device_id_set((uint16_t)num);
                                printk("OK DEVICE_ID=%d NAME=%s\n", num, device_id_get_name());
                            }
                        }
                        cmd_pos = 0;
                    } else if (cmd_pos < (int)sizeof(cmd_buf) - 1) {
                        cmd_buf[cmd_pos++] = c;
                    }
                } else {
                    k_msleep(10);
                }
            }
        }
    }

    // Indicate transport initialization
    LOG_PRINTK("\n");
    LOG_INF("Initializing transport...\n");

    set_led_green(true);
    set_led_green(false);

    // Start transport
    int transportErr;
    transportErr = transport_start();
    if (transportErr) {
        LOG_ERR("Failed to start transport (err %d)", transportErr);
        // TODO: Detect the current core is app core or net core
        // Blink green LED to indicate error
        for (int i = 0; i < 5; i++) {
            set_led_green(!gpio_pin_get_dt(&led_green));
            k_msleep(200);
        }
        set_led_green(false);

        return transportErr;
    }

#ifdef CONFIG_OMI_ENABLE_SPEAKER
    play_boot_sound();
#endif

    LOG_PRINTK("\n");
    LOG_INF("Initializing codec...\n");

    set_led_blue(true);

    // Audio codec(opus) callback
    set_codec_callback(codec_handler);
    err = codec_start();
    if (err) {
        LOG_ERR("Failed to start codec: %d", err);
        // Blink blue LED to indicate error
        for (int i = 0; i < 5; i++) {
            set_led_blue(!gpio_pin_get_dt(&led_blue));
            k_msleep(200);
        }
        set_led_blue(false);
        return err;
    }

    // Boot haptic buzz via speaker (500ms low-freq rumble)
    play_haptic_milli(500);
    set_led_blue(false);

    // Indicate microphone initialization
    LOG_PRINTK("\n");
    LOG_INF("Initializing microphone...\n");

    set_led_red(true);
    set_led_green(true);

    set_mic_callback(mic_handler);
    err = mic_start();
    if (err) {
        LOG_ERR("Failed to start microphone: %d", err);
        // Blink red and green LEDs to indicate error
        for (int i = 0; i < 5; i++) {
            set_led_red(!gpio_pin_get_dt(&led_red));
            set_led_green(!gpio_pin_get_dt(&led_green));
            k_msleep(200);
        }
        set_led_red(false);
        set_led_green(false);
        return err;
    }

    set_led_red(false);
    set_led_green(false);

    // Indicate successful initialization
    LOG_PRINTK("\n");
    LOG_INF("Device initialized successfully\n");

    set_led_blue(true);
    k_msleep(1000);
    set_led_blue(false);

    // MCUboot: confirm this firmware image is working.
    // If we reach here, all critical subsystems (BLE, codec, mic) initialized OK.
    // Without confirmation, MCUboot will revert to the previous image on next reboot.
#ifdef CONFIG_BOOTLOADER_MCUBOOT
    if (!boot_is_img_confirmed()) {
        int confirm_err = boot_write_img_confirmed();
        if (confirm_err) {
            LOG_ERR("Failed to confirm firmware image: %d", confirm_err);
        } else {
            LOG_INF("Firmware image confirmed as working");
        }
    }
#endif

    // Main loop
    LOG_PRINTK("\n");
    LOG_INF("Entering main loop...\n");

    // Main loop: watchdog + LED state only.
    // Button: D4 (P0.04) = output 3.3V power, D5 (P0.05) = input read.
    // PTT logic in button.c via work queue (activate_button_work above).
    while (1) {
        watchdog_feed();
        set_led_state();
        k_msleep(20);
    }

    // Unreachable
    return 0;
}
