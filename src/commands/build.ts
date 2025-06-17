import { Logger } from '../logger';
import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { walk, stringifyTargetWithDma } from '../util';
import { findDmaAssignments } from '../dma';

export interface BuildOptions {
  outputDir: string;
  processDma: boolean;
  logger: Logger;
}

export async function buildTargets(options: BuildOptions): Promise<void> {
  const { outputDir, processDma, logger } = options;
  
  // Load manufacturers database
  const manufacturers = YAML.parse(
    await fs.promises.readFile('manufacturers.yaml', 'utf8')
  );

  let targetIndex = [] as any[];

  // Clean and create output directory
  await fs.promises.rm(outputDir, { recursive: true }).catch(() => {});
  await fs.promises.mkdir(outputDir, { recursive: true });

  logger.info(`Processing targets from targets`);

  // Process each target file
  for await (const f of walk('targets')) {
    const target = YAML.parse(await fs.promises.readFile(f, 'utf8'));

    if (!target.manufacturer) {
      throw new Error(`manufacturer missing from target ${target.name}`);
    }
    if (!manufacturers[target.manufacturer]) {
      throw new Error(
        `invalid manufacturer ${target.manufacturer} on target ${target.name}`
      );
    }

    logger.debug(`Processing ${target.manufacturer}/${target.name}...`);

    // Process DMA assignments if enabled
    if (processDma && target.mcu) {
      try {
        const processedTarget = await findDmaAssignments(target);
        Object.assign(target, processedTarget);
        logger.debug(`DMA assignments processed for ${target.name}`);
      } catch (error) {
        logger.warn(`DMA processing failed for ${target.name}:`, error.message);
      }
    }

    const targetFile = `${target.manufacturer}-${target.name}`.toLowerCase();
    targetIndex.push({
      name: target.name,
      target: targetFile,
      manufacturer: target.manufacturer,
      mcu: target.mcu,
    });

    // Process aliases
    for (const alias of target.alias || []) {
      const parts = alias.split('-', 2);

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

    // Write target file
    await fs.promises.writeFile(
      path.join(outputDir, path.basename(f)),
      await stringifyTargetWithDma(target)
    );
  }

  // Sort target index
  targetIndex.sort((a, b) => a.name.localeCompare(b.name));

  // Generate JSON index
  await fs.promises.writeFile(
    path.join(outputDir, '_index.json'),
    JSON.stringify({
      manufacturers,
      targets: targetIndex,
    }, null, 2)
  );

  // Generate INI index for PlatformIO
  let targetIni = '';
  for (const target of targetIndex) {
    if (target.manufacturer) {
      const mgfr = target.manufacturer.toLowerCase();
      targetIni += `\n[env:${mgfr}-${target.name}]\n`;
    } else {
      targetIni += `\n[env:${target.name}]\n`;
    }
    targetIni += `extends = ${target.mcu}\n`;
  }

  await fs.promises.writeFile(path.join(outputDir, '_index.ini'), targetIni);

  logger.info(`Build completed: ${targetIndex.length} targets processed`);
}