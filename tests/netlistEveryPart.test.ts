import { describe, it, expect } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import { generateSpiceNetlist, type SpiceAnalysis } from '../src/utils/spice';

/**
 * The cards each part type writes, in every variant the generator branches
 * on, pinned byte for byte.
 *
 * The preset snapshots cover only the parts and settings the presets happen to
 * use; this covers the rest — a zener, a closed switch, each logic gate, an
 * LDR fed a light curve. The parts are left unwired, so every pin lands on its
 * own `NC_` net and the shunt cards are pinned too.
 */

const part = (id: string, type: string, data: Record<string, unknown> = {}): Node =>
  ({ id, type, position: { x: 0, y: 0 }, data });

const curve = [{ t: 0, v: 0 }, { t: 0.01, v: 0.5 }, { t: 0.02, v: 1 }];

const nodes: Node[] = [
  part('gnd', 'ground'),
  part('j1', 'junction'),
  part('jp1', 'jumper'),
  part('r1', 'resistor', { label: '4.7kΩ' }),
  part('r2', 'resistor', { label: '1M', resistance: '2k' }),
  part('c1', 'capacitor', { label: '10µF' }),
  part('l1', 'inductor', { label: '1mH' }),
  part('t1', 'transformer', { l_pri: '10m', l_sec: '2.5m', k: 0.95 }),
  part('v1', 'voltage', { label: '9V' }),
  part('ac1', 'acvoltage', { amplitude: 12, frequency: 50 }),
  part('sg_sine', 'signalgen', { waveform: 'sine', frequency: 1000, amplitude: 2 }),
  part('sg_sq', 'signalgen', { waveform: 'square', frequency: 100, amplitude: 5, dutyCycle: 25 }),
  part('sg_dc', 'signalgen', { waveform: 'square', frequency: 0, amplitude: 3 }),
  part('i1', 'currentsource', { label: '20mA' }),
  part('led1', 'led', { v_drop: 2.1 }),
  part('led2', 'led', { photodiodeMode: true, lightLevel: 0.4, lightSensitivity: 20 }),
  part('d1', 'diode', { v_drop: 0.6 }),
  part('z1', 'zener', { label: '3.3V' }),
  part('sw_open', 'switch', { isOpen: true }),
  part('sw_closed', 'switch', { isOpen: false }),
  part('mm_v', 'multimeter', {}),
  part('mm_i', 'multimeter', { mode: 'current' }),
  part('scope1', 'scope'),
  part('pot1', 'potentiometer', { label: '10k', position: 0 }),
  part('seg1', 'sevenseg'),
  part('spk1', 'speaker'),
  part('mic_pwl', 'microphone', { pwlData: curve, amplification: 20 }),
  part('mic_dc', 'microphone', {}),
  part('ldr_fixed', 'ldr', { r_dark: '200k', lightLevel: 0.5 }),
  part('ldr_pwl', 'ldr', { r_dark: '100k', pwlData: curve }),
  part('q1', 'npn'),
  part('q2', 'pnp'),
  part('m1', 'nmos'),
  part('m2', 'pmos'),
  part('u1', 'opamp'),
  part('u2', 'timer555'),
  part('u3', 'dff'),
  part('g_and', 'and'),
  part('g_or', 'or'),
  part('g_nand', 'nand'),
  part('g_nor', 'nor'),
  part('g_xor', 'xor'),
  part('g_not', 'not'),
  part('mcu1', 'mcu', {}),
  part('h1', 'heltec_v4', {
    pins: { GPIO_1: 'analog_in', GPIO_3: 'digital_out', GPIO_33: 'digital_in' },
    pinVoltages: { GPIO_1: 1.234, GPIO_33: 3.3 },
  }),
  part('mot1', 'dcmotor', { kt: '20m', loadTorque: 0.001 }),
  part('stp1', 'stepper', {}),
  part('drv1', 'stepdriver', { microsteps: 8, currentLimit: 1.2 }),
  part('hb1', 'hbridge', {}),
  part('fu1', 'fuse', { rating: 2, i2t: 0.5 }),
  part('ms1', 'meshsignal', { channel: 'joint:arm.pos', gain: 2, signalValue: 0.4 }),
  part('ms2', 'meshsignal', { channel: 'body:jaw.contacts', threshold: 0.5, high: 3.3, signalValue: 2 }),
  part('mot2', 'dcmotor', { shaftJoint: 'shaft', linkedShaft: { inertia: 1e-4, load: -0.01 } }),
  part('rail5', 'powerrail', { netName: '+5V', voltage: 5 }),
  part('rail5b', 'powerrail', { netName: '+5V', voltage: 5 }),
  part('lbl1', 'netlabel', { netName: 'SIG' }),
  part('lbl2', 'netlabel', { netName: 'SIG' }),
  part('hdr1', 'pinheader'),
  part('via1', 'via'),
  part('mh1', 'mountinghole'),
  part('cut1', 'cutout'),
];

const edges: Edge[] = [
  { id: 'e1', source: 'v1', sourceHandle: 'pos', target: 'r1', targetHandle: 'in' },
  { id: 'e2', source: 'r1', sourceHandle: 'out', target: 'l1', targetHandle: 'in' },
  { id: 'e3', source: 'l1', sourceHandle: 'out', target: 'gnd', targetHandle: 'in' },
  { id: 'e4', source: 'v1', sourceHandle: 'neg', target: 'gnd', targetHandle: 'in' },
  { id: 'e5', source: 'rail5', sourceHandle: 'in', target: 'r2', targetHandle: 'in' },
  { id: 'e6', source: 'lbl1', sourceHandle: 'in', target: 'r2', targetHandle: 'out' },
  { id: 'e7', source: 'lbl2', sourceHandle: 'in', target: 'c1', targetHandle: 'in' },
];

describe('the cards every part writes', () => {
  it('transient, from rest', () => {
    expect(generateSpiceNetlist(structuredClone(nodes), edges, { simLength: 0.1 }).netlist).toMatchSnapshot();
  });

  it('transient, as a carried slice', () => {
    const state = { n1: 1.5, 'i(l_l1)': 0.01, 'i(l_pri_t1)': 0.002, 'i(l_sec_t1)': -0.004 };
    const withoutAudio = nodes.filter(n => n.type !== 'speaker' && n.id !== 'mic_pwl');
    expect(generateSpiceNetlist(structuredClone(withoutAudio), edges, { simLength: 0.04, initialConditions: state, hilMaxStepMs: 0.2 }).netlist)
      .toMatchSnapshot();
  });

  it('pins, in the order the generator met them', () => {
    const { pins } = generateSpiceNetlist(structuredClone(nodes), edges, { simLength: 0.1 });
    expect(pins.map(p => `${p.nodeId}.${p.handleId} ${p.net}${p.connected ? '' : ' (nc)'}`)).toMatchSnapshot();
  });

  it('operating point', () => {
    const op: SpiceAnalysis = { kind: 'op' };
    expect(generateSpiceNetlist(structuredClone(nodes), edges, { analysis: op }).netlist).toMatchSnapshot();
  });

  for (const source of ['v1', 'ac1', 'sg_sine']) {
    it(`AC sweep from ${source}`, () => {
      const ac: SpiceAnalysis = { kind: 'ac', sourceNodeId: source, fStart: 1, fStop: 1e6, pointsPerDecade: 10 };
      expect(generateSpiceNetlist(structuredClone(nodes), edges, { analysis: ac }).netlist).toMatchSnapshot();
    });
  }
});
