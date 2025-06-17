#!/usr/bin/env node

import { Command } from 'commander';
import { createLogger, Logger } from './logger.js';
import path from 'path';
import fs from 'fs';

const program = new Command();
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));

let logger: Logger;

program
  .name('targets-cli')
  .description('QUICKSILVER Flight Controller Target Configuration Manager')
  .version(pkg.version)
  .option('-v, --verbose', 'enable verbose logging')
  .option('-q, --quiet', 'suppress output')
  .hook('preAction', async (thisCommand) => {
    const opts = thisCommand.opts();
    
    // Initialize logger
    logger = createLogger({
      level: opts.quiet ? 'error' : opts.verbose ? 'debug' : 'info'
    });
  });

// Build command - main target processing
program
  .command('build')
  .description('Process all target configurations and generate indices')
  .option('-o, --output <dir>', 'output directory', 'output')
  .option('--no-dma', 'skip DMA assignment processing')
  .action(async (options) => {
    logger.info('Building target configurations...');
    
    try {
      const { buildTargets } = await import('./commands/build.js');
      await buildTargets({
        outputDir: options.output,
        processDma: options.dma,
        logger
      });
      logger.info('Build completed successfully');
    } catch (error) {
      logger.error('Build failed:', error.message);
      process.exit(1);
    }
  });

// Translate command - Betaflight conversion
program
  .command('translate')
  .description('Convert Betaflight config.h files to QUICKSILVER YAML format')
  .option('-i, --input <dir>', 'Betaflight configs directory', 'betaflight/configs')
  .option('-o, --output <dir>', 'staging directory', 'staging')
  .option('--filter <pattern>', 'filter targets by pattern')
  .action(async (options) => {
    logger.info('Translating Betaflight configurations...');
    
    try {
      const { translateConfigs } = await import('./commands/translate.js');
      await translateConfigs({
        inputDir: options.input,
        outputDir: options.output,
        filter: options.filter,
        logger
      });
      logger.info('Translation completed successfully');
    } catch (error) {
      logger.error('Translation failed:', error.message);
      process.exit(1);
    }
  });

// DMA command - DMA assignment processing
program
  .command('dma')
  .description('Process DMA assignments for target configurations')
  .argument('[targets...]', 'specific target files to process')
  .option('-f, --force', 'force regenerate all DMA assignments')
  .option('--check-only', 'validate DMA assignments without modifying')
  .option('-d, --debug', 'enable debug output for DMA assignment solver')
  .action(async (targets, options) => {
    logger.info('Processing DMA assignments...');
    
    try {
      const { processDma } = await import('./commands/dma.js');
      await processDma({
        targets: targets.length > 0 ? targets : undefined,
        checkOnly: options.checkOnly,
        debug: options.debug,
        logger
      });
      logger.info('DMA processing completed successfully');
    } catch (error) {
      logger.error('DMA processing failed:', error.message);
      process.exit(1);
    }
  });

// Sync command - field synchronization
program
  .command('sync')
  .description('Sync specific fields between staging and production targets')
  .option('-f, --fields <fields...>', 'fields to sync', ['gyro', 'motor_pins'])
  .option('--dry-run', 'show what would be synced without making changes')
  .action(async (options) => {
    logger.info('Syncing target fields...');
    
    try {
      const { syncFields } = await import('./commands/sync.js');
      await syncFields({
        fields: options.fields,
        dryRun: options.dryRun,
        logger
      });
      logger.info('Sync completed successfully');
    } catch (error) {
      logger.error('Sync failed:', error.message);
      process.exit(1);
    }
  });

// Validate command - configuration validation
program
  .command('validate')
  .description('Validate target configurations against schema')
  .argument('[targets...]', 'specific target files to validate')
  .option('--schema <path>', 'custom schema file path')
  .option('--strict', 'enable strict validation mode')
  .action(async (targets, options) => {
    logger.info('Validating target configurations...');
    
    try {
      const { validateTargets } = await import('./commands/validate.js');
      const results = await validateTargets({
        targets: targets.length > 0 ? targets : undefined,
        schemaPath: options.schema,
        strict: options.strict,
        logger
      });
      
      if (results.errors > 0) {
        logger.error(`Validation failed: ${results.errors} errors, ${results.warnings} warnings`);
        process.exit(1);
      } else if (results.warnings > 0) {
        logger.warn(`Validation completed with ${results.warnings} warnings`);
      } else {
        logger.info('All targets validated successfully');
      }
    } catch (error) {
      logger.error('Validation failed:', error.message);
      process.exit(1);
    }
  });

// Format command - target formatting
program
  .command('format')
  .description('Format target configuration files')
  .argument('[targets...]', 'specific target files to format')
  .action(async (targets, options) => {
    logger.info('Formatting target configurations...');
    
    try {
      const { formatTargets } = await import('./commands/format.js');
      await formatTargets({
        targets: targets.length > 0 ? targets : undefined,
        logger
      });
      logger.info('Formatting completed successfully');
    } catch (error) {
      logger.error('Formatting failed:', error.message);
      process.exit(1);
    }
  });

// Info command - target information
program
  .command('info')
  .description('Show information about targets and manufacturers')
  .argument('[target]', 'specific target to show info for')
  .option('--list-manufacturers', 'list all manufacturers')
  .option('--list-mcus', 'list all supported MCUs')
  .option('--stats', 'show statistics')
  .action(async (target, options) => {
    try {
      const { showInfo } = await import('./commands/info.js');
      await showInfo({
        target,
        listManufacturers: options.listManufacturers,
        listMcus: options.listMcus,
        showStats: options.stats,
        logger
      });
    } catch (error) {
      logger.error('Info command failed:', error.message);
      process.exit(1);
    }
  });

// Error handling
program.exitOverride();

try {
  await program.parseAsync();
} catch (error) {
  if (error.code === 'commander.help' || error.code === 'commander.version') {
    // Help and version are expected exits
    process.exit(0);
  } else {
    logger?.error('CLI error:', error.message);
    process.exit(1);
  }
}

// Use the recommended pattern for CLI tools
if (require.main === module) {
  // CLI was called directly, parsing is complete
}