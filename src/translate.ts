import fs from "fs";
import readline from "readline";
import { walk } from "./util";
import { stringifyTarget, target_t } from "./types";

const OUTPUT_FOLDER = "staging";

function parsePin(pin: string) {
  const index = parseInt(pin.slice(1));
  return `P${pin[0].toUpperCase()}${index}`;
}

function handleResource(target: target_t, parts: string[]) {
  switch (parts[0]) {
    case "led": {
      const index = parseInt(parts[1]) - 1;
      target.leds[index] = {
        ...(target.leds[index] || { invert: true }),
        pin: parsePin(parts[2]),
      };
      break;
    }
    case "motor": {
      const index = parseInt(parts[1]) - 1;
      switch (index) {
        case 0:
        case 1:
          target.motor_pins[index + 2] = parsePin(parts[2]);
          break;

        case 2:
        case 3:
          target.motor_pins[index - 2] = parsePin(parts[2]);
          break;

        default:
          break;
      }
      break;
    }
    case "inverter": {
      const index = parseInt(parts[1]) - 1;
      target.serial_ports[index] = {
        ...(target.serial_ports[index] || {}),
        index: index + 1,
        inverter: parsePin(parts[2]),
      };
      break;
    }
    case "serial_tx": {
      const index = parseInt(parts[1]) - 1;
      target.serial_ports[index] = {
        ...(target.serial_ports[index] || {}),
        index: index + 1,
        tx: parsePin(parts[2]),
      };
      break;
    }
    case "serial_rx": {
      const index = parseInt(parts[1]) - 1;
      target.serial_ports[index] = {
        ...(target.serial_ports[index] || {}),
        index: index + 1,
        rx: parsePin(parts[2]),
      };
      break;
    }
    case "spi_sck": {
      const index = parseInt(parts[1]) - 1;
      target.spi_ports[index] = {
        ...(target.spi_ports[index] || {}),
        index: index + 1,
        sck: parsePin(parts[2]),
      };
      break;
    }
    case "spi_miso": {
      const index = parseInt(parts[1]) - 1;
      target.spi_ports[index] = {
        ...(target.spi_ports[index] || {}),
        index: index + 1,
        miso: parsePin(parts[2]),
      };
      break;
    }
    case "spi_mosi": {
      const index = parseInt(parts[1]) - 1;
      target.spi_ports[index] = {
        ...(target.spi_ports[index] || {}),
        index: index + 1,
        mosi: parsePin(parts[2]),
      };
      break;
    }
    case "gyro_cs": {
      if (parts[1] != "1") {
        break;
      }
      target.gyro = {
        ...(target.gyro || { port: 0 }),
        nss: parsePin(parts[2]),
      };
      break;
    }
    case "osd_cs": {
      if (parts[1] != "1") {
        break;
      }
      target.osd = {
        ...(target.osd || { port: 0 }),
        nss: parsePin(parts[2]),
      };
      break;
    }
    case "flash_cs": {
      if (parts[1] != "1") {
        break;
      }
      target.flash = {
        ...(target.flash || { port: 0 }),
        nss: parsePin(parts[2]),
      };
      break;
    }
    case "usb_detect": {
      if (parts[1] != "1") {
        break;
      }
      target.usb_detect = parsePin(parts[2]);
      break;
    }
    case "adc_batt": {
      if (parts[1] != "1") {
        break;
      }
      target.vbat = parsePin(parts[2]);
      break;
    }
    case "adc_curr": {
      if (parts[1] != "1") {
        break;
      }
      target.ibat = parsePin(parts[2]);
      break;
    }
    case "beeper": {
      if (parts[1] != "1") {
        break;
      }
      target.buzzer = {
        ...(target.buzzer || { invert: true }),
        pin: parsePin(parts[2]),
      };
      break;
    }
    default:
      console.warn(`unhandled resource ${parts[0]}`);
  }
}

function handleSet(target: target_t, parts: string[]) {
  switch (parts[0]) {
    case "gyro_1_spibus": {
      const port = parseInt(parts[1]);
      target.gyro = {
        ...(target.gyro || { nss: "None" }),
        port,
      };
      break;
    }
    case "max7456_spi_bus": {
      const port = parseInt(parts[1]);
      target.osd = {
        ...(target.osd || { nss: "None" }),
        port,
      };
      break;
    }
    case "flash_spi_bus": {
      const port = parseInt(parts[1]);
      target.flash = {
        ...(target.flash || { nss: "None" }),
        port,
      };
      break;
    }
    case "beeper_inversion": {
      target.buzzer = {
        ...(target.buzzer || { pin: "None" }),
        invert: parts[1] != "off",
      };
      break;
    }
    default:
      console.warn(`unhandled set ${parts[0]}`);
      break;
  }
}

function handle(target: target_t, parts: string[]) {
  switch (parts[0]) {
    case "board_name":
      target.name = parts[1].toLowerCase();
      break;

    case "manufacturer_id":
      target.manufacturer = parts[1].toUpperCase();
      break;

    case "#mcu":
      target.mcu = parts[1].toLowerCase();
      break;

    case "resource":
      handleResource(target, parts.slice(1));
      break;

    case "set":
      handleSet(target, parts.slice(1));
      break;

    case "dma":
    case "timer":
    case "feature":
    case "aux":
    case "led":
    case "rxrange":
    case "serial":
    case "beacon":
    case "beeper":
    case "color":
    case "defaults":
    case "display_name":
    case "map":
    case "mixer":
    case "mode_color":
      // ignore
      break;

    default:
      if (parts[1] == "betaflight") {
        target.mcu = parts[3];
      }
      if (!parts[0].startsWith("#")) {
        console.warn(`unhandled ${parts[0]}`);
      }
      break;
  }
}

async function translate(filename: string) {
  const target: target_t = {
    name: "",
    mcu: "",
    manufacturer: "",
    brushless: true,

    leds: [],
    serial_ports: [],
    spi_ports: [],

    motor_pins: [],

    gyro_orientation: 0,
  };

  const stream = fs.createReadStream(filename);
  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  for await (const raw of rl) {
    const line = raw.trim();
    if (line.length == 0) {
      continue;
    }
    if (line.startsWith("//")) {
      continue;
    }

    const parts = line
      .split(" ")
      .map((l) => l.trim().toLowerCase())
      .filter((l) => l.length != 0 && l != "=");

    handle(target, parts);
  }

  fs.writeFileSync(
    `${OUTPUT_FOLDER}/${target.manufacturer.toLowerCase()}-${target.name}.yaml`,
    stringifyTarget(target)
  );
}

await fs.promises.rm(OUTPUT_FOLDER, { recursive: true }).catch(() => {});
await fs.promises.mkdir(OUTPUT_FOLDER, { recursive: true }).catch(() => {});

const args = process.argv.slice(2);

if (args.length) {
  await translate(args[0]);
} else {
  for await (const f of walk("betaflight/configs/default/")) {
    await translate(f);
  }
}
