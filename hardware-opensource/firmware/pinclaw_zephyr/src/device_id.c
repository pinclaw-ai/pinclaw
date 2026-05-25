#include "device_id.h"

#include <stdio.h>
#include <string.h>
#include <zephyr/drivers/flash.h>
#include <zephyr/fs/nvs.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/storage/flash_map.h>

LOG_MODULE_REGISTER(device_id, CONFIG_LOG_DEFAULT_LEVEL);

#define NVS_DEVICE_ID_KEY 1
#define BLE_NAME_MAX_LEN  20

static struct nvs_fs nvs;
static char ble_name[BLE_NAME_MAX_LEN];
static uint8_t ble_name_len;
static uint16_t device_number;

static void build_name(uint16_t num)
{
    device_number = num;
    if (num > 0 && num <= 999) {
        ble_name_len = snprintf(ble_name, sizeof(ble_name), "Pinclaw %03d", num);
    } else {
        ble_name_len = snprintf(ble_name, sizeof(ble_name), "Pinclaw");
    }
}

int device_id_init(void)
{
    const struct flash_area *fa;
    int rc = flash_area_open(FIXED_PARTITION_ID(storage_partition), &fa);
    if (rc) {
        LOG_ERR("Flash area open failed: %d", rc);
        build_name(0);
        return rc;
    }

    nvs.flash_device = fa->fa_dev;
    nvs.offset = fa->fa_off;
    nvs.sector_size = 4096;  // nRF52840 flash page size
    nvs.sector_count = 2;    // 8KB for NVS (plenty for device ID)
    flash_area_close(fa);

    rc = nvs_mount(&nvs);
    if (rc) {
        LOG_ERR("NVS mount failed: %d", rc);
        build_name(0);
        return rc;
    }
    LOG_INF("NVS mounted");

    // Read stored device number
    uint16_t stored = 0;
    rc = nvs_read(&nvs, NVS_DEVICE_ID_KEY, &stored, sizeof(stored));
    if (rc > 0) {
        build_name(stored);
        LOG_INF("Device ID loaded: %d → \"%s\"", stored, ble_name);
    } else {
        build_name(0);
        LOG_INF("No device ID stored, using default name \"%s\"", ble_name);
    }

    return 0;
}

const char *device_id_get_name(void)
{
    return ble_name;
}

uint8_t device_id_get_name_len(void)
{
    return ble_name_len;
}

uint16_t device_id_get_number(void)
{
    return device_number;
}

int device_id_set(uint16_t number)
{
    int rc = nvs_write(&nvs, NVS_DEVICE_ID_KEY, &number, sizeof(number));
    if (rc < 0) {
        LOG_ERR("NVS write failed: %d", rc);
        return rc;
    }

    build_name(number);
    LOG_INF("Device ID set: %d → \"%s\"", number, ble_name);
    return 0;
}
