import type { Node, Edge } from '@xyflow/react';
import { generateSpiceNetlist } from '../utils/spice';
import { readEndState, type SimState } from '../utils/simState';
import { findNetGraph } from '../utils/netlistResult';
import { runSketches, type PWLPoint } from '../utils/mcu';
import { getEffectiveMcuConfig } from '../utils/mcuConfig';
import { shaftNodes, type LinkedShaft } from '../utils/transducer';
import { numParam } from '../utils/netlist/params';
import { DC_MOTOR_DEFAULTS } from '../utils/netlist/parts/dcmotor';
import { STEPPER_DEFAULTS } from '../utils/netlist/parts/stepper';
import { meshSignalLevel } from '../utils/netlist/parts/meshsignal';
import { jointChannels, type CoSimEndpoint } from '../utils/coSimLink';
import type { SpiceResult } from '../types/simulation';

/**
 * One lock-step slice of a circuit driving a Mesh scene.
 *
 * Volt owns time. Each slice:
 *  1. every bound motor's shaft starts at its joint's angle and speed, with
 *     the joint's inertia added to the rotor's and the scene's load on it;
 *  2. every Mesh signal outputs its channel's latest reading;
 *  3. the circuit is solved for the slice, shafts and all;
 *  4. Mesh steps the same slice with each joint driven by the torque its
 *     shaft transmitted, and reports the channels the circuit reads.
 *
 * Keeping the shaft's dynamics in the circuit is what makes this stable at
 * slices longer than a stepper's rotor period: the stiff part is solved
 * implicitly, and only the slowly varying load crosses the link. The torque
 * sent is the motor's less what it spent accelerating its own rotor, so the
 * joint, with only its own inertia, follows the same motion.
 *
 * Pure apart from the solver and the endpoint, which are handed in.
 */

export type CoSimState = {
  /** Where the circuit ended. Shaft speed and angle are overwritten from Mesh each slice. */
  sim: SimState;
  /** Mesh's latest reading of every bound channel. */
  outputs: Record<string, number>;
  /** Each thresholded Mesh signal: whether it is high. */
  latches: Record<string, boolean>;
  /** Last slice's nets, for reading MCU inputs off its end state. */
  portToNet: Record<string, string>;
};

export const initialCoSimState = (): CoSimState => ({ sim: {}, outputs: {}, latches: {}, portToNet: {} });

type ShaftBinding = { nodeId: string; joint: string; rotorInertia: number; usesPosition: boolean };
type SignalBinding = { nodeId: string; channel: string };

export type CoSimBindings = { shafts: ShaftBinding[]; signals: SignalBinding[]; outputs: string[] };

const ROTORS: Record<string, { inertia: number; usesPosition: boolean }> = {
  dcmotor: { inertia: DC_MOTOR_DEFAULTS.inertia, usesPosition: false },
  stepper: { inertia: STEPPER_DEFAULTS.inertia, usesPosition: true },
};

const bound = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** What the circuit has bound to the scene: motor shafts to joints, signals to channels. */
export function coSimBindings(nodes: Node[]): CoSimBindings {
  const shafts: ShaftBinding[] = [];
  const signals: SignalBinding[] = [];
  const outputs = new Set<string>();
  for (const n of nodes) {
    const rotor = ROTORS[n.type ?? ''];
    const joint = bound(n.data.shaftJoint);
    if (rotor && joint) {
      shafts.push({ nodeId: n.id, joint, rotorInertia: numParam(n.data, 'inertia', rotor.inertia), usesPosition: rotor.usesPosition });
      const c = jointChannels(joint);
      for (const name of [c.pos, c.vel, `joint:${joint}.inertia`, `joint:${joint}.load`]) outputs.add(name);
    }
    const channel = bound(n.data.channel);
    if (n.type === 'meshsignal' && channel) {
      signals.push({ nodeId: n.id, channel });
      outputs.add(channel);
    }
  }
  return { shafts, signals, outputs: [...outputs] };
}

export type CoSimInput = {
  nodes: Node[];
  edges: Edge[];
  sliceMs: number;
  /** The solver's report and maximum step, ms. A fiftieth of the slice by default. */
  stepMs?: number;
};

export type CoSimDeps = {
  solve: (netlist: string) => Promise<SpiceResult>;
  endpoint: CoSimEndpoint;
};

export type CoSimOutcome = {
  state: CoSimState;
  /** The nodes the slice was solved with, Mesh's readings on them. */
  nodes: Node[];
  result: SpiceResult;
  portToNet: Record<string, string>;
  /** The torque each bound shaft handed its joint, N·m, by node id. */
  torques: Record<string, number>;
  /** Names Mesh had no channel for. */
  unknown: string[];
  logs: Record<string, string[]>;
};

/** The mean of a trace over its own time span. */
function mean(t: number[], v: number[]): number {
  if (v.length === 0) return 0;
  if (v.length === 1 || t[t.length - 1] <= t[0]) return v[v.length - 1];
  let s = 0;
  for (let i = 1; i < t.length; i++) s += 0.5 * (v[i] + v[i - 1]) * (t[i] - t[i - 1]);
  return s / (t[t.length - 1] - t[0]);
}

export async function coSimStep(state: CoSimState, input: CoSimInput, { solve, endpoint }: CoSimDeps): Promise<CoSimOutcome> {
  const { edges, sliceMs } = input;
  const bindings = coSimBindings(input.nodes);
  let outputs = state.outputs;
  const unknown = new Set<string>();

  // Before the first slice, read the scene where it stands without moving it.
  if (bindings.outputs.some(name => outputs[name] === undefined)) {
    const read = await endpoint.stepFor(0, {}, bindings.outputs);
    outputs = { ...outputs, ...read.outputs };
    read.unknown.forEach(u => unknown.add(u));
  }

  const sim: SimState = { ...state.sim };
  const shaftById = new Map(bindings.shafts.map(s => [s.nodeId, s]));
  const signalById = new Map(bindings.signals.map(s => [s.nodeId, s]));
  const nodes = input.nodes.map(n => {
    const shaft = shaftById.get(n.id);
    if (shaft) {
      const c = jointChannels(shaft.joint);
      const { speed, position } = shaftNodes(n.id);
      sim[speed.toLowerCase()] = outputs[c.vel] ?? 0;
      if (shaft.usesPosition) sim[position.toLowerCase()] = outputs[c.pos] ?? 0;
      const linkedShaft: LinkedShaft = {
        inertia: outputs[`joint:${shaft.joint}.inertia`] ?? 0,
        load: outputs[`joint:${shaft.joint}.load`] ?? 0,
      };
      return { ...n, data: { ...n.data, linkedShaft } };
    }
    const signal = signalById.get(n.id);
    if (signal) {
      return { ...n, data: { ...n.data, signalValue: outputs[signal.channel] ?? 0, latchedHigh: state.latches[n.id] === true } };
    }
    return n;
  });

  // An MCU reads its inputs as they stood at the end of the last slice.
  const mcuInputs: Record<string, Record<string, PWLPoint[]>> = {};
  for (const n of nodes) {
    if (n.type !== 'mcu') continue;
    mcuInputs[n.id] = {};
    for (const pin of getEffectiveMcuConfig(n.data).pins) {
      const net = state.portToNet[`${n.id}-${pin.id}`];
      const v = net ? state.sim[net.toLowerCase()] : undefined;
      if (v !== undefined) mcuInputs[n.id][pin.id] = [{ t: 0, v }, { t: sliceMs, v }];
    }
  }
  const sketches = runSketches(nodes, sliceMs / 1000, mcuInputs);

  const { netlist, portToNet } = generateSpiceNetlist(nodes, edges, {
    simLength: sliceMs / 1000,
    mcuDrives: sketches.drives,
    initialConditions: sim,
    hilMaxStepMs: input.stepMs ?? sliceMs / 50,
  });
  const result = await solve(netlist);
  const end = readEndState(result, sim);

  const torques: Record<string, number> = {};
  const inputs: Record<string, number> = {};
  for (const shaft of bindings.shafts) {
    const { speed, torque } = shaftNodes(shaft.nodeId);
    const tq = findNetGraph(result, torque);
    const made = tq ? mean(tq.timestamps_ms, tq.voltage_levels) : 0;
    const w0 = sim[speed.toLowerCase()] ?? 0;
    const w1 = end[speed.toLowerCase()] ?? w0;
    const transmitted = made - shaft.rotorInertia * (w1 - w0) / (sliceMs / 1000);
    torques[shaft.nodeId] = transmitted;
    const key = jointChannels(shaft.joint).force;
    inputs[key] = (inputs[key] ?? 0) + transmitted;
  }

  const stepped = await endpoint.stepFor(sliceMs, inputs, bindings.outputs);
  stepped.unknown.forEach(u => unknown.add(u));
  const nextOutputs = { ...outputs, ...stepped.outputs };

  const latches: Record<string, boolean> = {};
  for (const signal of bindings.signals) {
    const node = nodes.find(n => n.id === signal.nodeId)!;
    latches[signal.nodeId] = meshSignalLevel(node.data, nextOutputs[signal.channel] ?? 0, state.latches[signal.nodeId] === true).high;
  }

  return {
    state: { sim: end, outputs: nextOutputs, latches, portToNet },
    nodes,
    result,
    portToNet,
    torques,
    unknown: [...unknown],
    logs: sketches.logs,
  };
}
