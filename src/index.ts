import fs from "fs";
import path from "path";
import YAML from "yaml";
import { walk } from "./util";
import { stringifyTarget } from "./types";

const OUTPUT_FOLDER = "output";

let targetIni = "";
let targetIndex = [] as any[];
await fs.promises.mkdir(OUTPUT_FOLDER).catch(() => {});

for await (const f of walk("targets")) {
  const target = YAML.parse(await fs.promises.readFile(f, "utf8"));

  console.log(`processing ${target.name}...`);
  if (target.manufacturer) {
    const mgfr = target.manufacturer.toLowerCase();
    targetIni += `\n[env:${mgfr}-${target.name}]\n`;
  } else {
    targetIni += `\n[env:${target.name}]\n`;
  }
  targetIni += `extends = ${target.mcu}\n`;

  targetIndex.push({
    name: target.name,
    manufacturer: target.manufacturer,
    mcu: target.mcu,
  });

  for (const alias of target.alias || []) {
    const parts = alias.split("-", 2);

    targetIndex.push({
      name: parts[1],
      manufacturer: parts[0].toUpperCase(),
      mcu: target.mcu,
    });
  }

  await fs.promises.writeFile(
    path.join(OUTPUT_FOLDER, path.basename(f)),
    stringifyTarget(target)
  );
}

targetIndex.sort((a, b) => a.name.localeCompare(b.name));

const manufacturers = YAML.parse(
  await fs.promises.readFile("manufacturers.yaml", "utf8")
);

const index = {
  manufacturers,
  targets: targetIndex,
};

await fs.promises.writeFile(path.join(OUTPUT_FOLDER, "_index.ini"), targetIni);
await fs.promises.writeFile(
  path.join(OUTPUT_FOLDER, "_index.json"),
  JSON.stringify(index)
);
