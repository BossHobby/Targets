import fs from "fs";
import path from "path";
import YAML from "yaml";
import { target_defaults_t, target_t } from "./types";

const MCU_MAP = {
  stm32f7x2: "stm32f722",
  stm32g47x: "stm32g473",
  at32f435g: "at32f435",
};

export function mapMCU(mcu: string) {
  return MCU_MAP[mcu] || mcu;
}

export function stripConfigComments(content: string) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*/gm, "");
}

export interface defaults_review_entry_t {
  define: string;
  value: string;
}

export interface defaults_extraction_t {
  defaults?: target_defaults_t;
  review: defaults_review_entry_t[];
  diagnostics: string[];
}

// Betaflight config.h definitions mapped to QUICKSILVER serial roles.
// Port numbers are never copied from Betaflight enum values; the UART name is
// parsed explicitly and re-numbered to QUICKSILVER conventions (soft serial 101+).
const PORT_DEFINES: Record<string, "rx" | "smart_audio" | "hdzero" | "gps"> = {
  serialrx_uart: "rx",
  vtx_smartaudio_uart: "smart_audio",
  vtx_tramp_uart: "smart_audio",
  msp_displayport_uart: "hdzero",
  gps_uart: "gps",
};

const PROVIDER_MAP: Record<string, "crsf" | "sbus"> = {
  serialrx_crsf: "crsf",
  serialrx_sbus: "sbus",
};

export function parsePort(value: string): number | undefined {
  const port = /^serial_port_(?:usart|uart)(\d+)$/.exec(value);
  if (port) {
    return parseInt(port[1]);
  }
  const soft = /^serial_port_softserial(\d+)$/.exec(value);
  if (soft) {
    return 100 + parseInt(soft[1]);
  }
  return undefined;
}

// Extract serial/receiver/vtx defaults from a comment-stripped Betaflight
// config.h. Only unconditional definitions are imported; anything under a
// preprocessor conditional (or defined conflictingly) is returned in `review`
// for a human to resolve. Unsupported values are reported, never guessed.
export function extractDefaults(content: string): defaults_extraction_t {
  const unconditional = new Map<string, string[]>();
  const conditional = new Map<string, string[]>();

  let depth = 0;
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith("#")) {
      continue;
    }
    const directive = line.substring(1).trim();
    if (/^(?:if|ifdef|ifndef)\b/.test(directive)) {
      depth++;
      continue;
    }
    if (/^endif\b/.test(directive)) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    const match = /^define\s+(\S+)(?:\s+(\S+))?/.exec(directive);
    if (!match) {
      continue;
    }
    const name = match[1].toLowerCase();
    if (name !== "serialrx_provider" && !(name in PORT_DEFINES)) {
      continue;
    }
    const value = (match[2] || "").toLowerCase();
    const bucket = depth > 0 ? conditional : unconditional;
    if (!bucket.has(name)) {
      bucket.set(name, []);
    }
    bucket.get(name)!.push(value);
  }

  const extraction: defaults_extraction_t = { review: [], diagnostics: [] };

  // A define is importable only as a single, unconditional occurrence.
  // Conditional twins of an unconditional define are conflicts, not overrides.
  const resolve = (name: string): string | undefined => {
    const cond = conditional.get(name) || [];
    const unc = unconditional.get(name) || [];
    if (cond.length > 0 || new Set(unc).size > 1) {
      for (const value of [...unc, ...cond]) {
        extraction.review.push({ define: name, value });
      }
      return undefined;
    }
    return unc[0];
  };

  const serial: Record<string, number> = {};
  let vtx: target_defaults_t["vtx"];
  for (const [name, role] of Object.entries(PORT_DEFINES)) {
    const value = resolve(name);
    if (value === undefined) {
      continue;
    }
    const port = parsePort(value);
    if (port === undefined) {
      extraction.diagnostics.push(`${name}=${value}: unsupported serial port, skipping`);
      continue;
    }
    if (serial[role] !== undefined && serial[role] !== port) {
      extraction.diagnostics.push(
        `${name}=${value}: conflicting ${role} port (already ${serial[role]}), skipping`
      );
      continue;
    }
    if (serial[role] === port) {
      extraction.diagnostics.push(
        `${name}=${value}: duplicate ${role} assignment on port ${port} (shared port allowed, verify)`
      );
    }
    serial[role] = port;
    if (name === "vtx_smartaudio_uart") {
      vtx = { protocol: "smart_audio" };
    }
    if (name === "vtx_tramp_uart") {
      vtx = { protocol: "tramp" };
    }
  }

  let receiver: target_defaults_t["receiver"];
  const provider = resolve("serialrx_provider");
  if (provider !== undefined) {
    const protocol = PROVIDER_MAP[provider];
    if (protocol) {
      receiver = { protocol };
    } else {
      extraction.diagnostics.push(
        `serialrx_provider=${provider}: unsupported provider, skipping`
      );
    }
  }

  if (Object.keys(serial).length > 0 || receiver || vtx) {
    extraction.defaults = {};
    if (Object.keys(serial).length > 0) {
      extraction.defaults.serial = {
        ...(serial.rx !== undefined ? { rx: serial.rx } : {}),
        ...(serial.smart_audio !== undefined ? { smart_audio: serial.smart_audio } : {}),
        ...(serial.hdzero !== undefined ? { hdzero: serial.hdzero } : {}),
        ...(serial.gps !== undefined ? { gps: serial.gps } : {}),
      };
    }
    if (receiver) {
      extraction.defaults.receiver = receiver;
    }
    if (vtx) {
      extraction.defaults.vtx = vtx;
    }
  }

  return extraction;
}

export type gpio_af_t = Record<
  string,
  { tag: { type: string; index: number; func?: string } }[]
>;

// Hardware serial indexes supported by the firmware serial_ports_t enum per
// MCU. Silicon capabilities differ (e.g. F411 USART6, H7 UART6); ports the
// firmware cannot address must not receive defaults.
const MCU_SERIAL_PORTS: Record<string, number[]> = {
  stm32f411: [1, 2],
  stm32g473: [1, 2, 3, 4, 5],
  stm32f405: [1, 2, 3, 4, 5, 6],
  stm32f722: [1, 2, 3, 4, 5, 6, 7, 8],
  stm32f745: [1, 2, 3, 4, 5, 6, 7, 8],
  stm32f765: [1, 2, 3, 4, 5, 6, 7, 8],
  stm32h743: [1, 2, 3, 4, 5, 7, 8],
  at32f435: [1, 2, 3, 4, 5, 6, 7, 8],
};

// Required pin direction per serial role, following the firmware serial_init
// call sites: rx needs an rx pin; smart_audio/hdzero/gps transmit on tx.
const ROLE_PINS: Record<string, "rx" | "tx"> = {
  rx: "rx",
  smart_audio: "tx",
  hdzero: "tx",
  gps: "tx",
};

export interface defaults_validation_t {
  defaults?: target_defaults_t;
  diagnostics: string[];
}

// Resolve extracted defaults against the actual target hardware. Ports must
// exist in the target's serial ports with the required pin and be valid for
// the MCU; anything else is dropped with a diagnostic. Shared ports between
// roles are reported but allowed (CRSF VTX sharing is a supported firmware case).
export function validateDefaults(
  target: target_t,
  defaults: target_defaults_t,
  gpio?: gpio_af_t
): defaults_validation_t {
  const diagnostics: string[] = [];
  const serial: Record<string, number> = { ...(defaults.serial || {}) };

  const portLabel = (port: number) =>
    port >= 100 ? `soft serial ${port - 100}` : `UART${port}`;

  const claimed = new Map<number, string>();
  for (const [role, pin] of Object.entries(ROLE_PINS)) {
    const port = serial[role];
    if (port === undefined) {
      continue;
    }
    const soft = port >= 100;
    const index = soft ? port - 100 : port;
    const entry = (soft ? target.serial_soft_ports : target.serial_ports)
      ?.filter((p) => p)
      .find((p) => p.index === index);
    if (!entry) {
      diagnostics.push(`serial.${role}: ${portLabel(port)} not present on target, skipping`);
      delete serial[role];
      continue;
    }
    if (!soft) {
      const allowed = MCU_SERIAL_PORTS[mapMCU(target.mcu)];
      if (allowed && !allowed.includes(port)) {
        diagnostics.push(
          `serial.${role}: ${portLabel(port)} is not a valid serial port on ${target.mcu}, skipping`
        );
        delete serial[role];
        continue;
      }
    }
    if (!entry[pin] || entry[pin] === "NONE") {
      diagnostics.push(
        `serial.${role}: ${portLabel(port)} lacks required ${pin} pin, skipping`
      );
      delete serial[role];
      continue;
    }
    if (gpio) {
      const hasFunc = Object.values(gpio).some((afs) =>
        afs.some(
          (af) =>
            af.tag.type === "serial" &&
            af.tag.index === index &&
            af.tag.func === pin
        )
      );
      if (!hasFunc) {
        diagnostics.push(
          `serial.${role}: ${portLabel(port)} has no ${pin} function on ${target.mcu}, skipping`
        );
        delete serial[role];
        continue;
      }
    }
    const other = claimed.get(port);
    if (other) {
      diagnostics.push(
        `serial.${role}: shares ${portLabel(port)} with serial.${other} (allowed, verify)`
      );
    } else {
      claimed.set(port, role);
    }
  }

  let receiver = defaults.receiver;
  if (receiver && serial.rx === undefined) {
    diagnostics.push(
      `receiver.protocol=${receiver.protocol}: no valid serial rx port, skipping (autodetection preserved)`
    );
    receiver = undefined;
  }

  let vtx = defaults.vtx;
  if (vtx && serial.smart_audio === undefined) {
    diagnostics.push(`vtx.protocol=${vtx.protocol}: no valid smart_audio port, skipping`);
    vtx = undefined;
  }

  const result: target_defaults_t = {};
  if (Object.keys(serial).length > 0) {
    result.serial = {
      ...(serial.rx !== undefined ? { rx: serial.rx } : {}),
      ...(serial.smart_audio !== undefined ? { smart_audio: serial.smart_audio } : {}),
      ...(serial.hdzero !== undefined ? { hdzero: serial.hdzero } : {}),
      ...(serial.gps !== undefined ? { gps: serial.gps } : {}),
    };
  }
  if (receiver) {
    result.receiver = receiver;
  }
  if (vtx) {
    result.vtx = vtx;
  }

  return {
    defaults:
      Object.keys(result).length > 0 ? result : undefined,
    diagnostics,
  };
}

const gpioCache = new Map<string, gpio_af_t | undefined>();

export async function loadMcuGpio(mcu: string): Promise<gpio_af_t | undefined> {
  const mapped = mapMCU(mcu);
  if (!gpioCache.has(mapped)) {
    try {
      gpioCache.set(
        mapped,
        YAML.parse(
          await fs.promises.readFile(path.join("mcu", mapped, "gpio.yaml"), "utf8")
        )
      );
    } catch {
      gpioCache.set(mapped, undefined);
    }
  }
  return gpioCache.get(mapped);
}

export function parseBoardIdentity(content: string) {
  const find = (name: string) =>
    new RegExp(`^#define\\s+${name}\\s+(\\S+)`, "m").exec(content)?.[1];
  return {
    mcu: mapMCU((find("FC_TARGET_MCU") || "").toLowerCase()),
    name: find("BOARD_NAME")?.toLowerCase(),
    manufacturer: find("MANUFACTURER_ID")?.toUpperCase(),
  };
}

// Render the defaults block in contract order (serial, receiver, vtx) for
// surgical insertion into a target file.
export function renderDefaults(defaults: target_defaults_t): string {
  let out = "defaults:\n";
  if (defaults.serial) {
    out += "  serial:\n";
    for (const key of ["rx", "smart_audio", "hdzero", "gps"] as const) {
      if (defaults.serial[key] !== undefined) {
        out += `    ${key}: ${defaults.serial[key]}\n`;
      }
    }
  }
  if (defaults.receiver) {
    out += `  receiver:\n`;
    out += `    protocol: ${defaults.receiver.protocol}\n`;
  }
  if (defaults.vtx) {
    out += `  vtx:\n`;
    out += `    protocol: ${defaults.vtx.protocol}\n`;
  }
  return out;
}
