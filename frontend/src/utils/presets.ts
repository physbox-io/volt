import { type Node, type Edge } from '@xyflow/react';

export interface CircuitPreset {
  name: string;
  nodes: Node[];
  edges: Edge[];
  recommendedSimLength?: number;
}

export const empty: CircuitPreset = {
  name: 'Empty',
  nodes: [],
  edges: []
};

export const basicBlink: CircuitPreset = {
  name: 'Basic Blink',
  recommendedSimLength: 1.0,
  nodes: [
    { id: 'sg1', type: 'signalgen', position: { x: 100, y: 150 }, data: { label: 'SIGNALGEN', waveform: 'square', frequency: 1, amplitude: 5 } },
    { id: 'r1', type: 'resistor', position: { x: 350, y: 150 }, data: { label: '330Ω' } },
    { id: 'led1', type: 'led', position: { x: 600, y: 150 }, data: { label: 'LED', color: 'red', v_drop: 2.0, max_current: 20 } },
    { id: 'g1', type: 'ground', position: { x: 600, y: 300 }, data: { label: 'GND' } },
    { id: 'g2', type: 'ground', position: { x: 100, y: 300 }, data: { label: 'GND' } },
  ],
  edges: [
    { id: 'e-sg1-r1', source: 'sg1', target: 'r1', sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep', style: { strokeWidth: 2, stroke: '#555' } },
    { id: 'e-r1-led1', source: 'r1', target: 'led1', sourceHandle: 'out', targetHandle: 'anode', type: 'smoothstep', style: { strokeWidth: 2, stroke: '#555' } },
    { id: 'e-led1-g1', source: 'led1', target: 'g1', sourceHandle: 'cathode', targetHandle: 'in', type: 'smoothstep', style: { strokeWidth: 2, stroke: '#555' } },
    { id: 'e-sg1-g2', source: 'sg1', target: 'g2', sourceHandle: 'gnd', targetHandle: 'in', type: 'smoothstep', style: { strokeWidth: 2, stroke: '#555' } },
  ]
};

export const timer555Blink: CircuitPreset = {
  name: '555 Blinker',
  recommendedSimLength: 1.0,
  nodes: [
    { id: 'v1', type: 'voltage', position: { x: 100, y: 50 }, data: { label: '5V' } },
    { id: 't555', type: 'timer555', position: { x: 400, y: 200 }, data: { label: '555 Timer' } },
    { id: 'r1', type: 'resistor', position: { x: 250, y: 50 }, data: { label: '10kΩ' } },
    { id: 'r2', type: 'resistor', position: { x: 250, y: 150 }, data: { label: '47kΩ' } },
    { id: 'c1', type: 'capacitor', position: { x: 250, y: 250 }, data: { label: '10µF' } },
    { id: 'r3', type: 'resistor', position: { x: 600, y: 200 }, data: { label: '330Ω' } },
    { id: 'led1', type: 'led', position: { x: 800, y: 200 }, data: { label: 'LED', color: 'blue', v_drop: 2.0, max_current: 20 } },
    { id: 'g1', type: 'ground', position: { x: 100, y: 400 }, data: { label: 'GND' } },
  ],
  edges: [
    // Power
    { id: 'e-v1-t8', source: 'v1', target: 't555', sourceHandle: 'pos', targetHandle: '8', type: 'smoothstep' },
    { id: 'e-v1-t4', source: 'v1', target: 't555', sourceHandle: 'pos', targetHandle: '4', type: 'smoothstep' }, // RST to VCC
    { id: 'e-v1-r1', source: 'v1', target: 'r1', sourceHandle: 'pos', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-v1-g1', source: 'v1', target: 'g1', sourceHandle: 'neg', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-t1-g1', source: 't555', target: 'g1', sourceHandle: '1', targetHandle: 'in', type: 'smoothstep' },
    
    // Astable network
    { id: 'e-r1-r2', source: 'r1', target: 'r2', sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-r1-t7', source: 'r1', target: 't555', sourceHandle: 'out', targetHandle: '7', type: 'smoothstep' }, // DIS
    { id: 'e-r2-c1', source: 'r2', target: 'c1', sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-r2-t6', source: 'r2', target: 't555', sourceHandle: 'out', targetHandle: '6', type: 'smoothstep' }, // THR
    { id: 'e-r2-t2', source: 'r2', target: 't555', sourceHandle: 'out', targetHandle: '2', type: 'smoothstep' }, // TRIG
    { id: 'e-c1-g1', source: 'c1', target: 'g1', sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep' },
    
    // Output
    { id: 'e-t3-r3', source: 't555', target: 'r3', sourceHandle: '3', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-r3-led1', source: 'r3', target: 'led1', sourceHandle: 'out', targetHandle: 'anode', type: 'smoothstep' },
    { id: 'e-led1-g1', source: 'led1', target: 'g1', sourceHandle: 'cathode', targetHandle: 'in', type: 'smoothstep' },
  ]
};

export const sineAudio: CircuitPreset = {
  name: 'Sine Wave Audio',
  recommendedSimLength: 1.0,
  nodes: [
    { id: 'sg1', type: 'signalgen', position: { x: 100, y: 150 }, data: { label: 'Tone', waveform: 'sine', frequency: 440, amplitude: 2 } },
    { id: 'spk1', type: 'speaker', position: { x: 400, y: 150 }, data: { label: 'Speaker' } },
    { id: 'g1', type: 'ground', position: { x: 400, y: 300 }, data: { label: 'GND' } },
    { id: 'g2', type: 'ground', position: { x: 100, y: 300 }, data: { label: 'GND' } },
  ],
  edges: [
    { id: 'e-sg1-spk1', source: 'sg1', target: 'spk1', sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-sg1-g2', source: 'sg1', target: 'g2', sourceHandle: 'gnd', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-spk1-g1', source: 'spk1', target: 'g1', sourceHandle: 'gnd', targetHandle: 'in', type: 'smoothstep' },
  ]
};

export const bjtAmp: CircuitPreset = {
  name: 'BJT Audio Amp',
  recommendedSimLength: 1.0,
  nodes: [
    { id: 'v1', type: 'voltage', position: { x: 100, y: 50 }, data: { label: '12V VCC' } },
    { id: 'mic1', type: 'microphone', position: { x: 100, y: 300 }, data: { label: 'Mic', pwlData: [{t:0,v:0}, {t:0.001,v:0.02}, {t:0.002,v:-0.02}, {t:0.003,v:0}] } },
    
    // Input coupling
    { id: 'cin', type: 'capacitor', position: { x: 250, y: 300 }, data: { label: '10µF' } },
    
    // Bias
    { id: 'r1', type: 'resistor', position: { x: 400, y: 150 }, data: { label: '47kΩ' } },
    { id: 'r2', type: 'resistor', position: { x: 400, y: 400 }, data: { label: '10kΩ' } },
    
    // Transistor
    { id: 'q1', type: 'npn', position: { x: 600, y: 300 }, data: { label: '2N3904', bf: 300 } },
    
    // Collector & Emitter resistors
    { id: 'rc', type: 'resistor', position: { x: 600, y: 150 }, data: { label: '2.2kΩ' } },
    { id: 're', type: 'resistor', position: { x: 600, y: 450 }, data: { label: '1kΩ' } },
    
    // Output coupling & Speaker
    { id: 'cout', type: 'capacitor', position: { x: 800, y: 300 }, data: { label: '470µF' } },
    { id: 'spk1', type: 'speaker', position: { x: 1000, y: 300 }, data: { label: 'Speaker', acCouple: true, normalize: true } },
    
    // Grounds
    { id: 'g1', type: 'ground', position: { x: 100, y: 600 }, data: { label: 'GND' } },
  ],
  edges: [
    // Power rails
    { id: 'e-v1-rc', source: 'v1', target: 'rc', sourceHandle: 'pos', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-v1-r1', source: 'v1', target: 'r1', sourceHandle: 'pos', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-v1-g1', source: 'v1', target: 'g1', sourceHandle: 'neg', targetHandle: 'in', type: 'smoothstep' },
    
    // Mic
    { id: 'e-mic-cin', source: 'mic1', target: 'cin', sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-mic-g1', source: 'mic1', target: 'g1', sourceHandle: 'gnd', targetHandle: 'in', type: 'smoothstep' },
    
    // Bias divider & Base
    { id: 'e-r1-b', source: 'r1', target: 'q1', sourceHandle: 'out', targetHandle: 'b', type: 'smoothstep' },
    { id: 'e-r2-b', source: 'q1', target: 'r2', sourceHandle: 'b', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-r2-g1', source: 'r2', target: 'g1', sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-cin-b', source: 'cin', target: 'q1', sourceHandle: 'out', targetHandle: 'b', type: 'smoothstep' },
    
    // Collector
    { id: 'e-rc-c', source: 'rc', target: 'q1', sourceHandle: 'out', targetHandle: 'c', type: 'smoothstep' },
    { id: 'e-c-cout', source: 'q1', target: 'cout', sourceHandle: 'c', targetHandle: 'in', type: 'smoothstep' },
    
    // Emitter
    { id: 'e-q1-re', source: 'q1', target: 're', sourceHandle: 'e', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-re-g1', source: 're', target: 'g1', sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep' },
    
    // Speaker
    { id: 'e-cout-spk', source: 'cout', target: 'spk1', sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-spk-g1', source: 'spk1', target: 'g1', sourceHandle: 'gnd', targetHandle: 'in', type: 'smoothstep' },
  ]
};

export const micSpeaker: CircuitPreset = {
  name: 'Mic → Speaker',
  recommendedSimLength: 1.0,
  nodes: [
    { id: 'mic1', type: 'microphone', position: { x: 100, y: 200 }, data: { label: 'Mic', amplification: 100 } },
    { id: 'spk1', type: 'speaker', position: { x: 400, y: 200 }, data: { label: 'Speaker' } },
    { id: 'g1', type: 'ground', position: { x: 250, y: 400 }, data: { label: 'GND' } },
  ],
  edges: [
    { id: 'e-mic-spk', source: 'mic1', target: 'spk1', sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-mic-g1', source: 'mic1', target: 'g1', sourceHandle: 'gnd', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-spk-g1', source: 'spk1', target: 'g1', sourceHandle: 'gnd', targetHandle: 'in', type: 'smoothstep' },
  ]
};

export const classBamp: CircuitPreset = {
  name: 'Class B Push-Pull',
  recommendedSimLength: 1.0,
  nodes: [
    { id: 'v1', type: 'voltage', position: { x: 50, y: 50 }, data: { label: '12V' } },
    { id: 'mic1', type: 'microphone', position: { x: 50, y: 300 }, data: { label: 'Mic', amplification: 50 } },
    { id: 'cin', type: 'capacitor', position: { x: 250, y: 300 }, data: { label: '10uF' } },
    { id: 'r1', type: 'resistor', position: { x: 400, y: 150 }, data: { label: '10k' } },
    { id: 'r2', type: 'resistor', position: { x: 400, y: 450 }, data: { label: '10k' } },
    { id: 'q1', type: 'npn', position: { x: 600, y: 200 }, data: { label: 'NPN', bf: 200 } },
    { id: 'q2', type: 'pnp', position: { x: 600, y: 400 }, data: { label: 'PNP', bf: 200 } },
    { id: 'cout', type: 'capacitor', position: { x: 800, y: 320 }, data: { label: '470uF' } },
    { id: 'spk1', type: 'speaker', position: { x: 1000, y: 320 }, data: { label: 'Speaker', acCouple: true, normalize: true } },
    { id: 'g1', type: 'ground', position: { x: 50, y: 550 }, data: { label: 'GND' } },
  ],
  edges: [
    { id: 'e-v1-q1c', source: 'v1', target: 'q1', sourceHandle: 'pos', targetHandle: 'c', type: 'smoothstep' },
    { id: 'e-v1-r1', source: 'v1', target: 'r1', sourceHandle: 'pos', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-v1-g1', source: 'v1', target: 'g1', sourceHandle: 'neg', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-r1-q1b', source: 'r1', target: 'q1', sourceHandle: 'out', targetHandle: 'b', type: 'smoothstep' },
    { id: 'e-r1-q2b', source: 'r1', target: 'q2', sourceHandle: 'out', targetHandle: 'b', type: 'smoothstep' },
    { id: 'e-r1-r2', source: 'r1', target: 'r2', sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-r2-gnd', source: 'r2', target: 'g1', sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-mic-cin', source: 'mic1', target: 'cin', sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-cin-base', source: 'cin', target: 'r1', sourceHandle: 'out', targetHandle: 'out', type: 'smoothstep' },
    { id: 'e-mic-gnd', source: 'mic1', target: 'g1', sourceHandle: 'gnd', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-q1e-cout', source: 'q1', target: 'cout', sourceHandle: 'e', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-q2e-cout', source: 'q2', target: 'cout', sourceHandle: 'e', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-q2c-gnd', source: 'q2', target: 'g1', sourceHandle: 'c', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-cout-spk', source: 'cout', target: 'spk1', sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-spk-gnd', source: 'spk1', target: 'g1', sourceHandle: 'gnd', targetHandle: 'in', type: 'smoothstep' },
  ]
};

// Class AB: series bias resistor (Rbias=1.1k) between NPN and PNP base taps
// Bias chain: VCC → R1(4.7k) → [NPN.b] → Rbias(1.1k) → [PNP.b] → R2(4.7k) → GND
// Rbias drops ~1.3V at divider current, matching 2×Vbe to eliminate crossover dead zone
export const classABamp: CircuitPreset = {
  name: 'Class AB Push-Pull',
  recommendedSimLength: 1.0,
  nodes: [
    { id: 'v1', type: 'voltage', position: { x: 50, y: 50 }, data: { label: '12V' } },
    { id: 'mic1', type: 'microphone', position: { x: 50, y: 350 }, data: { label: 'Mic', amplification: 50 } },
    { id: 'cin', type: 'capacitor', position: { x: 250, y: 350 }, data: { label: '10uF' } },
    { id: 'r1', type: 'resistor', position: { x: 420, y: 100 }, data: { label: '4.7k' } },
    { id: 'rbias', type: 'resistor', position: { x: 520, y: 340 }, data: { label: '1.1k' } },
    { id: 'r2', type: 'resistor', position: { x: 420, y: 560 }, data: { label: '4.7k' } },
    { id: 'q1', type: 'npn', position: { x: 680, y: 220 }, data: { label: 'NPN', bf: 200 } },
    { id: 'q2', type: 'pnp', position: { x: 680, y: 450 }, data: { label: 'PNP', bf: 200 } },
    { id: 're1', type: 'resistor', position: { x: 850, y: 290 }, data: { label: '22' } },
    { id: 're2', type: 'resistor', position: { x: 850, y: 420 }, data: { label: '22' } },
    { id: 'cout', type: 'capacitor', position: { x: 1020, y: 350 }, data: { label: '470uF' } },
    { id: 'spk1', type: 'speaker', position: { x: 1200, y: 350 }, data: { label: 'Speaker', acCouple: true, normalize: true } },
    { id: 'g1', type: 'ground', position: { x: 50, y: 650 }, data: { label: 'GND' } },
  ],
  edges: [
    { id: 'e-v1-q1c', source: 'v1', target: 'q1', sourceHandle: 'pos', targetHandle: 'c', type: 'smoothstep' },
    { id: 'e-v1-r1', source: 'v1', target: 'r1', sourceHandle: 'pos', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-v1-g1', source: 'v1', target: 'g1', sourceHandle: 'neg', targetHandle: 'in', type: 'smoothstep' },
    // Bias chain: R1.out = NPN.b, then Rbias, then Rbias.out = PNP.b
    { id: 'e-r1-q1b', source: 'r1', target: 'q1', sourceHandle: 'out', targetHandle: 'b', type: 'smoothstep' },
    { id: 'e-r1-rbias', source: 'r1', target: 'rbias', sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-rbias-q2b', source: 'rbias', target: 'q2', sourceHandle: 'out', targetHandle: 'b', type: 'smoothstep' },
    { id: 'e-rbias-r2', source: 'rbias', target: 'r2', sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-r2-gnd', source: 'r2', target: 'g1', sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep' },
    // Input coupling: mic → Cin → NPN base node
    { id: 'e-mic-cin', source: 'mic1', target: 'cin', sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-cin-bias', source: 'cin', target: 'r1', sourceHandle: 'out', targetHandle: 'out', type: 'smoothstep' },
    { id: 'e-mic-gnd', source: 'mic1', target: 'g1', sourceHandle: 'gnd', targetHandle: 'in', type: 'smoothstep' },
    // Emitter resistors → output
    { id: 'e-q1e-re1', source: 'q1', target: 're1', sourceHandle: 'e', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-q2e-re2', source: 'q2', target: 're2', sourceHandle: 'e', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-re1-cout', source: 're1', target: 'cout', sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-re2-cout', source: 're2', target: 'cout', sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-q2c-gnd', source: 'q2', target: 'g1', sourceHandle: 'c', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-cout-spk', source: 'cout', target: 'spk1', sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-spk-gnd', source: 'spk1', target: 'g1', sourceHandle: 'gnd', targetHandle: 'in', type: 'smoothstep' },
  ]
};

export const bridgeRectifier: CircuitPreset = {
  name: 'Full Bridge Rectifier',
  recommendedSimLength: 1.0,
  nodes: [
    { id: 'vac', type: 'acvoltage', position: { x: 50, y: 200 }, data: { label: '10V 60Hz', amplitude: 10, frequency: 60 } },
    
    // Diode bridge
    { id: 'd1', type: 'diode', position: { x: 300, y: 100 }, data: { label: 'D1' } },
    { id: 'd2', type: 'diode', position: { x: 300, y: 300 }, data: { label: 'D2' } },
    { id: 'd3', type: 'diode', position: { x: 500, y: 100 }, data: { label: 'D3' } },
    { id: 'd4', type: 'diode', position: { x: 500, y: 300 }, data: { label: 'D4' } },
    
    // Load & Filter
    { id: 'rload', type: 'resistor', position: { x: 750, y: 200 }, data: { label: '1k' } },
    { id: 'cfilter', type: 'capacitor', position: { x: 900, y: 200 }, data: { label: '100u' } },
    
    // Scope
    { id: 'scope1', type: 'scope', position: { x: 1100, y: 200 }, data: { label: 'Input vs Output' } },
    
    // GND
    { id: 'gnd1', type: 'ground', position: { x: 600, y: 500 }, data: { label: 'GND' } },
  ],
  edges: [
    // AC Source to bridge
    { id: 'e-vac-pos-d1', source: 'vac', target: 'd1', sourceHandle: 'pos', targetHandle: 'anode', type: 'smoothstep' },
    { id: 'e-vac-pos-d2', source: 'vac', target: 'd2', sourceHandle: 'pos', targetHandle: 'cathode', type: 'smoothstep' },
    { id: 'e-vac-neg-d3', source: 'vac', target: 'd3', sourceHandle: 'neg', targetHandle: 'anode', type: 'smoothstep' },
    { id: 'e-vac-neg-d4', source: 'vac', target: 'd4', sourceHandle: 'neg', targetHandle: 'cathode', type: 'smoothstep' },
    
    // Bridge Positive output
    { id: 'e-d1-pos', source: 'd1', target: 'rload', sourceHandle: 'cathode', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-d3-pos', source: 'd3', target: 'rload', sourceHandle: 'cathode', targetHandle: 'in', type: 'smoothstep' },
    
    // Bridge Negative output (GND)
    { id: 'e-d2-neg', source: 'd2', target: 'gnd1', sourceHandle: 'anode', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-d4-neg', source: 'd4', target: 'gnd1', sourceHandle: 'anode', targetHandle: 'in', type: 'smoothstep' },
    
    // Load and Filter connections
    { id: 'e-rl-c', source: 'rload', target: 'cfilter', sourceHandle: 'in', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-rl-gnd', source: 'rload', target: 'gnd1', sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-c-gnd', source: 'cfilter', target: 'gnd1', sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep' },
    
    // Scope connections
    { id: 'e-scope-ch1', source: 'vac', target: 'scope1', sourceHandle: 'pos', targetHandle: 'ch1', type: 'smoothstep' },
    { id: 'e-scope-ch2', source: 'rload', target: 'scope1', sourceHandle: 'in', targetHandle: 'ch2', type: 'smoothstep' },
    { id: 'e-scope-gnd', source: 'scope1', target: 'gnd1', sourceHandle: 'gnd', targetHandle: 'in', type: 'smoothstep' },
  ]
};

export const mcuBlink: CircuitPreset = {
  name: 'MCU Blink',
  recommendedSimLength: 1.0,
  nodes: [
    { id: 'mcu1', type: 'mcu', position: { x: 100, y: 150 }, data: { label: 'Microcontroller', code: "pinMode('D0', 'OUTPUT');\n\nwhile(true) {\n  digitalWrite('D0', 1);\n  sleep(500);\n  digitalWrite('D0', 0);\n  sleep(500);\n}" } },
    { id: 'r1', type: 'resistor', position: { x: 400, y: 180 }, data: { label: '330Ω' } },
    { id: 'led1', type: 'led', position: { x: 600, y: 180 }, data: { label: 'LED', color: 'blue', v_drop: 2.0, max_current: 20 } },
    { id: 'g1', type: 'ground', position: { x: 600, y: 350 }, data: { label: 'GND' } },
  ],
  edges: [
    { id: 'e-mcu-r1', source: 'mcu1', target: 'r1', sourceHandle: 'D0', targetHandle: 'in', type: 'smoothstep', style: { strokeWidth: 2, stroke: '#555' } },
    { id: 'e-r1-led1', source: 'r1', target: 'led1', sourceHandle: 'out', targetHandle: 'anode', type: 'smoothstep', style: { strokeWidth: 2, stroke: '#555' } },
    { id: 'e-led1-g1', source: 'led1', target: 'g1', sourceHandle: 'cathode', targetHandle: 'in', type: 'smoothstep', style: { strokeWidth: 2, stroke: '#555' } },
  ]
};

export const mcuSpeaker: CircuitPreset = {
  name: 'MCU Speaker Tone',
  recommendedSimLength: 1.0,
  nodes: [
    { id: 'mcu1', type: 'mcu', position: { x: 100, y: 150 }, data: { label: 'Microcontroller', code: "pinMode('D1', 'OUTPUT');\n\n// Generate 500Hz square wave\nconst halfPeriod = 1;\nwhile(true) {\n  digitalWrite('D1', 1);\n  sleep(halfPeriod);\n  digitalWrite('D1', 0);\n  sleep(halfPeriod);\n}" } },
    { id: 'spk1', type: 'speaker', position: { x: 400, y: 150 }, data: { label: 'Speaker' } },
    { id: 'g1', type: 'ground', position: { x: 400, y: 300 }, data: { label: 'GND' } },
  ],
  edges: [
    { id: 'e-mcu-spk1', source: 'mcu1', target: 'spk1', sourceHandle: 'D1', targetHandle: 'in', type: 'smoothstep', style: { strokeWidth: 2, stroke: '#555' } },
    { id: 'e-spk1-g1', source: 'spk1', target: 'g1', sourceHandle: 'gnd', targetHandle: 'in', type: 'smoothstep', style: { strokeWidth: 2, stroke: '#555' } },
  ]
};

export const mcuAnalogOut: CircuitPreset = {
  name: 'MCU Sine Wave (A0)',
  recommendedSimLength: 1.0,
  nodes: [
    { id: 'mcu1', type: 'mcu', position: { x: 100, y: 150 }, data: { label: 'Microcontroller', code: "pinMode('A0', 'OUTPUT');\n\n// Generate ~5Hz sine wave\nconst freq = 5;\nconst points = 20;\nconst dt = 1000 / (freq * points);\n\nwhile(true) {\n  for(let i=0; i<points; i++) {\n    const rad = (i / points) * 2 * Math.PI;\n    const val = (Math.sin(rad) + 1) * 127;\n    analogWrite('A0', val);\n    \n    // Log first period\n    if (millis() < 1000 / freq) {\n      Serial.println(`t=${millis().toFixed(0)} val=${val.toFixed(0)}`);\n    }\n    sleep(dt);\n  }\n}" } },
    { id: 'scope1', type: 'scope', position: { x: 400, y: 150 }, data: { label: 'A0 Output' } },
    { id: 'g1', type: 'ground', position: { x: 400, y: 300 }, data: { label: 'GND' } },
  ],
  edges: [
    { id: 'e-mcu-scope', source: 'mcu1', target: 'scope1', sourceHandle: 'A0', targetHandle: 'ch1', type: 'smoothstep', style: { strokeWidth: 2, stroke: '#555' } },
    { id: 'e-scope-g1', source: 'scope1', target: 'g1', sourceHandle: 'gnd', targetHandle: 'in', type: 'smoothstep', style: { strokeWidth: 2, stroke: '#555' } },
  ]
};

export const mcuAnalogIn: CircuitPreset = {
  name: 'MCU Analog Read (A0)',
  recommendedSimLength: 1.0,
  nodes: [
    { id: 'vac1', type: 'acvoltage', position: { x: 50, y: 180 }, data: { label: '5V 40Hz', amplitude: 5, frequency: 40 } },
    { id: 'mcu1', type: 'mcu', position: { x: 300, y: 150 }, data: { label: 'Microcontroller', code: "pinMode('A0', 'INPUT');\n\n// Read A0 every 5ms and log it\nwhile(true) {\n  const val = analogRead('A0');\n  Serial.println(`t=${millis()}ms -> A0: ${val}`);\n  sleep(5);\n}" } },
    { id: 'g1', type: 'ground', position: { x: 50, y: 300 }, data: { label: 'GND' } },
    { id: 'g2', type: 'ground', position: { x: 300, y: 350 }, data: { label: 'GND' } },
  ],
  edges: [
    { id: 'e-vac-mcu', source: 'vac1', target: 'mcu1', sourceHandle: 'pos', targetHandle: 'A0', type: 'smoothstep', style: { strokeWidth: 2, stroke: '#555' } },
    { id: 'e-vac-gnd', source: 'vac1', target: 'g1', sourceHandle: 'neg', targetHandle: 'in', type: 'smoothstep', style: { strokeWidth: 2, stroke: '#555' } },
    { id: 'e-mcu-gnd', source: 'mcu1', target: 'g2', sourceHandle: 'GND', targetHandle: 'in', type: 'smoothstep', style: { strokeWidth: 2, stroke: '#555' } },
  ]
};

export const mcuPassThrough: CircuitPreset = {
  name: 'MCU Audio Sampler',
  recommendedSimLength: 1.0,
  nodes: [
    { id: 'sg1', type: 'signalgen', position: { x: 50, y: 180 }, data: { label: '440Hz Sine', waveform: 'sine', frequency: 440, amplitude: 5 } },
    { id: 'mcu1', type: 'mcu', position: { x: 300, y: 150 }, data: { label: 'Microcontroller', code: "pinMode('A0', 'INPUT');\npinMode('A1', 'OUTPUT');\n\n// Pass-through sampling at 1kHz (1ms)\nwhile(true) {\n  const val = analogRead('A0');\n  // Convert 10-bit ADC to 8-bit DAC\n  analogWrite('A1', val / 4);\n  sleep(1);\n}" } },
    { id: 'spk1', type: 'speaker', position: { x: 600, y: 180 }, data: { label: 'Speaker' } },
    { id: 'g1', type: 'ground', position: { x: 50, y: 300 }, data: { label: 'GND' } },
    { id: 'g2', type: 'ground', position: { x: 300, y: 350 }, data: { label: 'GND' } },
    { id: 'g3', type: 'ground', position: { x: 600, y: 300 }, data: { label: 'GND' } },
  ],
  edges: [
    { id: 'e-sg-mcu', source: 'sg1', target: 'mcu1', sourceHandle: 'out', targetHandle: 'A0', type: 'smoothstep', style: { strokeWidth: 2, stroke: '#555' } },
    { id: 'e-sg-gnd', source: 'sg1', target: 'g1', sourceHandle: 'gnd', targetHandle: 'in', type: 'smoothstep', style: { strokeWidth: 2, stroke: '#555' } },
    { id: 'e-mcu-spk', source: 'mcu1', target: 'spk1', sourceHandle: 'A1', targetHandle: 'in', type: 'smoothstep', style: { strokeWidth: 2, stroke: '#555' } },
    { id: 'e-spk-gnd', source: 'spk1', target: 'g3', sourceHandle: 'gnd', targetHandle: 'in', type: 'smoothstep', style: { strokeWidth: 2, stroke: '#555' } },
    { id: 'e-mcu-gnd', source: 'mcu1', target: 'g2', sourceHandle: 'GND', targetHandle: 'in', type: 'smoothstep', style: { strokeWidth: 2, stroke: '#555' } },
  ]
};

export const mcuCleanAudioSampler: CircuitPreset = {
  name: 'MCU Clean Audio Sampler',
  recommendedSimLength: 1.0,
  nodes: [
    // Signal generation (2V amplitude so it swings 0.5V to 4.5V when biased at 2.5V)
    { id: 'sg1', type: 'signalgen', position: { x: 50, y: 300 }, data: { label: '440Hz Sine', waveform: 'sine', frequency: 440, amplitude: 2 } },
    { id: 'cin', type: 'capacitor', position: { x: 200, y: 300 }, data: { label: '10µF AC Couple', capacitance: 10e-6 } },
    
    // DC Bias network
    { id: 'v1', type: 'voltage', position: { x: 350, y: 50 }, data: { label: '5V' } },
    { id: 'r1', type: 'resistor', position: { x: 350, y: 150 }, data: { label: '10k' } },
    { id: 'r2', type: 'resistor', position: { x: 350, y: 400 }, data: { label: '10k' } },
    
    // Microcontroller
    { id: 'mcu1', type: 'mcu', position: { x: 550, y: 250 }, data: { label: 'Microcontroller', code: "pinMode('A0', 'INPUT');\npinMode('A1', 'OUTPUT');\n\n// 10kHz sampling for high fidelity\nwhile(true) {\n  const val = analogRead('A0');\n  analogWrite('A1', val / 4);\n  sleep(0.1);\n}" } },
    
    // Reconstruction Low-Pass Filter
    { id: 'rout', type: 'resistor', position: { x: 800, y: 250 }, data: { label: '1k' } },
    { id: 'cout', type: 'capacitor', position: { x: 950, y: 400 }, data: { label: '0.1µF LPF' } },
    
    // Output
    { id: 'spk1', type: 'speaker', position: { x: 1100, y: 250 }, data: { label: 'Speaker' } },
    
    // Grounds
    { id: 'g1', type: 'ground', position: { x: 50, y: 500 }, data: { label: 'GND' } },
    { id: 'g2', type: 'ground', position: { x: 350, y: 500 }, data: { label: 'GND' } },
    { id: 'g3', type: 'ground', position: { x: 950, y: 500 }, data: { label: 'GND' } },
  ],
  edges: [
    // Signal source
    { id: 'e-sg-cin', source: 'sg1', target: 'cin', sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-sg-g1', source: 'sg1', target: 'g1', sourceHandle: 'gnd', targetHandle: 'in', type: 'smoothstep' },
    
    // Bias divider & AC coupling mix
    { id: 'e-v1-r1', source: 'v1', target: 'r1', sourceHandle: 'pos', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-v1-g2', source: 'v1', target: 'g2', sourceHandle: 'neg', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-r1-mix', source: 'r1', target: 'r2', sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-r2-g2', source: 'r2', target: 'g2', sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-cin-mix', source: 'cin', target: 'r2', sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep' },
    
    // MCU input
    { id: 'e-mix-mcu', source: 'r2', target: 'mcu1', sourceHandle: 'in', targetHandle: 'A0', type: 'smoothstep' },
    { id: 'e-mcu-g2', source: 'mcu1', target: 'g2', sourceHandle: 'GND', targetHandle: 'in', type: 'smoothstep' },
    
    // MCU output to Filter
    { id: 'e-mcu-rout', source: 'mcu1', target: 'rout', sourceHandle: 'A1', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-rout-cout', source: 'rout', target: 'cout', sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-cout-g3', source: 'cout', target: 'g3', sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep' },
    
    // Filter to Speaker
    { id: 'e-filt-spk', source: 'rout', target: 'spk1', sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-spk-g3', source: 'spk1', target: 'g3', sourceHandle: 'gnd', targetHandle: 'in', type: 'smoothstep' },
  ]
};

export const mixedLogicBlink: CircuitPreset = {
  name: 'Mixed Logic Blink',
  recommendedSimLength: 1.0,
  nodes: [
    { id: 'sg1', type: 'signalgen', position: { x: 50, y: 100 }, data: { label: 'Clock 1Hz', waveform: 'square', frequency: 1, amplitude: 5 } },
    { id: 'sg2', type: 'signalgen', position: { x: 50, y: 300 }, data: { label: 'Clock 2Hz', waveform: 'square', frequency: 2, amplitude: 5 } },
    { id: 'and1', type: 'and', position: { x: 300, y: 200 }, data: { label: 'AND Gate' } },
    { id: 'r1', type: 'resistor', position: { x: 500, y: 200 }, data: { label: '330Ω' } },
    { id: 'led1', type: 'led', position: { x: 700, y: 200 }, data: { label: 'Output', color: 'lime', v_drop: 2.0, max_current: 20 } },
    { id: 'g1', type: 'ground', position: { x: 700, y: 350 }, data: { label: 'GND' } },
    { id: 'g2', type: 'ground', position: { x: 50, y: 200 }, data: { label: 'GND' } },
    { id: 'g3', type: 'ground', position: { x: 50, y: 400 }, data: { label: 'GND' } },
  ],
  edges: [
    { id: 'e-sg1-and', source: 'sg1', target: 'and1', sourceHandle: 'out', targetHandle: 'in1', type: 'smoothstep' },
    { id: 'e-sg2-and', source: 'sg2', target: 'and1', sourceHandle: 'out', targetHandle: 'in2', type: 'smoothstep' },
    { id: 'e-sg1-gnd', source: 'sg1', target: 'g2', sourceHandle: 'gnd', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-sg2-gnd', source: 'sg2', target: 'g3', sourceHandle: 'gnd', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-and-r1', source: 'and1', target: 'r1', sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-r1-led', source: 'r1', target: 'led1', sourceHandle: 'out', targetHandle: 'anode', type: 'smoothstep' },
    { id: 'e-led-gnd', source: 'led1', target: 'g1', sourceHandle: 'cathode', targetHandle: 'in', type: 'smoothstep' },
  ]
};

export const opAmpAmp: CircuitPreset = {
  name: 'Op-Amp Audio Amp',
  nodes: [
    { id: 'vcc', type: 'voltage', position: { x: 50, y: 50 }, data: { label: '12V' } },
    { id: 'mic1', type: 'microphone', position: { x: 50, y: 300 }, data: { label: 'Mic', amplification: 1 } },
    { id: 'cin', type: 'capacitor', position: { x: 200, y: 300 }, data: { label: '0.1uF' } },
    
    // Bias divider for single supply op-amp
    { id: 'r_b1', type: 'resistor', position: { x: 350, y: 150 }, data: { label: '100k' } },
    { id: 'r_b2', type: 'resistor', position: { x: 350, y: 450 }, data: { label: '100k' } },
    
    // Op-amp
    { id: 'oa1', type: 'opamp', position: { x: 550, y: 300 }, data: { label: 'LM358' } },
    
    // Feedback network (Gain = 1 + Rf/Rg)
    { id: 'rg', type: 'resistor', position: { x: 550, y: 450 }, data: { label: '1k' } },
    { id: 'rf', type: 'resistor', position: { x: 750, y: 450 }, data: { label: '10k' } },
    { id: 'cg', type: 'capacitor', position: { x: 450, y: 450 }, data: { label: '100uF' } },
    
    // Output coupling
    { id: 'cout', type: 'capacitor', position: { x: 900, y: 320 }, data: { label: '47uF' } },
    { id: 'spk1', type: 'speaker', position: { x: 1100, y: 320 }, data: { label: 'Speaker', acCouple: true, normalize: true } },
    
    { id: 'g1', type: 'ground', position: { x: 50, y: 600 }, data: { label: 'GND' } },
  ],
  edges: [
    // Power
    { id: 'e-vcc-rb1', source: 'vcc', target: 'r_b1', sourceHandle: 'pos', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-vcc-oa', source: 'vcc', target: 'oa1', sourceHandle: 'pos', targetHandle: 'vcc', type: 'smoothstep' },
    { id: 'e-vcc-gnd', source: 'vcc', target: 'g1', sourceHandle: 'neg', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-oa-vee', source: 'oa1', target: 'g1', sourceHandle: 'vee', targetHandle: 'in', type: 'smoothstep' },
    
    // Bias Divider
    { id: 'e-rb1-rb2', source: 'r_b1', target: 'r_b2', sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-rb2-gnd', source: 'r_b2', target: 'g1', sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep' },
    
    // Input Signal
    { id: 'e-mic-cin', source: 'mic1', target: 'cin', sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-mic-gnd', source: 'mic1', target: 'g1', sourceHandle: 'gnd', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-cin-oanon', source: 'cin', target: 'oa1', sourceHandle: 'out', targetHandle: 'in_non', type: 'smoothstep' },
    { id: 'e-rb1-oanon', source: 'r_b1', target: 'oa1', sourceHandle: 'out', targetHandle: 'in_non', type: 'smoothstep' },
    
    // Feedback
    { id: 'e-oaout-rf', source: 'oa1', target: 'rf', sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-rf-oainv', source: 'rf', target: 'oa1', sourceHandle: 'out', targetHandle: 'in_inv', type: 'smoothstep' },
    { id: 'e-rg-oainv', source: 'rg', target: 'oa1', sourceHandle: 'out', targetHandle: 'in_inv', type: 'smoothstep' },
    { id: 'e-rg-cg', source: 'rg', target: 'cg', sourceHandle: 'in', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-cg-gnd', source: 'cg', target: 'g1', sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep' },
    
    // Output
    { id: 'e-oaout-cout', source: 'oa1', target: 'cout', sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-cout-spk', source: 'cout', target: 'spk1', sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-spk-gnd', source: 'spk1', target: 'g1', sourceHandle: 'gnd', targetHandle: 'in', type: 'smoothstep' },
  ]
};

export const boostConverter: CircuitPreset = {
  name: 'Boost Converter (5V → 25V)',
  recommendedSimLength: 0.05,
  nodes: [
    { id: 'v5v', type: 'voltage', position: { x: 50, y: 250 }, data: { label: '5V IN' } },
    { id: 'l1', type: 'inductor', position: { x: 250, y: 150 }, data: { label: '100uH' } },
    { id: 'sw1', type: 'nmos', position: { x: 450, y: 300 }, data: { label: 'Switch', vto: 2.0, kp: 0.5 } },
    { id: 'pwm1', type: 'signalgen', position: { x: 50, y: 450 }, data: { label: 'PWM 50kHz', waveform: 'square', frequency: 50000, amplitude: 5, dutyCycle: 80 } },
    
    { id: 'd1', type: 'diode', position: { x: 550, y: 150 }, data: { label: 'Schottky', v_drop: 0.3 } },
    { id: 'c1', type: 'capacitor', position: { x: 750, y: 250 }, data: { label: '100uF' } },
    { id: 'rload', type: 'resistor', position: { x: 900, y: 250 }, data: { label: '1k Load' } },
    
    { id: 'mm_in', type: 'multimeter', position: { x: 200, y: 400 }, data: { label: 'Input Voltage' } },
    { id: 'mm_out', type: 'multimeter', position: { x: 1000, y: 250 }, data: { label: 'Output Voltage' } },
    
    { id: 'g1', type: 'ground', position: { x: 450, y: 550 }, data: { label: 'GND' } },
  ],
  edges: [
    // Power in
    { id: 'e-v5v-l1', source: 'v5v', target: 'l1', sourceHandle: 'pos', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-v5v-gnd', source: 'v5v', target: 'g1', sourceHandle: 'neg', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-mmin-pos', source: 'l1', target: 'mm_in', sourceHandle: 'in', targetHandle: 'pos', type: 'smoothstep' },
    { id: 'e-mmin-neg', source: 'mm_in', target: 'g1', sourceHandle: 'neg', targetHandle: 'in', type: 'smoothstep' },

    // Switching node
    { id: 'e-l1-sw', source: 'l1', target: 'sw1', sourceHandle: 'out', targetHandle: 'd', type: 'smoothstep' },
    { id: 'e-l1-d1', source: 'l1', target: 'd1', sourceHandle: 'out', targetHandle: 'anode', type: 'smoothstep' },
    { id: 'e-sw-gnd', source: 'sw1', target: 'g1', sourceHandle: 's', targetHandle: 'in', type: 'smoothstep' },
    
    // PWM Control
    { id: 'e-pwm-sw', source: 'pwm1', target: 'sw1', sourceHandle: 'out', targetHandle: 'g', type: 'smoothstep' },
    { id: 'e-pwm-gnd', source: 'pwm1', target: 'g1', sourceHandle: 'gnd', targetHandle: 'in', type: 'smoothstep' },

    // Output
    { id: 'e-d1-c1', source: 'd1', target: 'c1', sourceHandle: 'cathode', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-c1-rl', source: 'c1', target: 'rload', sourceHandle: 'in', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-rl-mmout', source: 'rload', target: 'mm_out', sourceHandle: 'in', targetHandle: 'pos', type: 'smoothstep' },
    { id: 'e-c1-gnd', source: 'c1', target: 'g1', sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-rl-gnd', source: 'rload', target: 'g1', sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep' },
    { id: 'mmout-neg', source: 'mm_out', target: 'g1', sourceHandle: 'neg', targetHandle: 'in', type: 'smoothstep' },
  ]
};

export const bistableMultivibrator: CircuitPreset = {
  name: 'Bistable Multivibrator',
  recommendedSimLength: 2.0,
  nodes: [
    { id: 'vcc', type: 'voltage', position: { x: 300, y: 50 }, data: { label: '5V' } },
    { id: 'q1', type: 'npn', position: { x: 200, y: 300 }, data: { label: 'Q1' } },
    { id: 'q2', type: 'npn', position: { x: 400, y: 300 }, data: { label: 'Q2' } },
    
    // Collector loads
    { id: 'rc1', type: 'resistor', position: { x: 200, y: 150 }, data: { label: '1k' } },
    { id: 'rc2', type: 'resistor', position: { x: 400, y: 150 }, data: { label: '1k' } },
    
    // LEDs to show state
    { id: 'led1', type: 'led', position: { x: 100, y: 150 }, data: { label: 'L1', color: 'red' } },
    { id: 'led2', type: 'led', position: { x: 500, y: 150 }, data: { label: 'L2', color: 'blue' } },
    { id: 'rl1', type: 'resistor', position: { x: 100, y: 100 }, data: { label: '330' } },
    { id: 'rl2', type: 'resistor', position: { x: 500, y: 100 }, data: { label: '330' } },

    // Cross-coupling resistors
    { id: 'rb1', type: 'resistor', position: { x: 300, y: 250 }, data: { label: '10k' } },
    { id: 'rb2', type: 'resistor', position: { x: 300, y: 350 }, data: { label: '10k' } },
    
    // Triggers (Set/Reset switches)
    { id: 'sw1', type: 'switch', position: { x: 50, y: 450 }, data: { label: 'SET', isOpen: true } },
    { id: 'sw2', type: 'switch', position: { x: 550, y: 450 }, data: { label: 'RESET', isOpen: true } },
    { id: 'r_trig1', type: 'resistor', position: { x: 150, y: 450 }, data: { label: '1k' } },
    { id: 'r_trig2', type: 'resistor', position: { x: 450, y: 450 }, data: { label: '1k' } },
    
    { id: 'g1', type: 'ground', position: { x: 300, y: 550 }, data: { label: 'GND' } },
  ],
  edges: [
    // Power
    { id: 'e-vcc-rc1', source: 'vcc', target: 'rc1', sourceHandle: 'pos', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-vcc-rc2', source: 'vcc', target: 'rc2', sourceHandle: 'pos', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-vcc-rl1', source: 'vcc', target: 'rl1', sourceHandle: 'pos', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-vcc-rl2', source: 'vcc', target: 'rl2', sourceHandle: 'pos', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-vcc-gnd', source: 'vcc', target: 'g1', sourceHandle: 'neg', targetHandle: 'in', type: 'smoothstep' },

    // Collector loads to transistors
    { id: 'e-rc1-q1', source: 'rc1', target: 'q1', sourceHandle: 'out', targetHandle: 'c', type: 'smoothstep' },
    { id: 'e-rc2-q2', source: 'rc2', target: 'q2', sourceHandle: 'out', targetHandle: 'c', type: 'smoothstep' },

    // LEDs
    { id: 'e-rl1-led1', source: 'rl1', target: 'led1', sourceHandle: 'out', targetHandle: 'anode', type: 'smoothstep' },
    { id: 'e-led1-q1', source: 'led1', target: 'q1', sourceHandle: 'cathode', targetHandle: 'c', type: 'smoothstep' },
    { id: 'e-rl2-led2', source: 'rl2', target: 'led2', sourceHandle: 'out', targetHandle: 'anode', type: 'smoothstep' },
    { id: 'e-led2-q2', source: 'led2', target: 'q2', sourceHandle: 'cathode', targetHandle: 'c', type: 'smoothstep' },

    // Cross-coupling: Collector of one to Base of other
    { id: 'e-q1c-rb2', source: 'q1', target: 'rb2', sourceHandle: 'c', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-rb2-q2b', source: 'rb2', target: 'q2', sourceHandle: 'out', targetHandle: 'b', type: 'smoothstep' },
    { id: 'e-q2c-rb1', source: 'q2', target: 'rb1', sourceHandle: 'c', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-rb1-q1b', source: 'rb1', target: 'q1', sourceHandle: 'out', targetHandle: 'b', type: 'smoothstep' },

    // Emitters to ground
    { id: 'e-q1-gnd', source: 'q1', target: 'g1', sourceHandle: 'e', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-q2-gnd', source: 'q2', target: 'g1', sourceHandle: 'e', targetHandle: 'in', type: 'smoothstep' },

    // Triggers to bases
    { id: 'e-vcc-sw1', source: 'vcc', target: 'sw1', sourceHandle: 'pos', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-vcc-sw2', source: 'vcc', target: 'sw2', sourceHandle: 'pos', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-sw1-rt1', source: 'sw1', target: 'r_trig1', sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-sw2-rt2', source: 'sw2', target: 'r_trig2', sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-rt1-q1b', source: 'r_trig1', target: 'q1', sourceHandle: 'out', targetHandle: 'b', type: 'smoothstep' },
    { id: 'e-rt2-q2b', source: 'r_trig2', target: 'q2', sourceHandle: 'out', targetHandle: 'b', type: 'smoothstep' },
  ]
};

export const astableMultivibrator: CircuitPreset = {
  name: 'Astable Multivibrator (Blinker)',
  recommendedSimLength: 2.0,
  nodes: [
    { id: 'vcc', type: 'voltage', position: { x: 300, y: 50 }, data: { label: '5V' } },
    { id: 'q1', type: 'npn', position: { x: 200, y: 350 }, data: { label: 'Q1' } },
    { id: 'q2', type: 'npn', position: { x: 400, y: 350 }, data: { label: 'Q2' } },
    { id: 'rc1', type: 'resistor', position: { x: 200, y: 150 }, data: { label: '330' } },
    { id: 'rc2', type: 'resistor', position: { x: 400, y: 150 }, data: { label: '330' } },
    { id: 'rb1', type: 'resistor', position: { x: 280, y: 150 }, data: { label: '47k' } },
    { id: 'rb2', type: 'resistor', position: { x: 320, y: 150 }, data: { label: '48k' } },
    { id: 'c1', type: 'capacitor', position: { x: 250, y: 250 }, data: { label: '10uF' } },
    { id: 'c2', type: 'capacitor', position: { x: 350, y: 250 }, data: { label: '10uF' } },
    { id: 'led1', type: 'led', position: { x: 100, y: 250 }, data: { label: 'L1', color: 'red' } },
    { id: 'led2', type: 'led', position: { x: 500, y: 250 }, data: { label: 'L2', color: 'green' } },
    { id: 'g1', type: 'ground', position: { x: 300, y: 500 }, data: { label: 'GND' } },
  ],
  edges: [
     { id: 'e-v-rc1', source: 'vcc', target: 'rc1', sourceHandle: 'pos', targetHandle: 'in' },
     { id: 'e-v-rc2', source: 'vcc', target: 'rc2', sourceHandle: 'pos', targetHandle: 'in' },
     { id: 'e-v-rb1', source: 'vcc', target: 'rb1', sourceHandle: 'pos', targetHandle: 'in' },
     { id: 'e-v-rb2', source: 'vcc', target: 'rb2', sourceHandle: 'pos', targetHandle: 'in' },
     { id: 'e-v-gnd', source: 'vcc', target: 'g1', sourceHandle: 'neg', targetHandle: 'in' },
     { id: 'e-led1-q1', source: 'led1', target: 'q1', sourceHandle: 'cathode', targetHandle: 'c' },
     { id: 'e-rc1-led1', source: 'rc1', target: 'led1', sourceHandle: 'out', targetHandle: 'anode' },
     { id: 'e-led2-q2', source: 'led2', target: 'q2', sourceHandle: 'cathode', targetHandle: 'c' },
     { id: 'e-rc2-led2', source: 'rc2', target: 'led2', sourceHandle: 'out', targetHandle: 'anode' },
     { id: 'e-q1c-c1', source: 'q1', target: 'c1', sourceHandle: 'c', targetHandle: 'in' },
     { id: 'e-c1-q2b', source: 'c1', target: 'q2', sourceHandle: 'out', targetHandle: 'b' },
     { id: 'e-q2c-c2', source: 'q2', target: 'c2', sourceHandle: 'c', targetHandle: 'in' },
     { id: 'e-c2-q1b', source: 'c2', target: 'q1', sourceHandle: 'out', targetHandle: 'b' },
     { id: 'e-rb1-q1b', source: 'rb1', target: 'q1', sourceHandle: 'out', targetHandle: 'b' },
     { id: 'e-rb2-q2b', source: 'rb2', target: 'q2', sourceHandle: 'out', targetHandle: 'b' },
     { id: 'e-q1e-gnd', source: 'q1', target: 'g1', sourceHandle: 'e', targetHandle: 'in' },
     { id: 'e-q2e-gnd', source: 'q2', target: 'g1', sourceHandle: 'e', targetHandle: 'in' },
  ]
};

export const potDimmer: CircuitPreset = {
  name: 'Pot LED Dimmer',
  recommendedSimLength: 0.5,
  nodes: [
    { id: 'v1', type: 'voltage', position: { x: 50, y: 150 }, data: { label: '5V' } },
    { id: 'pot1', type: 'potentiometer', position: { x: 250, y: 150 }, data: { label: '1k', position: 50 } },
    { id: 'r1', type: 'resistor', position: { x: 450, y: 150 }, data: { label: '100' } },
    { id: 'led1', type: 'led', position: { x: 650, y: 150 }, data: { label: 'LED', color: 'lime', v_drop: 2.0, max_current: 20 } },
    { id: 'mm1', type: 'multimeter', position: { x: 350, y: 50 }, data: { label: 'Wiper V' } },
    { id: 'g1', type: 'ground', position: { x: 350, y: 350 }, data: { label: 'GND' } },
  ],
  edges: [
    { id: 'e-v1-pot', source: 'v1', target: 'pot1', sourceHandle: 'pos', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-pot-gnd', source: 'pot1', target: 'g1', sourceHandle: 'out', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-wiper-r1', source: 'pot1', target: 'r1', sourceHandle: 'wiper', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-r1-led', source: 'r1', target: 'led1', sourceHandle: 'out', targetHandle: 'anode', type: 'smoothstep' },
    { id: 'e-led-gnd', source: 'led1', target: 'g1', sourceHandle: 'cathode', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-v1-gnd', source: 'v1', target: 'g1', sourceHandle: 'neg', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-mm-pos', source: 'pot1', target: 'mm1', sourceHandle: 'wiper', targetHandle: 'pos', type: 'smoothstep' },
    { id: 'e-mm-neg', source: 'mm1', target: 'g1', sourceHandle: 'neg', targetHandle: 'in', type: 'smoothstep' },
  ]
};

export const sevenSegDirect: CircuitPreset = {
  name: '7-Segment Display',
  recommendedSimLength: 1.0,
  nodes: [
    { id: 'v1', type: 'voltage', position: { x: 50, y: 50 }, data: { label: '5V' } },
    // Direct drive: wire 5V to segments a,b,c,d,e,f to show "0"
    { id: 'seg1', type: 'sevenseg', position: { x: 400, y: 150 }, data: { label: '7-SEG' } },
    { id: 'ra', type: 'resistor', position: { x: 200, y: 80 }, data: { label: '330' } },
    { id: 'rb', type: 'resistor', position: { x: 200, y: 140 }, data: { label: '330' } },
    { id: 'rc', type: 'resistor', position: { x: 200, y: 200 }, data: { label: '330' } },
    { id: 'rd', type: 'resistor', position: { x: 200, y: 260 }, data: { label: '330' } },
    { id: 're', type: 'resistor', position: { x: 200, y: 320 }, data: { label: '330' } },
    { id: 'rf', type: 'resistor', position: { x: 200, y: 380 }, data: { label: '330' } },
    { id: 'g1', type: 'ground', position: { x: 400, y: 400 }, data: { label: 'GND' } },
  ],
  edges: [
    // Resistors from 5V
    { id: 'e-v-ra', source: 'v1', target: 'ra', sourceHandle: 'pos', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-v-rb', source: 'v1', target: 'rb', sourceHandle: 'pos', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-v-rc', source: 'v1', target: 'rc', sourceHandle: 'pos', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-v-rd', source: 'v1', target: 'rd', sourceHandle: 'pos', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-v-re', source: 'v1', target: 're', sourceHandle: 'pos', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-v-rf', source: 'v1', target: 'rf', sourceHandle: 'pos', targetHandle: 'in', type: 'smoothstep' },
    // Segments
    { id: 'e-ra-a', source: 'ra', target: 'seg1', sourceHandle: 'out', targetHandle: 'a', type: 'smoothstep' },
    { id: 'e-rb-b', source: 'rb', target: 'seg1', sourceHandle: 'out', targetHandle: 'b', type: 'smoothstep' },
    { id: 'e-rc-c', source: 'rc', target: 'seg1', sourceHandle: 'out', targetHandle: 'c', type: 'smoothstep' },
    { id: 'e-rd-d', source: 'rd', target: 'seg1', sourceHandle: 'out', targetHandle: 'd', type: 'smoothstep' },
    { id: 'e-re-e', source: 're', target: 'seg1', sourceHandle: 'out', targetHandle: 'e', type: 'smoothstep' },
    { id: 'e-rf-f', source: 'rf', target: 'seg1', sourceHandle: 'out', targetHandle: 'f', type: 'smoothstep' },
    // Common cathode and GND
    { id: 'e-seg-gnd', source: 'seg1', target: 'g1', sourceHandle: 'common', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-v-gnd', source: 'v1', target: 'g1', sourceHandle: 'neg', targetHandle: 'in', type: 'smoothstep' },
  ]
};

export const currentMirror: CircuitPreset = {
  name: 'Current Mirror',
  recommendedSimLength: 0.5,
  nodes: [
    { id: 'v1', type: 'voltage', position: { x: 300, y: 50 }, data: { label: '12V' } },
    { id: 'isrc', type: 'currentsource', position: { x: 100, y: 250 }, data: { label: '5m' } },
    { id: 'q1', type: 'npn', position: { x: 200, y: 350 }, data: { label: 'Q1 (ref)' } },
    { id: 'q2', type: 'npn', position: { x: 400, y: 350 }, data: { label: 'Q2 (mirror)' } },
    { id: 'rload', type: 'resistor', position: { x: 400, y: 200 }, data: { label: '1k' } },
    { id: 'mm1', type: 'multimeter', position: { x: 50, y: 150 }, data: { label: 'I_ref' } },
    { id: 'mm2', type: 'multimeter', position: { x: 550, y: 200 }, data: { label: 'I_mirror' } },
    { id: 'g1', type: 'ground', position: { x: 300, y: 500 }, data: { label: 'GND' } },
  ],
  edges: [
    // Reference branch: V+ → current source → Q1 collector (diode-connected)
    { id: 'e-v-isrc', source: 'v1', target: 'isrc', sourceHandle: 'pos', targetHandle: 'pos', type: 'smoothstep' },
    { id: 'e-isrc-q1c', source: 'isrc', target: 'q1', sourceHandle: 'neg', targetHandle: 'c', type: 'smoothstep' },
    // Q1 diode-connected: base tied to collector
    { id: 'e-q1c-q1b', source: 'q1', target: 'q1', sourceHandle: 'c', targetHandle: 'b', type: 'smoothstep' },
    // Mirror: Q1.base → Q2.base
    { id: 'e-q1b-q2b', source: 'q1', target: 'q2', sourceHandle: 'b', targetHandle: 'b', type: 'smoothstep' },
    // Mirror branch: V+ → Rload → Q2 collector
    { id: 'e-v-rload', source: 'v1', target: 'rload', sourceHandle: 'pos', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-rload-q2c', source: 'rload', target: 'q2', sourceHandle: 'out', targetHandle: 'c', type: 'smoothstep' },
    // Emitters to ground
    { id: 'e-q1e-gnd', source: 'q1', target: 'g1', sourceHandle: 'e', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-q2e-gnd', source: 'q2', target: 'g1', sourceHandle: 'e', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-v-gnd', source: 'v1', target: 'g1', sourceHandle: 'neg', targetHandle: 'in', type: 'smoothstep' },
    // Multimeters
    { id: 'e-mm1-pos', source: 'isrc', target: 'mm1', sourceHandle: 'neg', targetHandle: 'pos', type: 'smoothstep' },
    { id: 'e-mm1-neg', source: 'mm1', target: 'g1', sourceHandle: 'neg', targetHandle: 'in', type: 'smoothstep' },
    { id: 'e-mm2-pos', source: 'rload', target: 'mm2', sourceHandle: 'out', targetHandle: 'pos', type: 'smoothstep' },
    { id: 'e-mm2-neg', source: 'mm2', target: 'g1', sourceHandle: 'neg', targetHandle: 'in', type: 'smoothstep' },
  ]
};

export const buckConverter: CircuitPreset = {
  name: 'Buck Converter (24V → 5V)',
  recommendedSimLength: 0.05,
  nodes: [
    { id: 'v1',    type: 'voltage',    position: { x: 50,   y: 250 }, data: { label: '24V IN', value: 24 } },
    { id: 'sw1',   type: 'nmos',       position: { x: 300,  y: 300 }, data: { label: 'NMOS Switch', vto: 2.0, kp: 0.5 } },
    { id: 'pwm1',  type: 'signalgen',  position: { x: 300,  y: 500 }, data: { label: 'PWM 1kHz 14%', waveform: 'square', frequency: 1000, amplitude: 10, dutyCycle: 14 } },
    { id: 'd1',    type: 'diode',      position: { x: 500,  y: 400 }, data: { label: 'Schottky', v_drop: 0.3 } },
    { id: 'l1',    type: 'inductor',   position: { x: 650,  y: 250 }, data: { label: '2mH' } },
    { id: 'c1',    type: 'capacitor',  position: { x: 850,  y: 350 }, data: { label: '1000uF' } },
    { id: 'rload', type: 'resistor',   position: { x: 1000, y: 350 }, data: { label: '5R Load' } },
    { id: 'mm1',   type: 'multimeter', position: { x: 1150, y: 350 }, data: { label: 'Output V' } },
    { id: 'g1',    type: 'ground',     position: { x: 600,  y: 600 }, data: { label: 'GND' } },
  ],
  edges: [
    { id: 'e-v1-sw-d',    source: 'v1',   target: 'sw1',   sourceHandle: 'pos',     targetHandle: 'd',   type: 'smoothstep' },
    { id: 'e-v1-gnd',     source: 'v1',   target: 'g1',    sourceHandle: 'neg',     targetHandle: 'in',  type: 'smoothstep' },
    { id: 'e-sw-s-l1',    source: 'sw1',  target: 'l1',    sourceHandle: 's',       targetHandle: 'in',  type: 'smoothstep' },
    { id: 'e-pwm-gate',   source: 'pwm1', target: 'sw1',   sourceHandle: 'out',     targetHandle: 'g',   type: 'smoothstep' },
    { id: 'e-pwm-gnd',    source: 'pwm1', target: 'g1',    sourceHandle: 'gnd',     targetHandle: 'in',  type: 'smoothstep' },
    { id: 'e-d1-sw-node', source: 'd1',   target: 'sw1',   sourceHandle: 'cathode', targetHandle: 's',   type: 'smoothstep' },
    { id: 'e-d1-gnd',     source: 'd1',   target: 'g1',    sourceHandle: 'anode',   targetHandle: 'in',  type: 'smoothstep' },
    { id: 'e-l1-c1',      source: 'l1',   target: 'c1',    sourceHandle: 'out',     targetHandle: 'in',  type: 'smoothstep' },
    { id: 'e-c1-rload',   source: 'c1',   target: 'rload', sourceHandle: 'in',      targetHandle: 'in',  type: 'smoothstep' },
    { id: 'e-c1-gnd',     source: 'c1',   target: 'g1',    sourceHandle: 'out',     targetHandle: 'in',  type: 'smoothstep' },
    { id: 'e-rload-mm',   source: 'rload', target: 'mm1',  sourceHandle: 'out',     targetHandle: 'pos', type: 'smoothstep' },
    { id: 'e-mm-gnd',     source: 'mm1',  target: 'g1',    sourceHandle: 'neg',     targetHandle: 'in',  type: 'smoothstep' },
  ]
};

export const presets: Record<string, CircuitPreset> = {
  empty,
  basicBlink,
  astableMultivibrator,
  timer555Blink,
  sineAudio,
  micSpeaker,
  bjtAmp,
  opAmpAmp,
  bistableMultivibrator,
  classBamp,
  classABamp,
  bridgeRectifier,
  boostConverter,
  buckConverter,
  potDimmer,
  sevenSegDirect,
  currentMirror,
  mcuBlink,
  mcuSpeaker,
  mcuAnalogOut,
  mcuAnalogIn,
  mcuPassThrough,
  mcuCleanAudioSampler,
  mixedLogicBlink
};
