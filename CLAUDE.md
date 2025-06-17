# CLAUDE.md

## Status

### **DMA Assignment System - SAT Solver Implementation**

**Current Status:** SAT solver implementation attempted but incomplete. The solver finds no assignments due to implementation issues.

**Key Issues:**
- Z3 solver integration works but produces empty assignments
- Peripheral enumeration working but DMA resource matching failing
- Need to properly integrate with existing DMA assignment structure

**Note:** The original backtracking implementation achieves 98.4% success rate (125/127 targets)

## Development Commands

```bash
npm run targets dma                      # Process DMA assignments for all targets
npm run targets dma targets/target.yaml  # Process specific target
npm test                                 # Run constraint solver tests
```

## Architecture Notes

- **Fixed DMA:** STM32F4/F7 use hardcoded stream/channel mappings from YAML files
- **Flexible DMA:** STM32G4/H7/AT32 use sequential stream assignment with DMAMUX

## Code Style

- Prefer concise, functional approach over verbose OOP
- Use libraries for complex constraint solving when appropriate
- Self-documenting code over excessive comments

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a target configuration management system for the QUICKSILVER Flight Controller Firmware. It manages hardware target definitions for 500+ FPV flight controller boards, converting Betaflight unified targets to QUICKSILVER-compatible YAML format and generating target indices.

## Development Commands

```bash
# CLI commands
npm run targets build                    # Build target index and validate configurations
npm run targets translate                # Convert Betaflight configs to staging targets
npm run targets dma                      # Process DMA assignments for all targets
npm run targets dma targets/target.yaml  # Process DMA assignments for specific targets
npm run targets sync                     # Sync specific fields between staging and production targets
npm run targets validate                 # Validate target configurations
npm run targets format                   # Format target configuration files
npm run targets info -- --stats         # Show target statistics
npm run targets -- --help               # Show all available commands

# Testing commands
npm test                # Run all tests
npm run test:watch      # Run tests in watch mode
npm run test:coverage   # Run tests with coverage report

# Development
npm install             # Install dependencies
npm run build           # Build TypeScript to dist/
npm run dev -- --help   # Run CLI in development mode
```

## Architecture Overview

**Core Components:**
- `src/cli.ts` - Unified command-line interface for all operations
- `src/commands/` - Self-contained command implementations:
  - `build.ts` - Target processing and index generation
  - `translate.ts` - Betaflight config.h to QUICKSILVER YAML conversion
  - `dma.ts` - DMA channel assignment and conflict resolution
  - `sync.ts` - Field synchronization between staging and production
  - `validate.ts` - Target configuration validation
  - `format.ts` - Target file formatting and standardization
  - `info.ts` - Target information and statistics
- `src/dma.ts` - Core DMA assignment algorithms and utilities
- `src/types.ts` - Type definitions and YAML formatting utilities
- `src/logger.ts` - Structured logging infrastructure  
- `src/util.ts` - Shared utility functions

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

- **Complete Regeneration**: DMA assignments are always completely regenerated from scratch - no existing assignments are preserved
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

## **MCU Configuration Files - Source of Truth Principle**

**CRITICAL RULE**: The `mcu/` directory is the **single source of truth** for all hardware-specific information. Never hardcode MCU-specific values in the code.

**Required Practice:**
- ✅ **Always read from MCU files**: GPIO mappings, DMA assignments, timer capabilities, etc.
- ✅ **Add new MCU data to `mcu/{type}/` files**: When new hardware information is needed, extend the YAML files
- ❌ **Never hardcode**: Platform-specific constants, DMA streams, timer support lists, request numbers
- ❌ **Never assume**: Hardware capabilities without checking the MCU configuration files

**MCU File Structure:**
- `mcu/{type}/gpio.yaml` - Pin to peripheral mappings (Timer channels, SPI, UART, etc.)
- `mcu/{type}/dma.yaml` - DMA stream/request assignments for each peripheral
- `mcu/{type}/` - Future: Timer DMAR support, clock configurations, errata information

**Examples:**
```typescript
// ✅ CORRECT: Read from MCU files
const dma = dmas[mcu] as dma_resource[];
const timerSupport = timerDmarSupport[mcu];

// ❌ WRONG: Hardcoded platform assumptions
const f4Timers = [1, 8]; // Don't hardcode!
if (mcu === 'stm32f405') { ... } // Don't hardcode MCU lists!
```

**When adding new features:**
1. First check if MCU files contain the needed information
2. If missing, extend the MCU YAML files with the new data
3. Read the data dynamically from the files
4. Never create hardcoded lookup tables in the TypeScript code

## DSHOT Mode System (Implemented)

### **Intelligent DSHOT Mode Selection**

The DMA assignment system now includes comprehensive DSHOT mode detection and automatic configuration based on hardware capabilities and platform constraints.

**Supported DSHOT Modes:**
- **DMAR**: Timer Burst DMA - single stream for all 4 motors (preferred when possible)
- **CCR**: Channel Register DMA - individual motor channel transfers (F4 errata safe fallback)  
- **BB**: Bitbang GPIO - flexible pin assignment with GPIO port grouping (DANGEROUS on F4)

### **Mode Selection Algorithm**

**STM32F4 MCUs (Errata-Affected) Priority:**
1. **DMAR Mode** → Timer burst DMA completely eliminates DMA2 errata
2. **CCR Mode** → Individual channel DMA avoids GPIO writes (safe fallback)
3. **BB Mode** → Bitbang GPIO (ultimate fallback - DANGEROUS, use with warnings)

**Non-F4 MCUs Priority:**
1. **DMAR Mode** → Optimal for single timer configurations (preferred when possible)
2. **BB Mode** → Flexible GPIO port grouping (fallback for mixed timer setups)

### **Auto-Detection Logic**

```typescript
// Mode detection considers existing assignments and hardware capabilities
function detectDshotMode(target: target_t, mcu: string, gpio: any): DshotModeResult {
    // Check existing DMA assignments first
    if (target.dma?.DSHOT_DMAR) return { mode: 'DMAR', reason: '...' };
    if (target.dma?.DSHOT_M0) return { mode: 'CCR', reason: '...' };
    if (target.dma?.DSHOT_CH1) return { mode: 'BB', reason: '...' };
    
    // Auto-detect optimal mode based on motor configuration
    const isF4ErrataAffected = requiresDMA2ErrataAvoidance(mcu);
    const dmarEligibility = canUseDMAR(target, mcu, gpio);
    
    if (isF4ErrataAffected) {
        if (dmarEligibility.canUse) return { mode: 'DMAR', timer: dmarEligibility.timer };
        if (canUseCCR(target, mcu, gpio).canUse) return { mode: 'CCR' };
        return { mode: 'BB', reason: 'DANGEROUS F4 fallback', motorGroups: groupMotorsByGpioPort(target.motor_pins) };
    } else {
        if (dmarEligibility.canUse) return { mode: 'DMAR', timer: dmarEligibility.timer };
        return { mode: 'BB', motorGroups: groupMotorsByGpioPort(target.motor_pins) };
    }
}
```

### **DMAR Mode Requirements**

**Timer Validation:**
- All 4 motors must be on same timer (TIM1, TIM8, or other DMAR-capable timers)
- Must use consecutive channels 1-4 for optimal efficiency
- Timer must support burst DMA (validated against MCU-specific capabilities)

**Platform Support:**
- **STM32F4**: TIM1, TIM8 only (general purpose timers lack DMAR)
- **STM32F7**: TIM1, TIM8 guaranteed; TIM2-5 varies by variant
- **STM32H7/G4**: TIM1, TIM8, TIM2-5 support DMAR
- **AT32F435**: TMR1, TMR8 guaranteed

### **CCR Mode (STM32F4 Only)**

**Purpose:** Fallback for F4 when DMAR impossible - uses individual channel DMA instead of dangerous bitbang

**Configuration:**
```yaml
dma:
  DSHOT_M0:  # Motor 0
    dma: DMA1_STREAM5
    channel: 3
    tag: TIMER2_CH1
  DSHOT_M1:  # Motor 1 
    dma: DMA1_STREAM6
    channel: 3
    tag: TIMER2_CH2
  # ... DSHOT_M2, DSHOT_M3
```

**Benefits:**
- Avoids DMA2 GPIO writes (eliminates errata)
- Supports mixed timer configurations
- More flexible than DMAR for scattered motor pins
- Always available as F4 fallback when DMAR not possible

### **BB Mode**

**GPIO Port Grouping:**
- Motors grouped by GPIO port (GPIOA, GPIOB, etc.) for efficiency
- Maximum 3 DMA streams (DSHOT_CH1-CH3) for up to 3 GPIO ports
- Motor bitmap tags indicate which motors share each DMA stream
- **DANGEROUS on F4** - ultimate fallback only, strong warnings displayed

**Example Configuration:**
```yaml
dma:
  DSHOT_CH1:
    dma: DMA1_STREAM1
    request: 42
    tag: MOTOR_01|MOTOR_02  # Port A motors
  DSHOT_CH2:
    dma: DMA1_STREAM2  
    request: 43
    tag: MOTOR_03|MOTOR_04  # Port B motors
```

### **STM32F4 DMA2 Errata 2.2.19 Avoidance (RESOLVED)**

**Issue:** Traditional bitbang DSHOT on F4 triggers silicon bug causing data corruption when DMA2 handles concurrent AHB/APB2 transfers.

**Solution Implementation:**
- **Automatic Detection**: `requiresDMA2ErrataAvoidance()` identifies affected MCUs
- **Mode Prioritization**: F4 targets automatically prefer DMAR/CCR over dangerous BB mode
- **Assignment Cleanup**: Existing BB assignments removed when migrating to safer modes
- **Clear Reporting**: Target headers indicate errata protection status

**Errata Protection Examples:**
```yaml
# F4 + DMAR capable → DMAR mode
# Motor Control: DMAR mode (Timer Burst DMA) - single stream for all 4 motors
# ✓ Benefits: Eliminates STM32F4 DMA2 errata 2.2.19, reduces resource usage

# F4 + Non-DMAR → CCR mode  
# Motor Control: CCR mode (Channel Register DMA) - individual channel transfers
# ✓ Benefits: STM32F4 DMA2 errata 2.2.19 avoided, flexible timer selection
```

### **Target Header Generation**

**Enhanced Headers** now include comprehensive DSHOT mode information:
```yaml
# DMA Assignment Summary
# Target: matekf405 (stm32f405)
# Architecture: fixed
# Total DMA assignments: 7
#
# Motor Control: DMAR mode (Timer Burst DMA) - single stream for all 4 motors
# ✓ Benefits: Eliminates STM32F4 DMA2 errata 2.2.19, reduces resource usage, atomic transfers
#
# DMA Device Assignments:
#   DSHOT_DMAR      -> ASSIGNED: DMA2_STREAM2 (ch7) [TIMER8]
#   SPI1_RX         -> ASSIGNED: DMA2_STREAM0 (ch3) [SPI1_MISO]
```

### **Key Implementation Patterns**

**Mode Detection Integration:**
```typescript
// Always detect mode first, then handle assignments accordingly
const dshotMode = detectDshotMode(target, mcu, gpio);

// Clean up incompatible assignments based on detected mode
switch (dshotMode.mode) {
    case 'DMAR': // Remove BB/CCR assignments
    case 'CCR':  // Remove BB/DMAR assignments  
    case 'BB':   // Remove DMAR/CCR assignments (DANGEROUS on F4)
}
```

**Custom Tag Support:**
```typescript
// Support motor bitmaps for BB mode
const addAssignment = (dev: string, tag: device_tag, allPeripherals: device_tag[], customTag?: string): boolean => {
    // Use customTag for motor bitmaps: "MOTOR_01|MOTOR_02"
    const finalTag = customTag || `${tag.type}${tag.index}${tag.func ? '_' + tag.func : ''}`.toUpperCase();
}
```

**Validation Built-In:**
- DMAR: Timer compatibility, channel ordering (1-4), DMAR capability
- CCR: F4-only restriction, timer channel availability (always available fallback)
- BB: GPIO port limits (max 3), motor distribution analysis (DANGEROUS on F4)

This implementation provides intelligent, automatic DSHOT optimization while ensuring robust errata protection for STM32F4 platforms.

## DSHOT Mode Regression Testing

### **Testing Strategy**

The DMA assignment system includes comprehensive regression testing to ensure no target moves to a worse DSHOT mode. The test suite:

1. **Processes all targets** in the repository and categorizes their DSHOT mode
2. **Enforces minimum expected modes** for key targets to prevent regression
3. **Reports statistics** on DSHOT mode distribution across all targets
4. **Fails immediately** if any target regresses from its expected minimum mode

### **DSHOT Mode Hierarchy (Context-Dependent Quality Ranking)**

**Universal Best:**
1. **DMAR Mode** - Timer Burst DMA, single stream for all 4 motors
   - ✅ Optimal resource usage and timing precision on all MCUs
   - ✅ Atomic transfers ensure perfect motor synchronization
   - ✅ Eliminates STM32F4 DMA2 errata 2.2.19 completely

**STM32F4 MCUs (Errata-Affected):**
2. **CCR Mode** - Individual Channel Register DMA 
   - ✅ STM32F4 errata safe (avoids DMA2 GPIO writes)
   - ✅ Flexible timer selection through constraint solving
   - ✅ Supports mixed timer configurations
3. **BB Mode** - Bitbang GPIO
   - ⚠️ **DANGEROUS on STM32F4** - exposes DMA2 errata risk
   - ⚠️ Only acceptable when hardware prevents DMA modes

**Non-F4 MCUs (F7/H7/G4/AT32):**
2. **BB Mode** - Bitbang GPIO (Equivalent to CCR)
   - ✅ **SAFE on non-F4** - no DMA2 errata risk
   - ✅ Flexible pin assignment with GPIO port grouping
   - ✅ Excellent fallback for mixed timer configurations
2. **CCR Mode** - Individual Channel Register DMA (F4-specific feature)
   - ⚠️ Not implemented for non-F4 MCUs (unnecessary)

### **Expected Minimum Modes (Regression Baselines)**

```typescript
const expectedMinimumModes = {
  'matekf405': 'DMAR',           // All motors on Timer8
  'speedybeef405aio': 'CCR',     // Constraint-solvable mixed timers
  'clracingf4': 'CCR',           // Constraint-solvable configuration
  'speedybeef405v3': 'BB',       // Timer4 CH4 lacks DMA (hardware limit)
  'tunercf405': 'BB',            // Hardware conflicts (PB0/PB8 → DMA1_STREAM7)
  'speedybeef405mini': 'CCR',    // Should be constraint-solvable
  'speedybeef405v4': 'CCR',      // Should be constraint-solvable
}
```

### **Running Regression Tests**

```bash
# Run all tests including regression suite
npm test

# Run only regression tests
npm test -- --grep "DSHOT Mode Regression"

# Run with coverage
npm run test:coverage
```

### **What to Check When a Target Regresses**

If the regression test fails with a message like:
```
❌ REGRESSIONS DETECTED:
  speedybeef405aio: expected ≥CCR, got BB
```

**Investigation Steps:**

1. **Check Motor Pin Configuration**
   ```bash
   # Examine the target's motor pins
   npx vite-node -e "console.log(YAML.parse(fs.readFileSync('targets/spbe-speedybeef405aio.yaml', 'utf8')).motor_pins)"
   ```

2. **Analyze GPIO Mappings**
   ```bash
   # Check what timers are available for each motor pin
   npm run targets dma targets/spbe-speedybeef405aio.yaml
   ```

3. **Debug Mode Detection**
   ```typescript
   // Add debug output to detectDshotMode function
   console.log('DMAR eligibility:', canUseDMAR(target, mcu, gpio))
   console.log('CCR eligibility:', canUseCCR(target, mcu, gpio))
   ```

4. **Check for Recent Changes**
   - Were motor pins reordered?
   - Were GPIO configurations updated?
   - Were DMA mappings modified?
   - Was the constraint-solving algorithm changed?

5. **Hardware Validation**
   - Verify timer availability for each motor pin in `mcu/{type}/gpio.yaml`
   - Check DMA stream assignments in `mcu/{type}/dma.yaml`
   - Confirm no new hardware limitations were discovered

6. **Algorithm Issues**
   - Test constraint-solving manually with the specific motor configuration
   - Check if new conflicts were introduced in DMA stream assignments
   - Verify scarcity analysis is working correctly

### **Common Regression Causes**

1. **MCU Configuration Changes**
   - Timer mappings removed from GPIO files
   - DMA assignments removed from DMA files
   - New hardware errata discovered

2. **Algorithm Bugs**
   - Constraint solver not finding valid solutions
   - Mode detection logic regression
   - DMA conflict detection failing

3. **Target Definition Changes**
   - Motor pins reordered in a way that breaks timer unity
   - New peripherals added that create DMA conflicts
   - MCU type changed to one with different capabilities

### **Acceptable Regression Scenarios**

A target moving to a "worse" mode is acceptable only if:

1. **Hardware Discovery** - New errata or limitations discovered
2. **Incorrect Baseline** - Previous mode was incorrectly achieved or not hardware-safe
3. **Trade-off Decision** - Deliberately accepting worse motor mode for other critical functionality

In these cases, update the `expectedMinimumModes` baseline after thorough validation.

### **Test Output Interpretation**

```bash
DSHOT Mode Distribution (89 targets):
  DMAR: 23 targets (25.8%)
  CCR:  44 targets (49.4%)
  BB:   22 targets (24.7%)
```

**Healthy Distribution (Context-Aware):**
- **DMAR**: 10-15% (premium targets with timer unity)
- **CCR**: 20-30% (F4 targets with constraint-solvable mixed timers)
- **BB**: 60-70% (mix of hardware-limited F4 and safe non-F4 targets)

**Warning Signs:**
- **F4 targets in BB mode > 80%** (too many dangerous F4 configurations)
- **CCR mode < 15% on F4** (constraint solver not working for F4)
- **DMAR mode < 5%** (timer detection issues)
- **Non-F4 targets using CCR** (unnecessary - BB is safe and equivalent)

This regression testing ensures the DMA assignment system continuously improves and never degrades target configurations, with proper context awareness that BB mode is only undesirable on STM32F4 MCUs due to DMA2 errata.

## Testing Infrastructure

### **Test Framework Setup**

The project uses **Vitest** for comprehensive testing of the DMA assignment system:

```bash
# Run all tests
npm test

# Watch mode for development
npm run test:watch

# Generate coverage reports
npm run test:coverage
```

### **Test Suite Organization**

**1. Core DMA Tests (`tests/dma.test.ts`)**
- DMA architecture detection (fixed vs flexible)
- Resource priority and scarcity handling
- STM32F4 errata avoidance validation
- Stream conflict detection and resolution
- Error handling for malformed targets

**2. DSHOT Mode Tests (`tests/dshot-modes.test.ts`)**
- DMAR mode requirements validation
- F4 errata detection and mode prioritization
- Timer DMAR support validation
- GPIO port grouping for BB mode
- Mode priority logic (DMAR > CCR > BB for F4)

**3. Integration Tests (`tests/integration.test.ts`)**
- Complete DMA assignment workflows
- Multi-MCU compatibility testing
- Header generation with comprehensive metadata
- Resource conflict resolution strategies
- End-to-end target processing

**4. Edge Cases (`tests/edge-cases.test.ts`)**
- Invalid target configurations
- Missing MCU data handling
- GPIO pin edge cases
- DMA resource exhaustion scenarios
- Special MCU cases (F411, AT32F435)
- Malformed input handling

### **Test Fixtures and Mocking**

**Mock MCU Data (`tests/fixtures/mock-mcu-data.ts`)**
- Representative GPIO/DMA configurations for F405, F411, G473
- Realistic pin mappings and DMA resource definitions
- Edge cases like Timer 8 absence on F411

**Mock Targets (`tests/fixtures/mock-targets.ts`)**
- Complete target configurations for different MCUs
- Invalid configurations for error testing
- Mixed timer scenarios for mode detection

### **Key Testing Patterns**

**1. Comprehensive Mocking Strategy**
```typescript
// Mock fs module for MCU data loading
vi.mock('fs', () => ({
  default: {
    promises: {
      readdir: vi.fn(),
      readFile: vi.fn()
    }
  }
}))

// Dynamic file content based on path
mockedReadFile.mockImplementation((filePath: string) => {
  if (pathStr.includes('stm32f405/gpio.yaml')) {
    return Promise.resolve(YAML.stringify(mockF405GPIO))
  }
  // ... handle other MCU files
})
```

**2. DSHOT Mode Validation**
```typescript
// Verify DMAR mode detection
const result = await findDmaAssignments(target)
expect((result as any)._dshotMode?.mode).toBe('DMAR')
expect((result as any)._dshotMode?.timer?.index).toBe(2)
```

**3. Conflict Detection Testing**
```typescript
// Ensure no duplicate stream assignments
const assignedStreams = new Set<string>()
Object.values(result.dma || {}).forEach((assignment: any) => {
  if (assignment.dma) {
    expect(assignedStreams.has(assignment.dma)).toBe(false)
    assignedStreams.add(assignment.dma)
  }
})
```

**4. Errata Protection Validation**
```typescript
// Verify F4 errata warnings
if ((result as any)._dshotMode?.mode === 'BB') {
  expect((result as any)._dshotMode?.reason).toContain('DANGEROUS')
}
```

### **Coverage Goals**

The test suite aims for comprehensive coverage of:
- **Core Algorithm Logic**: 90%+ coverage of DMA assignment functions
- **Error Paths**: All error conditions and edge cases
- **Platform Variations**: All supported MCU architectures
- **DSHOT Modes**: Complete coverage of DMAR/CCR/BB mode logic
- **Resource Management**: Scarcity analysis and conflict resolution

### **Testing Best Practices**

**1. Mock Real MCU Data**: Use actual GPIO/DMA mappings from MCU files
**2. Test Internal State**: Validate `_dshotMode`, `_dmaStatus` tracking
**3. Verify Side Effects**: Check stream usage, conflict resolution
**4. Test Error Recovery**: Ensure graceful degradation on failures
**5. Platform-Specific Logic**: Test F4 errata, AT32 differences, G4/H7 flexibility

### **Running Tests During Development**

```bash
# Quick test run
npm test

# Watch specific test file
npm run test:watch -- dma.test.ts

# Coverage for specific module
npm run test:coverage -- tests/dma.test.ts

# Debug specific test
npm run test:watch -- --reporter=verbose dshot-modes.test.ts
```

The comprehensive test suite ensures the DMA assignment system remains robust across 500+ target configurations while maintaining safety-critical errata protections for STM32F4 platforms.

## Development Lessons Learned

### **TypeScript Function Signatures**
When extending existing functions, always check all call sites to ensure parameter compatibility:
```typescript
// Before: Limited function signature
const addAssignment = (dev: string, tag: device_tag, allPeripherals: device_tag[]): boolean => {}

// After: Extended with optional parameter
const addAssignment = (dev: string, tag: device_tag, allPeripherals: device_tag[], customTag?: string): boolean => {}

// Critical: Update ALL call sites with the new parameter
addAssignment("RGB", timer.tag, allPeripherals, undefined);  // ✅ Explicit undefined
addAssignment(`DSHOT_CH${i}`, portTag, allPeripherals, motorBitmap);  // ✅ Custom tag
```

### **Mode Detection State Management**
Store computed state in the target object for header generation:
```typescript
// Store complex analysis results for later use
const result = { ...target, dma: finalDmaEntries };
(result as any)._dshotMode = dshotMode;  // Preserve detection results
(result as any)._dmaStatus = peripheralStatus;  // Preserve assignment status

// Later retrieval in header generation
const dshotMode = (target as any)._dshotMode;
if (dshotMode) { /* generate mode-specific headers */ }
```

### **Optional Chaining for Robustness**
Use optional chaining when checking nested properties that may not exist:
```typescript
// ❌ Fragile: target.dma might be undefined
const hasCCR = ['DSHOT_M0', 'DSHOT_M1'].some(d => target.dma[d]);

// ✅ Robust: Handles undefined target.dma gracefully  
const hasCCR = ['DSHOT_M0', 'DSHOT_M1'].some(d => target.dma?.[d]);
```

### **Incremental Algorithm Development**
When implementing complex detection logic:
1. **Start with existing assignment detection** (preserve user configurations)
2. **Add capability analysis** (what CAN the hardware do?)
3. **Apply platform constraints** (what SHOULD we use for this MCU?)
4. **Implement fallback logic** (what happens when ideal modes impossible?)

### **Debug-Driven Development**
Strategic debug output helps validate complex algorithms:
```typescript
console.log('DEBUG: Detected DSHOT mode:', dshotMode);
// Reveals: { mode: 'DMAR', reason: 'eliminates F4 errata', timer: { type: 'timer', index: 8 } }

// Remove debug output once algorithm validated
```

### **Header Generation Integration**
Complex algorithms need clear user-facing explanations:
```typescript
switch (dshotMode.mode) {
    case 'DMAR':
        lines.push(`# Motor Control: DMAR mode (Timer Burst DMA) - single stream for all 4 motors`);
        if (isF4ErrataAffected) {
            lines.push(`# ✓ Benefits: Eliminates STM32F4 DMA2 errata 2.2.19, reduces resource usage`);
        }
        break;
    // Clear explanations for each mode choice
}
```

### **Platform-Specific Logic Patterns**
Use consistent patterns for platform detection and handling:
```typescript
// Consistent errata detection
function requiresDMA2ErrataAvoidance(mcu: string): boolean {
    const errataAffectedMCUs = ['stm32f405', 'stm32f407', 'stm32f415', 'stm32f417'];
    return errataAffectedMCUs.some(affected => mcu.toLowerCase().startsWith(affected));
}

// Consistent mode prioritization
if (isF4ErrataAffected) {
    // F4-specific safe mode selection
} else {
    // Non-F4 optimal mode selection  
}
```

### **Assignment Cleanup Strategy**
When changing modes, systematically clean up incompatible assignments:
```typescript
// Mode-specific cleanup prevents conflicts
switch (dshotMode.mode) {
    case 'DMAR':
        // Remove BB and CCR assignments - they conflict with DMAR
        ['DSHOT_CH1', 'DSHOT_CH2', 'DSHOT_CH3', 'DSHOT_M0', 'DSHOT_M1'].forEach(key => {
            delete existingDmaEntries[key];
        });
        break;
    // Systematic cleanup for each mode
}
```

### **Testing Strategy**
Test edge cases and mode transitions:
1. **Fresh targets** (no existing DMA) → Auto-detection
2. **Existing configurations** → Mode preservation vs. upgrade
3. **F4 errata scenarios** → Safety prioritization
4. **Resource conflicts** → Graceful fallbacks
5. **Mixed configurations** → Cleanup and migration

### **Documentation-Driven Implementation**
The detailed specification documents (DSHOT_DMAR_IMPLEMENTATION.md, TARGET_GENERATION_DMAR_CHANGES.md) were essential for:
- Understanding complex requirements before coding
- Validating implementation against specifications  
- Ensuring comprehensive coverage of edge cases
- Providing examples for testing scenarios

## Testing and Quality Assurance

### **Running the Test Suite**

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run with coverage
npm run test:coverage

# Run specific test suites
npm test -- --grep "DSHOT Mode Regression"
npm test -- --grep "Constraint Solving"
```

### **Test Categories**

1. **Unit Tests** - Individual function validation
2. **Integration Tests** - Full DMA assignment pipeline
3. **Regression Tests** - DSHOT mode quality assurance
4. **Performance Tests** - All-target processing validation

The regression test suite is particularly important as it prevents any target from moving to a worse DSHOT mode, ensuring continuous improvement of the system.

# important-instruction-reminders
Do what has been asked; nothing more, nothing less.
NEVER create files unless they're absolutely necessary for achieving your goal.
ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.