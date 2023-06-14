import YAML from "yaml";
import fs from "fs";
import { walk } from "./util";
import { stringifyTarget } from "./types";

for await (const f of walk("targets")) {
  const target = YAML.parse(await fs.promises.readFile(f, "utf8"));
  fs.writeFileSync(f, stringifyTarget(target));
}
