import { describe, it, expect } from 'vitest';
import {
  EXPECTED_PLOT,
  SpiceRunError,
  cleanSpiceMessages,
  explainSpiceFailure,
  isEngineNoise,
  messagesFromError,
  plotNameOf,
  summariseSpiceWarnings,
} from '../src/utils/simDiagnostics';

/** What the WASM engine prints on a cold start, whatever the circuit is. */
const COLD_START = [
  'Error opening code model "/usr/local/lib/ngspice/spice2poly.cm"',
  "Error: Library /usr/local/lib/ngspice/spice2poly.cm couldn't be loaded!",
  'Error opening code model "/usr/local/lib/ngspice/analog.cm"',
  "Error: Library /usr/local/lib/ngspice/analog.cm couldn't be loaded!",
  "Warning: can't find the initialization file spinit.",
  'Using SPARSE 1.3 as Direct Linear Solver',
  '',
];

describe('what is worth repeating', () => {
  it('drops everything the engine says about itself on startup', () => {
    expect(cleanSpiceMessages(COLD_START)).toEqual([]);
    for (const line of COLD_START) expect(isEngineNoise(line)).toBe(true);
  });

  it('keeps what the engine says about the circuit', () => {
    const lines = [...COLD_START, 'Error: circuit not parsed.', ''];
    expect(cleanSpiceMessages(lines)).toEqual(['Error: circuit not parsed.']);
  });

  it('does not repeat a line the engine repeated', () => {
    expect(cleanSpiceMessages(['doubling up', 'doubling up', 'and again'])).toEqual(['doubling up', 'and again']);
  });

  it('handles nothing at all', () => {
    expect(cleanSpiceMessages(undefined)).toEqual([]);
    expect(cleanSpiceMessages([])).toEqual([]);
    expect(summariseSpiceWarnings([])).toBeNull();
  });
});

describe('which analysis actually ran', () => {
  it('reads the plot name out of a raw header', () => {
    expect(plotNameOf('Title: x\nPlotname: Transient Analysis\nFlags: real\n')).toBe('Transient Analysis');
    expect(plotNameOf('Plotname: AC Analysis\n')).toBe('AC Analysis');
    expect(plotNameOf('Plotname: constants\n')).toBe('constants');
    expect(plotNameOf(undefined)).toBeNull();
  });

  it('names a plot for every analysis the app emits', () => {
    // The plot ngspice writes is the only thing that tells a run which refused
    // apart from one that worked — the promise resolves either way.
    expect(EXPECTED_PLOT.tran).toBe('Transient Analysis');
    expect(EXPECTED_PLOT.op).toBe('Operating Point');
    expect(EXPECTED_PLOT.ac).toBe('AC Analysis');
  });
});

describe('turning the solver into advice', () => {
  const cases: [string, string[], RegExp][] = [
    ['a timestep failure', ['Fatal error: Timestep too small; time = 1.2e-09, timestep = 1e-21: trouble with node "n3"'], /small enough step/i],
    ['a singular matrix', ['Warning: singular matrix:  check node v(n7)'], /nothing sets the voltage at v\(n7\)/i],
    ['a convergence failure', ['Error: no convergence in the transient analysis'], /did not converge/i],
    ['a missing model', ["warning, can't find model 'nosuchmodel' from line", 'could not find a valid modelname'], /no model behind it/i],
    ['a parse failure', ['Error: circuit not parsed.'], /did not parse/i],
    ['a run that timed out', ['TIMED_OUT'], /did not finish/i],
    ['something unrecognised', ['banana'], /did not produce any data/i],
  ];

  for (const [name, messages, expected] of cases) {
    it(`explains ${name}`, () => {
      const { title, detail } = explainSpiceFailure(messages);
      expect(`${title} ${detail}`).toMatch(expected);
      expect(title.length).toBeGreaterThan(0);
    });
  }

  it('keeps the solver’s own words alongside the hint', () => {
    // A hint that guesses wrong has to leave the evidence for someone who can
    // read it — so the raw line is never thrown away in favour of the advice.
    const raw = 'Warning: singular matrix:  check node v(n7)';
    const { detail } = explainSpiceFailure([raw]);
    expect(detail).toContain(raw);
  });

  it('never produces an empty explanation, whatever it is handed', () => {
    for (const messages of [[], [''], ['\n'], ['a'.repeat(5000)]]) {
      const { title, detail } = explainSpiceFailure(messages);
      expect(title.trim().length).toBeGreaterThan(0);
      expect(detail.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('a failed run carries its reasons', () => {
  it('keeps the message list it was given', () => {
    const err = new SpiceRunError('two things', ['first', 'second']);
    expect(messagesFromError(err)).toEqual(['first', 'second']);
  });

  it('falls back to the message when there is no list', () => {
    expect(messagesFromError(new SpiceRunError('alone'))).toEqual(['alone']);
    expect(messagesFromError(new Error('plain'))).toEqual(['plain']);
    expect(messagesFromError('a string')).toEqual(['a string']);
  });
});
