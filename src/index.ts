import fs from "fs";
import path from "path";
import YAML from "yaml";
import { walk } from "./util";
import { stringifyTarget } from "./types";

const OUTPUT_FOLDER = "output";

const manufacturers = YAML.parse(
  await fs.promises.readFile("manufacturers.yaml", "utf8")
);

let targetIndex = [] as any[];

await fs.promises.rm(OUTPUT_FOLDER, { recursive: true }).catch(() => {});
await fs.promises.mkdir(OUTPUT_FOLDER, { recursive: true }).catch(() => {});

for await (const f of walk("targets")) {
  const target = YAML.parse(await fs.promises.readFile(f, "utf8"));

  if (!target.manufacturer) {
    throw new Error(`manufacturer missing from target ${target.name}`);
  }
  if (!manufacturers[target.manufacturer]) {
    throw new Error(
      `invalid manufacturer ${target.manufacturer} on target ${target.name}`
    );
  }

  console.log(`processing ${target.manufacturer} / ${target.name}...`);

  const targetFile = `${target.manufacturer}-${target.name}`.toLowerCase();
  targetIndex.push({
    name: target.name,
    target: targetFile,
    manufacturer: target.manufacturer,
    mcu: target.mcu,
  });

  for (const alias of target.alias || []) {
    const parts = alias.split("-", 2);

    const manufacturer = parts[0].toUpperCase();
    if (!manufacturer) {
      throw new Error(`manufacturer missing from alias ${alias}`);
    }
    if (!manufacturers[manufacturer]) {
      throw new Error(`invalid manufacturer ${manufacturer} on alias ${alias}`);
    }

    const name = parts[1];
    if (!name) {
      throw new Error(`name missing from alias ${alias}`);
    }

    targetIndex.push({
      name: name,
      target: targetFile,
      manufacturer: manufacturer,
      mcu: target.mcu,
    });
  }

  await fs.promises.writeFile(
    path.join(OUTPUT_FOLDER, path.basename(f)),
    stringifyTarget(target)
  );
}

targetIndex.sort((a, b) => a.name.localeCompare(b.name));

await fs.promises.writeFile(
  path.join(OUTPUT_FOLDER, "_index.json"),
  JSON.stringify({
    manufacturers,
    targets: targetIndex,
  })
);

let targetIni = "";
for (const target of targetIndex) {
  if (target.manufacturer) {
    const mgfr = target.manufacturer.toLowerCase();
    targetIni += `\n[env:${mgfr}-${target.name}]\n`;
  } else {
    targetIni += `\n[env:${target.name}]\n`;
  }
  targetIni += `extends = ${target.mcu}\n`;
}

await fs.promises.writeFile(path.join(OUTPUT_FOLDER, "_index.ini"), targetIni);
