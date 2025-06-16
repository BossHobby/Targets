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

# Process DMA assignments for all targets
npx vite-node src/dma.ts

# Process DMA assignments for specific targets
npx vite-node src/dma.ts -- targets/target1.yaml targets/target2.yaml

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

## DMA Assignment System

### **Scarcity-Based Assignment Algorithm (`src/dma.ts`)**

**Core Concept:**
The DMA assignment system uses a scarcity-based algorithm that computes assignment possibilities for each DMA stream based on actual peripheral usage, prioritizing streams with fewer options first for optimal resource allocation.

**Algorithm Flow:**
1. **Peripheral Detection**: Identifies all active peripherals on the target (motors, SPI, UART, I2C, RGB LEDs)
2. **Scarcity Analysis**: For each DMA stream, counts how many peripherals could potentially use it
3. **Priority Sorting**: Sorts streams by scarcity (fewest assignments first) for optimal allocation
4. **Conflict-Aware Assignment**: Assigns peripherals to the most constrained available streams
5. **Fallback Logic**: Handles conflicts with Timer8 fallback and RGB LED retry mechanism

**Priority Levels:**
- **Critical**: Motor DSHOT channels (Timer1/Timer8) - must be assigned
- **High**: SPI channels - essential for sensor communication
- **Medium**: UART/I2C channels - potential runtime assignments
- **Low**: RGB LED timers - can be disabled if conflicts occur

### **MCU-Specific DMA Architectures**

#### **STM32F4/F7 Series (F405, F411, F722, F745, F765)**
- **Architecture**: Dual DMA controllers (DMA1/DMA2), each with 8 streams (0-7)
- **Stream Assignment**: Fixed stream/channel mappings per peripheral
- **Constraints**: Each stream handles one transfer; no sharing possible
- **Special Cases**: F411 lacks Timer8, AT32F435 uses streams 1-7

#### **STM32G473 Series**
- **Architecture**: DMAMUX (DMA multiplexer) with request-based routing
- **Stream Assignment**: Uses request numbers instead of fixed mappings
- **Allocation**: Sequential stream assignment (DMA1_STREAM1, DMA1_STREAM2, etc.)
- **Flexibility**: More flexible routing compared to F4/F7 series

#### **STM32H743 Series**
- **Architecture**: Advanced DMA with DMAMUX capabilities
- **Stream Assignment**: Hybrid approach with enhanced routing
- **Performance**: Higher bandwidth and more sophisticated arbitration

### **Configuration Files Structure**

**STM32F4/F7 Format:**
```yaml
- tag:
    type: spi
    index: 1
    func: miso
  dma:
    port: 2
    stream: 0
  channel: 3
```

**STM32G473 Format:**
```yaml
- tag:
    type: spi
    index: 1
    func: miso
  request: 10
```

### **Generated Comments in Target Files**

Each DMA assignment includes comprehensive metadata:
```yaml
dma:
  # DMA Configuration for STM32F405 - 8 streams used, 3 motor channels, 4 SPI channels
  DSHOT_CH1:
    tag: TIMER1_CH1
    dma: DMA2_STREAM1
    channel: 6
    # DMA2 Stream1 Ch6 | Critical priority | exclusive | Motor 1 output (DSHOT protocol) | (ESC control)
```

**Comment Format:**
`DMA{Controller} Stream{Number} Ch{Channel} | {Priority} priority | exclusive | {Description} | ({Usage})`

### **Key Constraints & Validation**

- **Exclusivity**: DMA streams cannot be shared - each stream handles one transfer only
- **Motor Protection**: Timer1 (and Timer8 if available) reserved for DSHOT protocols
- **Conflict Detection**: Algorithm validates assignments and reports conflicts with ⚠️ warnings
- **Retry Logic**: Automatic RGB LED disabling and Timer8 fallback for conflict resolution
- **MCU Limits**: Respects stream ranges per MCU type (F411: 0-7, AT32F435: 1-7, G473: 1-7)

### **Configuration Files:**
- `mcu/stm32f405/dma.yaml` - F405 DMA stream/channel mappings (512 entries)
- `mcu/stm32f411/dma.yaml` - F411 DMA stream/channel mappings (464 entries)  
- `mcu/stm32g473/dma.yaml` - G473 DMAMUX request mappings (250 entries)
- `mcu/stm32h743/dma.yaml` - H743 advanced DMA mappings
- Each entry defines: peripheral type, index, function, and routing information

### **Module Pattern:**
- Always use `if (!module.parent)` for main execution blocks (not `require.main === module`)
- This pattern is required for proper CLI tool execution in the Node.js environment