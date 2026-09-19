import fs from "fs";
import path from "path";
import YAML from "yaml";
import { walk } from "./util";
import { target_t } from "./types";
import {
  defaults_review_entry_t,
  extractDefaults,
  loadMcuGpio,
  parseBoardIdentity,
  renderDefaults,
  stripConfigComments,
  validateDefaults,
} from "./defaults";

const CONFIGS = process.argv[2] || "betaflight/configs";

const modified: string[] = [];
const skipped: string[] = [];
const diagnostics = new Map<string, string[]>();
const review = new Map<string, defaults_review_entry_t[]>();

function insertDefaultsBlock(text: string, block: string): string {
  const lines = text.split("\n");
  const mcuIndex = lines.findIndex((l) => /^mcu:\s*\S/.test(l));
  if (mcuIndex === -1) {
    throw new Error("no mcu line found");
  }
  lines.splice(mcuIndex + 1, 0, ...block.replace(/\n$/, "").split("\n"));
  return lines.join("\n");
}

function removeDefaultsBlock(text: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^defaults:\s*$/.test(l));
  if (start === -1) {
    return text;
  }
  let end = start + 1;
  while (
    end < lines.length &&
    (lines[end].startsWith("  ") || lines[end].trim() === "")
  ) {
    end++;
  }
  lines.splice(start, end - start);
  return lines.join("\n");
}

for await (const file of walk(CONFIGS)) {
  if (path.basename(file) !== "config.h") {
    continue;
  }
  const content = stripConfigComments(
    await fs.promises.readFile(file, { encoding: "utf8" })
  );
  if (
    !/^\s*#define\s+(?:SERIALRX_UART|SERIALRX_PROVIDER|VTX_SMARTAUDIO_UART|VTX_TRAMP_UART|MSP_DISPLAYPORT_UART|GPS_UART)\b/m.test(
      content
    )
  ) {
    continue;
  }

  const extraction = extractDefaults(content);
  if (
    !extraction.defaults &&
    extraction.review.length === 0 &&
    extraction.diagnostics.length === 0
  ) {
    continue;
  }

  const board = path.basename(path.dirname(file)).toLowerCase();
  if (extraction.diagnostics.length > 0) {
    diagnostics.set(board, extraction.diagnostics);
  }
  if (extraction.review.length > 0) {
    review.set(board, extraction.review);
  }
  if (!extraction.defaults) {
    continue;
  }

  const identity = parseBoardIdentity(content);
  if (!identity.name || !identity.manufacturer) {
    skipped.push(`${board}: could not determine board identity`);
    continue;
  }
  const targetFile = path.join(
    "targets",
    `${identity.manufacturer.toLowerCase()}-${identity.name}.yaml`
  );
  if (!(await fs.promises.stat(targetFile).catch(() => false))) {
    skipped.push(`${board}: no production target ${targetFile}`);
    continue;
  }

  const text = await fs.promises.readFile(targetFile, "utf8");
  const target = YAML.parse(text) as target_t;
  const hasDefaults = target.defaults !== undefined && target.defaults !== null;

  const validated = validateDefaults(
    target,
    extraction.defaults,
    await loadMcuGpio(target.mcu || identity.mcu)
  );
  if (validated.diagnostics.length > 0) {
    diagnostics.set(board, [
      ...(diagnostics.get(board) || []),
      ...validated.diagnostics,
    ]);
  }
  if (!validated.defaults) {
    if (hasDefaults) {
      await fs.promises.writeFile(targetFile, removeDefaultsBlock(text));
      modified.push(`${targetFile} (removed stale defaults)`);
    } else {
      skipped.push(`${board}: no valid defaults for production target`);
    }
    continue;
  }

  const updated = hasDefaults
    ? insertDefaultsBlock(removeDefaultsBlock(text), renderDefaults(validated.defaults))
    : insertDefaultsBlock(text, renderDefaults(validated.defaults));
  await fs.promises.writeFile(targetFile, updated);
  modified.push(targetFile);
}

console.log(`modified ${modified.length} targets:`);
for (const file of modified) {
  console.log(`  ${file}`);
}
console.log(`skipped ${skipped.length}:`);
for (const entry of skipped) {
  console.log(`  ${entry}`);
}
if (diagnostics.size > 0) {
  console.log("diagnostics:");
  for (const [board, entries] of diagnostics) {
    for (const entry of entries) {
      console.log(`  ${board}: ${entry}`);
    }
  }
}
if (review.size > 0) {
  console.log("review (conditional or conflicting definitions, not imported):");
  for (const [board, entries] of review) {
    for (const entry of entries) {
      console.log(`  ${board}: ${entry.define} = ${entry.value}`);
    }
  }
}
