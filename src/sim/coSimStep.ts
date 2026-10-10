import type { Node, Edge } from '@xyflow/react';
import { generateSpiceNetlist } from '../utils/spice';
import { readEndState, type SimState } from '../utils/simState';
import { runSketches, type PWLPoint } from '../utils/mcu';
import { getEffectiveMcuConfig } from '../utils/mcuConfig';
import { forceLaw, phaseSense, shaftNodes, type LinkedShaft, type TransducerSpec } from '../utils/transducer';
import { transducerSpec } from '../utils/netlist/transducers';
import { meshSignalLevel } from '../utils/netlist/parts/meshsignal';
import { jointChannels, type CoSimEndpoint } from '../utils/coSimLink';
import type { SpiceResult } from '../types/simulation';

/**
 * One lock-step slice of a circuit driving a Mesh scene.
 *
 * Volt owns time and does the electrics; Mesh does every bit of mechanics.
 * Each slice:
 *  1. every bound motor's shaft is its joint: the joint's angle and speed,
 *     held for the slice, give the motor its back-EMF;
 *  2. every Mesh signal outputs its channel's latest reading;
 *  3. the circuit is solved for the slice;
 *  4. Mesh steps the same slice with each joint driven by its motor's force
 *     law at the currents the slice ended on — k(x)·i as constants, cosines
 *     and sines of the joint's position, which Mesh evaluates at the joint's
 *     own position every one of its steps — plus the rotor's inertia and its
 *     bearing friction as joint parameters; and reports what the circuit reads.
 *
 * The stiff part of a stepper, its magnetic spring, is therefore integrated by
 * Mesh at Mesh's rate (sub-stepped when it needs to be), and only the currents,
 * which a driver holds steady between steps, cross the link once a slice.
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

type ShaftBinding = { nodeId: string; joint: string; spec: TransducerSpec };
type SignalBinding = { nodeId: string; channel: string };

export type CoSimBindings = { shafts: ShaftBinding[]; signals: SignalBinding[]; outputs: string[] };

const bound = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** What the circuit has bound to the scene: motor shafts to joints, signals to channels. */
export function coSimBindings(nodes: Node[]): CoSimBindings {
  const shafts: ShaftBinding[] = [];
  const signals: SignalBinding[] = [];
  const outputs = new Set<string>();
  for (const n of nodes) {
    const spec = transducerSpec(n);
    const joint = bound(n.data.shaftJoint);
    if (spec && joint) {
      shafts.push({ nodeId: n.id, joint, spec });
      const c = jointChannels(joint);
      outputs.add(c.pos);
      outputs.add(c.vel);
    }
    const channel = bound(n.data.channel);
    if (n.type === 'meshsignal' && channel) {
      signals.push({ nodeId: n.id, channel });
      outputs.add(channel);
    }
  }
  return { shafts, signals, outputs: [...outputs] };
}

/**
 * The inputs that drive a joint: the force law as `force`, `force.cos(w)` and
 * `force.sin(w)` channels, and the rotor as `armature` and `damping`. Several
 * motors on one joint add.
 */
export function shaftInputs(joint: string, spec: TransducerSpec, currents: number[], into: Record<string, number> = {}): Record<string, number> {
  const add = (key: string, v: number) => {
    if (v !== 0) into[key] = (into[key] ?? 0) + v;
  };
  const c = jointChannels(joint);
  for (const h of forceLaw(spec, currents)) {
    if (h.w === 0) add(c.force, h.cos);
    else {
      add(`${c.force}.cos(${h.w})`, h.cos);
      add(`${c.force}.sin(${h.w})`, h.sin);
    }
  }
  add(`joint:${joint}.armature`, spec.shaft.j);
  add(`joint:${joint}.damping`, spec.shaft.b);
  return into;
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
  /** What each joint was driven with this slice, by channel. */
  inputs: Record<string, number>;
  /** Names Mesh had no channel for. */
  unknown: string[];
  logs: Record<string, string[]>;
};

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
      const linkedShaft: LinkedShaft = { x: outputs[c.pos] ?? 0, w: outputs[c.vel] ?? 0 };
      // The shaft's nodes are sources while linked: Mesh says where they are.
      const { speed, position } = shaftNodes(n.id);
      delete sim[speed.toLowerCase()];
      delete sim[position.toLowerCase()];
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

  // The currents the slice ended on drive the joint through the next one.
  const inputs: Record<string, number> = {};
  for (const shaft of bindings.shafts) {
    const currents = shaft.spec.phases.map((_, i) => end[`i(${phaseSense(shaft.nodeId, i + 1)})`.toLowerCase()] ?? 0);
    shaftInputs(shaft.joint, shaft.spec, currents, inputs);
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
    inputs,
    unknown: [...unknown],
    logs: sketches.logs,
  };
}
