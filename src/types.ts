import YAML, { Pair, Scalar } from "yaml";

export type gpio_pins_t = string;

export interface target_led_t {
  pin: gpio_pins_t;
  invert: boolean;
}

export interface target_invert_pin_t {
  pin: gpio_pins_t;
  invert: boolean;
}

export interface target_serial_port_t {
  index: number;
  rx: gpio_pins_t;
  tx: gpio_pins_t;
  inverter: gpio_pins_t;
}

export interface target_spi_port_t {
  index: number;
  miso: gpio_pins_t;
  mosi: gpio_pins_t;
  sck: gpio_pins_t;
}

export interface target_spi_device_t {
  port: number;
  nss: gpio_pins_t;
}

export interface target_rx_spi_device_t {
  port: number;
  nss: gpio_pins_t;
  exti?: gpio_pins_t;
  ant_sel?: gpio_pins_t;
  lna_en?: gpio_pins_t;
  tx_en?: gpio_pins_t;
  busy?: gpio_pins_t;
  busy_exti?: boolean;
  reset?: gpio_pins_t;
}

export interface target_t {
  name: string;
  manufacturer: string;
  mcu: string;
  brushless: boolean;

  leds: target_led_t[];
  serial_ports: target_serial_port_t[];
  serial_soft_ports?: target_serial_port_t[];
  spi_ports: target_spi_port_t[];

  gyro?: target_spi_device_t;
  gyro_orientation: number;
  osd?: target_spi_device_t;
  flash?: target_spi_device_t;
  sdcard?: target_spi_device_t;
  rx_spi?: target_rx_spi_device_t;

  usb_detect?: gpio_pins_t;
  fpv?: gpio_pins_t;
  vbat?: gpio_pins_t;
  ibat?: gpio_pins_t;

  sdcard_detect?: target_invert_pin_t;
  buzzer?: target_invert_pin_t;
  motor_pins: gpio_pins_t[];
}

export const target_keys = [
  "name",
  "manufacturer",
  "mcu",
  "brushless",
  "leds",
  "serial_ports",
  "serial_soft_ports",
  "spi_ports",
  "gyro",
  "gyro_orientation",
  "osd",
  "flash",
  "sdcard",
  "rx_spi",
  "usb_detect",
  "fpv",
  "vbat",
  "ibat",
  "sdcard_detect",
  "buzzer",
  "motor_pins",
  "index",
  "port",
  "nss",
];

function sortMapEntries(
  a: Pair<Scalar, unknown>,
  b: Pair<Scalar, unknown>
): number {
  const aIndex = target_keys.indexOf(a.key.value as string);
  const bIndex = target_keys.indexOf(b.key.value as string);
  if (aIndex == -1 && bIndex == -1) {
    return (a.key.value as string).localeCompare(b.key.value as string);
  }
  if (aIndex == -1) {
    return 1;
  }
  if (bIndex == -1) {
    return -1;
  }
  return aIndex - bIndex;
}

export function stringifyTarget(target: target_t) {
  return YAML.stringify(target, { sortMapEntries });
}
