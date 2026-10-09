import { describe, it, expect } from 'vitest';
import type { Node } from '@xyflow/react';
import { generateSpiceNetlist, type SpiceAnalysis } from '../src/utils/spice';
import { presets } from '../src/utils/presets';

/**
 * The netlist every preset writes, under every analysis, pinned byte for byte.
 *
 * A guard for refactoring the generator rather than a statement about what is
 * right: a change here that was meant is accepted with `vitest -u`, and one
 * that was not is the refactor's bug. Each run gets fresh nodes, because a
 * transient netlist runs an MCU's sketch and parks its state on the node.
 */

const AC_SOURCES = new Set(['voltage', 'acvoltage', 'signalgen']);

describe('the netlist each preset writes', () => {
  for (const [key, preset] of Object.entries(presets)) {
    const fresh = () => structuredClone(preset.nodes) as Node[];
    const length = preset.recommendedSimLength ?? 1;

    it(`${key}: transient`, () => {
      expect(generateSpiceNetlist(fresh(), preset.edges, { simLength: length }).netlist).toMatchSnapshot();
    });

    it(`${key}: transient, as an HIL slice`, () => {
      // A voltage and a current on every coil, so both halves of a carried
      // state show up in the cards.
      const state: Record<string, number> = { n1: 1.25 };
      for (const n of preset.nodes) {
        if (n.type === 'inductor') state[`i(l_${n.id})`.toLowerCase()] = 0.001;
        if (n.type === 'transformer') {
          state[`i(l_pri_${n.id})`.toLowerCase()] = 0.002;
          state[`i(l_sec_${n.id})`.toLowerCase()] = -0.002;
        }
      }
      expect(generateSpiceNetlist(fresh(), preset.edges, { simLength: 0.04, initialConditions: state, hilMaxStepMs: 0.05 }).netlist).toMatchSnapshot();
    });

    it(`${key}: operating point`, () => {
      const op: SpiceAnalysis = { kind: 'op' };
      expect(generateSpiceNetlist(fresh(), preset.edges, { simLength: length, analysis: op, skipMcuExecution: true }).netlist)
        .toMatchSnapshot();
    });

    const source = preset.nodes.find(n => AC_SOURCES.has(n.type ?? ''));
    it.skipIf(!source)(`${key}: AC sweep`, () => {
      const ac: SpiceAnalysis = { kind: 'ac', sourceNodeId: source!.id, fStart: 10, fStop: 100_000, pointsPerDecade: 20 };
      expect(generateSpiceNetlist(fresh(), preset.edges, { simLength: length, analysis: ac, skipMcuExecution: true }).netlist)
        .toMatchSnapshot();
    });
  }
});
