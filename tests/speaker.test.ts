import { describe, it, expect, beforeAll } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import { Simulation } from 'eecircuit-engine';
import { generateSpiceNetlist } from '../src/utils/spice';
import { AIR, SPEAKER_DEFAULTS, boxCompliance, portMass, speakerNodes } from '../src/utils/netlist/parts/speaker';
import type { SpiceComplexResult } from '../src/types/simulation';
import { presets } from '../src/utils/presets';

/**
 * The Thiele-Small speaker against the textbook, on the real engine: free-air
 * resonance from the impedance peak, a sealed box's raised resonance, a
 * ported box's two peaks with the box tuning between them, and the SPL node's
 * sensitivity and low-frequency slopes — each over several drivers and boxes.
 * And the default is still the 8Ω resistor, which the netlist snapshots hold.
 */

const node = (id: string, type: string, data: Record<string, unknown> = {}): Node => ({
  id, type, position: { x: 0, y: 0 }, data,
});
const wire = (source: string, sourceHandle: string, target: string, targetHandle: string): Edge => ({
  id: `e-${source}-${sourceHandle}-${target}-${targetHandle}`,
  source, sourceHandle, target, targetHandle,
});

let engine: Simulation;
beforeAll(async () => {
  engine = new Simulation();
  await engine.start();
});

type Driver = { re: number; le: number; bl: number; mms: number; cms: number; rms: number; sd: number };

const DRIVERS: Record<string, Driver> = {
  'the 3" default': { ...SPEAKER_DEFAULTS },
  'a 4" midrange': { re: 3.2, le: 0.25e-3, bl: 5, mms: 6e-3, cms: 0.8e-3, rms: 0.8, sd: 5.3e-3 },
  'a 6.5" woofer': { re: 5.6, le: 0.5e-3, bl: 7, mms: 15e-3, cms: 1.2e-3, rms: 1.5, sd: 13.2e-3 },
  'a 2" tweeter-ish full-range': { re: 6.8, le: 0.05e-3, bl: 2.5, mms: 1.2e-3, cms: 0.5e-3, rms: 0.3, sd: 1.5e-3 },
};

const fsOf = (d: Driver) => 1 / (2 * Math.PI * Math.sqrt(d.mms * d.cms));
const vasOf = (d: Driver) => AIR.rho * AIR.c * AIR.c * d.sd * d.sd * d.cms;

type Box = { enclosure?: 'sealed' | 'ported'; boxVolume?: number; portLength?: number; portRadius?: number; boxLeakQ?: number };

/** Complex arithmetic, just enough for the closed form. */
type C = [number, number];
const add = (a: C, b: C): C => [a[0] + b[0], a[1] + b[1]];
const mul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const inv = (a: C): C => { const m = a[0] * a[0] + a[1] * a[1]; return [a[0] / m, -a[1] / m]; };
const abs = (a: C) => Math.hypot(a[0], a[1]);

/**
 * The textbook driver, worked by hand at one frequency for a 1V drive: the
 * electrical impedance Re + jωLe + Bl²/Zm, with Zm the mechanical impedance
 * Rms + jωMms + 1/(jωCms) + Sd²·Zab, and Zab the box (Cab, its leak, and the
 * port's Map, all in parallel); and the on-axis pressure at 1m in a
 * half-space, ρ·ω·|U|/2π, U the net volume velocity off the cone and out of
 * the port.
 */
function closedForm(d: Driver, box: Box, f: number): { z: number; splDb: number } {
  const w = 2 * Math.PI * f;
  let zm: C = [d.rms, w * d.mms - 1 / (w * d.cms)];
  let ya: C | null = null;
  if (box.enclosure) {
    const cab = boxCompliance(box.boxVolume!);
    ya = [0, w * cab];
    if (box.enclosure === 'ported') {
      const map = portMass(box.portLength!, box.portRadius!);
      ya = add(ya, [1 / ((box.boxLeakQ ?? SPEAKER_DEFAULTS.boxLeakQ) * Math.sqrt(map / cab)), -1 / (w * map)]);
    } else {
      // The sealed box's leak is a one-second time constant: R = 1/Cab.
      ya = add(ya, [cab, 0]);
    }
    zm = add(zm, mul([d.sd * d.sd, 0], inv(ya)));
  }
  const ze = add([d.re, w * d.le], mul([d.bl * d.bl, 0], inv(zm)));
  const v = mul([d.bl, 0], mul(inv(ze), inv(zm)));
  const uCone: C = [d.sd * v[0], d.sd * v[1]];
  let u = uCone;
  if (box.enclosure === 'ported' && ya) {
    // The box's pressure is Sd·v over its admittance; the port carries p/(jωMap).
    const p = mul(uCone, inv(ya));
    const up = mul(p, inv([0, w * portMass(box.portLength!, box.portRadius!)]));
    u = [up[0] - uCone[0], up[1] - uCone[1]];
  }
  const pressure = (AIR.rho * w * abs(u)) / (2 * Math.PI * 1);
  return { z: abs(ze), splDb: 20 * Math.log10(pressure / 2e-5) };
}

/** A 1V AC source straight across the speaker, swept from fStart to fStop. */
async function sweep(data: Record<string, unknown>, fStart: number, fStop: number, pointsPerDecade = 2000) {
  const nodes = [
    node('SG', 'signalgen', { waveform: 'sine', frequency: 1000, amplitude: 1 }),
    node('G', 'ground'),
    node('S', 'speaker', { driverModel: 'thiele-small', ...data }),
  ];
  const edges = [wire('SG', 'out', 'S', 'in'), wire('S', 'gnd', 'G', 'in'), wire('SG', 'gnd', 'G', 'in')];
  const { netlist } = generateSpiceNetlist(nodes, edges, {
    simLength: 1, analysis: { kind: 'ac', sourceNodeId: 'SG', fStart, fStop, pointsPerDecade },
  });
  engine.setNetList(netlist);
  const result = (await engine.runSim()) as SpiceComplexResult;
  const col = (name: string) => {
    const i = result.variableNames.findIndex(n => n.toLowerCase() === name.toLowerCase());
    expect(i, `${name} in ${result.variableNames.join(', ')}`).toBeGreaterThanOrEqual(0);
    return result.data[i].values as { real: number; img: number }[];
  };
  const f = col('frequency').map(v => v.real);
  const mag = (v: { real: number; img: number }) => Math.hypot(v.real, v.img);
  // The source's current is the speaker's: |Z| = 1V / |I|.
  const z = col('i(v_sg)').map(v => 1 / mag(v));
  const splDb = col(`v(${speakerNodes('S').spl})`).map(v => 20 * Math.log10(mag(v)));
  return { f, z, splDb };
}

/**
 * The frequency of the extremum at `k`, refined by a parabola through it and
 * its neighbours in log-frequency: between sweep points, not on one.
 */
function refine(f: number[], y: number[], k: number): number {
  const x = (i: number) => Math.log(f[i]);
  const [x0, x1, x2] = [x(k - 1), x(k), x(k + 1)];
  const [y0, y1, y2] = [y[k - 1], y[k], y[k + 1]];
  const denom = (x0 - x1) * (x0 - x2) * (x1 - x2);
  const a = (x2 * (y1 - y0) + x1 * (y0 - y2) + x0 * (y2 - y1)) / denom;
  const b = (x2 * x2 * (y0 - y1) + x1 * x1 * (y2 - y0) + x0 * x0 * (y1 - y2)) / denom;
  return Math.exp(-b / (2 * a));
}

/** Indices of every local maximum (or minimum, with `sign` −1) of `y`. */
function extrema(y: number[], sign = 1): number[] {
  const out: number[] = [];
  for (let i = 1; i < y.length - 1; i++) {
    if (sign * (y[i] - y[i - 1]) > 0 && sign * (y[i] - y[i + 1]) >= 0) out.push(i);
  }
  return out;
}

const report: string[] = [];

describe('a driver in free air', () => {
  for (const [name, d] of Object.entries(DRIVERS)) {
    it(`peaks in impedance at fs = 1/(2π√(Mms·Cms)): ${name}`, async () => {
      const fs = fsOf(d);
      const { f, z } = await sweep(d, fs / 3, fs * 3);
      const peaks = extrema(z);
      expect(peaks).toHaveLength(1);
      const measured = refine(f, z, peaks[0]);
      report.push(`free air, ${name}: fs ${measured.toFixed(2)}Hz measured, ${fs.toFixed(2)}Hz predicted`);
      expect(Math.abs(measured / fs - 1)).toBeLessThan(0.005);
      // At the peak the motional branch is Bl²/Rms in series with Re.
      expect(z[peaks[0]] / (d.re + (d.bl * d.bl) / d.rms)).toBeCloseTo(1, 1);
    });
  }
});

describe('a driver in a sealed box', () => {
  const cases: [string, number][] = [
    ['the 3" default', 0.5e-3], ['the 3" default', 2e-3], ['a 4" midrange', 1.5e-3],
    ['a 6.5" woofer', 8e-3], ['a 6.5" woofer', 25e-3], ['a 2" tweeter-ish full-range', 0.2e-3],
  ];
  for (const [name, vb] of cases) {
    it(`resonates at fc = fs·√(1 + Vas/Vb): ${name} in ${vb * 1000}L`, async () => {
      const d = DRIVERS[name];
      const fc = fsOf(d) * Math.sqrt(1 + vasOf(d) / vb);
      const { f, z } = await sweep({ ...d, enclosure: 'sealed', boxVolume: vb }, fc / 3, fc * 3);
      const peaks = extrema(z);
      expect(peaks).toHaveLength(1);
      const measured = refine(f, z, peaks[0]);
      report.push(`sealed ${vb * 1000}L, ${name}: fc ${measured.toFixed(2)}Hz measured, ${fc.toFixed(2)}Hz predicted`);
      expect(Math.abs(measured / fc - 1)).toBeLessThan(0.005);
    });
  }
});

describe('a driver in a ported box', () => {
  const cases: { name: string; vb: number; lp: number; rp: number }[] = [
    { name: 'the 3" default', vb: SPEAKER_DEFAULTS.boxVolume, lp: SPEAKER_DEFAULTS.portLength, rp: SPEAKER_DEFAULTS.portRadius },
    { name: 'the 3" default', vb: 2e-3, lp: 0.08, rp: 0.0075 },
    { name: 'a 4" midrange', vb: 3e-3, lp: 0.06, rp: 0.012 },
    { name: 'a 6.5" woofer', vb: 20e-3, lp: 0.15, rp: 0.025 },
    { name: 'a 6.5" woofer', vb: 30e-3, lp: 0.12, rp: 0.03 },
  ];
  for (const { name, vb, lp, rp } of cases) {
    const d = DRIVERS[name];
    const box = { enclosure: 'ported' as const, boxVolume: vb, portLength: lp, portRadius: rp };
    const fb = 1 / (2 * Math.PI * Math.sqrt(portMass(lp, rp) * boxCompliance(vb)));
    const label = `${name}, ${vb * 1000}L, port ${lp * 100}cm × r${rp * 100}cm`;

    it(`has two impedance peaks with the minimum between them at fb = 1/(2π√(Map·Cab)), the box near lossless: ${label}`, async () => {
      // Lossless, the cone stands still at fb and the motional impedance is
      // zero there; the coil's inductance would then tilt the |Z| minimum off
      // it by a fraction of a percent, so it is left out to see fb itself.
      const { f, z } = await sweep({ ...d, ...box, le: 0, boxLeakQ: 1000 }, fb / 6, fb * 6);
      const peaks = extrema(z);
      expect(peaks).toHaveLength(2);
      const between = extrema(z, -1).filter(i => i > peaks[0] && i < peaks[1]);
      expect(between).toHaveLength(1);
      const measured = refine(f, z, between[0]);
      report.push(`ported ${label}, QL 1000: fb ${measured.toFixed(2)}Hz measured, ${fb.toFixed(2)}Hz predicted; peaks ${f[peaks[0]].toFixed(1)} and ${f[peaks[1]].toFixed(1)}Hz`);
      expect(Math.abs(measured / fb - 1)).toBeLessThan(0.005);
      // The peaks straddle the tuning, and the driver's own resonance lies
      // between them too.
      expect(f[peaks[0]]).toBeLessThan(fb);
      expect(f[peaks[1]]).toBeGreaterThan(fb);
      expect(f[peaks[0]]).toBeLessThan(fsOf(d));
      expect(f[peaks[1]]).toBeGreaterThan(fsOf(d));
    });

    it(`is the closed-form driver, impedance and SPL, across the sweep at the default leakage: ${label}`, async () => {
      const { f, z, splDb } = await sweep({ ...d, ...box }, fb / 6, fb * 6, 50);
      let worstZ = 0;
      let worstSpl = 0;
      f.forEach((fi, k) => {
        const want = closedForm(d, box, fi);
        worstZ = Math.max(worstZ, Math.abs(z[k] / want.z - 1));
        worstSpl = Math.max(worstSpl, Math.abs(splDb[k] - want.splDb));
      });
      // Leakage moves the minimum off fb, by as much as the closed form says.
      const peaks = extrema(z);
      const between = extrema(z, -1).filter(i => i > peaks[0] && i < peaks[1]);
      expect(between).toHaveLength(1);
      report.push(`ported ${label}, QL 7: |Z| within ${(worstZ * 100).toFixed(4)}%, SPL within ${worstSpl.toFixed(4)}dB of the closed form; minimum at ${f[between[0]].toFixed(1)}Hz against fb ${fb.toFixed(1)}Hz`);
      expect(worstZ).toBeLessThan(1e-3);
      expect(worstSpl).toBeLessThan(0.01);
    });
  }
});

describe('the SPL node', () => {
  for (const [name, d] of Object.entries(DRIVERS)) {
    it(`reads the mass-controlled sensitivity ρ·Sd·Bl·V/(2π·r·Mms·Re) far above fs: ${name}`, async () => {
      const f0 = fsOf(d) * 30;
      const { f, splDb } = await sweep({ ...d, le: 0 }, f0, f0 * 1.01, 10);
      const predicted = 20 * Math.log10((AIR.rho * d.sd * d.bl) / (2 * Math.PI * 1 * d.mms * d.re) / 2e-5);
      report.push(`SPL at 1V/1m, ${name} at ${f[0].toFixed(0)}Hz: ${splDb[0].toFixed(2)}dB measured, ${predicted.toFixed(2)}dB predicted`);
      expect(Math.abs(splDb[0] - predicted)).toBeLessThan(0.1);
    });

    it(`is the closed form, impedance and SPL, in free air and in a sealed box: ${name}`, async () => {
      const fs = fsOf(d);
      for (const box of [{}, { enclosure: 'sealed' as const, boxVolume: vasOf(d) / 2 }]) {
        const { f, z, splDb } = await sweep({ ...d, ...box }, fs / 10, fs * 30, 30);
        f.forEach((fi, k) => {
          const want = closedForm(d, box, fi);
          expect(Math.abs(z[k] / want.z - 1)).toBeLessThan(1e-3);
          expect(Math.abs(splDb[k] - want.splDb)).toBeLessThan(0.01);
        });
      }
    });
  }

  it('falls 12dB an octave far below a sealed box\'s resonance and 24dB below a lossless ported one\'s', async () => {
    const d = DRIVERS['a 6.5" woofer'];
    const sealed = await sweep({ ...d, enclosure: 'sealed', boxVolume: 8e-3 }, 4, 8, 50);
    const ported = await sweep({ ...d, enclosure: 'ported', boxVolume: 20e-3, portLength: 0.15, portRadius: 0.025, boxLeakQ: 1e4 }, 2, 4, 50);
    // dB per octave between the sweep's first and last points, wherever they fell.
    const slope = (s: { f: number[]; splDb: number[] }) =>
      (s.splDb[s.splDb.length - 1] - s.splDb[0]) / Math.log2(s.f[s.f.length - 1] / s.f[0]);
    report.push(`slopes an octave far below resonance: sealed ${slope(sealed).toFixed(2)}dB, ported ${slope(ported).toFixed(2)}dB`);
    expect(Math.abs(slope(sealed) - 12)).toBeLessThan(0.5);
    expect(Math.abs(slope(ported) - 24)).toBeLessThan(1);
  });
});

describe('a driver in a transient run', () => {
  for (const enclosure of ['none', 'sealed', 'ported'] as const) {
    it(`settles under DC to the cone held out by Bl·V/Re against its springs: ${enclosure}`, async () => {
      const d = DRIVERS['a 4" midrange'];
      const nodes = [
        node('V1', 'voltage', { voltage: 1 }), node('G', 'ground'),
        node('S', 'speaker', { driverModel: 'thiele-small', ...d, enclosure, boxVolume: 3e-3, portLength: 0.06, portRadius: 0.012 }),
      ];
      const edges = [wire('V1', 'pos', 'S', 'in'), wire('S', 'gnd', 'G', 'in'), wire('V1', 'neg', 'G', 'in')];
      const { netlist } = generateSpiceNetlist(nodes, edges, { simLength: 0.5, initialConditions: { 'i(l_s_p1)': 0, 'i(l_s_k)': 0 } });
      engine.setNetList(netlist);
      const result = (await engine.runSim()) as unknown as { variableNames: string[]; data: { values: number[] }[] };
      const v = (name: string) => result.data[result.variableNames.findIndex(n => n.toLowerCase() === name.toLowerCase())].values;
      const last = (a: number[]) => a[a.length - 1];
      // The coil draws V/Re, the cone has all but stopped, and its force
      // Bl·V/Re is held by the suspension and the box's pressure on the cone
      // between them. A sealed box takes seconds to leak its share off, so
      // the cone is still creeping out (and drawing a little back-EMF); a
      // port has no stiffness at DC at all.
      expect(Math.abs(last(v('i(l_s_p1)')) * d.re - 1)).toBeLessThan(0.005);
      const box = enclosure === 'none' ? 0 : d.sd * last(v(`v(${speakerNodes('S').boxPressure})`));
      expect(Math.abs((last(v('i(l_s_k)')) + box) / (d.bl / d.re) - 1)).toBeLessThan(0.01);
      if (enclosure === 'ported') expect(Math.abs(box) / (d.bl / d.re)).toBeLessThan(0.01);
      expect(Math.abs(last(v(`v(${speakerNodes('S').velocity})`)))).toBeLessThan(1e-3);
    });
  }
});

describe('the ported speaker preset', () => {
  const preset = presets.portedSpeaker;

  it('sweeps to the closed-form ported driver behind its ×3 amp', async () => {
    const { netlist, portToNet } = generateSpiceNetlist(structuredClone(preset.nodes) as Node[], preset.edges, {
      simLength: 1, analysis: { kind: 'ac', sourceNodeId: 'sg1', fStart: 20, fStop: 2000, pointsPerDecade: 100 },
    });
    engine.setNetList(netlist);
    const result = (await engine.runSim()) as SpiceComplexResult;
    const col = (name: string) => result.data[result.variableNames.findIndex(n => n.toLowerCase() === name.toLowerCase())].values as { real: number; img: number }[];
    const mag = (v: { real: number; img: number }) => Math.hypot(v.real, v.img);
    const f = col('frequency').map(v => v.real);
    const vin = col(`v(${portToNet['spk1-in']})`).map(mag);
    const i = col('i(l_spk1_p1)').map(mag);
    const spl = col(`v(${speakerNodes('spk1').spl})`).map(v => 20 * Math.log10(mag(v)));
    const box = { enclosure: 'ported' as const, boxVolume: SPEAKER_DEFAULTS.boxVolume, portLength: SPEAKER_DEFAULTS.portLength, portRadius: SPEAKER_DEFAULTS.portRadius };
    f.forEach((fi, k) => {
      const want = closedForm(DRIVERS['the 3" default'], box, fi);
      // The amp is ideal enough that the speaker sees 3V and its own impedance.
      expect(Math.abs(vin[k] / 3 - 1)).toBeLessThan(1e-3);
      expect(Math.abs(vin[k] / i[k] / want.z - 1)).toBeLessThan(2e-3);
      expect(Math.abs(spl[k] - (want.splDb + 20 * Math.log10(3)))).toBeLessThan(0.02);
    });
  });

  it('runs in time', async () => {
    const nodes = structuredClone(preset.nodes) as Node[];
    const { netlist } = generateSpiceNetlist(nodes, preset.edges, { simLength: preset.recommendedSimLength ?? 0.2 });
    engine.setNetList(netlist);
    const result = (await engine.runSim()) as unknown as { variableNames: string[]; data: { values: number[] }[] };
    const w = result.data[result.variableNames.findIndex(n => n.toLowerCase() === 'v(int_spk1_w)')].values;
    // A 100Hz tone, 3V on the coil: the cone moves, and stays finite.
    expect(Math.max(...w.map(Math.abs))).toBeGreaterThan(0.01);
    expect(w.every(Number.isFinite)).toBe(true);
  });
});

describe('the default', () => {
  it('is the 8Ω resistor, and nothing else, with the driver model off', () => {
    const nodes = [node('S', 'speaker'), node('S2', 'speaker', { driverModel: undefined, enclosure: 'ported', re: 3 })];
    const { netlist } = generateSpiceNetlist(nodes, [], { simLength: 1 });
    const cards = netlist.split('\n').filter(l => /_S2? /i.test(l) || /^[A-Z]_S2?_/i.test(l));
    expect(cards.filter(l => l.startsWith('R_S ') || l.startsWith('R_S2 '))).toHaveLength(2);
    expect(netlist).not.toMatch(/^[A-Z]_S2?_/m);
    for (const l of cards.filter(l => /^R_S2? /.test(l))) expect(l).toMatch(/ 8$/);
  });
});

describe('measurements', () => {
  it('reports what was measured', () => {
    // Printed for the record; every line is asserted in its own test above.
    console.log(report.join('\n'));
  });
});
