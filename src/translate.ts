import fs from "fs";
import { walk } from "./util";
import { GyroRotation, skipEmpty, stringifyTarget, target_t } from "./types";
import { findDmaAssigments } from "./dma";
import path from "path";

const OUTPUT_FOLDER = "staging";

const GYRO_ANGLE_MAP = {
  0: GyroRotation.ROTATE_NONE,
  45: GyroRotation.ROTATE_45_CW,
  90: GyroRotation.ROTATE_90_CW,
  135: GyroRotation.ROTATE_45_CW | GyroRotation.ROTATE_90_CW,
  180: GyroRotation.ROTATE_180,
  225: GyroRotation.ROTATE_45_CCW | GyroRotation.ROTATE_90_CCW,
  270: GyroRotation.ROTATE_90_CCW,
  315: GyroRotation.ROTATE_45_CCW,
};

const MCU_MAP = {
  stm32f7x2: "stm32f722",
  stm32g47x: "stm32g473",
  at32f435g: "at32f435",
};

const BLACKLIST = [
  "nucleof722",
  "nucleof446",
  "atstartf435",
  "revo_at",
  "ark_fpv"
];

function mapMCU(mcu: string) {
  if (MCU_MAP[mcu]) {
    return MCU_MAP[mcu];
  } else {
    return mcu;
  }
}

function parsePin(pin: string) {
  return pin.toUpperCase();
}

function parseSPI(spi: string) {
  return parseInt(spi.substring(3));
}

function parseI2C(i2c: string) {
  return parseInt(i2c.substring('I2CDEV_'.length));
}

function handle(target: target_t, parts: string[]) {
  const range = (str: string, min: number, max: number, func) => {
    let result = {};
    for (let i = min; i <= max; i++) {
      result = {
        ...result,
        [str.replace("{i}", i.toString())]: () => func(i),
      };
    }
    return result;
  };
  const multiple = (keys: string[], func) => {
    let result = {};
    for (const key of keys) {
      result = {
        ...result,
        [key]: func,
      };
    }
    return result;
  };

  const handlers = {
    fc_target_mcu: () => (target.mcu = mapMCU(parts[1])),
    board_name: () => (target.name = parts[1].toLowerCase()),
    manufacturer_id: () => (target.manufacturer = parts[1].toUpperCase()),
    default_current_meter_scale: () => (target.ibat_scale = parseInt(parts[1])),
    default_voltage_meter_scale: () => (target.vbat_scale = parseInt(parts[1])),
    led_strip_pin: () => (target.rgb_led = parsePin(parts[1])),
    ...multiple(
      ["adc_vbat_pin", "adc_batt_pin"],
      () => (target.vbat = parsePin(parts[1]))
    ),
    adc_curr_pin: () => (target.ibat = parsePin(parts[1])),
    usb_detect_pin: () => (target.usb_detect = parsePin(parts[1])),
    beeper_pin: () =>
      (target.buzzer = {
        ...(target.buzzer || { invert: false }),
        pin: parsePin(parts[1]),
      }),
    beeper_inverted: () =>
      (target.buzzer = {
        ...(target.buzzer || { pin: "NONE" }),
        invert: true,
      }),
    flash_cs_pin: () =>
      (target.flash = {
        ...(target.flash || { port: 0 }),
        nss: parsePin(parts[1]),
      }),
    flash_spi_instance: () =>
      (target.flash = {
        ...(target.flash || { nss: "NONE" }),
        port: parseSPI(parts[1]),
      }),
    ...multiple(
      ["max7456_cs_pin", "max7456_spi_cs_pin"],
      () =>
        (target.osd = {
          ...(target.osd || { port: 0 }),
          nss: parsePin(parts[1]),
        })
    ),
    max7456_spi_instance: () => {
      target.osd = {
        ...(target.osd || { nss: "NONE" }),
        port: parseSPI(parts[1]),
      };
    },
    sdcard_spi_cs_pin: () =>
      (target.sdcard = {
        ...(target.sdcard || { port: 0 }),
        nss: parsePin(parts[1]),
      }),
    sdcard_spi_instance: () =>
      (target.sdcard = {
        ...(target.sdcard || { nss: "NONE" }),
        port: parseSPI(parts[1]),
      }),
    sdcard_detect_pin: () =>
      (target.sdcard_detect = {
        ...(target.sdcard_detect || { invert: false }),
        pin: parsePin(parts[1]),
      }),
    sdcard_detect_inverted: () =>
      (target.sdcard_detect = {
        ...(target.sdcard_detect || { pin: "NONE" }),
        invert: parts[1] != "off",
      }),
    gyro_1_cs_pin: () =>
      (target.gyro = {
        ...(target.gyro || { port: 0 }),
        nss: parsePin(parts[1]),
      }),
    gyro_1_exti_pin: () =>
      (target.gyro = {
        ...(target.gyro || { port: 0, nss: "NONE" }),
        exti: parsePin(parts[1]),
      }),
    gyro_1_spi_instance: () =>
      (target.gyro = {
        ...(target.gyro || { nss: "NONE" }),
        port: parseSPI(parts[1]),
      }),
    gyro_1_align: () => {
      const regex = /CW(\d+)_DEG(\w*)/gi;
      const matches = regex.exec(parts[1]);
      if (!matches) {
        return;
      }

      const angle = parseInt(matches[1]);
      let orientation = GYRO_ANGLE_MAP[angle];
      if (matches[2] == "_flip") {
        orientation |= GyroRotation.FLIP_180;
      }
      target.gyro_orientation = orientation;
    },
    baro_i2c_instance: () => {
      target.baro = {
        ...(target.baro),
        port: parseI2C(parts[1]),
      }
    },
    ...range("led{i}_pin", 0, 2, (index: number) => {
      target.leds[index] = {
        ...(target.leds[index] || { invert: true }),
        pin: parsePin(parts[1]),
      };
    }),
    ...range("led{i}_inverted", 0, 2, (index: number) => {
      target.leds[index] = {
        ...(target.leds[index] || { pin: "NONE" }),
        invert: true,
      };
    }),
    ...range("motor{i}_pin", 1, 4, (index: number) => {
      index -= 1;
      target.motor_pins[index < 2 ? index + 2 : index - 2] = parsePin(parts[1]);
    }),
    ...range("uart{i}_rx_pin", 1, 10, (index: number) => {
      target.serial_ports[index - 1] = {
        ...(target.serial_ports[index - 1] || {}),
        index: index,
        rx: parsePin(parts[1]),
      };
    }),
    ...range("uart{i}_tx_pin", 1, 10, (index: number) => {
      target.serial_ports[index - 1] = {
        ...(target.serial_ports[index - 1] || {}),
        index: index,
        tx: parsePin(parts[1]),
      };
    }),
    ...range("inverter_pin_uart{i}", 1, 10, (index: number) => {
      target.serial_ports[index - 1] = {
        ...(target.serial_ports[index - 1] || {}),
        index: index,
        inverter: parsePin(parts[1]),
      };
    }),
    ...range("softserial{i}_rx_pin", 1, 10, (index: number) => {
      target.serial_soft_ports[index - 1] = {
        ...(target.serial_soft_ports[index - 1] || {}),
        index: index,
        rx: parsePin(parts[1]),
      };
    }),
    ...range("softserial{i}_tx_pin", 1, 10, (index: number) => {
      target.serial_soft_ports[index - 1] = {
        ...(target.serial_soft_ports[index - 1] || {}),
        index: index,
        tx: parsePin(parts[1]),
      };
    }),
    ...range("spi{i}_sck_pin", 1, 6, (index: number) => {
      target.spi_ports[index - 1] = {
        ...(target.spi_ports[index - 1] || {}),
        index: index,
        sck: parsePin(parts[1]),
      };
    }),
    ...range("spi{i}_sdi_pin", 1, 6, (index: number) => {
      target.spi_ports[index - 1] = {
        ...(target.spi_ports[index - 1] || {}),
        index: index,
        miso: parsePin(parts[1]),
      };
    }),
    ...range("spi{i}_sdo_pin", 1, 6, (index: number) => {
      target.spi_ports[index - 1] = {
        ...(target.spi_ports[index - 1] || {}),
        index: index,
        mosi: parsePin(parts[1]),
      };
    }),
    ...range("i2c{i}_sda_pin", 1, 6, (index: number) => {
      target.i2c_ports[index - 1] = {
        ...(target.i2c_ports[index - 1] || {}),
        index: index,
        sda: parsePin(parts[1]),
      };
    }),
    ...range("i2c{i}_scl_pin", 1, 6, (index: number) => {
      target.i2c_ports[index - 1] = {
        ...(target.i2c_ports[index - 1] || {}),
        index: index,
        scl: parsePin(parts[1]),
      };
    }),
  };

  const handler = handlers[parts[0]];
  if (handler) {
    return handler(parts);
  }

  //console.log(`unhandled ${parts[0]}`);
}

async function translate(filename: string, output?: string) {
  const target: target_t = {
    name: "",
    mcu: "",
    manufacturer: "",
    brushless: true,

    leds: [],
    serial_ports: [],
    serial_soft_ports: [],
    spi_ports: [],
    i2c_ports: [],

    motor_pins: [],

    gyro_orientation: 0,
  };

  console.log(`processing ${filename}...`);
  const content = (await fs.promises.readFile(filename, { encoding: "utf8" }))
    .replace(/\/\*(.|\s)*?\*\//gm, "")
    .replace(/\/\/.*/gm, "")
    .replace(/\\r?\n/gm, "");

  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length && l.startsWith("#define"));
  for (const l of lines) {
    let start = 0;
    let line = "" + l;
    let blocked = false;

    let parts: string[] = [];
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c == "(") blocked = true;
      if (!blocked && /\s/.test(c)) {
        parts.push(line.substring(start, i));
        while (/\s/.test(line[i])) i++;
        start = i;
      }
      if (c == ")") blocked = false;
    }
    parts.push(line.substring(start, line.length));
    parts = parts.slice(1).map((p) => p.trim().toLowerCase());

    handle(target, parts);
  }

  if (BLACKLIST.includes(target.name)) {
    return;
  }

  if (!output) {
    output = `${OUTPUT_FOLDER}/${target.manufacturer.toLowerCase()}-${
      target.name
    }.yaml`;
  }
  await fs.promises.writeFile(output, stringifyTarget(findDmaAssigments(skipEmpty(target))));
}

const args = process.argv.slice(2);

if (args.length) {
  await translate(args[0], args[1]);
} else {
  await fs.promises.rm(OUTPUT_FOLDER, { recursive: true }).catch(() => {});
  await fs.promises.mkdir(OUTPUT_FOLDER, { recursive: true }).catch(() => {});

  for await (const f of walk("betaflight/configs/")) {
    if (path.basename(f) == "config.h") {
      await translate(f);
    }
  }
}
