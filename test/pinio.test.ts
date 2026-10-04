import assert from "node:assert/strict";
import fs from "node:fs";
import YAML from "yaml";
import { extractPinio, validatePinio } from "../src/pinio";
import { target_t } from "../src/types";

function test(name: string, run: () => void) {
  run();
  console.log(`PASS ${name}`);
}

test("imports inversion and case-preserved names through USER box mapping", () => {
  assert.deepEqual(extractPinio(`
    #define PINIO1_PIN PC6
    #define PINIO1_CONFIG 129
    #define PINIO1_BOX 41
    #define BOX_USER1_NAME "Camera"
    #define BOX_USER2_NAME "10V BEC"
    #define PINIO2_PIN PB5
    #define PINIO2_CONFIG 1
    #define PINIO2_BOX 40
  `), [
    { pin: "PC6", label: "10V BEC", invert: true },
    { pin: "PB5", label: "Camera", invert: false },
  ]);
});

test("supports pin aliases, symbolic config, unassigned slots and default polarity", () => {
  assert.deepEqual(extractPinio(`
    #define VTX_ENABLE_PIN PC15
    #define PINIO1_PIN NONE
    #define PINIO2_PIN VTX_ENABLE_PIN
    #define PINIO2_CONFIG (PINIO_CONFIG_MODE_OUT_PP | PINIO_CONFIG_OUT_INVERTED)
    #define PINIO4_PIN PA8 // switch
    // #define PINIO3_PIN PA7
  `), [
    { pin: "PC15", label: "PINIO 2", invert: true },
    { pin: "PA8", label: "PINIO 4", invert: false },
  ]);
});

test("rejects ambiguous or unsupported electrical definitions", () => {
  for (const config of ["0", "130", "unknown", "256"]) {
    assert.throws(() => extractPinio(`#define PINIO1_PIN PA1\n#define PINIO1_CONFIG ${config}`));
  }
  assert.throws(() => extractPinio("#ifdef X\n#define PINIO1_PIN PA1\n#endif"));
  assert.throws(() => extractPinio("#define PINIO1_PIN PA1\n#define PINIO1_PIN PB1"));
  assert.throws(() => extractPinio("#define PINIO1_PIN PA1\n#define PINIO2_PIN PA1"));
});

test("rejects PINIO ownership conflicts while allowing the legacy fpv alias", () => {
  const target = {
    name: "pinio-test",
    pinio: [{ pin: "PC14", label: "Switch" }],
    fpv: "PC14",
  } as target_t;
  assert.doesNotThrow(() => validatePinio(target));
  assert.throws(() => validatePinio({ ...target, leds: [{ pin: "PC14", invert: true }] }), /conflicts with leds\[0\].pin/);
  const uart = { index: 3, rx: "PC14", tx: "PB10", inverter: "NONE" };
  assert.throws(() => validatePinio({ ...target, serial_ports: [uart] }), /conflicts with serial_ports\[0\].rx/);
});

test("supported HAKRC and ZEEZ targets give each PINIO pin one owner", () => {
  for (const folder of ["targets", "staging"]) {
    const hakrc = YAML.parse(fs.readFileSync(`${folder}/harc-hakrcf411d.yaml`, "utf8"));
    const zeez = YAML.parse(fs.readFileSync(`${folder}/zeez-zeezf7.yaml`, "utf8"));
    validatePinio(hakrc);
    validatePinio(zeez);
    assert.equal(hakrc.pinio[1].pin, "PC14");
    assert.equal(zeez.pinio[0].pin, "PB11");
    assert.equal(zeez.serial_ports.find(port => port.index === 3).tx, "PB10");
  }
});
