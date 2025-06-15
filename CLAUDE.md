# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a target configuration management system for the QUICKSILVER Flight Controller Firmware. It manages hardware target definitions for 500+ FPV flight controller boards, converting Betaflight unified targets to QUICKSILVER-compatible YAML format and generating target indices.

## Development Commands

```bash
# Convert Betaflight configs to staging targets
npm run translate

# Build target index and validate configurations  
npx vite-node src/index.ts

# Sync specific fields between staging and production targets
npx vite-node src/sync.ts

# Install dependencies
npm install
```

## Architecture Overview

**Core Components:**
- `src/translate.ts` - Converts Betaflight `config.h` files to QUICKSILVER YAML format
- `src/index.ts` - Processes all target YAML files and generates consolidated indices
- `src/dma.ts` - Automatically assigns DMA channels and prevents hardware conflicts
- `src/sync.ts` - Syncs specific fields between staging and production targets

**Directory Structure:**
- `targets/` - Production target configurations (500+ YAML files)
- `staging/` - Converted Betaflight targets awaiting validation
- `betaflight/` - Git submodule with upstream Betaflight configurations
- `mcu/` - MCU-specific pin and DMA definitions (stm32f405, stm32f411, etc.)
- `manufacturers.yaml` - Manufacturer database with codes and metadata

**Target Configuration Format:**
Each target YAML contains hardware definitions: MCU type, pin mappings, serial/SPI ports, gyro configuration, motor outputs, and DMA assignments. Files are validated against `src/schema/target.json`.

**MCU Support:**
STM32F405/F411/F722/F745/F765/H743, STM32G473, AT32F435 with MCU-specific pin definitions in `mcu/{type}/gpio.yaml` and DMA mappings in `mcu/{type}/dma.yaml`.

**CI/CD Pipeline:**
Automated builds on master push generate target indices and deploy to the `targets` branch for consumption by QUICKSILVER firmware builds.