import { describe, it, expect } from 'vitest';
import type { ResultType } from 'eecircuit-engine';
import { packResult, unpackResult } from '../src/utils/simTransfer';

const base = { header: 'Plotname: Transient Analysis\n', numVariables: 0, variableNames: [] as string[], numPoints: 0 };

function real(vars: number, pts: number, seed: number): ResultType {
  const data = Array.from({ length: vars }, (_, v) => ({
    name: `v(n${v})`, type: 'voltage' as const,
    values: Array.from({ length: pts }, (_, i) => Math.sin(i * 1e-3 + v + seed) * 10 ** ((i % 7) - 3)),
  }));
  return { ...base, numVariables: vars, variableNames: data.map(d => d.name), numPoints: pts, dataType: 'real', data };
}

function complex(vars: number, pts: number, seed: number): ResultType {
  const data = Array.from({ length: vars }, (_, v) => ({
    name: `v(n${v})`, type: 'voltage' as const,
    values: Array.from({ length: pts }, (_, i) => ({ real: Math.cos(i + v + seed), img: -Math.sin(i * seed + v) })),
  }));
  return { ...base, header: 'Plotname: AC Analysis\n', numVariables: vars, variableNames: data.map(d => d.name), numPoints: pts, dataType: 'complex', data };
}

/** What the page receives: the packed result after a real transfer, as postMessage does it. */
function roundTrip(result: ResultType): ResultType {
  const { packed, transfer } = packResult(result);
  const received = structuredClone(packed, { transfer });
  for (const buf of transfer) expect(buf.byteLength).toBe(0);
  return unpackResult(received);
}

describe('simTransfer', () => {
  it('returns every real and complex result exactly as the engine gave it', () => {
    for (const [vars, pts] of [[0, 0], [1, 0], [1, 1], [3, 17], [40, 500]]) {
      for (let seed = 1; seed <= 5; seed++) {
        for (const make of [real, complex]) {
          const r = make(vars, pts, seed);
          const out = roundTrip(r);
          expect(out).toEqual(r);
          for (const d of out.data) expect(Array.isArray(d.values)).toBe(true);
        }
      }
    }
  });

  it('keeps values that are not ordinary numbers', () => {
    const odd = [NaN, Infinity, -Infinity, -0, Number.MIN_VALUE, Number.MAX_VALUE, 1e-300];
    const r: ResultType = { ...base, numVariables: 1, variableNames: ['time'], numPoints: odd.length, dataType: 'real', data: [{ name: 'time', type: 'time', values: odd }] };
    const out = roundTrip(r).data[0].values as number[];
    odd.forEach((v, i) => expect(Object.is(out[i], v)).toBe(true));
  });

  it('serialises to the same JSON as the unpacked engine result', () => {
    const r = real(4, 50, 2);
    expect(JSON.stringify(roundTrip(r))).toBe(JSON.stringify(r));
  });
});
