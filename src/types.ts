import YAML, { Pair, Scalar } from "yaml";

export enum GyroRotation {
  ROTATE_NONE = 0x0,
  ROTATE_45_CCW = 0x1,
  ROTATE_45_CW = 0x2,
  ROTATE_90_CW = 0x4,
  ROTATE_90_CCW = 0x8,
  ROTATE_180 = 0x10,
  FLIP_180 = 0x20,
}

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

export interface target_i2c_port_t {
  index: number;
  sda: gpio_pins_t;
  scl: gpio_pins_t;
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

export interface target_i2c_device_t {
  port: number;
}

export interface target_gyro_spi_device_t {
  port: number;
  nss: gpio_pins_t;
  exti?: gpio_pins_t;
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

export interface target_dma_assignment_t {
  tag: string;
  dma: string;
  channel?: number;
}

export interface target_t {
  name: string;
  manufacturer: string;
  mcu: string;
  alias?: string[];
  brushless: boolean;

  leds: target_led_t[];
  serial_ports: target_serial_port_t[];
  serial_soft_ports: target_serial_port_t[];
  spi_ports: target_spi_port_t[];
  i2c_ports: target_i2c_port_t[];

  gyro?: target_gyro_spi_device_t;
  gyro_orientation: number;
  osd?: target_spi_device_t;
  flash?: target_spi_device_t;
  sdcard?: target_spi_device_t;
  rx_spi?: target_rx_spi_device_t;

  baro?: target_i2c_device_t;

  usb_detect?: gpio_pins_t;
  fpv?: gpio_pins_t;
  vbat?: gpio_pins_t;
  ibat?: gpio_pins_t;
  rgb_led?: gpio_pins_t;

  sdcard_detect?: target_invert_pin_t;
  buzzer?: target_invert_pin_t;
  motor_pins: gpio_pins_t[];

  vbat_scale?: number;
  ibat_scale?: number;
  
  dma?: Record<string, target_dma_assignment_t>;
  timers?: any[];
}

export const target_keys = [
  "name",
  "manufacturer",
  "mcu",
  "alias",
  "brushless",
  "leds",
  "serial_ports",
  "serial_soft_ports",
  "spi_ports",
  "i2c_ports",
  "gyro",
  "gyro_orientation",
  "osd",
  "flash",
  "sdcard",
  "rx_spi",
  "usb_detect",
  "fpv",
  "vbat",
  "vbat_scale",
  "ibat",
  "ibat_scale",
  "rgb_led",
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

export function skipEmpty(val: any) {
  if (val === undefined) {
    return undefined;
  }
  if (val === "NONE") {
    return undefined;
  }
  if (Array.isArray(val)) {
    for (let i = val.length - 1; i >= 0; i--) {
      val[i] = skipEmpty(val[i]);
      if (val[i] === undefined) {
        val.splice(i, 1);
      }
    }
    if (val.length == 0) {
      return undefined;
    }
  }
  if (Object.getPrototypeOf(val) === Object.prototype) {
    const keys = Object.keys(val);
    for (let i = keys.length - 1; i >= 0; i--) {
      val[keys[i]] = skipEmpty(val[keys[i]]);
      if (val[keys[i]] === undefined) {
        delete val[keys[i]];
      }
    }
    if (Object.keys(val).length == 0) {
      return undefined;
    }
  }
  return val;
}

export function stringifyTarget(target: target_t) {
  return YAML.stringify(skipEmpty(target), { sortMapEntries });
}
