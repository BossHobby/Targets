import { stripConfigComments } from "./defaults";
import { target_pinio_t, target_t } from "./types";

export function validatePinio(target: target_t): void {
  if (!target.pinio) return;
  if (!Array.isArray(target.pinio) || target.pinio.length > 4 ||
      new Set(target.pinio.map(output => output.pin)).size !== target.pinio.length) {
    throw new Error(`invalid PINIO outputs on target ${target.name}`);
  }
  for (const output of target.pinio) {
    if (!/^P[A-K](?:[0-9]|1[0-5])$/.test(output.pin) || typeof output.label !== "string" || !output.label.trim() ||
        Buffer.byteLength(output.label) >= 32 ||
        (output.description !== undefined && (typeof output.description !== "string" || Buffer.byteLength(output.description) >= 96)) ||
        (output.invert !== undefined && typeof output.invert !== "boolean")) {
      throw new Error(`invalid PINIO entry on target ${target.name}`);
    }
  }

  const pins = new Set(target.pinio.map(output => output.pin));
  const check = (value: unknown, path: string): void => {
    if (typeof value === "string" && pins.has(value)) {
      throw new Error(`PINIO pin ${value} conflicts with ${path} on target ${target.name}`);
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => check(entry, `${path}[${index}]`));
    } else if (value && typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) check(entry, `${path}.${key}`);
    }
  };
  // Legacy fpv deliberately duplicates PINIO. Metadata and DMA tags do not
  // claim GPIO pins; every other target field describes hardware resources.
  for (const [key, value] of Object.entries(target)) {
    if (!["pinio", "fpv", "name", "manufacturer", "mcu", "defaults", "dma"].includes(key)) check(value, key);
  }
}

// Betaflight drivers/pinio.h: push-pull mode is 1; bit 7 inverts the output.
// Names belong to USER boxes (permanent IDs 40–43), not PINIO slot numbers.
export function extractPinio(content: string): target_pinio_t[] {
  const definitions = new Map<string, string>();
  let depth = 0;
  for (const line of stripConfigComments(content).split(/\r?\n/)) {
    if (/^\s*#\s*(if|ifdef|ifndef)\b/.test(line)) depth++;
    if (/^\s*#\s*endif\b/.test(line)) depth--;
    const match = /^\s*#define\s+(\w+)\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const [, name, value] = match;
    if (/^(PINIO\d+_(PIN|CONFIG|BOX)|BOX_USER\d+_NAME)$/.test(name)) {
      if (depth || (definitions.has(name) && definitions.get(name) !== value)) {
        throw new Error(`ambiguous PINIO definition: ${name}`);
      }
    }
    definitions.set(name, value);
  }

  const resolve = (value: string): string => {
    const visited = new Set<string>();
    while (definitions.has(value) && !visited.has(value)) {
      visited.add(value);
      value = definitions.get(value)!;
    }
    return value;
  };
  const parseConfig = (value: string): number => {
    let config = 0;
    for (const part of resolve(value).replace(/[()]/g, "").split("|")) {
      const token = resolve(part.trim());
      const numeric = token === "PINIO_CONFIG_MODE_OUT_PP" ? 1
        : token === "PINIO_CONFIG_OUT_INVERTED" ? 128
        : /^(?:0x[0-9a-f]+|\d+)$/i.test(token) ? Number(token) : NaN;
      if (!Number.isInteger(numeric) || numeric < 0 || numeric > 255)
        throw new Error(`unsupported PINIO config: ${value}`);
      config |= numeric;
    }
    if ((config & 0x7f) !== 1) throw new Error(`unsupported PINIO mode: ${value}`);
    return config;
  };

  const outputs: target_pinio_t[] = [];
  for (let i = 1; i <= 4; i++) {
    const pin = resolve(definitions.get(`PINIO${i}_PIN`) || "NONE");
    if (pin === "NONE") continue;
    if (!/^P[A-K](?:[0-9]|1[0-5])$/.test(pin)) throw new Error(`invalid PINIO${i} pin: ${pin}`);
    if (outputs.some(output => output.pin === pin)) throw new Error(`duplicate PINIO pin: ${pin}`);
    const config = parseConfig(definitions.get(`PINIO${i}_CONFIG`) || "1");
    const box = Number(definitions.get(`PINIO${i}_BOX`));
    const name = box >= 40 && box <= 43 ? definitions.get(`BOX_USER${box - 39}_NAME`) : undefined;
    const label = name ? JSON.parse(name) : `PINIO ${i}`;
    if (typeof label !== "string" || !label.trim() || Buffer.byteLength(label) >= 32)
      throw new Error(`invalid PINIO${i} label: ${name}`);
    outputs.push({ pin, label, invert: (config & 0x80) !== 0 });
  }
  return outputs;
}
