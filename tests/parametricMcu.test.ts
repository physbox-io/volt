/**
 * Parametric MCU modules: running their code, netlisting their pins, and
 * generating a footprint for each form factor.
 *
 * Converted from `src/test_parametric_mcu.ts`, which printed these results for
 * a human to read and threw on the way out if a count was wrong. The board
 * layout half of that script is covered by `pcbLayout.test.ts`; what is here is
 * the half that never had a home.
 */
import { describe, it, expect } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import { executeMcuCode } from '../src/utils/mcu';
import { generateSpiceNetlist } from '../src/utils/spice';
import { generateCustomMcuFootprint } from '../src/utils/pcbFootprints';
import {
  MCU_PRESETS,
  createCustomMcuConfig,
  getEffectiveMcuConfig,
  rightColumnRunsUp,
} from '../src/utils/mcuConfig';

describe('running MCU code against arbitrary pin names', () => {
  const script = `
pinMode('GPIO4', 'OUTPUT');
pinMode('ADC1', 'INPUT');
pinMode('PWM_CH', 'OUTPUT');

// Analog read from custom pin
const val = analogRead('ADC1');
Serial.println('ADC1 value: ' + val);

// Write digital & analog outputs
digitalWrite('GPIO4', 1);
analogWrite('PWM_CH', 128);
sleep(100);
digitalWrite('GPIO4', 0);
analogWrite('PWM_CH', 255);
sleep(100);
`;

  const result = executeMcuCode(script, 0.5, {
    ADC1: [
      { t: 0, v: 2.5 },
      { t: 500, v: 2.5 },
    ],
  }, {});

  it('drives a waveform out of every pin the script writes to', () => {
    expect(result.pwlOutputs['GPIO4']?.length).toBeGreaterThanOrEqual(2);
    expect(result.pwlOutputs['PWM_CH']?.length).toBeGreaterThanOrEqual(2);
  });

  it('reads an analog pin at the ADC resolution, not as volts', () => {
    // 2.5V on a 0-3.3V 10-bit input.
    expect(result.logs[0]).toContain('ADC1 value: 511');
  });
});

describe('netlisting an MCU with a configured pin map', () => {
  const esp32 = MCU_PRESETS.find(p => p.key === 'esp32_devkit')!;

  const nodes: Node[] = [
    {
      id: 'mcu1',
      type: 'mcu',
      position: { x: 100, y: 100 },
      data: {
        mcuConfig: esp32.config,
        code: "pinMode('G4', 'OUTPUT');\npinMode('G18', 'OUTPUT');\ndigitalWrite('G4', 1);\ndigitalWrite('G18', 0);",
      },
    },
    { id: 'res1', type: 'resistor', position: { x: 300, y: 100 }, data: { resistance: '1k' } },
    { id: 'gnd1', type: 'ground', position: { x: 300, y: 200 }, data: {} },
  ];

  const edges: Edge[] = [
    { id: 'e1', source: 'mcu1', sourceHandle: 'G4', target: 'res1', targetHandle: 'in' },
    { id: 'e2', source: 'res1', sourceHandle: 'out', target: 'gnd1', targetHandle: 'in' },
  ];

  const { netlist } = generateSpiceNetlist(nodes, edges, 0.1);

  it('emits a source for the driven IO pin', () => {
    expect(netlist).toContain('V_mcu1_G4');
  });

  it('emits the power rails the part needs to be a circuit at all', () => {
    expect(netlist).toContain('V_mcu1_VIN');
    expect(netlist).toContain('V_mcu1_3V3');
  });

  it('ties ground through a resistor rather than shorting it', () => {
    expect(netlist).toContain('R_mcu1_GND1');
  });
});

describe('footprints for each module form factor', () => {
  const fromPreset = (key: string) =>
    generateCustomMcuFootprint(MCU_PRESETS.find(p => p.key === key)!.config);

  it.each([
    ['esp32_devkit', 30],
    ['pico_rp2040', 40],
    ['quad_module_16', 16],
    ['cc1101', 8],
    ['heltec_v4', 36],
  ])('%s has %i pads', (key, pads) => {
    expect(fromPreset(key).pads.length).toBe(pads);
  });

  it('makes a quad module surface mount', () => {
    expect(fromPreset('quad_module_16').pads[0].drillDiameter).toBe(0);
  });

  it('builds an arbitrary pin count from a custom config', () => {
    const custom = createCustomMcuConfig(12, 'quad', { widthMm: 22, heightMm: 22, isSmd: true });
    expect(generateCustomMcuFootprint(custom).pads.length).toBe(12);
  });
});

describe('right column numbering direction', () => {
  const padFor = (key: string, pinId: string) => {
    const preset = MCU_PRESETS.find(p => p.key === key)!;
    const fp = generateCustomMcuFootprint(preset.config);
    const pin = preset.config.pins.find(p => p.id === pinId)!;
    return fp.pads.find(pad => pad.pinNumber === String(pin.pinNumber))!;
  };

  // The bug this guards: a module whose right row is milled end-for-end against
  // its left row cannot be seated in ANY orientation. Flipping the part to the
  // reverse face mirrors both rows together, so it does not undo the reversal -
  // the first symptom is pin 1 of the module landing in the last hole of the
  // row. Found the hard way on a soldered Heltec carrier.
  it('runs a Heltec V4 down both columns, so 3V3 faces 5V/VIN', () => {
    const p1 = padFor('heltec_v4', '3V3');
    const p19 = padFor('heltec_v4', 'VIN');
    expect(p19.y).toBeCloseTo(p1.y, 3);
    expect(p19.x).toBeGreaterThan(p1.x);

    // ...and the far end of each row lines up too.
    expect(padFor('heltec_v4', 'RST').y).toBeCloseTo(padFor('heltec_v4', 'GPIO_18').y, 3);
  });

  it('runs a Nano and an ESP32 DevKit down both columns', () => {
    expect(padFor('arduino_nano', 'D13').y).toBeCloseTo(padFor('arduino_nano', 'TX').y, 3);
    expect(padFor('esp32_devkit', '3V3').y).toBeCloseTo(padFor('esp32_devkit', 'EN').y, 3);
  });

  it('keeps counter-clockwise numbering for a Pico and a DIP', () => {
    // Pico pin 21 (GP16) genuinely sits at the bottom of the right column,
    // opposite pin 20 rather than pin 1.
    expect(padFor('pico_rp2040', 'GP16').y).toBeCloseTo(padFor('pico_rp2040', 'GP15').y, 3);
    expect(padFor('pico_rp2040', 'GP16').y).toBeLessThan(padFor('pico_rp2040', 'GP0').y);

    const dip = MCU_PRESETS.find(p => p.key === 'dip8_standard')!;
    const dipPads = generateCustomMcuFootprint(dip.config).pads;
    const pad = (n: string) => dipPads.find(p => p.pinNumber === n)!;
    expect(pad('5').y).toBeCloseTo(pad('4').y, 3);
    expect(pad('8').y).toBeCloseTo(pad('1').y, 3);
  });
});

describe('pin numbering survives a round trip through node data', () => {
  it('keeps an explicit counter-clockwise setting off a saved node', () => {
    const preset = MCU_PRESETS.find(p => p.key === 'pico_rp2040')!;
    const roundTripped = getEffectiveMcuConfig({ mcuConfig: preset.config });
    expect(roundTripped.pinNumbering).toBe('counterclockwise');
    expect(rightColumnRunsUp(roundTripped)).toBe(true);
  });

  it('leaves an unset value to the per-style default', () => {
    const preset = MCU_PRESETS.find(p => p.key === 'heltec_v4')!;
    const roundTripped = getEffectiveMcuConfig({ mcuConfig: preset.config });
    expect(roundTripped.pinNumbering).toBeUndefined();
    expect(rightColumnRunsUp(roundTripped)).toBe(false);
  });
});
