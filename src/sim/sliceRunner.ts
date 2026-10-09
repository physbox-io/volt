import type { Node, Edge } from '@xyflow/react';
import { generateSpiceNetlist } from '../utils/spice';
import { readEndState, type SimState } from '../utils/simState';
import { buildNetlistResultIndex, findNetGraph } from '../utils/netlistResult';
import { runSketches, type PWLPoint } from '../utils/mcu';
import type { HILMemoizer } from '../utils/hilMemoizer';
import type { SpiceResult } from '../types/simulation';
import { HELTEC_V4_GPIO_PINS } from '../components/nodes/partDefaults';
import { chooseMaxStepMs, encodePinEdges, trackHalfPeriod, type Hold } from '../hil/pinEncoding';

/**
 * One step of a sliced run: the circuit, the state the last slice ended on and
 * the board's latest readings in; the slice's waveforms, what each output pin
 * plays and the state the next slice starts from out.
 *
 * Nothing here knows about sockets or React. The solver is handed in, so the
 * same step runs against the worker in the app and the engine in a test.
 */

/** What one slice hands the next. */
export type SliceState = {
  /** Where the circuit ended: net voltages and coil currents. */
  sim: SimState;
  /** The board's inputs as the last slice saw them: where an MCU's input ramp starts. */
  prevInputs: Record<string, number>;
  /** Each digital_out pin's tracked half-period, ms, which sets the step size. */
  halfPeriods: Record<string, number>;
};

export const initialSliceState = (): SliceState => ({ sim: {}, prevInputs: {}, halfPeriods: {} });

export type SliceInput = {
  nodes: Node[];
  edges: Edge[];
  /** The board in the loop. */
  boardId: string;
  /** The voltage last read off each of the board's input pins. */
  inputs: Record<string, number>;
  sliceMs: number;
};

export type SliceDeps = {
  solve: (netlist: string) => Promise<SpiceResult>;
  /** Skips the solve for a slice whose inputs, state and drive were seen before. */
  memoizer: HILMemoizer;
};

export type SliceOutcome = {
  state: SliceState;
  /** The nodes the slice was built from, the board's readings on it. */
  nodes: Node[];
  result: SpiceResult;
  portToNet: Record<string, string>;
  /** Each digital_out pin's level over the slice, as holds. */
  outputs: Record<string, Hold[]>;
};

export async function runSlice(state: SliceState, input: SliceInput, { solve, memoizer }: SliceDeps): Promise<SliceOutcome> {
  const { edges, boardId, inputs, sliceMs } = input;
  const nodes = input.nodes.map(n => n.id === boardId
    ? { ...n, data: { ...n.data, pinVoltages: { ...inputs } } }
    : n);
  const board = nodes.find(n => n.id === boardId)!;

  const maxStepMs = chooseMaxStepMs(state.halfPeriods, sliceMs, nodes.some(n => n.type === 'speaker'));

  // A board pin wired straight to an MCU pin is that MCU's input, ramped from
  // the last reading to this one across the slice.
  const mcuWaveforms: Record<string, Record<string, PWLPoint[]>> = {};
  let prevInputs = state.prevInputs;
  const mcuNode = nodes.find(n => n.type === 'mcu');
  if (mcuNode) {
    mcuWaveforms[mcuNode.id] = {};
    for (const edge of edges) {
      if (edge.source !== boardId || edge.target !== mcuNode.id) continue;
      const boardPin = edge.sourceHandle;
      const mcuPin = edge.targetHandle;
      if (boardPin && mcuPin && boardPin.startsWith('GPIO_')) {
        const volt = inputs[boardPin] ?? 0.0;
        const prevVolt = state.prevInputs[boardPin] ?? volt;
        mcuWaveforms[mcuNode.id][mcuPin] = [{ t: 0, v: prevVolt }, { t: sliceMs, v: volt }];
      }
    }
    prevInputs = { ...inputs };
  }

  // Every slice moves each sketch on, cached or not: the program keeps
  // running whether or not the circuit around it needs solving again. What
  // it drives this slice goes into the cache key, since it changes the
  // answer without changing any input.
  const sketches = runSketches(nodes, sliceMs / 1000, mcuWaveforms);
  const drive = Object.keys(sketches.drives).length > 0 ? JSON.stringify(sketches.drives) : '';

  const cached = memoizer.get({ ...inputs }, { ...state.sim }, sliceMs, maxStepMs, drive);
  if (cached) {
    return {
      state: { sim: cached.nextICs, prevInputs, halfPeriods: { ...cached.halfPeriods } },
      nodes,
      result: cached.result,
      portToNet: cached.portToNet,
      outputs: cached.outputs,
    };
  }

  const { netlist, portToNet } = generateSpiceNetlist(nodes, edges, {
    simLength: sliceMs / 1000, mcuDrives: sketches.drives, initialConditions: state.sim, hilMaxStepMs: maxStepMs,
  });
  const result = await solve(netlist);
  const resultIndex = buildNetlistResultIndex(result);
  const sim = readEndState(result);

  const outputs: Record<string, Hold[]> = {};
  const halfPeriods = { ...state.halfPeriods };
  const pins = (board.data.pins as Record<string, string>) || {};
  for (const pinId of HELTEC_V4_GPIO_PINS) {
    if (pins[pinId] !== 'digital_out') continue;
    const trace = findNetGraph(result, portToNet[`${boardId}-${pinId}`], resultIndex);
    const { seq, shortestPulseUs } = encodePinEdges(trace, sliceMs, maxStepMs);
    if (shortestPulseUs !== null) halfPeriods[pinId] = trackHalfPeriod(halfPeriods[pinId], shortestPulseUs);
    outputs[pinId] = seq;
  }

  memoizer.set({ ...inputs }, { ...state.sim }, sliceMs, maxStepMs, {
    result, portToNet, nextICs: sim, outputs, halfPeriods: { ...halfPeriods },
  }, drive);

  return { state: { sim, prevInputs, halfPeriods }, nodes, result, portToNet, outputs };
}
