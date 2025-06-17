import fs from "fs";
import path from "path";
import YAML, { Pair, Scalar } from "yaml";
import { target_t, target_keys, skipEmpty } from "./types";

export async function* walk(dir: string): AsyncGenerator<string> {
  for await (const d of await fs.promises.opendir(dir)) {
    const entry = path.join(dir, d.name);
    if (d.isDirectory()) yield* walk(entry);
    else if (d.isFile()) yield entry;
  }
}

function sortMapEntries(a: Pair<Scalar, unknown>, b: Pair<Scalar, unknown>): number {
  const aIndex = target_keys.indexOf(a.key.value as string);
  const bIndex = target_keys.indexOf(b.key.value as string);
  if (aIndex == -1 && bIndex == -1) {
    return (a.key.value as string).localeCompare(b.key.value as string);
  }
  if (aIndex == -1) return 1;
  if (bIndex == -1) return -1;
  return aIndex - bIndex;
}

// Simple stringify function without DMA headers
export function stringifyTarget(target: target_t & { _dmaStatus?: any; _usedStreams?: Set<string>; _mcu?: string; _dmaResources?: any[]; _dshotMode?: any }) {
  // Remove internal data before stringifying
  const cleanTarget = { ...target };
  delete (cleanTarget as any)._dmaStatus;
  delete (cleanTarget as any)._usedStreams;
  delete (cleanTarget as any)._mcu;
  delete (cleanTarget as any)._dmaResources;
  delete (cleanTarget as any)._dshotMode;
  
  return YAML.stringify(skipEmpty(cleanTarget), { sortMapEntries });
}

// Enhanced stringify function that automatically generates DMA headers
export async function stringifyTargetWithDma(target: target_t & { _dmaStatus?: any; _usedStreams?: Set<string>; _mcu?: string; _dmaResources?: any[]; _dshotMode?: any }): Promise<string> {
  let content = '';
  
  // Add DMA header if present
  if (target._dmaHeader) {
    content += target._dmaHeader;
  }
  
  // Remove internal properties before stringifying
  const cleanTarget = { ...target };
  delete cleanTarget._dmaHeader;
  delete cleanTarget._usedStreams;
  delete cleanTarget._mcu;
  delete cleanTarget._dmaResources;
  delete cleanTarget._dshotMode;
  delete cleanTarget._dmaStatus;
  
  // Ensure dma is included if present
  if (target.dma) {
    cleanTarget.dma = target.dma;
  }
  
  content += stringifyTarget(cleanTarget);
  return content;
}
