import type { Node, Edge } from '@xyflow/react';
import { dependsOnTime, generateSpiceNetlist } from '../utils/spice';
import { SIM_TIME, readEndState, simTime, withoutTime, type SimState } from '../utils/simState';
import { buildNetlistResultIndex, findNetGraph, type NetlistResultIndex } from '../utils/netlistResult';
import { hashDrives } from '../utils/mcu';
import { runSketches, type PWLPoint } from '../utils/mcu';
import type { HILMemoizer } from '../utils/hilMemoizer';
import type { SpiceResult } from '../types/simulation';
import { getEffectiveMcuConfig } from '../utils/mcuConfig';
import { HELTEC_V4_GPIO_PINS } from '../components/nodes/partDefaults';
import { chooseMaxStepMs, encodePinEdges, trackHalfPeriod, type Hold } from '../hil/pinEncoding';

const VOLATILE_NODE_KEYS = new Set([
  'pinVoltages', 'state', 'logs', 'voltage', 'voltageData', 'voltageData1', 'voltageData2',
  'current_array', 'time_points', 'timePoints', 'segmentVoltages', 'segmentVoltageArrays',
  'isSimulating', 'rpm', 'angleDeg', 'blown', 'signalValue', 'latchedHigh', 'brightness',
  'isExploded', 'selected', 'hilStats', 'hilClearCacheRequested', 'isConnected', 'hilEnabled', 'hilError',
]);

/** Lightweight deterministic fingerprint of circuit topology & non-volatile part parameters. */
function circuitFingerprint(nodes: Node[], edges: Edge[]): string {
  const nParts = nodes.map(n => {
    const data = (n.data || {}) as Record<string, unknown>;
    const keys = Object.keys(data).filter(k => !VOLATILE_NODE_KEYS.has(k)).sort();
    const fields = keys.map(k => {
      const v = data[k];
      return `${k}:${typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}`;
    });
    return `${n.id}|${n.type ?? ''}|${fields.join(',')}`;
  }).sort();
  const eParts = edges
    .map(e => `${e.source}:${e.sourceHandle ?? ''}->${e.target}:${e.targetHandle ?? ''}`)
    .sort();
  return `${nParts.join(';')}#${eParts.join(';')}`;
}

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
  /** Last slice's net map, for stripping stepped board input nets and resolving indirect MCU wiring. */
  portToNet?: Record<string, string>;
};

export const initialSliceState = (): SliceState => ({ sim: {}, prevInputs: {}, halfPeriods: {} });

export type SliceInput = {
  nodes: Node[];
  edges: Edge[];
  /** The board in the loop. */
  boardId: string;
  /** The voltage last read off each of the board's input pins. Not modified, and may be kept. */
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
  /** `result`'s lookup index, for reading more nets off it. */
  index: NetlistResultIndex;
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

  // A board pin wired to any MCU pin (in either edge direction, or sharing a net
  // from the prior slice) is that MCU's input, ramped from the last reading to this one.
  const mcuWaveforms: Record<string, Record<string, PWLPoint[]>> = {};
  let prevInputs = state.prevInputs;
  const mcuNodes = nodes.filter(n => n.type === 'mcu');
  if (mcuNodes.length > 0) {
    const mcuById = new Map(mcuNodes.map(n => [n.id, n]));
    for (const mcuNode of mcuNodes) mcuWaveforms[mcuNode.id] = {};

    const assignRamp = (mcuId: string, mcuPin: string, boardPin: string) => {
      const volt = inputs[boardPin] ?? 0.0;
      const prevVolt = state.prevInputs[boardPin] ?? volt;
      mcuWaveforms[mcuId][mcuPin] = [{ t: 0, v: prevVolt }, { t: sliceMs, v: volt }];
    };

    // Direct edges in either direction (board -> mcu or mcu -> board)
    for (const edge of edges) {
      if (edge.source === boardId && mcuById.has(edge.target)) {
        const boardPin = edge.sourceHandle;
        const mcuPin = edge.targetHandle;
        if (boardPin && mcuPin && boardPin.startsWith('GPIO_')) assignRamp(edge.target, mcuPin, boardPin);
      } else if (edge.target === boardId && mcuById.has(edge.source)) {
        const boardPin = edge.targetHandle;
        const mcuPin = edge.sourceHandle;
        if (boardPin && mcuPin && boardPin.startsWith('GPIO_')) assignRamp(edge.source, mcuPin, boardPin);
      }
    }

    // Indirect connections (via junctions or net labels) resolved from last slice's portToNet
    if (state.portToNet) {
      const netToBoardPin = new Map<string, string>();
      for (const pinId of HELTEC_V4_GPIO_PINS) {
        const net = state.portToNet[`${boardId}-${pinId}`];
        if (net && net !== '0') netToBoardPin.set(net, pinId);
      }
      for (const mcuNode of mcuNodes) {
        for (const pin of getEffectiveMcuConfig(mcuNode.data).pins) {
          if (mcuWaveforms[mcuNode.id][pin.id]) continue;
          const net = state.portToNet[`${mcuNode.id}-${pin.id}`];
          const boardPin = net ? netToBoardPin.get(net) : undefined;
          if (boardPin) assignRamp(mcuNode.id, pin.id, boardPin);
        }
      }
    }
    prevInputs = { ...inputs };
  }

  // Every slice moves each sketch on, cached or not: the program keeps
  // running whether or not the circuit around it needs solving again. What
  // it drives this slice goes into the cache key, since it changes the
  // answer without changing any input.
  const sketches = runSketches(nodes, sliceMs / 1000, mcuWaveforms);
  // The cache keys on the circuit's state, not the clock — except when a
  // source in it is a function of time, when the clock is part of the answer.
  const clock = dependsOnTime(nodes) ? `@${simTime(state.sim).toFixed(6)}` : '';
  const drive = (Object.keys(sketches.drives).length > 0 ? hashDrives(sketches.drives) : '') + clock;
  const circuitState = withoutTime(state.sim);
  const cktKey = circuitFingerprint(nodes, edges);

  const cached = memoizer.get(inputs, circuitState, sliceMs, maxStepMs, drive, cktKey);
  if (cached) {
    // A hit from another time moves the clock on from this one.
    return {
      state: {
        sim: { ...cached.nextICs, [SIM_TIME]: simTime(state.sim) + sliceMs / 1000 },
        prevInputs,
        halfPeriods: { ...cached.halfPeriods },
        portToNet: cached.portToNet,
      },
      nodes,
      result: cached.result,
      index: cached.index,
      portToNet: cached.portToNet,
      outputs: cached.outputs,
    };
  }

  // Strip nets driven by stepped Heltec input voltage sources so .ic does not fight V_heltec_* under uic.
  const simForSolve: SimState = { ...state.sim };
  const boardPins = (board.data.pins as Record<string, string>) || {};
  if (state.portToNet) {
    for (const pinId of HELTEC_V4_GPIO_PINS) {
      const mode = boardPins[pinId] || 'digital_in';
      if (mode === 'analog_in' || mode === 'digital_in') {
        const net = state.portToNet[`${boardId}-${pinId}`];
        if (net && net !== '0') delete simForSolve[net.toLowerCase()];
      }
    }
  }

  const { netlist, portToNet } = generateSpiceNetlist(nodes, edges, {
    simLength: sliceMs / 1000, mcuDrives: sketches.drives, initialConditions: simForSolve, hilMaxStepMs: maxStepMs, realtime: true,
  });
  const result = await solve(netlist);
  const resultIndex = buildNetlistResultIndex(result);
  const sim = readEndState(result, state.sim);

  const outputs: Record<string, Hold[]> = {};
  const halfPeriods = { ...state.halfPeriods };
  for (const pinId of HELTEC_V4_GPIO_PINS) {
    if (boardPins[pinId] !== 'digital_out') continue;
    const trace = findNetGraph(result, portToNet[`${boardId}-${pinId}`], resultIndex);
    const { seq, shortestPulseUs } = encodePinEdges(trace, sliceMs, maxStepMs);
    if (shortestPulseUs !== null) halfPeriods[pinId] = trackHalfPeriod(halfPeriods[pinId], shortestPulseUs);
    outputs[pinId] = seq;
  }

  memoizer.set(inputs, circuitState, sliceMs, maxStepMs, {
    result, index: resultIndex, portToNet, nextICs: sim, outputs, halfPeriods: { ...halfPeriods },
  }, drive, cktKey);

  return { state: { sim, prevInputs, halfPeriods, portToNet }, nodes, result, index: resultIndex, portToNet, outputs };
}
