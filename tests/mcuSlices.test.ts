/**
 * A sketch run in slices behaves as the same sketch run in one go.
 *
 * The HIL loop hands a sketch's state from one slice to the next, and the
 * two-pass run in `runSimulation` must start it over rather than hand it on.
 * Both rest on the same thing: each call to `executeMcuCode` covers the next
 * `simLength` of the sketch, and nothing else.
 */
import { describe, it, expect } from 'vitest';
import type { Node } from '@xyflow/react';
import { executeMcuCode, type PWLPoint } from '../src/utils/mcu';
import { generateSpiceNetlist } from '../src/utils/spice';

const blink = (onMs: number, offMs: number) => `
pinMode('D0', 'OUTPUT');
while (true) {
  Serial.println(millis());
  digitalWrite('D0', 1);
  sleep(${onMs});
  digitalWrite('D0', 0);
  sleep(${offMs});
}`;

/** The level a PWL holds at `t`, taking the later point where two share a time. */
function levelAt(pwl: PWLPoint[], t: number): number {
  let v = pwl[0].v;
  for (const p of pwl) if (p.t <= t) v = p.v;
  return v;
}

function runInSlices(code: string, totalMs: number, sliceMs: number) {
  let state: unknown = {};
  const logs: string[] = [];
  const levels: number[] = [];
  for (let start = 0; start < totalMs; start += sliceMs) {
    const run = executeMcuCode(code, sliceMs / 1000, {}, state);
    state = run.newState;
    logs.push(...run.logs);
    // Sample mid-millisecond so a sample never lands on an edge.
    for (let t = 0.5; t < sliceMs; t += 1) levels.push(levelAt(run.pwlOutputs.D0, t));
  }
  return { logs, levels };
}

describe('a sketch run in slices', () => {
  const cases = [
    { on: 7, off: 13, total: 240, slices: [1, 5, 8, 40, 60, 240] },
    { on: 20, off: 20, total: 400, slices: [10, 25, 40, 400] },
    { on: 3, off: 50, total: 300, slices: [4, 30, 100, 300] },
  ];

  for (const { on, off, total, slices } of cases) {
    const whole = runInSlices(blink(on, off), total, total);

    it(`counts millis() from the start of the run (${on}/${off} ms)`, () => {
      const period = on + off;
      expect(whole.logs).toEqual(
        Array.from({ length: Math.ceil(total / period) }, (_, i) => String(i * period)),
      );
      for (const sliceMs of slices) {
        expect(runInSlices(blink(on, off), total, sliceMs).logs, `slice ${sliceMs} ms`).toEqual(whole.logs);
      }
    });

    it(`drives the same waveform whatever the slice length (${on}/${off} ms)`, () => {
      for (const sliceMs of slices) {
        expect(runInSlices(blink(on, off), total, sliceMs).levels, `slice ${sliceMs} ms`).toEqual(whole.levels);
      }
    });
  }
});

describe('netlisting a sketch twice', () => {
  const mcu = (): Node => ({
    id: 'mcu1', type: 'mcu', position: { x: 0, y: 0 },
    data: { code: "pinMode('D0', 'OUTPUT');\ndigitalWrite('D0', 1);\nsleep(1000);\ndigitalWrite('D0', 0);\nsleep(1000);" },
  });
  /** The D0 source card, PWL continuation lines included. */
  const sourceFor = (netlist: string) => {
    const lines = netlist.split('\n');
    const at = lines.findIndex(l => l.startsWith('V_mcu1_D0'));
    if (at < 0) return undefined;
    let end = at + 1;
    while (lines[end]?.startsWith('+')) end++;
    return lines.slice(at, end).join('\n');
  };

  it('carries the sketch on, so a second pass over the same window must clear its state first', () => {
    const node = mcu();
    const pass1 = sourceFor(generateSpiceNetlist([node], [], 1).netlist);
    const resumed = sourceFor(generateSpiceNetlist([node], [], 1).netlist);
    node.data.state = undefined;
    const replayed = sourceFor(generateSpiceNetlist([node], [], 1).netlist);

    expect(pass1).toBeDefined();
    expect(resumed).not.toEqual(pass1);
    expect(replayed).toEqual(pass1);
  });
});
