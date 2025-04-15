import fs from "fs";
import path from "path";
import YAML from "yaml";
import { walk } from "./util";
import { stringifyTarget, target_t } from "./types";

interface device_tag {
    type: string;
    index: number;
    func?: string;
}

interface dma_tag {
    port: number;
    stream: number;
}

interface dma_resource {
    tag: device_tag;
    dma?: dma_tag;
    channel?: number;
    request?: number;
}

interface dma_assigment {
    res: dma_resource;

    dev: string;
    tag: string;
    dma: string;
    channel?: number;
}

const mcus = await fs.promises.readdir("mcu");
const gpios = await mcus.reduce(async (prev, m) => ({ ...(await prev), [m]: YAML.parse(await fs.promises.readFile(path.join("mcu", m, "gpio.yaml"), "utf8")) }), {});
const dmas = await mcus.reduce(async (prev, m) => ({ ...(await prev), [m]: YAML.parse(await fs.promises.readFile(path.join("mcu", m, "dma.yaml"), "utf8")) }), {});

const MCU_MAP = {
    at32f435m: "at32f435",
};

function mapMCU(mcu: string) {
    if (MCU_MAP[mcu]) {
        return MCU_MAP[mcu];
    } else {
        return mcu;
    }
}

function assEqual(lhs: dma_resource, rhs: dma_resource): boolean {
    const ignore = ["tag", "dev", "channel"]
    const replacer = (k, v) => ignore.includes(k) ? undefined : v;
    return JSON.stringify(lhs, replacer) == JSON.stringify(rhs, replacer);
}
function assIncludes(array: dma_assigment[], ass: dma_resource) {
    return array.find((e) => assEqual(e.res, ass))
}

function tagEqual(lhs: device_tag, rhs: device_tag): boolean {
    if (lhs.func && rhs.func && lhs.func != rhs.func)
        return false;
    return lhs.type == rhs.type && lhs.index == rhs.index;
}
function tagIncludes(array: device_tag[], tag: device_tag) {
    return array.find((e) => tagEqual(e, tag))
}

export function findDmaAssigments(target: target_t): target_t {
    const mcu = mapMCU(target.mcu);
    const dma = dmas[mcu] as dma_resource[];
    const gpio = gpios[mcu];

    if (!dma || !gpio) {
        return target;
    }

    const dma_assigments = [] as dma_assigment[];
    const timer_assigments = [] as device_tag[];

    let motor_timers = [{ type: "timer", index: 1 }]
    if (mcu != "stm32f411") {
        motor_timers.push({ type: "timer", index: 8 })
    }

    const stream_max = mcu == 'at32f435' ? 7 : 8;
    const stream_start = (mcu == 'at32f435' || mcu == 'stm32g473') ? 1 : 0;

    let dma_count = 0;

    function addTimer(dev: string, tag: device_tag) {
        motor_timers = motor_timers.filter(t => !tagEqual(t, tag))
        timer_assigments.push({ dev, ...tag } as any);
    }

    function addDmaAssigment(dev: string, tag: device_tag) {
        const ass = dma.find(d => tagEqual(d.tag, tag) && !assIncludes(dma_assigments, d));
        if (!ass) {
            return false;
        }

        const port = ass.dma ? ass.dma.port : 1 + Math.floor(dma_count / stream_max);
        const stream = stream_start + (ass.dma ? ass.dma.stream : dma_count % stream_max);
        dma_count++;

        dma_assigments.push({
            res: ass,
            ...ass,
            dev,
            tag: `${tag.type}${tag.index}${tag.func ? '_' + tag.func : ''}`.toUpperCase(),
            dma: `DMA${port}_STREAM${stream}`
        });
        return true;
    }

    function findTimers(dev: string, gpios: any[]) {
        const entries = gpios.filter(g => g.tag.type == 'timer' && !tagIncludes(timer_assigments, g.tag))
        // try to find a timer that is _not_ a motor timer
        const timers = entries.filter(g => !tagIncludes(motor_timers, g.tag))
        if (timers.length) {
            return timers;
        }
        if (motor_timers.length == 1) {
            console.warn("no non-motor timers found for", dev)
            return [];
        }
        return entries;
    }

    if (target.rgb_led) {
        const timers = findTimers("RGB", gpio[target.rgb_led]);
        for (const timer of timers) {
            if (addDmaAssigment("RGB", timer.tag)) {
                addTimer("RGB", timer.tag);
                break;
            }
        }
    }

    const motor_ports = target.motor_pins.map(p => p.slice(0, 2)).filter((v, i, a) => a.indexOf(v) === i);
    const motor_timer = motor_timers[0];
    if (!motor_timer) {
        console.log(timer_assigments, dma_assigments);
        throw new Error("no motor timer found!");
    }
    for (let i = 0; i < motor_ports.length; i++) {
        const tag = { ...motor_timer, func: "ch" + (i + 1) };
        addTimer("DSHOT", tag);
        if (!addDmaAssigment("DSHOT_CH" + (i + 1), tag)) {
            throw new Error("no motor dma found!");
        }
    }

    for (const spi of target.spi_ports) {
        const miso = gpio[spi.miso].filter(g => g.tag.type == 'spi' && g.tag.index == spi.index && g.tag.func == 'miso');
        for (const m of miso) {
            if (addDmaAssigment(`SPI${spi.index}_RX`, m.tag))
                break;
        }

        const mosi = gpio[spi.mosi].filter(g => g.tag.type == 'spi' && g.tag.index == spi.index && g.tag.func == 'mosi');
        for (const m of mosi) {
            if (addDmaAssigment(`SPI${spi.index}_TX`, m.tag))
                break;
        }
    }

    const entries = {}
    for (const ass of dma_assigments) {
        const ignore = ["res", "dev"];
        entries[ass.dev] = Object.keys(ass).reduce((prev, curr) => {
            if (!ignore.includes(curr))
                prev[curr] = ass[curr];
            return prev;
        }, {});
    }

    return { ...target, dma: entries, timers: [] };
}

if (!module.parent) {
    for await (const f of walk("targets")) {
        console.log("processing ", f)

        const target = YAML.parse(await fs.promises.readFile(f, "utf8")) as target_t;
        try {
            await fs.promises.writeFile(f, stringifyTarget(findDmaAssigments(target)));
        } catch (err) {
            if (err.message == "no motor dma found!" && target.rgb_led) {
                console.log("no motor dma found! re-trying without rgb_led");
                target.rgb_led = undefined;
                await fs.promises.writeFile(f, stringifyTarget(findDmaAssigments(target)));
            } else {
                throw err;
            }
        }
    }
}
