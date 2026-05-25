/* Stub for storage functions when CONFIG_OMI_ENABLE_OFFLINE_STORAGE is disabled */
#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>

bool storage_is_on = false;
int write_to_file(uint8_t *data, size_t size) { return -1; }
int get_file_size(void) { return 0; }
int get_offset(void) { return 0; }
int storage_init(void) { return 0; }
bool is_sd_on(void) { return false; }
int mount_sd_card(void) { return -1; }

/* file_num_array stub */
int file_num_array[10] = {0};

#include <zephyr/bluetooth/gatt.h>
/* Empty storage BLE service stub */
static struct bt_gatt_attr storage_stub_attrs[] = {};
struct bt_gatt_service storage_service = BT_GATT_SERVICE(storage_stub_attrs);
