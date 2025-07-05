import fs from "fs";
import path from "path";
import YAML, { Pair, Scalar } from "yaml";
import { walk } from "./util";
import { stringifyTarget, target_t, skipEmpty, target_keys } from "./types";

interface device_tag {
    type: string;
    index: number;
    func?: string;
}

interface dma_resource {
    tag: device_tag;
    dma?: { port: number; stream: number };
    channel?: number;
    request?: number;
}


const mcus = await fs.promises.readdir("mcu");
const gpios = await mcus.reduce(async (prev, m) => ({ ...(await prev), [m]: YAML.parse(await fs.promises.readFile(path.join("mcu", m, "gpio.yaml"), "utf8")) }), {});
const dmas = await mcus.reduce(async (prev, m) => ({ ...(await prev), [m]: YAML.parse(await fs.promises.readFile(path.join("mcu", m, "dma.yaml"), "utf8")) }), {});

const mapMCU = (mcu: string) => ({ at32f435m: "at32f435" }[mcu] || mcu);

const tagEqual = (lhs: device_tag, rhs: device_tag) =>
    lhs.type === rhs.type && lhs.index === rhs.index && (!lhs.func || !rhs.func || lhs.func === rhs.func);

const getDmaArchitecture = (mcu: string) =>
    ['stm32f405', 'stm32f411', 'stm32f722', 'stm32f745', 'stm32f765'].includes(mcu) ? 'fixed' : 'flexible';

export function findDmaAssignments(target: target_t): target_t {
    const mcu = mapMCU(target.mcu);
    const dma = dmas[mcu] as dma_resource[];
    const gpio = gpios[mcu];

    if (!dma || !gpio) {
        return target;
    }

    const assignments: any[] = [];
    const usedResources = new Set<string>();
    const usedTimers = new Set<string>();
    const usedStreams = new Set<string>();

    let motorTimers = mcu === "stm32f411" ? [{ type: "timer", index: 1 }] : [{ type: "timer", index: 1 }, { type: "timer", index: 8 }];

    function findOptimalDmaResource(tag: device_tag, allPeripherals: device_tag[]): dma_resource | null {
        const candidateResources = dma.filter(d =>
            tagEqual(d.tag, tag) && !usedResources.has(JSON.stringify(d))
        );

        if (candidateResources.length === 0) return null;

        // For flexible architecture, use sequential assignment
        if (getDmaArchitecture(mcu) === 'flexible') {
            return candidateResources[0];
        }

        // For fixed F4/F7 architecture, analyze scarcity
        const resourceScarcity = candidateResources.map(resource => {
            const streamName = `DMA${resource.dma?.port || 1}_STREAM${resource.dma?.stream || 0}`;

            if (usedStreams.has(streamName)) {
                return { resource, scarcity: Infinity };
            }

            // Count competing peripherals for this stream
            let competingPeripherals = 0;
            for (const otherPeripheral of allPeripherals) {
                if (tagEqual(otherPeripheral, tag)) continue;

                const otherCandidates = dma.filter(d => tagEqual(d.tag, otherPeripheral));
                for (const candidate of otherCandidates) {
                    const otherStreamName = `DMA${candidate.dma?.port || 1}_STREAM${candidate.dma?.stream || 0}`;
                    if (otherStreamName === streamName) {
                        competingPeripherals++;
                        break;
                    }
                }
            }

            return { resource, scarcity: competingPeripherals };
        });

        resourceScarcity.sort((a, b) => a.scarcity - b.scarcity);
        const chosen = resourceScarcity[0];

        return chosen.resource;
    }

    function getDmaStreamName(resource: dma_resource, assignmentIndex: number): string {
        if (getDmaArchitecture(mcu) === 'flexible') {
            const streamsPerController = mcu === 'at32f435' ? 7 : 8;
            const startStream = 1;
            const dmaController = assignmentIndex < streamsPerController ? 1 : 2;
            const streamNumber = startStream + (assignmentIndex % streamsPerController);
            return `DMA${dmaController}_STREAM${streamNumber}`;
        } else {
            return `DMA${resource.dma?.port || 1}_STREAM${resource.dma?.stream || 0}`;
        }
    }

    const addAssignment = (dev: string, tag: device_tag, allPeripherals: device_tag[]): boolean => {
        const resource = findOptimalDmaResource(tag, allPeripherals);
        if (!resource) return false;

        usedResources.add(JSON.stringify(resource));
        const dmaStream = getDmaStreamName(resource, assignments.length);

        if (usedStreams.has(dmaStream)) {
            throw new Error(`DMA stream conflict: ${dmaStream} already assigned`);
        }

        usedStreams.add(dmaStream);
        assignments.push({
            dev,
            tag: `${tag.type}${tag.index}${tag.func ? '_' + tag.func : ''}`.toUpperCase(),
            dma: dmaStream,
            channel: resource.channel,
            request: resource.request
        });
        return true;
    };

    const findAvailableTimer = (dev: string, gpios: any[]) => {
        const timerGpios = gpios.filter((g: any) =>
            g.tag.type === 'timer' && !usedTimers.has(`${g.tag.type}${g.tag.index}_${g.tag.func}`)
        );
        return dev === "RGB"
            ? timerGpios.filter((g: any) => !motorTimers.some(mt => mt.type === g.tag.type && mt.index === g.tag.index))
            : timerGpios;
    };

    const peripheralStatus = {
        rgb: { attempted: false, assigned: false, reason: '' },
        motors: { attempted: false, assigned: 0, total: 0, reason: '' },
        spi: { attempted: false, assigned: 0, total: 0, reason: '' }
    };

    // Collect all potential peripherals for scarcity analysis
    const allPeripherals: device_tag[] = [];

    if (target.rgb_led) {
        const timers = findAvailableTimer("RGB", gpio[target.rgb_led]);
        allPeripherals.push(...timers.map(t => t.tag));
    }

    const motorPorts = target.motor_pins.map(p => p.slice(0, 2)).filter((v, i, a) => a.indexOf(v) === i);
    const primaryMotorTimer = motorTimers[0];
    if (primaryMotorTimer) {
        for (let i = 0; i < motorPorts.length; i++) {
            allPeripherals.push({ ...primaryMotorTimer, func: `ch${i + 1}` });
        }
    }

    for (const spi of target.spi_ports || []) {
        allPeripherals.push({ type: 'spi', index: spi.index, func: 'miso' });
        allPeripherals.push({ type: 'spi', index: spi.index, func: 'mosi' });
    }

    for (const serial of target.serial_ports || []) {
        allPeripherals.push({ type: 'serial', index: serial.index, func: 'rx' });
        allPeripherals.push({ type: 'serial', index: serial.index, func: 'tx' });
    }

    for (const i2c of target.i2c_ports || []) {
        allPeripherals.push({ type: 'i2c', index: i2c.index, func: 'rx' });
        allPeripherals.push({ type: 'i2c', index: i2c.index, func: 'tx' });
    }

    // 1. Assign motor channels first (highest priority)
    peripheralStatus.motors.attempted = true;
    peripheralStatus.motors.total = motorPorts.length;

    if (!primaryMotorTimer) {
        throw new Error("No motor timer available!");
    }

    // Try to assign all motor channels to the same timer
    let selectedMotorTimer: device_tag | null = null;
    let motorAssignments: Array<{ channel: number, tag: device_tag, resource: dma_resource, dmaStream: string }> = [];

    // Smart motor timer selection: if RGB can only use one of the motor timers, try others first
    let orderedMotorTimers = [...motorTimers];
    if (target.rgb_led && gpio[target.rgb_led]) {
        const rgbTimers = gpio[target.rgb_led].filter((g: any) => g.tag.type === 'timer');
        const rgbTimerIndices = rgbTimers.map((t: any) => t.tag.index);
        
        // If RGB has limited timer options that overlap with motor timers, deprioritize those
        if (rgbTimerIndices.length > 0) {
            orderedMotorTimers.sort((a, b) => {
                const aConflictsWithRgb = rgbTimerIndices.includes(a.index);
                const bConflictsWithRgb = rgbTimerIndices.includes(b.index);
                if (aConflictsWithRgb && !bConflictsWithRgb) return 1;
                if (!aConflictsWithRgb && bConflictsWithRgb) return -1;
                return 0;
            });
        }
    }
    
    // Try each available motor timer
    for (const motorTimer of orderedMotorTimers) {
        let canAssignAll = true;
        let tempAssignments: Array<{ channel: number, tag: device_tag, resource: dma_resource, dmaStream: string }> = [];
        let tempUsedResources = new Set(usedResources);
        let tempUsedStreams = new Set(usedStreams);
        let tempAssignmentCount = assignments.length;

        // Check if we can assign all channels to this timer
        for (let i = 0; i < motorPorts.length; i++) {
            const motorTag = { ...motorTimer, func: `ch${i + 1}` };
            const resource = findOptimalDmaResource(motorTag, allPeripherals);

            if (!resource) {
                canAssignAll = false;
                break;
            }

            const resourceKey = JSON.stringify(resource);
            if (tempUsedResources.has(resourceKey)) {
                canAssignAll = false;
                break;
            }

            const dmaStream = getDmaStreamName(resource, tempAssignmentCount + i);

            if (!dmaStream || tempUsedStreams.has(dmaStream)) {
                canAssignAll = false;
                break;
            }

            tempAssignments.push({
                channel: i + 1,
                tag: motorTag,
                resource,
                dmaStream
            });
            tempUsedResources.add(resourceKey);
            tempUsedStreams.add(dmaStream);
        }

        if (canAssignAll) {
            selectedMotorTimer = motorTimer;
            motorAssignments = tempAssignments;
            break;
        }
    }

    if (!selectedMotorTimer) {
        throw new Error("No motor timer can accommodate all DSHOT channels!");
    }

    // Now actually assign the motor channels
    for (const assignment of motorAssignments) {
        const motorTag = assignment.tag;
        usedTimers.add(`${motorTag.type}${motorTag.index}_${motorTag.func}`);

        if (!addAssignment(`DSHOT_CH${assignment.channel}`, motorTag, allPeripherals)) {
            throw new Error(`Failed to assign motor DMA for channel ${assignment.channel}!`);
        }
        peripheralStatus.motors.assigned++;
    }

    // 2. Assign RGB LED (lower priority than motors)
    if (target.rgb_led) {
        peripheralStatus.rgb.attempted = true;
        // First try non-motor timers
        const timers = findAvailableTimer("RGB", gpio[target.rgb_led]);
        for (const timer of timers) {
            if (addAssignment("RGB", timer.tag, allPeripherals)) {
                peripheralStatus.rgb.assigned = true;
                usedTimers.add(`${timer.tag.type}${timer.tag.index}_${timer.tag.func}`);
                break;
            }
        }
        
        // If that fails, try any available timer
        if (!peripheralStatus.rgb.assigned) {
            const allTimers = gpio[target.rgb_led]?.filter((g: any) =>
                g.tag.type === 'timer' && !usedTimers.has(`${g.tag.type}${g.tag.index}_${g.tag.func}`)
            ) || [];
            
            for (const timer of allTimers) {
                if (addAssignment("RGB", timer.tag, allPeripherals)) {
                    peripheralStatus.rgb.assigned = true;
                    peripheralStatus.rgb.reason = 'Assigned using motor timer';
                    break;
                }
            }
        }
        
        if (!peripheralStatus.rgb.assigned) {
            peripheralStatus.rgb.reason = 'No available timer or DMA resource';
        }
    }

    // 3. Assign SPI channels
    if (target.spi_ports && target.spi_ports.length > 0) {
        peripheralStatus.spi.attempted = true;
        peripheralStatus.spi.total = target.spi_ports.length * 2;

        for (const spi of target.spi_ports) {
            const misoGpios = gpio[spi.miso]?.filter((g: any) =>
                g.tag.type === 'spi' && g.tag.index === spi.index && g.tag.func === 'miso') || [];
            const mosiGpios = gpio[spi.mosi]?.filter((g: any) =>
                g.tag.type === 'spi' && g.tag.index === spi.index && g.tag.func === 'mosi') || [];

            for (const miso of misoGpios) {
                if (addAssignment(`SPI${spi.index}_RX`, miso.tag, allPeripherals)) {
                    peripheralStatus.spi.assigned++;
                    break;
                }
            }
            for (const mosi of mosiGpios) {
                if (addAssignment(`SPI${spi.index}_TX`, mosi.tag, allPeripherals)) {
                    peripheralStatus.spi.assigned++;
                    break;
                }
            }
        }
    }

    // Convert assignments to target format
    const dmaEntries: Record<string, any> = {};
    for (const assignment of assignments) {
        const entry: any = {
            tag: assignment.tag,
            dma: assignment.dma
        };
        if (assignment.channel !== undefined) entry.channel = assignment.channel;
        if (assignment.request !== undefined) entry.request = assignment.request;
        dmaEntries[assignment.dev] = entry;
    }

    const result = {
        ...target,
        dma: dmaEntries,
        timers: []
    };

    // Store data for header generation
    (result as any)._dmaStatus = peripheralStatus;
    (result as any)._usedStreams = usedStreams;
    (result as any)._mcu = mcu;
    (result as any)._dmaResources = dma;

    return result;
}


function generateDmaHeader(target: target_t & { _dmaStatus?: any }, usedStreams: Set<string>, mcu: string, dma: any[]): string {
    const status = target._dmaStatus;
    if (!status) return '';

    const lines: string[] = [];
    lines.push('# DMA Assignment Summary');
    lines.push(`# Target: ${target.name} (${target.mcu})`);
    lines.push(`# Architecture: ${getDmaArchitecture(mapMCU(target.mcu))}`);
    lines.push(`# Total DMA assignments: ${Object.keys(target.dma || {}).length}`);
    lines.push('#');

    // Collect all DMA devices present in target and their potential assignments
    const allDevices = new Map<string, { assigned?: string, options: string[] }>();
    const isFixedArch = getDmaArchitecture(mcu) === 'fixed';

    // Add assigned devices
    if (target.dma) {
        Object.entries(target.dma).forEach(([dev, assignment]: [string, any]) => {
            const details = assignment.channel !== undefined ? `ch${assignment.channel}` : `req${assignment.request}`;
            allDevices.set(dev, {
                assigned: `${assignment.dma} (${details}) [${assignment.tag}]`,
                options: []
            });
        });
    }

    // For fixed architectures, find potential assignments for all devices
    if (isFixedArch) {
        // Add all potential motor channels
        const motorPorts = target.motor_pins ? target.motor_pins.map(p => p.slice(0, 2)).filter((v, i, a) => a.indexOf(v) === i) : [];
        for (let i = 0; i < motorPorts.length; i++) {
            const deviceName = `DSHOT_CH${i + 1}`;
            if (!allDevices.has(deviceName)) {
                allDevices.set(deviceName, { options: [] });
            }

            // Find potential streams for this motor channel
            const potentialStreams: string[] = [];
            for (const resource of dma) {
                if (resource.tag.type === 'timer' && (resource.tag.index === 1 || resource.tag.index === 8) &&
                    resource.tag.func === `ch${i + 1}`) {
                    const streamName = `DMA${resource.dma?.port}_STREAM${resource.dma?.stream}`;
                    potentialStreams.push(streamName);
                }
            }
            allDevices.get(deviceName)!.options = potentialStreams;
        }

        // Add all potential SPI channels
        if (target.spi_ports) {
            for (const spi of target.spi_ports) {
                const rxDevice = `SPI${spi.index}_RX`;
                const txDevice = `SPI${spi.index}_TX`;

                if (!allDevices.has(rxDevice)) allDevices.set(rxDevice, { options: [] });
                if (!allDevices.has(txDevice)) allDevices.set(txDevice, { options: [] });

                // Find potential streams
                const rxStreams: string[] = [];
                const txStreams: string[] = [];
                for (const resource of dma) {
                    if (resource.tag.type === 'spi' && resource.tag.index === spi.index) {
                        const streamName = `DMA${resource.dma?.port}_STREAM${resource.dma?.stream}`;
                        if (resource.tag.func === 'miso') rxStreams.push(streamName);
                        if (resource.tag.func === 'mosi') txStreams.push(streamName);
                    }
                }
                allDevices.get(rxDevice)!.options = rxStreams;
                allDevices.get(txDevice)!.options = txStreams;
            }
        }

        // Add RGB if present
        if (target.rgb_led) {
            if (!allDevices.has('RGB')) allDevices.set('RGB', { options: [] });

            const rgbStreams: string[] = [];
            for (const resource of dma) {
                if (resource.tag.type === 'timer' && resource.tag.index !== 1 && resource.tag.index !== 8) {
                    const streamName = `DMA${resource.dma?.port}_STREAM${resource.dma?.stream}`;
                    rgbStreams.push(streamName);
                }
            }
            allDevices.get('RGB')!.options = rgbStreams;
        }

        // Add serial ports
        if (target.serial_ports) {
            for (const serial of target.serial_ports) {
                const rxDevice = `SERIAL${serial.index}_RX`;
                const txDevice = `SERIAL${serial.index}_TX`;

                if (!allDevices.has(rxDevice)) allDevices.set(rxDevice, { options: [] });
                if (!allDevices.has(txDevice)) allDevices.set(txDevice, { options: [] });

                const rxStreams: string[] = [];
                const txStreams: string[] = [];
                for (const resource of dma) {
                    if (resource.tag.type === 'serial' && resource.tag.index === serial.index) {
                        const streamName = `DMA${resource.dma?.port}_STREAM${resource.dma?.stream}`;
                        if (resource.tag.func === 'rx') rxStreams.push(streamName);
                        if (resource.tag.func === 'tx') txStreams.push(streamName);
                    }
                }
                allDevices.get(rxDevice)!.options = rxStreams;
                allDevices.get(txDevice)!.options = txStreams;
            }
        }
    }

    lines.push('# DMA Device Assignments:');

    // Sort devices for consistent output
    const sortedDevices = Array.from(allDevices.entries()).sort(([a], [b]) => {
        // Sort order: RGB, DSHOT, SPI, SERIAL, I2C
        const priority = (name: string) => {
            if (name === 'RGB') return 0;
            if (name.startsWith('DSHOT_')) return 1;
            if (name.startsWith('SPI')) return 2;
            if (name.startsWith('SERIAL')) return 3;
            if (name.startsWith('I2C')) return 4;
            return 5;
        };
        return priority(a) - priority(b) || a.localeCompare(b);
    });

    for (const [deviceName, info] of sortedDevices) {
        if (info.assigned) {
            if (isFixedArch && info.options.length > 0) {
                const optionsList = info.options.join(', ');
                lines.push(`#   ${deviceName.padEnd(15)} -> ASSIGNED: ${info.assigned.padEnd(30)} (options: ${optionsList})`);
            } else {
                lines.push(`#   ${deviceName.padEnd(15)} -> ASSIGNED: ${info.assigned}`);
            }
        } else {
            if (isFixedArch && info.options.length > 0) {
                const optionsList = info.options.join(', ');
                lines.push(`#   ${deviceName.padEnd(15)} -> available${' '.repeat(40)} (options: ${optionsList})`);
            } else {
                lines.push(`#   ${deviceName.padEnd(15)} -> available`);
            }
        }
    }

    lines.push('#');

    // Summary
    let totalStreams = 16;
    if (getDmaArchitecture(mcu) === 'flexible') {
        totalStreams = mcu === 'at32f435' ? 14 : 16;
    }
    const availableStreams = totalStreams - usedStreams.size;
    lines.push(`# Summary: ${Object.keys(target.dma || {}).length} devices assigned, ${availableStreams}/${totalStreams} streams available`);

    return lines.join('\n') + '\n';
}

function sortMapEntries(a: Pair<Scalar, unknown>, b: Pair<Scalar, unknown>): number {
    const aIndex = target_keys.indexOf(a.key.value as string);
    const bIndex = target_keys.indexOf(b.key.value as string);
    if (aIndex == -1 && bIndex == -1) {
        return (a.key.value as string).localeCompare(b.key.value as string);
    }
    if (aIndex == -1) return 1;
    if (bIndex == -1) return -1;
    return aIndex - bIndex;
}

export function stringifyTargetWithDmaHeader(target: target_t & { _dmaStatus?: any; _usedStreams?: Set<string>; _mcu?: string; _dmaResources?: any[] }): string {
    const header = generateDmaHeader(
        target,
        target._usedStreams || new Set(),
        target._mcu || target.mcu,
        target._dmaResources || []
    );

    // Remove internal data before stringifying
    const cleanTarget = { ...target };
    delete (cleanTarget as any)._dmaStatus;
    delete (cleanTarget as any)._usedStreams;
    delete (cleanTarget as any)._mcu;
    delete (cleanTarget as any)._dmaResources;

    const yamlContent = YAML.stringify(skipEmpty(cleanTarget), { sortMapEntries });

    return header + yamlContent;
}

// Main execution
if (!module.parent) {
    (async () => {
        const files = process.argv.slice(2);

        if (files.length > 0) {
            for (const f of files) {
                try {
                    const target = YAML.parse(await fs.promises.readFile(f, "utf8")) as target_t;
                    const result = findDmaAssignments(target);
                    await fs.promises.writeFile(f, stringifyTargetWithDmaHeader(result));
                    console.log(`✓ Processed ${f}`);
                } catch (err) {
                    try {
                        const target = YAML.parse(await fs.promises.readFile(f, "utf8")) as target_t;
                        if (err.message.includes("No motor DMA") && target.rgb_led) {
                            const targetWithoutRgb = { ...target, rgb_led: undefined };
                            const result = findDmaAssignments(targetWithoutRgb);
                            await fs.promises.writeFile(f, stringifyTargetWithDmaHeader(result));
                            console.log(`✓ Processed ${f} (RGB disabled due to conflict)`);
                        }
                    } catch (retryErr) {
                        console.error(`✗ Failed to process ${f}: ${err.message}`);
                    }
                }
            }
        } else {
            // Process all files in targets directory
            let processed = 0;
            let failed = 0;

            for await (const f of walk("targets")) {
                try {
                    const target = YAML.parse(await fs.promises.readFile(f, "utf8")) as target_t;
                    const result = findDmaAssignments(target);
                    await fs.promises.writeFile(f, stringifyTargetWithDmaHeader(result));
                    processed++;
                } catch (err) {
                    try {
                        const target = YAML.parse(await fs.promises.readFile(f, "utf8")) as target_t;
                        if (err.message.includes("No motor DMA") && target.rgb_led) {
                            const targetWithoutRgb = { ...target, rgb_led: undefined };
                            const result = findDmaAssignments(targetWithoutRgb);
                            await fs.promises.writeFile(f, stringifyTargetWithDmaHeader(result));
                            processed++;
                        }
                    } catch (retryErr) {
                        failed++;
                    }
                }
            }

            console.log(`Batch processing complete: ${processed} processed, ${failed} failed`);
        }
    })();
}