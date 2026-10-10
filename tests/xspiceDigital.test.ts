import { describe, it, expect, beforeAll } from 'vitest';
import { Simulation } from 'eecircuit-engine';
import type { SpiceResult } from '../src/types/simulation';

/**
 * XSPICE's event-driven digital code models run in the wasm engine.
 *
 * The code-model libraries are linked into spice.wasm (they cannot be
 * dlopen'ed there), so `adc_bridge`, `d_tff`, `d_and`… must resolve like any
 * built-in device. Each case is a counter clocked by a 1kHz pulse train whose
 * rising edges fall at 0.5ms, 1.5ms, 2.5ms…; the count is read back through a
 * `dac_bridge` (0V/1V per bit) midway between edges, where it has settled.
 */

let engine: Simulation;
beforeAll(async () => {
  engine = new Simulation();
  await engine.start();
});

async function run(netlist: string): Promise<SpiceResult> {
  engine.setNetList(netlist);
  const result = (await engine.runSim()) as SpiceResult;
  const errors = engine.getError().filter(e => /unknown model|unable to find|MIF-ERROR|error/i.test(e));
  expect(errors, errors.join('\n')).toEqual([]);
  return result;
}

function vector(result: SpiceResult, name: string): number[] {
  const i = result.variableNames.findIndex(v => v.toLowerCase() === name);
  expect(i, `${name} in ${result.variableNames.join(', ')}`).toBeGreaterThanOrEqual(0);
  return result.data[i].values as number[];
}

function sampleAt(result: SpiceResult, name: string, tMs: number): number {
  const t = vector(result, 'time');
  const v = vector(result, name);
  const s = tMs / 1000;
  const k = t.findIndex(x => x >= s);
  if (k <= 0) return v[k < 0 ? v.length - 1 : 0];
  const f = (s - t[k - 1]) / (t[k] - t[k - 1]);
  return v[k - 1] + f * (v[k] - v[k - 1]);
}

/** The 3-bit count at `tMs`; each bit must sit at a clean 0 or 1. */
function countAt(result: SpiceResult, tMs: number): number {
  let n = 0;
  for (let b = 0; b < 3; b++) {
    const v = sampleAt(result, `v(b${b})`, tMs);
    expect(Math.min(Math.abs(v), Math.abs(v - 1)), `bit ${b} at ${tMs}ms is ${v}`).toBeLessThan(1e-6);
    n += Math.round(v) << b;
  }
  return n;
}

const ic = (count: number) => [0, 1, 2].map(b => (count >> b) & 1);

/** The clock (first rising edge `firstEdgeMs` in), a logic-high rail and the readout. */
const common = (firstEdgeMs: number) => `
VCLK clk 0 PULSE(0 5 ${firstEdgeMs}m 1u 1u 0.5m 1m)
VHI hi 0 DC 5
AIN [clk hi] [dclk dhi] adc1
.model adc1 adc_bridge(in_low=1 in_high=4)
AOUT [q0 q1 q2] [b0 b1 b2] dac1
.model dac1 dac_bridge(out_low=0 out_high=1)
RB0 b0 0 1k
RB1 b1 0 1k
RB2 b2 0 1k
`;

/** Ripple up counter: each stage toggles when the one before it falls. */
const rippleUp = (lengthMs: number, start = 0) => `* 3-bit ripple up counter
${common(0.5)}
A0 dhi dclk NULL NULL q0 nq0 tff0
A1 dhi nq0 NULL NULL q1 nq1 tff1
A2 dhi nq1 NULL NULL q2 nq2 tff2
${ic(start).map((v, b) => `.model tff${b} d_tff(ic=${v})`).join('\n')}
.tran 10u ${lengthMs}m
.end
`;

/**
 * Synchronous up/down counter: every stage on the one clock, a stage toggling
 * when all below it are 1 (counting up, DIR high) or all 0 (counting down).
 */
const upDown = (lengthMs: number, opts: { firstEdgeMs: number; dir: string; start: number }) => `* 3-bit up/down counter
${common(opts.firstEdgeMs)}
VDIR dir 0 ${opts.dir}
ADIR [dir] [ddir] adc1
AINV ddir ndir inv1
.model inv1 d_inverter
AU1 [ddir q0] u1 and2
AD1 [ndir nq0] d1 and2
AT1 [u1 d1] t1 or2
AU2 [ddir q0 q1] u2 and3
AD2 [ndir nq0 nq1] d2 and3
AT2 [u2 d2] t2 or2
.model and2 d_and
.model and3 d_and
.model or2 d_or
A0 dhi dclk NULL NULL q0 nq0 tff0
A1 t1 dclk NULL NULL q1 nq1 tff1
A2 t2 dclk NULL NULL q2 nq2 tff2
${ic(opts.start).map((v, b) => `.model tff${b} d_tff(ic=${v})`).join('\n')}
.tran 10u ${lengthMs}m
.end
`;

describe('XSPICE digital code models', () => {
  it('a ripple counter of d_tff counts every rising edge', async () => {
    const r = await run(rippleUp(5));
    expect(countAt(r, 0.25)).toBe(0);
    for (let k = 1; k <= 5; k++) expect(countAt(r, k), `after edge ${k}`).toBe(k);
  });

  it('wraps past 7', async () => {
    const r = await run(rippleUp(10));
    const counts = Array.from({ length: 10 }, (_, k) => countAt(r, k + 1));
    expect(counts).toEqual([1, 2, 3, 4, 5, 6, 7, 0, 1, 2]);
  });

  it('starts from the d_tff ic= state', async () => {
    for (const start of [1, 5, 7]) {
      const r = await run(rippleUp(5, start));
      expect(countAt(r, 0.25), `start ${start}`).toBe(start);
      for (let k = 1; k <= 5; k++) expect(countAt(r, k), `start ${start}, edge ${k}`).toBe((start + k) % 8);
    }
  });

  it('counts up with DIR high and down with DIR low, through 0', async () => {
    // Up for the edges at 0.5, 1.5, 2.5ms; down from 3.5ms.
    const r = await run(upDown(8, { firstEdgeMs: 0.5, dir: 'PWL(0 5 2.75m 5 2.76m 0)', start: 0 }));
    const counts = Array.from({ length: 8 }, (_, k) => countAt(r, k + 1));
    expect(counts).toEqual([1, 2, 3, 2, 1, 0, 7, 6]);
  });

  it('carries the count across slices through ic=', async () => {
    const dir = 'PWL(0 5 2.75m 5 2.76m 0)';
    const whole = await run(upDown(8, { firstEdgeMs: 0.5, dir, start: 0 }));

    // The same 8ms as two 4ms runs: the second starts from the first's end
    // count, its clock shifted to keep the edges at 4.5ms, 5.5ms…
    const first = await run(upDown(4, { firstEdgeMs: 0.5, dir, start: 0 }));
    const carried = countAt(first, 4);
    expect(carried).toBe(countAt(whole, 4));
    const second = await run(upDown(4, { firstEdgeMs: 0.5, dir: 'DC 0', start: carried }));
    for (let k = 1; k <= 4; k++) expect(countAt(second, k), `slice 2, ${k}ms`).toBe(countAt(whole, 4 + k));
  });

  it('still runs a plain analog circuit after the digital ones', async () => {
    const r = await run(`* RC
V1 in 0 DC 5
R1 in out 1k
C1 out 0 1u IC=0
.tran 10u 5m uic
.end
`);
    // 5τ: 5 * (1 - e^-5) = 4.966V
    expect(sampleAt(r, 'v(out)', 5)).toBeCloseTo(5 * (1 - Math.exp(-5)), 2);
  });
});
