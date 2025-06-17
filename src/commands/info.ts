import { Logger } from '../logger';
import { walk } from '../util';
import fs from 'fs';
import YAML from 'yaml';

export interface InfoOptions {
  target?: string;
  listManufacturers: boolean;
  listMcus: boolean;
  showStats: boolean;
  logger: Logger;
}

export async function showInfo(options: InfoOptions): Promise<void> {
  const { target, listManufacturers, listMcus, showStats, logger } = options;

  // Load manufacturers database
  const manufacturers = YAML.parse(
    await fs.promises.readFile('manufacturers.yaml', 'utf8')
  );

  if (listManufacturers) {
    console.log('\nSupported Manufacturers:');
    console.log('========================');
    for (const [code, info] of Object.entries(manufacturers)) {
      console.log(`${code.padEnd(6)} - ${(info as any).name}`);
    }
    return;
  }

  if (target) {
    // Show specific target info
    await showTargetInfo(target, logger);
    return;
  }

  // Collect statistics
  const stats = {
    totalTargets: 0,
    manufacturers: new Set<string>(),
    mcus: new Map<string, number>(),
    dshotModes: new Map<string, number>()
  };

  for await (const targetFile of walk('targets')) {
    try {
      const targetData = YAML.parse(await fs.promises.readFile(targetFile, 'utf8'));
      stats.totalTargets++;
      stats.manufacturers.add(targetData.manufacturer);
      
      if (targetData.mcu) {
        const count = stats.mcus.get(targetData.mcu) || 0;
        stats.mcus.set(targetData.mcu, count + 1);
      }

      // Detect DSHOT mode
      if (targetData.dma) {
        let dshotMode = 'Unknown';
        if (targetData.dma.DSHOT_DMAR) {
          dshotMode = 'DMAR';
        } else if (targetData.dma.DSHOT_M0) {
          dshotMode = 'CCR';
        } else if (targetData.dma.DSHOT_CH1) {
          dshotMode = 'BB';
        }
        
        const count = stats.dshotModes.get(dshotMode) || 0;
        stats.dshotModes.set(dshotMode, count + 1);
      }
    } catch (error) {
      logger.warn(`Failed to parse ${targetFile}:`, error.message);
    }
  }

  if (listMcus) {
    console.log('\nSupported MCUs:');
    console.log('===============');
    const sortedMcus = Array.from(stats.mcus.entries()).sort((a, b) => b[1] - a[1]);
    for (const [mcu, count] of sortedMcus) {
      console.log(`${mcu.padEnd(12)} - ${count} targets`);
    }
    return;
  }

  if (showStats) {
    console.log('\nTarget Statistics:');
    console.log('==================');
    console.log(`Total Targets: ${stats.totalTargets}`);
    console.log(`Manufacturers: ${stats.manufacturers.size}`);
    console.log(`MCU Types: ${stats.mcus.size}`);
    
    console.log('\nMCU Distribution:');
    const sortedMcus = Array.from(stats.mcus.entries()).sort((a, b) => b[1] - a[1]);
    for (const [mcu, count] of sortedMcus.slice(0, 10)) {
      const percentage = ((count / stats.totalTargets) * 100).toFixed(1);
      console.log(`  ${mcu.padEnd(12)} ${count.toString().padStart(3)} (${percentage}%)`);
    }

    console.log('\nDSHOT Mode Distribution:');
    const sortedModes = Array.from(stats.dshotModes.entries()).sort((a, b) => b[1] - a[1]);
    for (const [mode, count] of sortedModes) {
      const percentage = ((count / stats.totalTargets) * 100).toFixed(1);
      console.log(`  ${mode.padEnd(8)} ${count.toString().padStart(3)} (${percentage}%)`);
    }
    return;
  }

  // Default: show overview
  console.log('\nQuicksilver Target Manager');
  console.log('==========================');
  console.log(`${stats.totalTargets} targets configured`);
  console.log(`${stats.manufacturers.size} manufacturers supported`);
  console.log(`${stats.mcus.size} MCU types supported`);
  console.log('\nUse --help for available commands');
}

async function showTargetInfo(targetName: string, logger: Logger): Promise<void> {
  // Find target file
  let targetFile: string | null = null;
  let targetData: any = null;

  for await (const f of walk('targets')) {
    try {
      const data = YAML.parse(await fs.promises.readFile(f, 'utf8'));
      if (data.name === targetName) {
        targetFile = f;
        targetData = data;
        break;
      }
    } catch (error) {
      logger.warn(`Failed to parse ${f}:`, error.message);
    }
  }

  if (!targetData) {
    console.log(`Target '${targetName}' not found`);
    return;
  }

  console.log(`\nTarget Information: ${targetData.name}`);
  console.log('===============================================');
  console.log(`File: ${targetFile}`);
  console.log(`Manufacturer: ${targetData.manufacturer}`);
  console.log(`MCU: ${targetData.mcu}`);
  
  if (targetData.alias && targetData.alias.length > 0) {
    console.log(`Aliases: ${targetData.alias.join(', ')}`);
  }

  if (targetData.motor_pins) {
    console.log(`Motor Pins: ${targetData.motor_pins.length} configured`);
    console.log(`  ${targetData.motor_pins.slice(0, 8).join(', ')}`);
  }

  if (targetData.dma) {
    console.log(`DMA Assignments: ${Object.keys(targetData.dma).length} configured`);
    
    // Detect DSHOT mode
    let dshotMode = 'Unknown';
    if (targetData.dma.DSHOT_DMAR) {
      dshotMode = 'DMAR (Timer Burst DMA)';
    } else if (targetData.dma.DSHOT_M0) {
      dshotMode = 'CCR (Channel Register DMA)';
    } else if (targetData.dma.DSHOT_CH1) {
      dshotMode = 'BB (Bitbang GPIO)';
    }
    console.log(`  DSHOT Mode: ${dshotMode}`);
  }

  if (targetData.gyro) {
    console.log(`Gyro: ${targetData.gyro.type || 'configured'}`);
  }

  if (targetData.serial_ports) {
    console.log(`Serial Ports: ${Object.keys(targetData.serial_ports).length} configured`);
  }
}