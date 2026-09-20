import { describe, it, expect } from 'vitest';
import type { SpiceComplexResult, SpiceResult } from '../src/types/simulation';
import {
  acOutputNets,
  buildBodeTrace,
  cornerFrequencyHz,
  formatHz,
  formatVolts,
  readOperatingPoint,
} from '../src/utils/analysisResults';

const opResult = (nets: Record<string, number>, extra: Record<string, number> = {}): SpiceResult => {
  const entries = [...Object.entries(nets).map(([n, v]) => [`v(${n})`, v] as const), ...Object.entries(extra)];
  return {
    header: 'Plotname: Operating Point\n',
    numVariables: entries.length,
    variableNames: entries.map(([n]) => n),
    numPoints: 1,
    dataType: 'real',
    data: entries.map(([name, v]) => ({ name, type: 'voltage', values: [v] })),
  };
};

/** An RC low-pass, evaluated exactly, in the shape `.ac` hands it back. */
const rcSweep = (rOhms: number, cFarads: number, freqs: number[]): SpiceComplexResult => ({
  header: 'Plotname: AC Analysis\n',
  numVariables: 3,
  variableNames: ['frequency', 'v(in)', 'v(out)'],
  numPoints: freqs.length,
  dataType: 'complex',
  data: [
    { name: 'frequency', type: 'frequency', values: freqs.map(f => ({ real: f, img: 0 })) },
    { name: 'v(in)', type: 'voltage', values: freqs.map(() => ({ real: 1, img: 0 })) },
    {
      name: 'v(out)',
      type: 'voltage',
      values: freqs.map(f => {
        // H(jw) = 1 / (1 + jwRC)
        const w = 2 * Math.PI * f;
        const d = 1 + (w * rOhms * cFarads) ** 2;
        return { real: 1 / d, img: (-w * rOhms * cFarads) / d };
      }),
    },
  ],
});

const decade = (from: number, to: number, perDecade: number) => {
  const out: number[] = [];
  const steps = Math.round(Math.log10(to / from) * perDecade);
  for (let i = 0; i <= steps; i++) out.push(from * 10 ** (i / perDecade));
  return out;
};

describe('the operating point', () => {
  it('keys every node voltage by its net name', () => {
    expect(readOperatingPoint(opResult({ in: 9, mid: 6 }))).toEqual({ in: 9, mid: 6 });
  });

  it('leaves branch currents out, so nothing draws an amp as a volt', () => {
    expect(readOperatingPoint(opResult({ in: 9 }, { 'i(v1)': -0.003 }))).toEqual({ in: 9 });
  });

  it('survives being handed nothing', () => {
    expect(readOperatingPoint(null)).toEqual({});
    expect(readOperatingPoint(undefined)).toEqual({});
  });
});

describe('the Bode trace', () => {
  const R = 1000, C = 1e-7;           // corner at 1/(2*pi*R*C) ≈ 1591.5 Hz
  const expectedCorner = 1 / (2 * Math.PI * R * C);
  const sweep = rcSweep(R, C, decade(10, 1e6, 40));

  it('lists the nets a sweep has a trace for', () => {
    expect(acOutputNets(sweep)).toEqual(['in', 'out']);
  });

  it('is flat at unity well below the corner', () => {
    const trace = buildBodeTrace(sweep, 'out')!;
    expect(trace.magDb[0]).toBeCloseTo(0, 2);
    expect(trace.phaseDeg[0]).toBeGreaterThan(-2);
  });

  it('rolls off at twenty dB per decade above the corner', () => {
    const trace = buildBodeTrace(sweep, 'out')!;
    const at = (f: number) => {
      let best = 0;
      for (let i = 0; i < trace.freqHz.length; i++) {
        if (Math.abs(Math.log10(trace.freqHz[i] / f)) < Math.abs(Math.log10(trace.freqHz[best] / f))) best = i;
      }
      return trace.magDb[best];
    };
    expect(at(1e5) - at(1e6)).toBeCloseTo(20, 0);
  });

  it('finds the corner the filter was designed to', () => {
    const corner = cornerFrequencyHz(buildBodeTrace(sweep, 'out'))!;
    expect(corner / expectedCorner).toBeGreaterThan(0.95);
    expect(corner / expectedCorner).toBeLessThan(1.05);
  });

  it('finds the corner of a high-pass too, scanning the other way', () => {
    // The mirror of the low-pass: H = jwRC / (1 + jwRC).
    const freqs = decade(1, 1e6, 40);
    const hp: SpiceComplexResult = {
      ...rcSweep(R, C, freqs),
      data: [
        { name: 'frequency', type: 'frequency', values: freqs.map(f => ({ real: f, img: 0 })) },
        { name: 'v(in)', type: 'voltage', values: freqs.map(() => ({ real: 1, img: 0 })) },
        {
          name: 'v(out)', type: 'voltage',
          values: freqs.map(f => {
            const x = 2 * Math.PI * f * R * C;
            const d = 1 + x * x;
            return { real: (x * x) / d, img: x / d };
          }),
        },
      ],
    };
    const corner = cornerFrequencyHz(buildBodeTrace(hp, 'out'))!;
    expect(corner / expectedCorner).toBeGreaterThan(0.95);
    expect(corner / expectedCorner).toBeLessThan(1.05);
  });

  it('unwraps the phase instead of jumping the plot', () => {
    // Two cascaded poles run past -90 toward -180 and then past it. Wrapped,
    // that is a vertical line through the middle of the interesting part.
    const freqs = decade(1, 1e7, 30);
    const twoPole: SpiceComplexResult = {
      header: 'Plotname: AC Analysis\n',
      numVariables: 2,
      variableNames: ['frequency', 'v(out)'],
      numPoints: freqs.length,
      dataType: 'complex',
      data: [
        { name: 'frequency', type: 'frequency', values: freqs.map(f => ({ real: f, img: 0 })) },
        {
          name: 'v(out)', type: 'voltage',
          values: freqs.map(f => {
            // 1 / (1 + jx)^3 — three poles, so the phase runs to -270.
            const x = 2 * Math.PI * f * R * C;
            const re = 1, im = x;
            const mag = (re * re + im * im) ** 1.5;
            const ang = 3 * Math.atan2(im, re);
            return { real: Math.cos(-ang) / mag, img: Math.sin(-ang) / mag };
          }),
        },
      ],
    };
    const trace = buildBodeTrace(twoPole, 'out')!;
    expect(Math.min(...trace.phaseDeg)).toBeLessThan(-180);
    // Never a jump of more than half a turn between adjacent points.
    for (let i = 1; i < trace.phaseDeg.length; i++) {
      expect(Math.abs(trace.phaseDeg[i] - trace.phaseDeg[i - 1])).toBeLessThan(180);
    }
  });

  it('refuses to invent a corner for a response that has none', () => {
    const freqs = decade(1, 1e4, 10);
    const flat: SpiceComplexResult = {
      header: 'Plotname: AC Analysis\n',
      numVariables: 2,
      variableNames: ['frequency', 'v(out)'],
      numPoints: freqs.length,
      dataType: 'complex',
      data: [
        { name: 'frequency', type: 'frequency', values: freqs.map(f => ({ real: f, img: 0 })) },
        { name: 'v(out)', type: 'voltage', values: freqs.map(() => ({ real: 1, img: 0 })) },
      ],
    };
    expect(cornerFrequencyHz(buildBodeTrace(flat, 'out'))).toBeNull();
    expect(cornerFrequencyHz(null)).toBeNull();
  });

  it('gives nothing back for a net that is not in the sweep', () => {
    expect(buildBodeTrace(sweep, 'nowhere')).toBeNull();
    expect(buildBodeTrace(null, 'out')).toBeNull();
    expect(acOutputNets(null)).toEqual([]);
  });
});

describe('the way numbers are spoken', () => {
  it('scales a frequency to the unit it is read in', () => {
    expect(formatHz(12345)).toBe('12.3 kHz');
    expect(formatHz(1.2e6)).toBe('1.20 MHz');
    expect(formatHz(50)).toBe('50.0 Hz');
    expect(formatHz(NaN)).toBe('—');
  });

  it('scales a voltage the same way', () => {
    expect(formatVolts(3.3)).toBe('3.30 V');
    expect(formatVolts(0.025)).toBe('25.0 mV');
    expect(formatVolts(-1.5)).toBe('-1.50 V');
    expect(formatVolts(0)).toBe('0 V');
  });
});
