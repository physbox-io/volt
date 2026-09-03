/**
 * What a signal generator puts into the netlist.
 *
 * The frequency used to be read as `frequency || 1`, so a generator set to 0
 * was quietly run at 1Hz — the canvas said 0Hz and the trace showed a 1Hz wave.
 */
import { describe, it, expect } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import { generateSpiceNetlist } from '../src/utils/spice';

/** A generator across a resistor to ground, so it has a circuit to drive. */
function netlistFor(data: Record<string, unknown>): string {
  const nodes: Node[] = [
    { id: 'sg1', type: 'signalgen', position: { x: 0, y: 0 }, data },
    { id: 'r1', type: 'resistor', position: { x: 100, y: 0 }, data: { label: '1k' } },
    { id: 'g1', type: 'ground', position: { x: 200, y: 0 }, data: {} },
  ];
  const edges: Edge[] = [
    { id: 'e1', source: 'sg1', sourceHandle: 'out', target: 'r1', targetHandle: 'in' },
    { id: 'e2', source: 'r1', sourceHandle: 'out', target: 'g1', targetHandle: 'in' },
    { id: 'e3', source: 'sg1', sourceHandle: 'gnd', target: 'g1', targetHandle: 'in' },
  ];
  return generateSpiceNetlist(nodes, edges, 0.1).netlist;
}

/** The source line for the generator. */
const sourceLine = (netlist: string) =>
  netlist.split('\n').find(l => l.startsWith('V_sg1')) ?? '';

describe('0Hz is DC', () => {
  it('emits a DC source at the set amplitude, not a 1Hz wave', () => {
    const line = sourceLine(netlistFor({ frequency: 0, amplitude: 5, waveform: 'square' }));
    expect(line).toContain('DC 5');
    expect(line).not.toMatch(/PULSE|SINE/);
  });

  it('does the same for a sine generator', () => {
    const line = sourceLine(netlistFor({ frequency: 0, amplitude: 3.3, waveform: 'sine' }));
    expect(line).toContain('DC 3.3');
  });

  it('never divides by the frequency to get there', () => {
    // `1/0` reaching the netlist is an Infinity the solver cannot read.
    const line = sourceLine(netlistFor({ frequency: 0, amplitude: 5, waveform: 'square' }));
    expect(line).not.toMatch(/Infinity|NaN/);
  });
});

describe('an ordinary frequency still oscillates', () => {
  it('emits a sine for a sine generator', () => {
    expect(sourceLine(netlistFor({ frequency: 60, amplitude: 5, waveform: 'sine' })))
      .toContain('SINE(0 5 60)');
  });

  it('emits a pulse with the period the frequency implies', () => {
    const line = sourceLine(netlistFor({ frequency: 100, amplitude: 5, waveform: 'square', dutyCycle: 50 }));
    expect(line).toContain('PULSE(');
    // 100Hz is a 10ms period, half of it high.
    expect(line).toContain('0.005 0.01');
  });

  it('carries a fractional frequency through rather than rounding it', () => {
    expect(sourceLine(netlistFor({ frequency: 0.5, amplitude: 5, waveform: 'sine' })))
      .toContain('SINE(0 5 0.5)');
  });
});

describe('a value that is not a number', () => {
  it('falls back rather than writing NaN into the netlist', () => {
    // A cleared field used to store NaN; it must never reach the solver.
    for (const bad of [NaN, undefined, null, 'abc']) {
      const line = sourceLine(netlistFor({ frequency: bad, amplitude: 5, waveform: 'sine' }));
      expect(line, `frequency ${String(bad)}`).not.toMatch(/NaN|Infinity/);
    }
  });

  it('falls back for a bad amplitude too', () => {
    const line = sourceLine(netlistFor({ frequency: 60, amplitude: NaN, waveform: 'sine' }));
    expect(line).not.toMatch(/NaN|Infinity/);
  });
});
