import { executeMcuCode } from './utils/mcu.js';
import { generateSpiceNetlist } from './utils/spice.js';
import { generateCustomMcuFootprint } from './utils/pcbFootprints.js';
import { generatePcbLayout } from './utils/pcbExporter.js';
import { MCU_PRESETS, createCustomMcuConfig } from './utils/mcuConfig.js';
import type { Node, Edge } from '@xyflow/react';

console.log('=== RUNNING PARAMETRIC MCU TEST SUITE ===\n');

// -------------------------------------------------------------
// Test 1: Simulation execution with custom pin names & IO types
// -------------------------------------------------------------
console.log('1. Testing JavaScript Simulation with Arbitrary Pins:');
const customScript = `
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

const simRes = executeMcuCode(
  customScript,
  0.5,
  {
    ADC1: [
      { t: 0, v: 2.5 },
      { t: 500, v: 2.5 },
    ],
  },
  {}
);

console.log(' - Logs:', simRes.logs);
console.log(' - Pin Modes:', simRes.pinModes);
console.log(' - GPIO4 PWL points:', simRes.pwlOutputs['GPIO4']);
console.log(' - PWM_CH PWL points:', simRes.pwlOutputs['PWM_CH']);

if (
  simRes.pwlOutputs['GPIO4']?.length >= 2 &&
  simRes.pwlOutputs['PWM_CH']?.length >= 2 &&
  simRes.logs[0].includes('ADC1 value: 511')
) {
  console.log(' [PASS] Custom pin simulation successful!\n');
} else {
  throw new Error('Custom pin simulation failed!');
}

// -------------------------------------------------------------
// Test 2: SPICE netlist generation with dynamic MCU config
// -------------------------------------------------------------
console.log('2. Testing SPICE Netlist Generation for Custom MCU:');

const esp32Preset = MCU_PRESETS.find(p => p.key === 'esp32_devkit')!;

const testNodes: Node[] = [
  {
    id: 'mcu1',
    type: 'mcu',
    position: { x: 100, y: 100 },
    data: {
      mcuConfig: esp32Preset.config,
      code: "pinMode('G4', 'OUTPUT');\npinMode('G18', 'OUTPUT');\ndigitalWrite('G4', 1);\ndigitalWrite('G18', 0);",
    },
  },
  {
    id: 'res1',
    type: 'resistor',
    position: { x: 300, y: 100 },
    data: { resistance: '1k' },
  },
  {
    id: 'gnd1',
    type: 'ground',
    position: { x: 300, y: 200 },
    data: {},
  },
];

const testEdges: Edge[] = [
  {
    id: 'e1',
    source: 'mcu1',
    sourceHandle: 'G4',
    target: 'res1',
    targetHandle: 'in',
  },
  {
    id: 'e2',
    source: 'res1',
    sourceHandle: 'out',
    target: 'gnd1',
    targetHandle: 'in',
  },
];

const netlistRes = generateSpiceNetlist(testNodes, testEdges, 0.1);
console.log(' - Netlist generated length:', netlistRes.netlist.length);
console.log(' - Netlist excerpt:');
console.log(netlistRes.netlist.split('\n').slice(0, 15).join('\n'));

if (
  netlistRes.netlist.includes('V_mcu1_G4') &&
  netlistRes.netlist.includes('V_mcu1_VIN') &&
  netlistRes.netlist.includes('V_mcu1_3V3') &&
  netlistRes.netlist.includes('R_mcu1_GND1')
) {
  console.log(' [PASS] SPICE Netlist properly generated power, GND, and dynamic IO pins!\n');
} else {
  throw new Error('Netlist missing dynamic MCU pins!');
}

// -------------------------------------------------------------
// Test 3: Footprint Generation for Various Form Factors
// -------------------------------------------------------------
console.log('3. Testing Footprint Generation (DIP, 2xN Module, 4-Sided Quad, Custom):');

// 3a. ESP32 DevKit footprint
const esp32Footprint = generateCustomMcuFootprint(esp32Preset.config);
console.log(` - ESP32 Footprint: ${esp32Footprint.name}, ${esp32Footprint.pads.length} pads, dimensions: ${esp32Footprint.widthMm}x${esp32Footprint.heightMm}mm`);

// 3b. Raspberry Pi Pico (40-Pin)
const picoPreset = MCU_PRESETS.find(p => p.key === 'pico_rp2040')!;
const picoFootprint = generateCustomMcuFootprint(picoPreset.config);
console.log(` - Pico Footprint: ${picoFootprint.name}, ${picoFootprint.pads.length} pads, dimensions: ${picoFootprint.widthMm}x${picoFootprint.heightMm}mm`);

// 3c. 4-Sided SMD Quad Module (16-Pin)
const quadPreset = MCU_PRESETS.find(p => p.key === 'quad_module_16')!;
const quadFootprint = generateCustomMcuFootprint(quadPreset.config);
console.log(` - Quad Footprint: ${quadFootprint.name}, ${quadFootprint.pads.length} pads, SMD: ${quadFootprint.pads[0].drillDiameter === 0}`);

// 3d. CC1101 RF Module (8-pin 2x4 Dupont header)
const cc1101Preset = MCU_PRESETS.find(p => p.key === 'cc1101')!;
const cc1101Footprint = generateCustomMcuFootprint(cc1101Preset.config);
console.log(` - CC1101 Footprint: ${cc1101Footprint.name}, ${cc1101Footprint.pads.length} pads, dimensions: ${cc1101Footprint.widthMm}x${cc1101Footprint.heightMm}mm`);

// 3e. Heltec WiFi LoRa 32 V4 (36-pin dual header board)
const heltecPreset = MCU_PRESETS.find(p => p.key === 'heltec_v4')!;
const heltecFootprint = generateCustomMcuFootprint(heltecPreset.config);
console.log(` - Heltec V4 Footprint: ${heltecFootprint.name}, ${heltecFootprint.pads.length} pads, dimensions: ${heltecFootprint.widthMm}x${heltecFootprint.heightMm}mm`);

// 3f. Arbitrary Custom 12-pin Module
const customConfig = createCustomMcuConfig(12, 'quad', { widthMm: 22, heightMm: 22, isSmd: true });
const customFootprint = generateCustomMcuFootprint(customConfig);
console.log(` - Custom 12P Quad Footprint: ${customFootprint.name}, ${customFootprint.pads.length} pads`);

if (
  esp32Footprint.pads.length === 30 &&
  picoFootprint.pads.length === 40 &&
  quadFootprint.pads.length === 16 &&
  cc1101Footprint.pads.length === 8 &&
  heltecFootprint.pads.length === 36 &&
  customFootprint.pads.length === 12
) {
  console.log(' [PASS] All parametric footprint geometries (including CC1101 2x4 and Heltec V4) generated correctly!\n');
} else {
  throw new Error('Footprint pad counts mismatch!');
}

// -------------------------------------------------------------
// Test 4: Full PCB Layout & A* Maze Routing with Arbitrary MCU
// -------------------------------------------------------------
console.log('4. Testing Full PCB Layout & Trace Routing with 30-Pin ESP32 Module:');

const pcbNodes: Node[] = [
  {
    id: 'mcu1',
    type: 'mcu',
    position: { x: 50, y: 50 },
    data: {
      mcuConfig: esp32Preset.config,
    },
  },
  {
    id: 'led1',
    type: 'led',
    position: { x: 250, y: 50 },
    data: { packageId: 'LED-5MM' },
  },
  {
    id: 'r1',
    type: 'resistor',
    position: { x: 250, y: 150 },
    data: { packageId: 'AXIAL-0.3' },
  },
];

const pcbEdges: Edge[] = [
  {
    id: 'e_gpio',
    source: 'mcu1',
    sourceHandle: 'G4',
    target: 'led1',
    targetHandle: 'anode',
  },
  {
    id: 'e_led_res',
    source: 'led1',
    sourceHandle: 'cathode',
    target: 'r1',
    targetHandle: 'in',
  },
  {
    id: 'e_gnd',
    source: 'r1',
    sourceHandle: 'out',
    target: 'mcu1',
    targetHandle: 'GND1',
  },
];

const pcbResult = generatePcbLayout(pcbNodes, pcbEdges, {
  boardWidthMm: 50,
  boardHeightMm: 60,
  autoGrowBoard: true,
});

console.log(' - PCB Success:', pcbResult.success);
console.log(' - Final Board Size:', `${pcbResult.boardWidthMm} x ${pcbResult.boardHeightMm} mm`);
console.log(' - Placed Components:', pcbResult.components.map(c => `${c.name} (${c.footprint.packageId})`));
console.log(' - Routed Traces:', pcbResult.traces.length);
console.log(' - Routing Completion:', `${(pcbResult.completion * 100).toFixed(0)}%`);
console.log(' - G-Code Generated Lines:', pcbResult.gcode.split('\n').length);

if (!pcbResult.success || pcbResult.completion !== 1 || pcbResult.traces.length < 3) {
  throw new Error(`PCB routing did not complete 100%: ${JSON.stringify(pcbResult.violations)}`);
}

// -------------------------------------------------------------
// Test 5: Full PCB Layout with Heltec V4 Node & CC1101 Module
// -------------------------------------------------------------
console.log('5. Testing Full PCB Layout connecting Heltec V4 to CC1101 Transceiver (2x4 Header):');

const heltecNodes: Node[] = [
  {
    id: 'heltec1',
    type: 'heltec_v4',
    position: { x: 50, y: 50 },
    data: {
      packageId: 'HELTEC-V4',
    },
  },
  {
    id: 'cc1101_1',
    type: 'mcu',
    position: { x: 250, y: 50 },
    data: {
      mcuConfig: cc1101Preset.config,
    },
  },
];

const heltecEdges: Edge[] = [
  {
    id: 'e_vcc',
    source: 'heltec1',
    sourceHandle: '3V3',
    target: 'cc1101_1',
    targetHandle: 'VCC',
  },
  {
    id: 'e_gnd',
    source: 'heltec1',
    sourceHandle: 'GND',
    target: 'cc1101_1',
    targetHandle: 'GND',
  },
  {
    id: 'e_mosi',
    source: 'heltec1',
    sourceHandle: 'GPIO_3',
    target: 'cc1101_1',
    targetHandle: 'MOSI',
  },
  {
    id: 'e_miso',
    source: 'heltec1',
    sourceHandle: 'GPIO_1',
    target: 'cc1101_1',
    targetHandle: 'MISO',
  },
];

const heltecPcbRes = generatePcbLayout(heltecNodes, heltecEdges, {
  boardWidthMm: 70,
  boardHeightMm: 80,
  autoGrowBoard: true,
});

console.log(' - Heltec + CC1101 PCB Success:', heltecPcbRes.success);
console.log(' - Final Board Size:', `${heltecPcbRes.boardWidthMm} x ${heltecPcbRes.boardHeightMm} mm`);
console.log(' - Placed Components:', heltecPcbRes.components.map(c => `${c.name} (${c.footprint.packageId})`));
console.log(' - Routed Traces:', heltecPcbRes.traces.length);
console.log(' - Routing Completion:', `${(heltecPcbRes.completion * 100).toFixed(0)}%`);

if (heltecPcbRes.success && heltecPcbRes.completion === 1 && heltecPcbRes.traces.length >= 4) {
  console.log(' [PASS] Heltec V4 + CC1101 2x4 Dupont PCB Layout & Traces completed with 100% completion!\n');
} else {
  throw new Error(`Heltec+CC1101 PCB routing did not complete 100%: ${JSON.stringify(heltecPcbRes.violations)}`);
}

console.log('=== ALL MCU & RF MODULE TESTS PASSED! ===');

