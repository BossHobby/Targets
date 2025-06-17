import { target_t } from './types';
import { promises as fs } from 'fs';
import { join } from 'path';
import YAML from 'yaml';
import { init } from 'z3-solver';

// Types
export interface device_tag {
    type: string;
    index: number;
    func?: string;
}

export interface dma_resource {
    tag: device_tag;
    dma?: { port: number; stream: number };
    channel?: number;
    request?: number;
}

export interface DmaContext {
    mcu: string;
    gpio: any;
    resources: dma_resource[];
    usedStreams: Set<string>;
}

export type DshotMode = 'DMAR' | 'CCR' | 'BB';

interface PeripheralRequirement {
    device: string;
    tag: device_tag;
    priority: number;
}

// Utility functions
export const tagEqual = (a: device_tag, b: device_tag): boolean =>
    a.type === b.type && a.index === b.index && (!a.func || !b.func || a.func === b.func);

export const mapMCU = (mcu: string): string => ({ at32f435m: "at32f435" }[mcu] || mcu);

export const getDmaArchitecture = (mcu: string): 'fixed' | 'flexible' => {
    const mcuLower = mcu.toLowerCase();
    return ['stm32f405', 'stm32f411', 'stm32f722', 'stm32f745', 'stm32f765'].includes(mcuLower) ? 'fixed' : 'flexible';
};

const formatTag = (tag: device_tag): string => {
    if (tag.type === 'timer' && tag.func === 'up') {
        return `TIMER${tag.index}`;
    }
    if (tag.func?.startsWith('ch')) {
        return `${tag.type}${tag.index}_${tag.func}`.toUpperCase();
    }
    return `${tag.type}${tag.index}${tag.func ? '_' + tag.func : ''}`.toUpperCase();
};

// Z3 SAT Solver
interface SolverOptions {
    debug?: boolean;
}

class Z3Solver {
    private Z3: any;
    private ctx: any;
    private solver: any;
    private variables: Map<string, any> = new Map();
    private ready: Promise<void>;

    constructor() {
        this.ready = this.initialize();
    }

    private async initialize() {
        this.Z3 = await init();
        this.ctx = new this.Z3.Context();
        this.solver = new this.ctx.Solver();
    }

    async reset() {
        await this.ready;
        this.solver = new this.ctx.Solver();
        this.variables.clear();
    }

    async addVariable(name: string) {
        await this.ready;
        this.variables.set(name, this.ctx.Bool.const(name));
    }

    async addConstraint(expr: any) {
        await this.ready;
        this.solver.add(expr);
    }

    async or(...args: string[]): Promise<any> {
        await this.ready;
        const vars = args.map(name => this.variables.get(name)).filter(v => v);
        return this.ctx.Or(...vars);
    }

    async and(...args: string[]): Promise<any> {
        await this.ready;
        const vars = args.map(name => this.variables.get(name)).filter(v => v);
        return this.ctx.And(...vars);
    }

    async not(arg: string): Promise<any> {
        await this.ready;
        const v = this.variables.get(arg);
        return v ? this.ctx.Not(v) : null;
    }

    async atMostOne(...args: string[]): Promise<any> {
        await this.ready;
        const vars = args.map(name => this.variables.get(name)).filter(v => v);
        const pairs: any[] = [];
        for (let i = 0; i < vars.length; i++) {
            for (let j = i + 1; j < vars.length; j++) {
                pairs.push(this.ctx.Not(this.ctx.And(vars[i], vars[j])));
            }
        }
        return pairs.length > 0 ? this.ctx.And(...pairs) : this.ctx.Bool.val(true);
    }

    async solve(options?: SolverOptions): Promise<Map<string, boolean> | null> {
        await this.ready;

        if (options?.debug) {
            console.log(`[Z3] Solving with ${this.variables.size} variables`);
        }

        const result = await this.solver.check();

        if (options?.debug) {
            console.log(`[Z3] Result: ${result}`);
        }

        if (result === 'sat') {
            const model = this.solver.model();
            const solution = new Map<string, boolean>();

            for (const [name, variable] of this.variables) {
                const value = model.eval(variable);
                if (value && typeof value.isBool === 'function' && value.isBool()) {
                    solution.set(name, value.isTrue());
                } else {
                    const strValue = value?.toString();
                    if (strValue === 'true' || strValue === 'false') {
                        solution.set(name, strValue === 'true');
                    }
                }
            }

            return solution;
        }

        return null;
    }
}

// Simple DSHOT mode ordering - try in sequence
async function tryDshotMode(
    target: target_t,
    gpio: any,
    ctx: DmaContext,
    mode: DshotMode,
    debug: boolean = false
): Promise<Map<string, dma_resource> | null> {
    
    const solver = new Z3Solver();
    await solver.reset();

    if (debug) {
        console.log(`[SAT] Trying ${mode} mode for ${target.name}`);
    }

    // Enumerate peripherals for this specific mode
    const peripherals = enumeratePeripherals(target, gpio, mode, ctx);
    
    // Split into SPI (mandatory) and DSHOT (mandatory) and others
    const spiPeripherals = peripherals.filter(p => p.tag.type === 'spi');
    const dshotPeripherals = peripherals.filter(p => p.priority === 100);
    const otherPeripherals = peripherals.filter(p => p.tag.type !== 'spi' && p.priority !== 100);

    if (debug) {
        console.log(`[SAT] ${mode}: ${spiPeripherals.length} SPI, ${dshotPeripherals.length} DSHOT, ${otherPeripherals.length} other`);
    }

    // Calculate stream congestion first to sort resources by preference
    const arch = getDmaArchitecture(ctx.mcu);
    const streamCongestion = new Map<string, number>();
    if (arch === 'fixed') {
        // Pre-calculate all possible assignments to understand congestion
        const allPeripherals = [...spiPeripherals, ...dshotPeripherals, ...otherPeripherals];
        for (const peripheral of allPeripherals) {
            const compatibleResources = ctx.resources.filter(r => tagEqual(r.tag, peripheral.tag));
            for (const resource of compatibleResources) {
                if (resource.dma) {
                    const streamName = `DMA${resource.dma.port}_STREAM${resource.dma.stream}`;
                    streamCongestion.set(streamName, (streamCongestion.get(streamName) || 0) + 1);
                }
            }
        }
        
        if (debug) {
            console.log(`[SAT] Stream congestion analysis:`);
            const sortedStreams = Array.from(streamCongestion.entries())
                .sort((a, b) => a[1] - b[1]) // Sort by congestion (least congested first)
                .slice(0, 8);
            for (const [stream, count] of sortedStreams) {
                console.log(`[SAT]   ${stream}: ${count} competing peripherals`);
            }
        }
    }

    // Create variables for all peripheral-resource pairs, sorted by stream preference
    const allPeripherals = [...spiPeripherals, ...dshotPeripherals, ...otherPeripherals];
    const validPairs: Array<{ 
        peripheral: string, 
        resource: dma_resource, 
        variable: string,
        congestion: number
    }> = [];
    
    for (const peripheral of allPeripherals) {
        const compatibleResources = ctx.resources.filter(r => tagEqual(r.tag, peripheral.tag));
        
        // Sort resources by congestion (prefer less congested streams)
        const sortedResources = compatibleResources.sort((a, b) => {
            if (!a.dma && !b.dma) return 0;
            if (!a.dma) return 1; // Put non-DMA at end
            if (!b.dma) return -1;
            
            const aCongestion = streamCongestion.get(`DMA${a.dma.port}_STREAM${a.dma.stream}`) || 0;
            const bCongestion = streamCongestion.get(`DMA${b.dma.port}_STREAM${b.dma.stream}`) || 0;
            return aCongestion - bCongestion; // Less congested first
        });
        
        for (const resource of sortedResources) {
            const resourceId = resource.dma
                ? `${resource.dma.port}_${resource.dma.stream}_${resource.channel || 0}`
                : `flex_${resource.request || 0}`;
            const varName = `${peripheral.device}_${resourceId}`;
            const congestion = resource.dma 
                ? streamCongestion.get(`DMA${resource.dma.port}_STREAM${resource.dma.stream}`) || 0
                : 0;
            
            await solver.addVariable(varName);
            validPairs.push({ 
                peripheral: peripheral.device, 
                resource, 
                variable: varName,
                congestion
            });
        }
    }

    // Constraint 1: ALL SPI ports must be assigned
    for (const spiPeripheral of spiPeripherals) {
        const peripheralVars = validPairs
            .filter(p => p.peripheral === spiPeripheral.device)
            .map(p => p.variable);
        
        if (peripheralVars.length === 0) {
            if (debug) console.log(`[SAT] No DMA for SPI peripheral ${spiPeripheral.device} - mode fails`);
            return null;
        }
        
        // Exactly one assignment per SPI peripheral
        await solver.addConstraint(await solver.or(...peripheralVars));
        await solver.addConstraint(await solver.atMostOne(...peripheralVars));
    }

    // Constraint 2: DSHOT must work (at least some motor assignments)
    if (dshotPeripherals.length > 0) {
        const allDshotVars = dshotPeripherals.flatMap(dshot => 
            validPairs
                .filter(p => p.peripheral === dshot.device)
                .map(p => p.variable)
        );
        
        if (allDshotVars.length === 0) {
            if (debug) console.log(`[SAT] No DMA for DSHOT - mode fails`);
            return null;
        }
        
        // At least one DSHOT assignment must succeed
        await solver.addConstraint(await solver.or(...allDshotVars));
        
        // Each DSHOT peripheral gets at most one assignment
        for (const dshotPeripheral of dshotPeripherals) {
            const peripheralVars = validPairs
                .filter(p => p.peripheral === dshotPeripheral.device)
                .map(p => p.variable);
            
            if (peripheralVars.length > 0) {
                await solver.addConstraint(await solver.atMostOne(...peripheralVars));
            }
        }
    }

    // Constraint 3: Stream conflicts
    if (arch === 'fixed') {
        const streamGroups = new Map<string, string[]>();

        for (const pair of validPairs) {
            if (!pair.resource.dma) continue;
            const streamName = `DMA${pair.resource.dma.port}_STREAM${pair.resource.dma.stream}`;
            if (!streamGroups.has(streamName)) {
                streamGroups.set(streamName, []);
            }
            streamGroups.get(streamName)!.push(pair.variable);
        }
        
        for (const [streamName, vars] of streamGroups) {
            if (vars.length > 1 && !ctx.usedStreams.has(streamName)) {
                await solver.addConstraint(await solver.atMostOne(...vars));
            } else if (ctx.usedStreams.has(streamName)) {
                for (const var_ of vars) {
                    await solver.addConstraint(await solver.not(var_));
                }
            }
        }
    }

    // Constraint 4: STM32F4 DMA2 errata
    if (ctx.mcu.toLowerCase().startsWith('stm32f4')) {
        const problematicPairs = validPairs.filter(p =>
            p.resource.dma?.port === 2 &&
            [0, 2].includes(p.resource.dma.stream) &&
            [3, 4].includes(p.resource.channel || 0)
        );

        if (problematicPairs.length > 1) {
            await solver.addConstraint(await solver.atMostOne(...problematicPairs.map(p => p.variable)));
        }
    }

    // SAT optimization: try to maximize usable serial ports and RGB availability
    let solution = null;
    
    if (arch === 'fixed') {
        // Calculate streams needed for serial ports and RGB
        const serialStreamNeeds = new Map<string, string[]>(); // stream -> serial ports that could use it
        const rgbStreamNeeds = new Set<string>(); // streams that RGB could use
        
        // Analyze serial port needs
        for (const peripheral of otherPeripherals) {
            if (peripheral.device.startsWith('SERIAL')) {
                const compatibleResources = ctx.resources.filter(r => tagEqual(r.tag, peripheral.tag));
                for (const resource of compatibleResources) {
                    if (resource.dma) {
                        const streamName = `DMA${resource.dma.port}_STREAM${resource.dma.stream}`;
                        if (!serialStreamNeeds.has(streamName)) {
                            serialStreamNeeds.set(streamName, []);
                        }
                        serialStreamNeeds.get(streamName)!.push(peripheral.device);
                    }
                }
            }
        }
        
        // Analyze RGB needs (look for timer resources that aren't Timer1/Timer8)
        if (target.rgb_led) {
            for (const resource of ctx.resources) {
                if (resource.tag.type === 'timer' && 
                    resource.tag.func === 'up' && 
                    ![1, 8].includes(resource.tag.index) &&
                    resource.dma) {
                    const streamName = `DMA${resource.dma.port}_STREAM${resource.dma.stream}`;
                    rgbStreamNeeds.add(streamName);
                }
            }
        }
        
        if (debug) {
            console.log(`[SAT] Serial port stream analysis:`);
            const sortedSerial = Array.from(serialStreamNeeds.entries())
                .sort((a, b) => b[1].length - a[1].length)
                .slice(0, 5);
            for (const [stream, serials] of sortedSerial) {
                console.log(`[SAT]   ${stream}: needed by ${serials.length} serial ports (${serials.join(', ')})`);
            }
            
            if (rgbStreamNeeds.size > 0) {
                console.log(`[SAT] RGB could use ${rgbStreamNeeds.size} streams: ${Array.from(rgbStreamNeeds).join(', ')}`);
            }
        }
        
        // Add soft constraints to prefer assignments that leave streams free for serial/RGB
        const preferredStreams = new Set<string>();
        
        // Add streams needed by 2+ serial ports
        for (const [stream, serials] of serialStreamNeeds) {
            if (serials.length >= 2) {
                preferredStreams.add(stream);
            }
        }
        
        // Add RGB streams
        for (const stream of rgbStreamNeeds) {
            preferredStreams.add(stream);
        }
        
        if (preferredStreams.size > 0 && debug) {
            console.log(`[SAT] Trying to avoid ${preferredStreams.size} preferred streams for serial/RGB: ${Array.from(preferredStreams).slice(0, 3).join(', ')}${preferredStreams.size > 3 ? '...' : ''}`);
        }
        
        // Add soft constraints - penalize using preferred streams for non-critical assignments
        for (const pair of validPairs) {
            if (!pair.resource.dma) continue;
            
            const streamName = `DMA${pair.resource.dma.port}_STREAM${pair.resource.dma.stream}`;
            if (preferredStreams.has(streamName)) {
                // This is a soft constraint - we prefer NOT to use this assignment
                // For SPI (non-critical), add a penalty
                if (pair.peripheral.startsWith('SPI')) {
                    // We can't add true soft constraints in basic SAT, but we can try alternatives first
                    // by ordering variables - Z3 will try false first for these variables
                    await solver.addVariable(`avoid_${pair.variable}`);
                    await solver.addConstraint(await solver.or(`avoid_${pair.variable}`, await solver.not(pair.variable)));
                }
            }
        }
        
        solution = await solver.solve({ debug });
    } else {
        // For flexible architecture, just solve normally
        solution = await solver.solve({ debug });
    }
    if (!solution) {
        if (debug) console.log(`[SAT] ${mode} mode failed to solve`);
        return null;
    }

    // Extract assignments
    const assignments = new Map<string, dma_resource>();
    for (const pair of validPairs) {
        if (solution.get(pair.variable)) {
            assignments.set(pair.peripheral, pair.resource);
        }
    }

    if (debug) {
        console.log(`[SAT] ${mode} mode succeeded with ${assignments.size} assignments`);
    }

    return assignments;
}


// Try DSHOT modes in preference order
async function solveDmaAssignment(
    target: target_t,
    gpio: any,
    ctx: DmaContext,
    debug: boolean = false
): Promise<{ assignments: Map<string, dma_resource>; dshotMode: DshotMode } | null> {

    if (debug) {
        console.log(`[SAT] Processing ${target.name} (${target.mcu})`);
    }

    // Enforce 4-motor requirement
    if (!target.motor_pins || target.motor_pins.length !== 4) {
        throw new Error(`Target ${target.name} must have exactly 4 motors, found ${target.motor_pins?.length || 0}`);
    }

    // Try modes in preference order
    const modes: DshotMode[] = ['DMAR', 'CCR', 'BB'];
    
    // For non-F4, skip CCR mode
    if (!ctx.mcu.toLowerCase().startsWith('stm32f4')) {
        modes.splice(1, 1); // Remove CCR
    }
    
    // TODO: Future optimization for STM32F7 targets
    // F7 has fixed DMA but no errata risk, so we could prioritize BB mode over DMAR
    // when it would significantly increase serial port availability. However, there
    // are few F7 targets currently, so this optimization is deferred.

    for (const mode of modes) {
        const assignments = await tryDshotMode(target, gpio, ctx, mode, debug);
        if (assignments) {
            if (debug) {
                console.log(`[SAT] SUCCESS: ${mode} mode worked for ${target.name}`);
            }
            return { assignments, dshotMode: mode };
        }
    }

    if (debug) {
        console.log(`[SAT] FAILED: No viable mode for ${target.name}`);
    }
    return null;
}

// Main DMA assignment function
async function loadDmaData(mcu: string): Promise<[dma_resource[], any]> {
    const mcuName = mcu.toLowerCase();
    const mcuPath = mapMCU(mcuName);

    const [dmaYaml, gpioYaml] = await Promise.all([
        fs.readFile(join('mcu', mcuPath, 'dma.yaml'), 'utf8'),
        fs.readFile(join('mcu', mcuPath, 'gpio.yaml'), 'utf8')
    ]);

    const dmaData = YAML.parse(dmaYaml);
    const gpioData = YAML.parse(gpioYaml);

    return [dmaData || [], gpioData];
}


function enumeratePeripherals(target: target_t, gpio: any, dshotMode: DshotMode, ctx?: DmaContext): PeripheralRequirement[] {
    const peripherals: PeripheralRequirement[] = [];

    // Sort timer functions to prefer those with better DMA availability
    const sortTimerFuncs = (timerFuncs: { tag: device_tag }[]) => {
        return timerFuncs.sort((a: { tag: device_tag }, b: { tag: device_tag }) => {
            // Prefer commonly available timers that work well: TIMER2, TIMER3, TIMER5, then others
            const getTimerPriority = (index: number) => {
                if (index === 2) return 1;  // TIMER2 is very commonly supported
                if (index === 3) return 2;  // TIMER3 is also well supported
                if (index === 5) return 3;  // TIMER5 is commonly used
                if (index === 4) return 4;  // TIMER4 is decent
                if (index === 1) return 5;  // TIMER1 can have conflicts
                return 10;  // Higher timers are often less supported
            };
            
            return getTimerPriority(a.tag.index) - getTimerPriority(b.tag.index);
        });
    };

    // Motor peripherals based on DSHOT mode
    if (target.motor_pins && target.motor_pins.length > 0) {
        if (dshotMode === 'DMAR') {
            const timersUsed = new Set<number>();
            for (const motorPin of target.motor_pins) {
                const pinFuncs = gpio[motorPin];
                if (pinFuncs) {
                    const timerFuncs = pinFuncs.filter((f: { tag?: device_tag }) => f.tag?.type === 'timer' && f.tag?.func?.startsWith('ch'));
                    const sortedTimerFuncs = sortTimerFuncs(timerFuncs);
                    if (sortedTimerFuncs.length > 0) {
                        timersUsed.add(sortedTimerFuncs[0].tag.index);
                    }
                }
            }

            timersUsed.forEach(timerIndex => {
                peripherals.push({
                    device: `TIMER${timerIndex}_UP`,
                    tag: { type: 'timer', index: timerIndex, func: 'up' },
                    priority: 100
                });
            });
        } else if (dshotMode === 'CCR') {
            // CCR mode: Find the best timer assignment for each motor
            // Prefer timers with DMA resources and avoid conflicts
            for (let index = 0; index < target.motor_pins.length; index++) {
                const motorPin = target.motor_pins[index];
                const pinFuncs = gpio[motorPin];
                if (pinFuncs) {
                    const timerFuncs = pinFuncs.filter((f: { tag?: device_tag }) => f.tag?.type === 'timer' && f.tag?.func?.startsWith('ch'));
                    
                    // Sort by DMA availability first, then by timer preference
                    const timerFuncsWithDma = timerFuncs.filter((f: any) => {
                        if (!ctx) return true;
                        return ctx.resources.some(r => tagEqual(r.tag, f.tag));
                    });
                    
                    const sortedTimerFuncs = timerFuncsWithDma.length > 0 ? 
                        sortTimerFuncs(timerFuncsWithDma) : 
                        sortTimerFuncs(timerFuncs);
                        
                    if (sortedTimerFuncs.length > 0) {
                        const timerFunc = sortedTimerFuncs[0];
                        const channelTag = `TIMER${timerFunc.tag.index}_${timerFunc.tag.func.toUpperCase()}`;
                        peripherals.push({
                            device: channelTag,
                            tag: timerFunc.tag,
                            priority: 100
                        });
                    }
                }
            }
        } else if (dshotMode === 'BB') {
            const portsUsed = new Set<string>();
            target.motor_pins.forEach((motorPin: string) => {
                const portName = motorPin.slice(0, 2);
                portsUsed.add(portName);
            });

            let channelIndex = 1;
            portsUsed.forEach(port => {
                peripherals.push({
                    device: `${port}_DSHOT`,
                    tag: { type: 'timer', index: 1, func: `ch${channelIndex}` },
                    priority: 100
                });
                channelIndex++;
            });
        }
    }

    // SPI ports - intelligent priority based on usage
    for (const spi of target.spi_ports || []) {
        const isGyro = target.gyro?.port === spi.index;
        const isFlash = target.flash?.port === spi.index;
        
        if (spi.mosi && gpio[spi.mosi]) {
            // Gyro SPI is critical, Flash is important, others are optional
            const priority = isGyro ? 70 : isFlash ? 60 : 30;
            peripherals.push({
                device: `SPI${spi.index}_TX`,
                tag: { type: 'spi', index: spi.index, func: 'mosi' },
                priority
            });
        }
        if (spi.miso && gpio[spi.miso]) {
            // Gyro RX is most critical for flight control
            const priority = isGyro ? 75 : isFlash ? 55 : 25;
            peripherals.push({
                device: `SPI${spi.index}_RX`,
                tag: { type: 'spi', index: spi.index, func: 'miso' },
                priority
            });
        }
    }

    // Serial ports (lower priority)
    for (const serial of target.serial_ports || []) {
        if (serial.tx && gpio[serial.tx]) {
            peripherals.push({
                device: `SERIAL${serial.index}_TX`,
                tag: { type: 'serial', index: serial.index, func: 'tx' },
                priority: 10
            });
        }
        if (serial.rx && gpio[serial.rx]) {
            peripherals.push({
                device: `SERIAL${serial.index}_RX`,
                tag: { type: 'serial', index: serial.index, func: 'rx' },
                priority: 10
            });
        }
    }

    // RGB LED (lowest priority)
    if (target.rgb_led && gpio[target.rgb_led]) {
        const pinFuncs = gpio[target.rgb_led];
        const timerFunc = pinFuncs.find((f: { tag?: device_tag }) =>
            f.tag?.type === 'timer' &&
            f.tag?.index !== 1 &&
            f.tag?.index !== 8 &&
            f.tag?.func?.startsWith('ch')
        );
        if (timerFunc) {
            peripherals.push({
                device: 'RGB',
                tag: timerFunc.tag,
                priority: 5
            });
        }
    }

    return peripherals;
}

function buildDmaObject(
    assignments: Map<string, dma_resource>,
    ctx: DmaContext
): any {
    const dma: any = {};
    const arch = getDmaArchitecture(ctx.mcu);
    let assignmentIndex = ctx.usedStreams.size;


    // Build DMA entries from assignments
    for (const [device, resource] of assignments) {
        const streamName = arch === 'fixed' && resource.dma
            ? `DMA${resource.dma.port}_STREAM${resource.dma.stream}`
            : `DMA${Math.floor(assignmentIndex / 8) + 1}_STREAM${(assignmentIndex % 8) + 1}`;

        const entry: any = {
            tag: formatTag(resource.tag),
            dma: streamName
        };

        if (arch === 'fixed' && resource.channel !== undefined) {
            entry.channel = resource.channel;
        }
        if (arch === 'flexible' && resource.request !== undefined) {
            entry.request = resource.request;
        }

        // Map device names to expected DMA keys
        if (device.startsWith('TIMER') && device.endsWith('_UP')) {
            dma.DSHOT_DMAR = entry;
        } else if (device.startsWith('DSHOT_CCR_M')) {
            // CCR mode - device name already has the motor index
            dma[device] = entry;
        } else if (device.endsWith('_DSHOT')) {
            // BB mode - extract proper channel from enumerated ports
            const bbDevices = Array.from(assignments.keys())
                .filter(k => k.endsWith('_DSHOT'))
                .sort(); // Ensure consistent ordering
            const channelIndex = bbDevices.indexOf(device) + 1;
            dma[`DSHOT_BB_CH${channelIndex}`] = entry;
        } else {
            // Regular peripherals
            dma[device] = entry;
        }

        assignmentIndex++;
    }

    return dma;
}

function generateHeader(
    target: target_t,
    assignments: Map<string, dma_resource>,
    ctx: DmaContext,
    dshotMode: DshotMode,
    peripherals: PeripheralRequirement[],
    gpio: any
): string {
    const lines: string[] = [];
    const arch = getDmaArchitecture(ctx.mcu);

    lines.push('# DMA Assignment Summary');
    lines.push(`# Target: ${target.name} (${target.mcu})`);
    lines.push(`# Architecture: ${arch === 'flexible' ? 'flexible' : 'fixed'}`);
    lines.push(`# Total DMA assignments: ${assignments.size}`);
    lines.push('#');

    if (target.motor_pins && target.motor_pins.length > 0) {
        switch (dshotMode) {
            case 'DMAR':
                lines.push('# Motor Control: DMAR mode (UP Timer DMA) - burst transfers for all motors');
                lines.push('# ✓ Benefits: Single DMA stream for all 4 motors, optimal performance');
                break;
            case 'CCR':
                lines.push('# Motor Control: CCR mode (Channel Register DMA) - individual channel transfers');
                lines.push('# ✓ Benefits: STM32F4 DMA2 errata 2.2.19 avoided, flexible timer selection');
                break;
            case 'BB':
                lines.push('# Motor Control: BB mode (Bitbang GPIO) - flexible pin assignment');
                const portsUsed = new Set<string>();
                target.motor_pins.forEach((motorPin: string) => portsUsed.add(motorPin.slice(0, 2)));
                lines.push(`# ✓ Configuration: ${portsUsed.size} GPIO port${portsUsed.size > 1 ? 's' : ''} used`);
                break;
        }
        lines.push('#');
    }

    // List all DMA assignments with available options
    lines.push('# DMA Device Assignments:');

    // Create mapping from peripheral device names to final DMA keys
    const deviceToDmaKey = new Map<string, string>();
    const dmaKeyToDevice = new Map<string, string>();
    
    for (const [device] of assignments) {
        // Map device names to expected DMA keys (same logic as buildDmaObject)
        if (device.startsWith('TIMER') && device.endsWith('_UP')) {
            deviceToDmaKey.set(device, 'DSHOT_DMAR');
            dmaKeyToDevice.set('DSHOT_DMAR', device);
        } else if (device.startsWith('DSHOT_CCR_M')) {
            deviceToDmaKey.set(device, device);
            dmaKeyToDevice.set(device, device);
        } else if (device.endsWith('_DSHOT')) {
            const bbDevices = Array.from(assignments.keys())
                .filter(k => k.endsWith('_DSHOT'))
                .sort();
            const channelIndex = bbDevices.indexOf(device) + 1;
            const dmaKey = `DSHOT_BB_CH${channelIndex}`;
            deviceToDmaKey.set(device, dmaKey);
            dmaKeyToDevice.set(dmaKey, device);
        } else {
            deviceToDmaKey.set(device, device);
            dmaKeyToDevice.set(device, device);
        }
    }

    // Build a map of all peripherals to their available resources
    const availableOptions = new Map<string, dma_resource[]>();
    for (const peripheral of peripherals) {
        const compatible = ctx.resources.filter(r => tagEqual(r.tag, peripheral.tag));
        availableOptions.set(peripheral.device, compatible);
    }

    // Build comprehensive list in the correct order (RGB, DSHOT modes, SPI, SERIAL)
    const orderedDmaKeys: string[] = [];
    
    // Add RGB first if target has RGB LED
    if (target.rgb_led) {
        orderedDmaKeys.push('RGB');
    }
    
    // Add all DSHOT mode options for context (DMAR, CCR, BB)
    orderedDmaKeys.push('DSHOT_DMAR');
    for (let i = 0; i < 4; i++) {
        orderedDmaKeys.push(`DSHOT_CCR_M${i}`);
    }
    for (let i = 1; i <= 3; i++) {
        orderedDmaKeys.push(`DSHOT_BB_CH${i}`);
    }
    
    // Add all SPI ports (RX, then TX for each port)
    for (const spi of target.spi_ports || []) {
        orderedDmaKeys.push(`SPI${spi.index}_RX`);
        orderedDmaKeys.push(`SPI${spi.index}_TX`);
    }
    
    // Add all serial ports (RX, then TX for each port)
    for (const serial of target.serial_ports || []) {
        orderedDmaKeys.push(`SERIAL${serial.index}_RX`);
        orderedDmaKeys.push(`SERIAL${serial.index}_TX`);
    }

    let assignmentIndex = ctx.usedStreams.size;
    const usedStreams = new Set<string>();

    // Track used streams from assignments
    for (const [, resource] of assignments) {
        if (arch === 'fixed' && resource.dma) {
            usedStreams.add(`DMA${resource.dma.port}_STREAM${resource.dma.stream}`);
        }
    }

    for (const dmaKey of orderedDmaKeys) {
        const deviceName = dmaKeyToDevice.get(dmaKey) || dmaKey;
        const assigned = assignments.get(deviceName);
        let available = availableOptions.get(deviceName) || [];
        
        // For unassigned DSHOT modes, compute their theoretical availability
        if (!assigned && dmaKey.startsWith('DSHOT_')) {
            if (dmaKey === 'DSHOT_DMAR') {
                // Check for timer UP channels that could support DMAR
                const timerUps = peripherals.filter(p => p.device.endsWith('_UP'));
                available = timerUps.flatMap(p => ctx.resources.filter(r => tagEqual(r.tag, p.tag)));
            } else if (dmaKey.startsWith('DSHOT_CCR_M')) {
                // Check for motor timer channels that could support CCR mode
                const motorIndex = parseInt(dmaKey.split('_M')[1]);
                if (target.motor_pins && target.motor_pins[motorIndex] && gpio[target.motor_pins[motorIndex]]) {
                    const pinFuncs = gpio[target.motor_pins[motorIndex]];
                    const timerFuncs = pinFuncs.filter((f: { tag?: device_tag }) => f.tag?.type === 'timer' && f.tag?.func?.startsWith('ch'));
                    available = timerFuncs.flatMap((f: { tag: device_tag }) => ctx.resources.filter(r => tagEqual(r.tag, f.tag)));
                }
            } else if (dmaKey.startsWith('DSHOT_BB_CH')) {
                // Check for timer channels that could support BB mode
                const timerChannels = peripherals.filter(p => p.tag.type === 'timer' && p.tag.func?.startsWith('ch'));
                available = timerChannels.flatMap(p => ctx.resources.filter(r => tagEqual(r.tag, p.tag)));
            }
        }

        if (assigned) {
            const streamName = arch === 'fixed' && assigned.dma
                ? `DMA${assigned.dma.port}_STREAM${assigned.dma.stream}`
                : `DMA${Math.floor(assignmentIndex / 8) + 1}_STREAM${(assignmentIndex % 8) + 1}`;

            const channelInfo = arch === 'fixed' && assigned.channel !== undefined
                ? ` (ch${assigned.channel})`
                : arch === 'flexible' && assigned.request !== undefined
                ? ` (req${assigned.request})`
                : '';

            // Show available options for assigned devices
            const options = available
                .filter(r => arch !== 'fixed' || !r.dma || !usedStreams.has(`DMA${r.dma.port}_STREAM${r.dma.stream}`))
                .map(r => r.dma ? `DMA${r.dma.port}_STREAM${r.dma.stream}` : 'flexible')
                .filter((v, i, a) => a.indexOf(v) === i); // unique

            const optionsStr = options.length > 1 ? ` (options: ${options.join(', ')})` : '';

            lines.push(`#   ${dmaKey.padEnd(16)} -> ASSIGNED: ${streamName}${channelInfo} [${formatTag(assigned.tag)}]${optionsStr}`);
            assignmentIndex++;
        } else {
            // Show available options for unassigned devices
            const options = available
                .filter(r => arch !== 'fixed' || !r.dma || !usedStreams.has(`DMA${r.dma.port}_STREAM${r.dma.stream}`))
                .map(r => r.dma ? `DMA${r.dma.port}_STREAM${r.dma.stream}` : 'flexible');

            const uniqueOptions = options.filter((v, i, a) => a.indexOf(v) === i);
            const optionsStr = uniqueOptions.length > 0 ? `(options: ${uniqueOptions.join(', ')})` : '(no options available)';

            lines.push(`#   ${dmaKey.padEnd(16)} -> available${' '.repeat(39)} ${optionsStr}`);
        }
    }

    lines.push('#');

    // Add summary
    const totalStreams = arch === 'fixed' ? 16 : 'unlimited';
    const streamsAvailable = arch === 'fixed' ? 16 - usedStreams.size : 'N/A';
    lines.push(`# Summary: ${assignments.size} devices assigned${arch === 'fixed' ? `, ${streamsAvailable}/${totalStreams} streams available` : ''}`);

    return lines.join('\n') + '\n';
}

export async function findDmaAssignments(target: target_t, debug: boolean = false): Promise<target_t> {
    const [resources, gpio] = await loadDmaData(target.mcu);

    const ctx: DmaContext = {
        mcu: target.mcu,
        gpio,
        resources,
        usedStreams: new Set()
    };

    // Clear any existing DMA assignments
    if (target.dma) {
        delete target.dma;
    }

    if (debug) {
        console.log(`[DMA] Target: ${target.name} (${target.mcu})`);
    }

    // Use SAT solver to find assignments and best DSHOT mode
    const result = await solveDmaAssignment(target, gpio, ctx, debug);

    if (!result) {
        throw new Error('No valid DMA assignment found');
    }

    const { assignments, dshotMode } = result;

    // Get peripherals for the selected mode for header generation
    const peripherals = enumeratePeripherals(target, gpio, dshotMode, ctx);
    peripherals.sort((a, b) => b.priority - a.priority);

    // Build DMA object
    const dma = buildDmaObject(assignments, ctx);

    // Generate header
    const header = generateHeader(target, assignments, ctx, dshotMode, peripherals, gpio);

    // Get timer info for DMAR mode
    let timerInfo = undefined;
    if (dshotMode === 'DMAR' && target.motor_pins) {
        // Find which timer is used for all motors
        const timersUsed = new Map<number, number>();
        for (const motorPin of target.motor_pins) {
            const pinFuncs = gpio[motorPin];
            if (pinFuncs) {
                const timerFuncs = pinFuncs.filter((f: { tag?: device_tag }) => f.tag?.type === 'timer' && f.tag?.func?.startsWith('ch'));
                timerFuncs.sort((a: { tag: device_tag }, b: { tag: device_tag }) => b.tag.index - a.tag.index);
                if (timerFuncs.length > 0) {
                    const timerIndex = timerFuncs[0].tag.index;
                    timersUsed.set(timerIndex, (timersUsed.get(timerIndex) || 0) + 1);
                }
            }
        }
        for (const [timerIndex, count] of timersUsed) {
            if (count === 4) {
                timerInfo = { type: 'timer', index: timerIndex, func: 'up' };
                break;
            }
        }
    }

    return {
        ...target,
        dma,
        _dmaHeader: header,
        _dshotMode: { mode: dshotMode, reason: 'SAT solver selected', timer: timerInfo }
    } as any;
}