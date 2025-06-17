import { Logger } from '../logger';
import { walk, stringifyTargetWithDma } from '../util';
import fs from 'fs';
import path from 'path';
import YAML from 'yaml';

export interface SyncOptions {
  fields: string[];
  dryRun: boolean;
  logger: Logger;
}

export async function syncFields(options: SyncOptions): Promise<void> {
  const { fields, dryRun, logger } = options;
  
  logger.info(`Syncing fields: ${fields.join(', ')}`);
  
  if (dryRun) {
    logger.info('Dry run mode - no changes will be made');
  }
  
  try {
    await syncTargetFields(fields, dryRun, logger);
    logger.info('Field synchronization completed successfully');
  } catch (error) {
    logger.error('Field synchronization failed:', error.message);
    throw error;
  }
}

async function syncTargetFields(fields: string[], dryRun: boolean, logger: Logger): Promise<void> {
  const targetsDir = 'targets';
  const stagingDir = 'staging';
  
  for await (const f of walk(targetsDir)) {
    const stagingFile = path.join(stagingDir, path.basename(f));
    
    if (!fs.existsSync(stagingFile)) {
      logger.debug(`Staging target ${stagingFile} not found`);
      continue;
    }

    const target = YAML.parse(await fs.promises.readFile(f, "utf8"));
    const staging = YAML.parse(await fs.promises.readFile(stagingFile, "utf8"));
    
    const updates: any = {};
    for (const field of fields) {
      if (staging[field] !== undefined) {
        updates[field] = staging[field];
      }
    }
    
    if (Object.keys(updates).length > 0) {
      const updatedTarget = { ...target, ...updates };
      
      if (dryRun) {
        logger.info(`Would update ${f} with fields: ${Object.keys(updates).join(', ')}`);
      } else {
        await fs.promises.writeFile(f, await stringifyTargetWithDma(updatedTarget));
        logger.debug(`Updated ${f} with fields: ${Object.keys(updates).join(', ')}`);
      }
    }
  }
}