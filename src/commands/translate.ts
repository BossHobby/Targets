import { Logger } from '../logger';
import { walk, stringifyTargetWithDma } from '../util';
import { GyroRotation, skipEmpty, target_t } from '../types';
import { findDmaAssignments } from '../dma';
import fs from 'fs';
import path from 'path';

export interface TranslateOptions {
  inputDir: string;
  outputDir: string;
  filter?: string;
  logger: Logger;
}

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
  return parseInt(i2c.substring(3));
}

function parseUART(uart: string) {
  return parseInt(uart.substring(4));
}

function handle(target: target_t, parts: string[]) {
  const map = {
    max7456_spi_instance: () => { },
    
    sdcard_spi_cs_pin: () => ({ nss: parsePin(parts[1]), port: parseSPI(parts[1].substring(0, 4)) }),
    sdcard_spi_instance: () => ({ port: parseSPI(parts[1]), nss: parsePin(parts[1]) }),
    
    flash_cs_pin: () => parsePin(parts[1]),
    flash_spi_instance: () => parseSPI(parts[1]),
    
    gyro_1_cs_pin: () => parsePin(parts[1]),
    gyro_1_spi_instance: () => parseSPI(parts[1]),
    gyro_1_align: () => GYRO_ANGLE_MAP[parseInt(parts[1])],
    
    baro_i2c_instance: () => parseI2C(parts[1]),
    
    mag_i2c_instance: () => parseI2C(parts[1]),
    
    serialrx_uart: () => parseUART(parts[1]),
    msp_uart: () => parseUART(parts[1]),
    gps_uart: () => parseUART(parts[1]),
    
    pinio_pin: () => parsePin(parts[1]),
    
    beeper_pin: () => parsePin(parts[1]),
    
    motor1_pin: () => parsePin(parts[1]),
    motor2_pin: () => parsePin(parts[1]),
    motor3_pin: () => parsePin(parts[1]),
    motor4_pin: () => parsePin(parts[1]),
    motor5_pin: () => parsePin(parts[1]),
    motor6_pin: () => parsePin(parts[1]),
    motor7_pin: () => parsePin(parts[1]),
    motor8_pin: () => parsePin(parts[1]),
    
    led_strip_pin: () => parsePin(parts[1]),
  };

  if (parts[0] == "target_name") {
    target.name = parts[1];
    return;
  }

  if (parts[0] == "board_name") {
    target.manufacturer = parts[1].substring(0, 4).toUpperCase();
    return;
  }

  if (parts[0] == "mcu") {
    target.mcu = mapMCU(parts[1]);
    return;
  }

  if (parts[0] in map) {
    const func = map[parts[0]];
    const value = func();

    if (parts[0].includes("motor") && parts[0].includes("pin")) {
      target.motor_pins.push(value);
      return;
    }

    if (parts[0] == "gyro_1_align") {
      target.gyro_orientation = value;
      return;
    }

    if (parts[0] == "led_strip_pin") {
      target.rgb_led = {
        pin: value,
      };
      return;
    }

    if (parts[0] == "beeper_pin") {
      target.buzzer = {
        pin: value,
      };
      return;
    }

    if (parts[0] == "flash_cs_pin") {
      target.flash = {
        pin: value,
      };
      return;
    }

    if (parts[0] == "flash_spi_instance") {
      if (target.flash) {
        target.flash.port = value;
      }
      return;
    }

    if (parts[0] == "gyro_1_cs_pin") {
      target.gyro = {
        pin: value,
      };
      return;
    }

    if (parts[0] == "gyro_1_spi_instance") {
      if (target.gyro) {
        target.gyro.port = value;
      }
      return;
    }

    if (parts[0] == "baro_i2c_instance") {
      target.baro = {
        port: value,
      };
      return;
    }

    if (parts[0] == "mag_i2c_instance") {
      target.mag = {
        port: value,
      };
      return;
    }

    if (parts[0] == "serialrx_uart") {
      target.serial_ports.push({
        index: value,
        rx: "",
        inverter: "",
      });
      return;
    }

    if (parts[0] == "msp_uart") {
      target.serial_ports.push({
        index: value,
        tx: "",
        inverter: "",
      });
      return;
    }

    if (parts[0] == "gps_uart") {
      target.serial_ports.push({
        index: value,
        inverter: "",
        tx: "",
      });
      return;
    }

    if (parts[0] == "serialrx_uart") {
      target.serial_ports.push({
        index: value,
        rx: "",
        inverter: "",
      });
      return;
    }

    if (parts[0] == "msp_uart") {
      target.serial_ports.push({
        index: value,
        tx: "",
        inverter: "",
      });
      return;
    }

    if (parts[0] == "gyro_1_spi_instance") {
      target.spi_ports.push({
        index: value,
        sck: "",
        mosi: "",
      });
      return;
    }

    if (parts[0] == "gyro_1_spi_instance") {
      target.spi_ports.push({
        index: value,
        miso: "",
        sck: "",
      });
      return;
    }

    if (parts[0] == "gyro_1_spi_instance") {
      target.spi_ports.push({
        index: value,
        mosi: "",
        sck: "",
      });
      return;
    }

    if (parts[0] == "baro_i2c_instance") {
      target.i2c_ports.push({
        index: value,
        sda: "",
      });
      return;
    }

    if (parts[0] == "mag_i2c_instance") {
      target.i2c_ports.push({
        index: value,
        scl: "",
      });
      return;
    }
  }
}

async function translateSingleFile(filename: string, output?: string, outputDir?: string, logger?: Logger): Promise<void> {
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

  if (logger) {
    logger.debug(`Processing ${filename}...`);
  } else {
    console.log(`processing ${filename}...`);
  }
  
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
    const baseDir = outputDir || "staging";
    output = `${baseDir}/${target.manufacturer.toLowerCase()}-${
      target.name
    }.yaml`;
  }
  
  const processedTarget = await findDmaAssignments(skipEmpty(target));
  await fs.promises.writeFile(output, await stringifyTargetWithDma(processedTarget));
}

export async function translateConfigs(options: TranslateOptions): Promise<void> {
  const { inputDir, outputDir, filter, logger } = options;
  
  logger.info(`Translating Betaflight configurations from ${inputDir} to ${outputDir}`);
  
  // Clean and create output directory
  await fs.promises.rm(outputDir, { recursive: true }).catch(() => {});
  await fs.promises.mkdir(outputDir, { recursive: true });
  
  let processedCount = 0;
  let errorCount = 0;
  
  // Process each config.h file
  for await (const f of walk(inputDir)) {
    if (path.basename(f) !== "config.h") {
      continue;
    }
    
    const configDir = path.dirname(f);
    const targetName = path.basename(configDir);
    
    // Apply filter if specified
    if (filter && !targetName.toLowerCase().includes(filter.toLowerCase())) {
      logger.debug(`Skipping ${targetName} (filtered out)`);
      continue;
    }
    
    try {
      logger.debug(`Translating ${targetName}...`);
      await translateSingleFile(f, undefined, outputDir, logger);
      processedCount++;
      logger.debug(`Translated ${targetName} successfully`);
    } catch (error) {
      logger.error(`Failed to translate ${targetName}:`, error.message);
      errorCount++;
    }
  }
  
  if (errorCount > 0) {
    logger.warn(`Translation completed with ${errorCount} errors`);
  } else {
    logger.info(`Translation completed successfully: ${processedCount} targets processed`);
  }
}