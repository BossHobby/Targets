import { Logger } from '../logger';
import { walk, stringifyTargetWithDma } from '../util';
import fs from 'fs';
import YAML from 'yaml';

export interface FormatOptions {
  targets?: string[];
  logger: Logger;
}

export async function formatTargets(options: FormatOptions): Promise<void> {
  const { targets, logger } = options;
  
  let targetFiles: string[];
  
  if (targets && targets.length > 0) {
    // Format specific targets
    targetFiles = targets;
    logger.info(`Formatting ${targets.length} specific targets`);
  } else {
    // Format all targets
    targetFiles = [];
    for await (const f of walk('targets')) {
      targetFiles.push(f);
    }
    logger.info(`Formatting all ${targetFiles.length} targets`);
  }

  let formattedCount = 0;
  let errorCount = 0;

  for (const targetFile of targetFiles) {
    try {
      logger.debug(`Formatting ${targetFile}...`);
      
      const target = YAML.parse(await fs.promises.readFile(targetFile, 'utf8'));
      const formattedContent = await stringifyTargetWithDma(target);
      
      await fs.promises.writeFile(targetFile, formattedContent);
      
      formattedCount++;
      logger.debug(`Formatted ${targetFile}`);
    } catch (error) {
      logger.error(`Failed to format ${targetFile}:`, error.message);
      errorCount++;
    }
  }

  if (errorCount > 0) {
    logger.warn(`Formatting completed with ${errorCount} errors`);
  } else {
    logger.info(`Formatting completed successfully: ${formattedCount} targets formatted`);
  }
}