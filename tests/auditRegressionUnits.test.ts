import { describe, it, expect } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import { computeFFT } from '../src/utils/fft';
import { detectPeriod } from '../src/utils/periodDetect';
import { checkComponentRatings } from '../src/utils/powerRatings';
import { executeMcuCode } from '../src/utils/mcu';
import { HILMemoizer, type CachedHILSliceResult } from '../src/utils/hilMemoizer';
import { encodeSpeakerAudio } from '../src/hil/pinEncoding';
import { generateSpiceNetlist } from '../src/utils/spice';
import { dcPathGroups, runErc } from '../src/utils/erc';
import type { SpiceResult } from '../src/types/simulation';

const node = (id: string, type: string, data: Record<string, unknown> = {}): Node => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data,
});

const wire = (source: string, sourceHandle: string, target: string, targetHandle: string): Edge => ({
  id: `e-${source}-${sourceHandle}-${target}-${targetHandle}`,
  source,
  sourceHandle,
  target,
  targetHandle,
});

describe('FFT regression checks (fft.ts)', () => {
  it('accurately measures peak frequency and dB amplitude for pure sine (power-of-2 and non-power-of-2)', () => {
    const sampleRate = 4096;
    const freq = 256; // exact bin for N=4096
    const amp = 2.0; // +6.02 dB

    for (const length of [2048, 3000]) {
      const samples = Array.from({ length }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / sampleRate));
      const bins = computeFFT(samples, sampleRate);
      expect(bins.length).toBeGreaterThan(0);

      let peak = bins[0];
      for (const b of bins) {
        if (b.mag > peak.mag) peak = b;
      }

      // Peak frequency within 1 bin resolution
      expect(Math.abs(peak.freq - freq)).toBeLessThanOrEqual(sampleRate / (bins.length * 2) + 1e-6);
      // Amplitude within 0.5 dB of 20*log10(2) = 6.02 dB
      expect(peak.mag).toBeGreaterThan(5.5);
      expect(peak.mag).toBeLessThan(6.5);
    }
  });

  it('measures DC offset amplitude accurately in bin 0', () => {
    const dc = 3.5; // 20*log10(3.5) ≈ 10.88 dB
    const samples = new Array(500).fill(dc);
    const bins = computeFFT(samples, 1000);
    expect(bins[0].freq).toBe(0);
    expect(bins[0].mag).toBeCloseTo(20 * Math.log10(dc), 1);
  });

  it('handles degenerate lengths and invalid sample rates without NaN', () => {
    expect(computeFFT([], 1000)).toEqual([]);
    expect(computeFFT([42], 1000)).toEqual([]);
    expect(computeFFT([1, 2, 3, 4], 0)).toEqual([]);
    expect(computeFFT([1, 2, 3, 4], -100)).toEqual([]);
    expect(computeFFT([1, 2, 3, 4], NaN)).toEqual([]);

    const twoPts = computeFFT([1, -1], 1000);
    expect(twoPts.every(b => Number.isFinite(b.freq) && Number.isFinite(b.mag))).toBe(true);
  });
});

describe('Period detection regression checks (periodDetect.ts)', () => {
  it('detects a 2-cycle sine wave above threshold accurately', () => {
    // 2.2 cycles of 100Hz (period = 10ms) over 22ms
    const periodMs = 10;
    const totalMs = 22;
    const pts = Array.from({ length: 221 }, (_, i) => {
      const t = (i / 220) * totalMs;
      return { t, v: 5 * Math.sin((2 * Math.PI * t) / periodMs) };
    });
    const est = detectPeriod(pts);
    expect(est).not.toBeNull();
    expect(est!.confidence).toBeGreaterThan(0.5);
    expect(est!.periodMs).toBeCloseTo(periodMs, 1);
    expect(est!.freqHz).toBeCloseTo(100, 0);
  });

  it('returns null for flat or undersampled traces', () => {
    expect(detectPeriod([{ t: 0, v: 1 }, { t: 1, v: 1 }])).toBeNull();
    const flat = Array.from({ length: 50 }, (_, i) => ({ t: i, v: 3.3 }));
    expect(detectPeriod(flat)).toBeNull();
  });
});

describe('Power ratings regression checks (powerRatings.ts)', () => {
  const makeResult = (timesMs: number[], nets: Record<string, number[]>): SpiceResult => ({
    header: 'Plotname: Transient Analysis\n',
    numVariables: 1 + Object.keys(nets).length,
    variableNames: ['time', ...Object.keys(nets).map(n => `v(${n})`)],
    numPoints: timesMs.length,
    dataType: 'real',
    data: [
      { name: 'time', type: 'time', values: timesMs.map(t => t / 1000) },
      ...Object.entries(nets).map(([name, values]) => ({ name: `v(${name})`, type: 'voltage' as const, values })),
    ],
  });

  it('derates each potentiometer track segment at wiper 5% (pos=5)', () => {
    // 1k pot rated at 0.25W total; at pos=5 (5%), lower segment is 50Ω rated at 0.25 * 0.05 = 12.5mW.
    // Put 2V across lower 50Ω -> 4/50 = 80mW (under 0.25W total, but well over 12.5mW lower segment rating!).
    const nodes = [node('P1', 'potentiometer', { label: '1k', position: 5 })];
    const portToNet = { 'P1-in': 'a', 'P1-wiper': 'w', 'P1-out': '0' };
    const found = checkComponentRatings({
      nodes,
      portToNet,
      nameOf: id => id,
      result: makeResult([0, 10, 20], { a: [2, 2, 2], w: [2, 2, 2] }),
    });
    expect(found).toHaveLength(1);
    expect(found[0].id).toBe('rating:power:P1');
    expect(found[0].detail).toMatch(/lower track segment/i);
  });

  it('returns null from across() when a net is missing without throwing or false-warning', () => {
    const nodes = [node('R1', 'resistor', { resistance: 10 })];
    const portToNet = { 'R1-in': 'a', 'R1-out': 'missing_net' };
    const found = checkComponentRatings({
      nodes,
      portToNet,
      nameOf: id => id,
      result: makeResult([0, 10], { a: [100, 100] }),
    });
    expect(found).toEqual([]);
  });
});

describe('MCU runtime regression checks (mcu.ts)', () => {
  it('caps infinite loops without positive sleep instead of hanging', () => {
    const res = executeMcuCode(
      "pinMode('D0', 'OUTPUT'); while (true) { digitalWrite('D0', 1); sleep(0); }",
      0.01,
      {},
      {},
    );
    expect(res.logs.some(l => /execution limit exceeded/i.test(l))).toBe(true);
  });

  it('rejects negative and NaN sleep durations', () => {
    const neg = executeMcuCode('sleep(-5);', 0.01, {}, {});
    expect(neg.logs.some(l => /invalid sleep duration/i.test(l))).toBe(true);

    const nan = executeMcuCode('sleep(NaN);', 0.01, {}, {});
    expect(nan.logs.some(l => /invalid sleep duration/i.test(l))).toBe(true);
  });

  it('does not corrupt await(), strings, comments, or property .wait() in rewriteSleepCalls', () => {
    const code = `
      const obj = { wait: (x) => x * 2 };
      const msg = "sleep(10) and wait(20)";
      // wait(5)
      function my_sleep(v) { return v + 1; }
      Serial.println(String(obj.wait(3)) + '|' + msg + '|' + String(my_sleep(4)));
      sleep(5);
    `;
    const res = executeMcuCode(code, 0.01, {}, {});
    expect(res.logs).toEqual(['6|sleep(10) and wait(20)|5']);
  });

  it('keeps PWL timestamps strictly monotonic for < 1us toggles', () => {
    const code = `
      pinMode('D0', 'OUTPUT');
      digitalWrite('D0', 1);
      sleep(0.0002);
      digitalWrite('D0', 0);
      sleep(0.0002);
      digitalWrite('D0', 1);
      sleep(1);
    `;
    const res = executeMcuCode(code, 0.005, {}, {});
    const pts = res.pwlOutputs.D0;
    expect(pts.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i].t).toBeGreaterThanOrEqual(pts[i - 1].t);
    }
  });

  it('recompiles the generator when sketch code is edited between slices', () => {
    const first = executeMcuCode("Serial.println('v1'); sleep(100);", 0.01, {}, {});
    expect(first.logs).toEqual(['v1']);

    const second = executeMcuCode("Serial.println('v2'); sleep(100);", 0.01, {}, first.newState);
    expect(second.logs).toEqual(['v2']);
  });
});

describe('HILMemoizer & encodeSpeakerAudio regression checks', () => {
  const fakeEntry = (tag: string): CachedHILSliceResult => ({
    result: { header: tag, numVariables: 0, variableNames: [], numPoints: 0, dataType: 'real', data: [] },
    index: { timestamps_ms: [], indexByName: new Map() },
    portToNet: {},
    nextICs: {},
    outputs: {},
    halfPeriods: {},
  });

  it('evicts least-recently-used entries at maxEntries', () => {
    const memo = new HILMemoizer({ maxEntries: 2 });
    memo.set({ GPIO_1: 1 }, {}, 40, 1, fakeEntry('a'));
    memo.set({ GPIO_1: 2 }, {}, 40, 1, fakeEntry('b'));
    // Touch 'a' so 'b' becomes LRU
    expect(memo.get({ GPIO_1: 1 }, {}, 40, 1)?.result.header).toBe('a');
    // Insert 'c' -> evicts 'b'
    memo.set({ GPIO_1: 3 }, {}, 40, 1, fakeEntry('c'));
    expect(memo.get({ GPIO_1: 2 }, {}, 40, 1)).toBeNull();
    expect(memo.get({ GPIO_1: 1 }, {}, 40, 1)?.result.header).toBe('a');
    expect(memo.get({ GPIO_1: 3 }, {}, 40, 1)?.result.header).toBe('c');
  });

  it('normalizes -0 and +0 to the same cache key and respects circuitKey invalidation', () => {
    const memo = new HILMemoizer();
    const kPos = memo.generateKey({ GPIO_1: 0 }, { n1: 0 }, 40, 1, '', 'cktA');
    const kNeg = memo.generateKey({ GPIO_1: -0 }, { n1: -1e-9 }, 40, 1, '', 'cktA');
    expect(kNeg).toBe(kPos);

    memo.set({ GPIO_1: 0 }, { n1: 0 }, 40, 1, fakeEntry('cktA'), '', 'cktA');
    expect(memo.get({ GPIO_1: -0 }, { n1: -0 }, 40, 1, '', 'cktA')?.result.header).toBe('cktA');
    expect(memo.get({ GPIO_1: 0 }, { n1: 0 }, 40, 1, '', 'cktB')).toBeNull();
  });

  it('encodeSpeakerAudio handles 1-sample traces without NaN and applies the silence gate', () => {
    const oneSample = encodeSpeakerAudio({ timestamps_ms: [0], voltage_levels: [2.5] }, null, 10);
    expect(oneSample).not.toBeNull();
    expect(oneSample!.length).toBe(160);
    expect(Array.from(oneSample!).every(v => v === 0)).toBe(true);

    // Sub-5mV noise is gated to silence
    const quiet = encodeSpeakerAudio(
      { timestamps_ms: [0, 5, 10], voltage_levels: [0, 0.002, -0.002] },
      null,
      10,
    );
    expect(quiet).not.toBeNull();
    expect(Array.from(quiet!).every(v => v === 0)).toBe(true);

    // Audible signal (> 5mV) produces non-zero PCM
    const loud = encodeSpeakerAudio(
      { timestamps_ms: [0, 2.5, 5, 7.5, 10], voltage_levels: [0, 1, 0, -1, 0] },
      null,
      10,
    );
    expect(loud).not.toBeNull();
    expect(Math.max(...Array.from(loud!).map(Math.abs))).toBeGreaterThan(10000);

    // Zero sliceMs returns null
    expect(encodeSpeakerAudio({ timestamps_ms: [0, 1], voltage_levels: [0, 1] }, null, 0)).toBeNull();
  });
});

describe('ERC regression checks (erc.ts)', () => {
  const check = (nodes: Node[], edges: Edge[]) => {
    const { portToNet, pins } = generateSpiceNetlist(nodes, edges, { simLength: 1, analysis: { kind: 'op' } });
    return runErc({ nodes, pins, portToNet, nameOf: id => id });
  };

  it('flags a capacitor-isolated MOSFET gate as having no DC path', () => {
    expect(dcPathGroups('nmos', {}, ['g', 'd', 's'])).toEqual([['d', 's']]);
    const nodes = [
      node('V1', 'voltage', { voltage: 5 }),
      node('R1', 'resistor', { resistance: 1000 }),
      node('C1', 'capacitor', { capacitance: 1e-6 }),
      node('M1', 'nmos', {}),
      node('G', 'ground'),
    ];
    const edges = [
      wire('V1', 'pos', 'R1', 'in'),
      wire('R1', 'out', 'M1', 'd'),
      wire('M1', 's', 'G', 'in'),
      wire('V1', 'neg', 'G', 'in'),
      wire('V1', 'pos', 'C1', 'in'),
      wire('C1', 'out', 'M1', 'g'),
    ];
    const found = check(nodes, edges);
    expect(found.some(a => a.id.startsWith('erc:no-dc-path'))).toBe(true);
  });

  it('treats sevenseg as having no DC path', () => {
    expect(dcPathGroups('sevenseg', {}, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'com'])).toEqual([]);
  });

  it('flags a single wired netlabel as erc:lonely-net', () => {
    const nodes = [
      node('V1', 'voltage', { voltage: 5 }),
      node('R1', 'resistor', { resistance: 1000 }),
      node('L1', 'netlabel', { net: 'ORPHAN' }),
      node('G', 'ground'),
    ];
    const edges = [
      wire('V1', 'pos', 'R1', 'in'),
      wire('R1', 'out', 'L1', 'in'),
      wire('V1', 'neg', 'G', 'in'),
    ];
    const found = check(nodes, edges);
    expect(found.some(a => a.id.startsWith('erc:lonely-net:'))).toBe(true);
  });

  it('flags conflicting power rails on the same net as erc:rail-conflict', () => {
    const nodes = [
      node('PR1', 'powerrail', { rail: '+5V', voltage: 5 }),
      node('PR2', 'powerrail', { rail: '+3.3V', voltage: 3.3 }),
      node('R1', 'resistor', { resistance: 1000 }),
      node('G', 'ground'),
    ];
    const edges = [
      wire('PR1', 'in', 'PR2', 'in'),
      wire('PR1', 'in', 'R1', 'in'),
      wire('R1', 'out', 'G', 'in'),
    ];
    const found = check(nodes, edges);
    expect(found.some(a => a.id.startsWith('erc:rail-conflict:'))).toBe(true);
  });

  it('flags parallel ideal voltage sources as erc:vsource-loop', () => {
    const nodes = [
      node('V1', 'voltage', { voltage: 5 }),
      node('V2', 'voltage', { voltage: 3.3 }),
      node('G', 'ground'),
    ];
    const edges = [
      wire('V1', 'pos', 'V2', 'pos'),
      wire('V1', 'neg', 'G', 'in'),
      wire('V2', 'neg', 'G', 'in'),
    ];
    const found = check(nodes, edges);
    expect(found.some(a => a.id.startsWith('erc:vsource-loop:'))).toBe(true);
  });
});
