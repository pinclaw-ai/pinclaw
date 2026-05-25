#include "speaker.h"

#include <math.h>
#include <zephyr/bluetooth/gatt.h>
#include <zephyr/bluetooth/l2cap.h>
#include <zephyr/bluetooth/services/bas.h>
#include <zephyr/bluetooth/uuid.h>
#include <zephyr/device.h>
#include <zephyr/drivers/gpio.h>
#include <zephyr/drivers/i2s.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/logging/log_ctrl.h>

LOG_MODULE_REGISTER(speaker, CONFIG_LOG_DEFAULT_LEVEL);

#define MAX_BLOCK_SIZE 10000 // 24000 * 2

#define BLOCK_COUNT 2
#define SAMPLE_FREQUENCY 8000
#define NUMBER_OF_CHANNELS 2
#define PACKET_SIZE 400
#define WORD_SIZE 16
#define NUM_CHANNELS 2

#define PI 3.14159265358979323846

#define MAX_HAPTIC_DURATION 5000
K_MEM_SLAB_DEFINE_STATIC(mem_slab, MAX_BLOCK_SIZE, BLOCK_COUNT, 2);

// Flag to interrupt ongoing speaker playback
volatile bool speaker_stop_requested = false;

struct device *audio_speaker;

static void *rx_buffer;
static void *buzz_buffer;
static int16_t *ptr2;
static int16_t *clear_ptr;

static uint16_t current_length;
static uint16_t offset;

// Haptic motor removed — vibration feedback is now via speaker (I2S low-freq buzz).
// D6 (P1.11) haptic_gpio_pin is no longer used.

// Speaker amp enable on D6 (P1.11). MAX98357A (Adafruit 5769) via I2S.
struct gpio_dt_spec speaker_gpio_pin = {.port = DEVICE_DT_GET(DT_NODELABEL(gpio1)),
                                        .pin = 11,
                                        .dt_flags = GPIO_INT_DISABLE};

// ble service
//

static void speaker_ccc_config_changed_handler(const struct bt_gatt_attr *attr, uint16_t value);
static ssize_t speaker_haptic_handler(struct bt_conn *conn,
                                      const struct bt_gatt_attr *attr,
                                      const void *buf,
                                      uint16_t len,
                                      uint16_t offset,
                                      uint8_t flags);

static struct bt_uuid_128 speaker_uuid =
    BT_UUID_INIT_128(BT_UUID_128_ENCODE(0xCAB1AB95, 0x2EA5, 0x4F4D, 0xBB56, 0x874B72CFC984));
static struct bt_uuid_128 speaker_haptic_uuid =
    BT_UUID_INIT_128(BT_UUID_128_ENCODE(0xCAB1AB96, 0x2EA5, 0x4F4D, 0xBB56, 0x874B72CFC984));

static struct bt_gatt_attr speaker_service_attr[] = {
    BT_GATT_PRIMARY_SERVICE(&speaker_uuid),
    BT_GATT_CHARACTERISTIC(&speaker_haptic_uuid.uuid,
                           BT_GATT_CHRC_WRITE | BT_GATT_CHRC_NOTIFY,
                           BT_GATT_PERM_WRITE,
                           NULL,
                           speaker_haptic_handler,
                           NULL),
    BT_GATT_CCC(speaker_ccc_config_changed_handler, BT_GATT_PERM_READ | BT_GATT_PERM_WRITE),
};
static struct bt_gatt_service speaker_service = BT_GATT_SERVICE(speaker_service_attr);

void register_speaker_service()
{
    bt_gatt_service_register(&speaker_service);
}

static void speaker_ccc_config_changed_handler(const struct bt_gatt_attr *attr, uint16_t value)
{
    if (value == BT_GATT_CCC_NOTIFY) {
        LOG_INF("Client subscribed for notifications");
    } else if (value == 0) {
        LOG_INF("Client unsubscribed from notifications");
    } else {
        LOG_ERR("Invalid CCC value: %u", value);
    }
}

static ssize_t speaker_haptic_handler(struct bt_conn *conn,
                                      const struct bt_gatt_attr *attr,
                                      const void *buf,
                                      uint16_t len,
                                      uint16_t offset,
                                      uint8_t flags)
{
    LOG_INF("play the haptic");

    uint8_t value = ((uint8_t *) buf)[0];
    LOG_INF("value %d  ", value);

    if (value < 1 || value > 4) {
        return 0;
    }

    if (value == 1) {
        play_haptic_milli(20);
    } else if (value == 2) {
        play_haptic_milli(50);
    } else if (value == 3) {
        play_haptic_milli(500);
    } else if (value == 4) {
        play_notification_chime();
    }

    return 1;
}

int speaker_init()
{
    printk("[speaker] init start\n");
    audio_speaker = device_get_binding("I2S_0");
    printk("[speaker] device_get_binding returned %p\n", audio_speaker);

    if (!audio_speaker) {
        printk("[speaker] ERROR: I2S_0 device not found!\n");
        return -1;
    }
    if (!device_is_ready(audio_speaker)) {
        printk("[speaker] ERROR: I2S_0 not ready\n");
        return -1;
    }
    printk("[speaker] I2S_0 device ready\n");

    if (gpio_is_ready_dt(&speaker_gpio_pin)) {
        LOG_PRINTK("Speaker Pin ready\n");
    } else {
        LOG_PRINTK("Error setting up speaker Pin\n");
        return -1;
    }
    if (gpio_pin_configure_dt(&speaker_gpio_pin, GPIO_OUTPUT_INACTIVE) < 0) {
        LOG_PRINTK("Error setting up Haptic Pin\n");
        return -1;
    }
    gpio_pin_set_dt(&speaker_gpio_pin, 1);

    struct i2s_config config = {
        .word_size = WORD_SIZE,                       // how long is one left/right word.
        .channels = NUMBER_OF_CHANNELS,               // how many words in a frame 2
        .format = I2S_FMT_DATA_FORMAT_LEFT_JUSTIFIED, // format
        // .format = I2S_FMT_DATA_FORMAT_I2S,
        .options =
            I2S_OPT_FRAME_CLK_MASTER | I2S_OPT_BIT_CLK_MASTER | I2S_OPT_BIT_CLK_GATED, // how to configure the mclock
        .frame_clk_freq = SAMPLE_FREQUENCY,                                            /* Sampling rate */
        .mem_slab = &mem_slab,        /* Memory slab to store rx/tx data */
        .block_size = MAX_BLOCK_SIZE, /* size of ONE memory block in bytes */
        .timeout = 2000, /* 2s timeout — prevents I2S blocking forever if hardware doesn't respond */
    };
    int err = i2s_configure(audio_speaker, I2S_DIR_TX, &config);
    if (err) {
        LOG_ERR("Failed to configure Speaker (%d)", err);
        return -1;
    }
    err = k_mem_slab_alloc(&mem_slab, &rx_buffer, K_MSEC(200));
    if (err) {
        LOG_INF("Failed to allocate memory for speaker%d)", err);
        return -1;
    }

    err = k_mem_slab_alloc(&mem_slab, &buzz_buffer, K_MSEC(200));
    if (err) {
        LOG_INF("Failed to allocate for chime (%d)", err);
        return -1;
    }

    memset(rx_buffer, 0, MAX_BLOCK_SIZE);
    memset(buzz_buffer, 0, MAX_BLOCK_SIZE);

    return 0;
}

uint16_t speak(uint16_t len, const void *buf) // direct from bt
{
    uint16_t amount = 0;
    amount = len;

    // If stop was requested, discard incoming audio data
    if (speaker_stop_requested) {
        current_length = 0;
        offset = 0;
        speaker_stop_requested = false;
        return amount;
    }

    if (len == 4) // if stage 1
    {
        current_length = ((uint32_t *) buf)[0];
        LOG_INF("About to write %u bytes", current_length);
        ptr2 = (int16_t *) rx_buffer;
        clear_ptr = (int16_t *) rx_buffer;
        speaker_stop_requested = false;
    } else { // if not stage 1
        if (current_length > PACKET_SIZE) {
            LOG_INF("Data length: %u", len);
            current_length = current_length - PACKET_SIZE;
            LOG_INF("remaining data: %u", current_length);

            for (int i = 0; i < (int) (len / 2); i++) {
                *ptr2++ = ((int16_t *) buf)[i];
                *ptr2++ = ((int16_t *) buf)[i];
            }
            offset = offset + len;
        } else if (current_length < PACKET_SIZE) {
            LOG_INF("entered the final stretch");
            LOG_INF("Data length: %u", len);
            current_length = current_length - len;
            LOG_INF("remaining data: %u", current_length);
            for (int i = 0; i < len / 2; i++) {
                *ptr2++ = ((int16_t *) buf)[i];
                *ptr2++ = ((int16_t *) buf)[i];
            }
            offset = offset + len;
            LOG_INF("offset: %u", offset);
            offset = 0;
            int res = i2s_write(audio_speaker, rx_buffer, MAX_BLOCK_SIZE);
            if (res < 0) {
                LOG_PRINTK("Failed to write I2S data: %d\n", res);
            }
            i2s_trigger(audio_speaker, I2S_DIR_TX, I2S_TRIGGER_START);
            if (res != 0) {
                LOG_PRINTK("Failed to drain I2S transmission: %d\n", res);
            }
            res = i2s_trigger(audio_speaker, I2S_DIR_TX, I2S_TRIGGER_DRAIN);
            if (res != 0) {
                LOG_PRINTK("Failed to drain I2S transmission: %d\n", res);
            }
            // Wait for playback but allow interruption
            for (int i = 0; i < 40; i++) {  // 40 x 100ms = 4s max
                if (speaker_stop_requested) {
                    i2s_trigger(audio_speaker, I2S_DIR_TX, I2S_TRIGGER_DROP);
                    speaker_stop_requested = false;
                    LOG_INF("Playback interrupted by button");
                    break;
                }
                k_sleep(K_MSEC(100));
            }

            memset(clear_ptr, 0, MAX_BLOCK_SIZE);
        }
    }
    return amount;
}

void generate_gentle_chime(int16_t *buffer, int num_samples)
{
    LOG_INF("Generating gentle chime");                                 // 2500
    const float frequencies[] = {523.25, 659.25, 783.99, 1046.50};      // C5, E5, G5, C6
    const int num_freqs = sizeof(frequencies) / sizeof(frequencies[0]); // 4

    for (int i = 0; i < num_samples; i++) {
        float t = (float) i / SAMPLE_FREQUENCY; // 0.000125
        float sample = 0;
        for (int j = 0; j < num_freqs; j++) {
            sample += sinf(2 * PI * frequencies[j] * t) * (1.0 - t);
        }
        int16_t int_sample = (int16_t) (sample / num_freqs * 32767 * 0.5);
        buffer[i * NUM_CHANNELS] = int_sample;
        buffer[i * NUM_CHANNELS + 1] = int_sample;
    }
    LOG_INF("Done generating gentle chime");
}

int play_boot_sound(void)
{
    int ret;
    int16_t *buffer = (int16_t *) buzz_buffer;
    const int samples_per_block = MAX_BLOCK_SIZE / (NUM_CHANNELS * sizeof(int16_t));

    generate_gentle_chime(buffer, samples_per_block);
    LOG_INF("Writing to speaker");
    k_sleep(K_MSEC(100));
    ret = i2s_write(audio_speaker, buffer, MAX_BLOCK_SIZE);
    if (ret) {
        LOG_ERR("Failed to write initial I2S data: %d", ret);
        return ret;
    }

    ret = i2s_trigger(audio_speaker, I2S_DIR_TX, I2S_TRIGGER_START);
    if (ret) {
        LOG_ERR("Failed to start I2S transmission: %d", ret);
        return ret;
    }

    ret = i2s_trigger(audio_speaker, I2S_DIR_TX, I2S_TRIGGER_DRAIN);
    if (ret != 0) {
        LOG_ERR("Failed to drain I2S transmission: %d", ret);
        return ret;
    }
    k_sleep(K_MSEC(3000));

    return 0;
}

int init_haptic_pin()
{
    // No GPIO haptic motor — feedback is via speaker I2S.
    // Nothing to init; speaker_init() handles I2S setup.
    LOG_INF("Haptic via speaker (no motor)");
    return 0;
}

void play_haptic_milli(uint32_t duration)
{
    if (duration > MAX_HAPTIC_DURATION) {
        LOG_ERR("Duration is too long");
        return;
    }
    if (!audio_speaker || !device_is_ready(audio_speaker)) {
        LOG_WRN("Speaker not ready for haptic buzz");
        return;
    }

    // Generate a low-frequency buzz in buzz_buffer (150 Hz square-ish wave)
    int16_t *buffer = (int16_t *) buzz_buffer;
    const int samples_per_block = MAX_BLOCK_SIZE / (NUM_CHANNELS * sizeof(int16_t));
    // Limit samples to requested duration
    int duration_samples = (SAMPLE_FREQUENCY * duration) / 1000;
    if (duration_samples > samples_per_block) {
        duration_samples = samples_per_block;
    }

    const float freq = 150.0f;  // low rumble frequency
    const float amplitude = 0.8f;
    for (int i = 0; i < samples_per_block; i++) {
        int16_t val = 0;
        if (i < duration_samples) {
            float t = (float) i / SAMPLE_FREQUENCY;
            // Square-ish wave: clipped sine for stronger tactile feel
            float s = sinf(2.0f * PI * freq * t);
            if (s > 0.3f) s = 1.0f;
            else if (s < -0.3f) s = -1.0f;
            else s = s / 0.3f;
            val = (int16_t)(s * 32767.0f * amplitude);
        }
        buffer[i * NUM_CHANNELS] = val;
        buffer[i * NUM_CHANNELS + 1] = val;
    }

    int ret = i2s_write(audio_speaker, buffer, MAX_BLOCK_SIZE);
    if (ret) {
        LOG_ERR("Haptic buzz i2s_write failed: %d", ret);
        return;
    }
    ret = i2s_trigger(audio_speaker, I2S_DIR_TX, I2S_TRIGGER_START);
    if (ret) {
        LOG_ERR("Haptic buzz i2s start failed: %d", ret);
        return;
    }
    i2s_trigger(audio_speaker, I2S_DIR_TX, I2S_TRIGGER_DRAIN);

    // Wait for playback to finish
    uint32_t wait = (duration < 100) ? 200 : duration + 100;
    k_sleep(K_MSEC(wait));
    LOG_INF("Haptic buzz %u ms via speaker", duration);
}

int play_notification_chime(void)
{
    if (!audio_speaker || !device_is_ready(audio_speaker)) {
        LOG_WRN("Speaker not ready for notification chime");
        return -1;
    }

    int16_t *buffer = (int16_t *) buzz_buffer;
    const int samples_per_block = MAX_BLOCK_SIZE / (NUM_CHANNELS * sizeof(int16_t));

    // Short two-note chime: G5 (784 Hz) → C6 (1047 Hz), ~200ms total
    const float freq1 = 783.99f;   // G5
    const float freq2 = 1046.50f;  // C6
    const int half = (SAMPLE_FREQUENCY * 100) / 1000;  // 100ms per note = 800 samples
    const int total = half * 2;  // 200ms total

    for (int i = 0; i < samples_per_block; i++) {
        int16_t val = 0;
        if (i < total) {
            float t = (float) i / SAMPLE_FREQUENCY;
            float freq = (i < half) ? freq1 : freq2;
            // Envelope: quick attack, gentle decay within each note
            int note_i = (i < half) ? i : (i - half);
            float env = 1.0f - 0.5f * ((float) note_i / half);
            val = (int16_t)(sinf(2.0f * PI * freq * t) * 32767.0f * 0.4f * env);
        }
        buffer[i * NUM_CHANNELS] = val;
        buffer[i * NUM_CHANNELS + 1] = val;
    }

    int ret = i2s_write(audio_speaker, buffer, MAX_BLOCK_SIZE);
    if (ret) {
        LOG_ERR("Notification chime i2s_write failed: %d", ret);
        return ret;
    }
    ret = i2s_trigger(audio_speaker, I2S_DIR_TX, I2S_TRIGGER_START);
    if (ret) {
        LOG_ERR("Notification chime i2s start failed: %d", ret);
        return ret;
    }
    i2s_trigger(audio_speaker, I2S_DIR_TX, I2S_TRIGGER_DRAIN);
    k_sleep(K_MSEC(400));
    LOG_INF("Notification chime played");
    return 0;
}

void speaker_stop()
{
    if (!audio_speaker || !device_is_ready(audio_speaker)) return;
    speaker_stop_requested = true;
    // Stop I2S immediately — DROP discards queued data
    i2s_trigger(audio_speaker, I2S_DIR_TX, I2S_TRIGGER_DROP);
    LOG_INF("Speaker playback stopped");
}

void speaker_off()
{

    gpio_pin_set_dt(&speaker_gpio_pin, 0);
}
