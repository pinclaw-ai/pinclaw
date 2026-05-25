#include "button.h"

#include <zephyr/bluetooth/bluetooth.h>
#include <zephyr/bluetooth/gatt.h>
#include <zephyr/bluetooth/l2cap.h>
#include <zephyr/bluetooth/services/bas.h>
#include <zephyr/bluetooth/uuid.h>
#include <zephyr/drivers/gpio.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/poweroff.h>

#include "led.h"
#include "mic.h"
#include "speaker.h"
#include "transport.h"
#include "wdog_facade.h"
LOG_MODULE_REGISTER(button, CONFIG_LOG_DEFAULT_LEVEL);

bool is_off = false;
static void button_ccc_config_changed_handler(const struct bt_gatt_attr *attr, uint16_t value);
static ssize_t button_data_read_characteristic(struct bt_conn *conn,
                                               const struct bt_gatt_attr *attr,
                                               void *buf,
                                               uint16_t len,
                                               uint16_t offset);
static struct gpio_callback button_cb_data;

static struct bt_uuid_128 button_uuid =
    BT_UUID_INIT_128(BT_UUID_128_ENCODE(0x23BA7924, 0x0000, 0x1000, 0x7450, 0x346EAC492E92));
static struct bt_uuid_128 button_characteristic_data_uuid =
    BT_UUID_INIT_128(BT_UUID_128_ENCODE(0x23BA7925, 0x0000, 0x1000, 0x7450, 0x346EAC492E92));

static struct bt_gatt_attr button_service_attr[] = {
    BT_GATT_PRIMARY_SERVICE(&button_uuid),
    BT_GATT_CHARACTERISTIC(&button_characteristic_data_uuid.uuid,
                           BT_GATT_CHRC_READ | BT_GATT_CHRC_NOTIFY,
                           BT_GATT_PERM_READ,
                           button_data_read_characteristic,
                           NULL,
                           NULL),
    BT_GATT_CCC(button_ccc_config_changed_handler, BT_GATT_PERM_READ | BT_GATT_PERM_WRITE),
};

static struct bt_gatt_service button_service = BT_GATT_SERVICE(button_service_attr);

static void button_ccc_config_changed_handler(const struct bt_gatt_attr *attr, uint16_t value)
{
    if (value == BT_GATT_CCC_NOTIFY) {
        LOG_INF("Client subscribed for notifications");
    } else if (value == 0) {
        LOG_INF("Client unsubscribed from notifications");
    } else {
        LOG_ERR("Invalid CCC value: %u", value);
    }
}

// Pinclaw PTT button: D4 (P0.04) = input with pull-up, switch to GND
// Pressed: D4 pulled LOW by switch → reads 0
// Released: D4 pulled HIGH by internal pull-up → reads 1
struct gpio_dt_spec d4_pin_input = {.port = DEVICE_DT_GET(DT_NODELABEL(gpio0)),
                                    .pin = 4,
                                    .dt_flags = 0};

#define BUTTON_CHECK_INTERVAL 40 // 0.04 seconds, 25 Hz

void check_button_level(struct k_work *work_item);
K_WORK_DELAYABLE_DEFINE(button_work, check_button_level);

#define SINGLE_TAP 1
#define DOUBLE_TAP 2
#define LONG_TAP 3
#define BUTTON_PRESS 4
#define BUTTON_RELEASE 5

static FSM_STATE_T current_button_state = IDLE;

static int final_button_state[2] = {0, 0};

static inline void notify_press()
{
    final_button_state[0] = BUTTON_PRESS;
    LOG_INF("Button pressed");
    struct bt_conn *conn = get_current_connection();
    if (conn != NULL) {
        bt_gatt_notify(conn, &button_service.attrs[1], &final_button_state, sizeof(final_button_state));
    }
}

static inline void notify_unpress()
{
    final_button_state[0] = BUTTON_RELEASE;
    LOG_INF("Button released");
    struct bt_conn *conn = get_current_connection();
    if (conn != NULL) {
        bt_gatt_notify(conn, &button_service.attrs[1], &final_button_state, sizeof(final_button_state));
    }
}

// Pinclaw PTT: hold > 0.5s starts recording, release stops.
// Short tap < 0.5s sends PLAY command.
void check_button_level(struct k_work *work_item)
{
    // Poll D4: active LOW (pressed = 0 when switch connects to GND)
    int raw = gpio_pin_get_raw(d4_pin_input.port, d4_pin_input.pin);
    bool pressed = (raw == 0);

    // Debug: print D4 value every 2 seconds
    static int debug_counter = 0;
    if (++debug_counter >= 50) {  // 50 * 40ms = 2s
        LOG_INF("[BTN-DBG] D4 raw=%d pressed=%d", raw, pressed);
        debug_counter = 0;
    }

    static bool was_btn_pressed = false;
    static bool btn_recording_started = false;
    static int64_t press_start_time = 0;

    extern volatile bool recording_active;
    extern uint16_t opus_seq_no;
    extern struct bt_gatt_service audio_service;

    // Button just pressed — record time, don't start recording yet
    if (pressed && !was_btn_pressed) {
        was_btn_pressed = true;
        btn_recording_started = false;
        press_start_time = k_uptime_get();
        // Stop any ongoing speaker playback
        speaker_stop();
    }

    // Button held past 0.5s — start recording
    if (pressed && was_btn_pressed && !btn_recording_started) {
        int64_t held = k_uptime_get() - press_start_time;
        if (held >= 500) {
            btn_recording_started = true;
            recording_active = true;
            opus_seq_no = 0;
            struct bt_conn *conn = get_current_connection();
            if (conn) {
                uint8_t start_pkt[6] = {0x01, 0x14, 0x00, 0x00, 0x00, 0x00};
                bt_gatt_notify(conn, &audio_service.attrs[1], start_pkt, 6);
            }
            LOG_INF("[BTN] Recording started (held > 0.5s)");
            set_led_red(true);
        }
    }

    // Button released
    if (!pressed && was_btn_pressed) {
        was_btn_pressed = false;
        int64_t duration = k_uptime_get() - press_start_time;

        if (btn_recording_started) {
            // Was recording — stop and enqueue END into ring buffer
            // END goes through the same queue as audio, so pusher sends
            // it after all remaining audio frames — no BLE TX competition
            recording_active = false;
            btn_recording_started = false;
            enqueue_end_packet(opus_seq_no);
            set_led_red(false);
            LOG_INF("[BTN] Recording stopped, frames=%d", opus_seq_no);
        } else {
            // Short tap (< 0.5s) — PLAY command
            LOG_INF("[BTN] Short tap (%lld ms) — PLAY", duration);
            struct bt_conn *conn = get_current_connection();
            if (conn) {
                uint8_t play_cmd = 0x20;
                bt_gatt_notify(conn, &audio_service.attrs[3], &play_cmd, 1);
            }
        }
    }

    k_work_reschedule(&button_work, K_MSEC(BUTTON_CHECK_INTERVAL));
}

static ssize_t button_data_read_characteristic(struct bt_conn *conn,
                                               const struct bt_gatt_attr *attr,
                                               void *buf,
                                               uint16_t len,
                                               uint16_t offset)
{
    return bt_gatt_attr_read(conn, attr, buf, len, offset, &final_button_state, sizeof(final_button_state));
}

int button_init()
{
    // XIAO BLE Sense has on-board IMU (LSM6DS3TR-C) wired to P0.04 (I2C1 SDA)
    // and P0.05 (I2C1 SCL). With CONFIG_I2C=n the driver never runs, so the
    // TWIM1 peripheral may still hold these pins. Force-disconnect before use.
    volatile uint32_t *twi1_enable = (volatile uint32_t *)(0x40004000 + 0x500);
    volatile uint32_t *twi1_scl = (volatile uint32_t *)(0x40004000 + 0x504);
    volatile uint32_t *twi1_sda = (volatile uint32_t *)(0x40004000 + 0x508);
    LOG_INF("TWIM1 before fix: EN=%d SDA=0x%08x SCL=0x%08x",
            *twi1_enable, *twi1_sda, *twi1_scl);
    *twi1_enable = 0;
    *twi1_sda = 0x80000000;  // disconnect
    *twi1_scl = 0x80000000;  // disconnect
    LOG_INF("TWIM1 disconnected from P0.04/P0.05");

    // Also check TWIM0 for P0.04 (SDA)
    volatile uint32_t *twi0_sda = (volatile uint32_t *)(0x40003000 + 0x508);
    if ((*twi0_sda & 0x1F) == 4 && !(*twi0_sda & 0x80000000)) {
        *twi0_sda = 0x80000000;
        LOG_INF("TWIM0 SDA was on P0.04, disconnected");
    }

    // D4 (P0.04): input with pull-up, switch connects to GND
    if (!gpio_is_ready_dt(&d4_pin_input)) {
        LOG_ERR("D4 pin not ready");
        return -1;
    }
    int err = gpio_pin_configure_dt(&d4_pin_input, GPIO_INPUT | GPIO_PULL_UP);
    if (err) {
        LOG_ERR("D4 input config failed: %d", err);
        return -1;
    }
    LOG_INF("D4 configured as input with pull-up");

    // Interrupt on both edges for responsive detection
    err = gpio_pin_interrupt_configure(d4_pin_input.port, d4_pin_input.pin, GPIO_INT_EDGE_BOTH);
    if (err) {
        LOG_ERR("D4 interrupt config failed: %d", err);
        return -1;
    }

    // Read initial state
    int d4_val = gpio_pin_get_raw(d4_pin_input.port, d4_pin_input.pin);
    LOG_INF("D4 initial value: %d (should be 1 if not pressed)", d4_val);

    return 0;
}

void activate_button_work()
{
    k_work_schedule(&button_work, K_MSEC(BUTTON_CHECK_INTERVAL));
}

void register_button_service()
{
    bt_gatt_service_register(&button_service);
}

FSM_STATE_T get_current_button_state()
{
    return current_button_state;
}

void turnoff_all()
{
    mic_off();
    accel_off();
    play_haptic_milli(50);
    speaker_off();
    k_msleep(100);
    set_led_blue(false);
    set_led_red(false);
    set_led_green(false);
    gpio_pin_interrupt_configure(d4_pin_input.port, d4_pin_input.pin, GPIO_INT_DISABLE);

    // Disable watchdog before entering system off
    int rc = watchdog_deinit();
    if (rc < 0) {
        LOG_ERR("Failed to deinitialize watchdog (%d)", rc);
    }

    NRF_USBD->INTENCLR = 0xFFFFFFFF;
    NRF_POWER->SYSTEMOFF = 1;
}

void force_button_state(FSM_STATE_T state)
{
    current_button_state = state;
}
