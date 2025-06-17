import { Logger } from '../logger';
import { findDmaAssignments } from '../dma';
import { walk, stringifyTargetWithDma } from '../util';
import fs from 'fs';
import YAML from 'yaml';

export interface DmaOptions {
  targets?: string[];
  checkOnly: boolean;
  debug?: boolean;
  logger: Logger;
}

export async function processDma(options: DmaOptions): Promise<void> {
  const { targets, checkOnly, debug, logger } = options;
  
  let targetFiles: string[];
  
  if (targets && targets.length > 0) {
    // Process specific targets
    targetFiles = targets;
    logger.info(`Processing DMA for ${targets.length} specific targets`);
  } else {
    // Process all targets
    targetFiles = [];
    for await (const f of walk('targets')) {
      targetFiles.push(f);
    }
    logger.info(`Processing DMA for all ${targetFiles.length} targets`);
  }

  let processedCount = 0;
  let errorCount = 0;

  for (const targetFile of targetFiles) {
    try {
      const target = YAML.parse(await fs.promises.readFile(targetFile, 'utf8'));
      
      if (!target.mcu) {
        logger.warn(`Skipping ${target.name || targetFile}: no MCU specified`);
        continue;
      }

      logger.debug(`Processing DMA for ${target.name || targetFile} (${target.mcu})`);
      
      const processedTarget = await findDmaAssignments(target, debug);
      
      if (checkOnly) {
        // Validation mode - just check if it works
        const dshotMode = (processedTarget as any)._dshotMode;
        logger.info(`${target.name || targetFile}: ${dshotMode?.mode || 'Unknown'} mode - ${dshotMode?.reason || 'OK'}`);
      } else {
        // Write the processed target back with DMA header
        await fs.promises.writeFile(
          targetFile,
          await stringifyTargetWithDma(processedTarget)
        );
        logger.debug(`Updated ${targetFile}`);
      }
      
      processedCount++;
    } catch (error) {
      logger.error(`Failed to process ${targetFile}:`, error.message);
      
      // Try retry logic for DMA conflicts (RGB LED or other conflicts)
      if (!checkOnly && (error.message.includes("No motor DMA") || error.message.includes("Failed to assign DMA for SPI"))) {
        try {
          const target = YAML.parse(await fs.promises.readFile(targetFile, 'utf8'));
          if (target.rgb_led) {
            logger.debug(`Retrying ${targetFile} without RGB LED due to DMA conflict: ${error.message}`);
            const targetWithoutRgb = { ...target, rgb_led: undefined };
            const result = await findDmaAssignments(targetWithoutRgb, debug);
            await fs.promises.writeFile(targetFile, await stringifyTargetWithDma(result));
            logger.info(`✓ Processed ${targetFile} (RGB disabled due to conflict)`);
            processedCount++;
            continue;
          }
        } catch (retryError) {
          logger.error(`✗ Retry failed for ${targetFile}: ${retryError.message}`);
        }
      }
      
      errorCount++;
    }
  }

  if (errorCount > 0) {
    logger.warn(`DMA processing completed with ${errorCount} errors`);
  } else {
    logger.info(`DMA processing completed successfully: ${processedCount} targets processed`);
  }
}