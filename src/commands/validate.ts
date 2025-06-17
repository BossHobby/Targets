import { Logger } from '../logger';
import { walk } from '../util';
import fs from 'fs';
import YAML from 'yaml';

export interface ValidateOptions {
  targets?: string[];
  schemaPath?: string;
  strict: boolean;
  logger: Logger;
}

export interface ValidationResult {
  errors: number;
  warnings: number;
  details: Array<{
    target: string;
    type: 'error' | 'warning';
    message: string;
  }>;
}

export async function validateTargets(options: ValidateOptions): Promise<ValidationResult> {
  const { targets, schemaPath, strict, logger } = options;
  
  const result: ValidationResult = {
    errors: 0,
    warnings: 0,
    details: []
  };

  let targetFiles: string[];
  
  if (targets && targets.length > 0) {
    targetFiles = targets;
  } else {
    targetFiles = [];
    for await (const f of walk('targets')) {
      targetFiles.push(f);
    }
  }

  logger.info(`Validating ${targetFiles.length} targets`);

  // Load schema if provided
  let schema: any = null;
  if (schemaPath) {
    try {
      schema = JSON.parse(await fs.promises.readFile(schemaPath, 'utf8'));
      logger.debug(`Loaded schema from ${schemaPath}`);
    } catch (error) {
      logger.warn('Failed to load schema:', error.message);
    }
  }

  for (const targetFile of targetFiles) {
    try {
      const target = YAML.parse(await fs.promises.readFile(targetFile, 'utf8'));
      
      // Basic validation
      if (!target.name) {
        result.errors++;
        result.details.push({
          target: targetFile,
          type: 'error',
          message: 'Missing required field: name'
        });
      }

      if (!target.manufacturer) {
        result.errors++;
        result.details.push({
          target: targetFile,
          type: 'error',
          message: 'Missing required field: manufacturer'
        });
      }

      if (!target.mcu) {
        result.errors++;
        result.details.push({
          target: targetFile,
          type: 'error',
          message: 'Missing required field: mcu'
        });
      }

      // DMA validation
      if (target.dma) {
        const dmaKeys = Object.keys(target.dma);
        const streamCounts = new Map<string, number>();
        
        for (const key of dmaKeys) {
          const assignment = target.dma[key];
          if (assignment.dma) {
            const count = streamCounts.get(assignment.dma) || 0;
            streamCounts.set(assignment.dma, count + 1);
          }
        }

        // Check for duplicate stream assignments
        for (const [stream, count] of streamCounts.entries()) {
          if (count > 1) {
            result.errors++;
            result.details.push({
              target: targetFile,
              type: 'error',
              message: `Duplicate DMA stream assignment: ${stream} used ${count} times`
            });
          }
        }
      }

      // Motor pin validation
      if (target.motor_pins && Array.isArray(target.motor_pins)) {
        if (target.motor_pins.length > 8) {
          result.warnings++;
          result.details.push({
            target: targetFile,
            type: 'warning',
            message: `Unusual number of motor pins: ${target.motor_pins.length}`
          });
        }
      }

      logger.debug(`Validated ${target.name || targetFile}`);
      
    } catch (error) {
      result.errors++;
      result.details.push({
        target: targetFile,
        type: 'error',
        message: `Parse error: ${error.message}`
      });
    }
  }

  // Log summary
  for (const detail of result.details) {
    if (detail.type === 'error') {
      logger.error(`${detail.target}: ${detail.message}`);
    } else {
      logger.warn(`${detail.target}: ${detail.message}`);
    }
  }

  return result;
}