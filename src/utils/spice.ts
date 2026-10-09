import { type Node, type Edge } from '@xyflow/react';
import type { McuDrive } from './mcu';
import { nodeNetName, railVoltage, virtualNetPort } from './netNaming';
import { nodeVoltages, simTime, type SimState } from './simState';
import { partEmitters } from './netlist/partEmitters';

export { sanitizeSpiceValue } from './netlist/values';

/**
 * Node types that exist only on the board. They are placed, drilled and routed,
 * but they emit no SPICE device — a pin header, via or mounting hole has no
 * electrical behaviour of its own.
 */
export const NON_SIMULATING_TYPES = new Set([
  'pinheader', 'via', 'mountinghole', 'cutout',
  // Named nets. They are wiring, not devices: the label contributes nothing at
  // all, and the rail's source is emitted once per net further down rather than
  // once per symbol, so that three `+5V` flags on one rail are one supply.
  'netlabel', 'powerrail',
]);

/**
 * Which analysis the netlist ends in.
 *
 * `tran` is what Run has always emitted and stays the default, so a call that
 * names no analysis gets exactly the netlist it used to. The other two are the
 * same circuit solved a different way: `op` for the quiescent bias point, `ac`
 * for a small-signal sweep driven from one chosen source.
 */
export type SpiceAnalysis =
  | { kind: 'tran' }
  | { kind: 'op' }
  | {
      kind: 'ac';
      /** The source given `AC 1`. Every other source contributes nothing. */
      sourceNodeId: string;
      fStart: number;
      fStop: number;
      pointsPerDecade: number;
    };

/**
 * One terminal of one device, as the netlist builder saw it.
 *
 * Recorded by `getNet` rather than derived from a second table of pins per part
 * type: this is the list of terminals that actually reached SPICE, so it cannot
 * drift out of step with the netlist the way a hand-maintained copy would, and
 * a part added later is covered without being added anywhere.
 */
export type PinRef = {
  nodeId: string;
  nodeType: string;
  handleId: string;
  net: string;
  /** False when no wire and no net label puts this pin on a net. */
  connected: boolean;
};

/**
 * What to build the netlist for. Every field has a default, so a bare call
 * gets one second of transient at normal resolution from rest.
 */
export type NetlistOptions = {
  /** Seconds of transient to run. */
  simLength?: number;
  simResolution?: 'normal' | 'high';
  /**
   * What each MCU drives onto its pins over the run, by node id, from
   * `runSketches`. An MCU missing here has every pin idle.
   */
  mcuDrives?: Record<string, McuDrive>;
  /** The state a run starts from: see `SimState`. Any entry runs it with `uic`. */
  initialConditions?: SimState;
  /** HIL's step override: the report and maximum internal step, in ms. */
  hilMaxStepMs?: number;
  analysis?: SpiceAnalysis;
};

/**
 * Whether any part of the circuit emits differently at different times —
 * a generator, an AC source, a recording — so that two runs from the same
 * state are the same run only if they start at the same time too.
 */
export function dependsOnTime(nodes: Node[]): boolean {
  return nodes.some(n => !NON_SIMULATING_TYPES.has(n.type as string) && partEmitters[n.type ?? '']?.timeVarying?.(n));
}

export function generateSpiceNetlist(nodes: Node[], edges: Edge[], options: NetlistOptions = {}): { netlist: string; portToNet: Record<string, string>; pins: PinRef[] } {
  const {
    simLength = 1.0,
    simResolution = 'normal',
    mcuDrives = {},
    initialConditions,
    hilMaxStepMs,
    analysis = { kind: 'tran' },
  } = options;
  let netlist = "Circuit Simulation\n";
  
  // 1. Map connections to nets. A port is `${node.id}-${handle}`.
  let netIdCounter = 1;
  const portToNet: Record<string, string> = {};
  /**
   * Every net's ports, so a merge relabels only the net it absorbs instead of
   * scanning every port in the circuit — which made building a large
   * schematic's netlist quadratic in its wires.
   */
  const members = new Map<string, string[]>();
  const assign = (port: string, net: string) => {
    portToNet[port] = net;
    const list = members.get(net);
    if (list) list.push(port);
    else members.set(net, [port]);
  };
  /** Moves every port of net `from` onto net `to`; `to` keeps its name. */
  const relabel = (from: string, to: string) => {
    const moving = members.get(from);
    if (!moving || from === to) return;
    members.delete(from);
    for (const port of moving) portToNet[port] = to;
    const list = members.get(to);
    if (list) list.push(...moving);
    else members.set(to, moving);
  };

  // Pre-populate junction nodes so in/out ports are electrically connected
  nodes.forEach(node => {
    if (node.type === 'junction') {
      const netId = `N_junc_${node.id}`;
      assign(`${node.id}-in`, netId);
      assign(`${node.id}-out`, netId);
    }
  });

  /** Put two ports on the same net, merging the nets they already had. */
  const unitePorts = (portA: string, portB: string) => {
    const netA = portToNet[portA];
    const netB = portToNet[portB];

    if (!netA && !netB) {
      const netId = `N${netIdCounter++}`;
      assign(portA, netId);
      assign(portB, netId);
    } else if (netA && !netB) {
      assign(portB, netA);
    } else if (!netA && netB) {
      assign(portA, netB);
    } else if (netA !== netB) {
      relabel(netB, netA);
    }
  };

  // Initialize each edge connection as a net
  edges.forEach(edge => {
    unitePorts(
      `${edge.source}-${edge.sourceHandle || 'out'}`,
      `${edge.target}-${edge.targetHandle || 'in'}`,
    );
  });

  // Named nets. A label or a power rail joins its pin to a virtual port shared
  // by every symbol carrying the same name, which is how two pins a screen
  // apart end up on one net with no wire between them. `virtualNetPort` sends
  // a label written GND to the same port the ground symbols use.
  nodes.forEach(node => {
    const name = nodeNetName(node.type, node.data);
    if (!name) return;
    unitePorts(`${node.id}-in`, virtualNetPort(name));
  });

  // Force ground to be net '0'
  const groundPorts = nodes.filter(n => n.type === 'ground').map(n => `${n.id}-in`);
  if (portToNet['GND-global'] !== undefined) groundPorts.push('GND-global');
  groundPorts.forEach(groundPortIn => {
    const net = portToNet[groundPortIn];
    if (net) relabel(net, '0');
    else assign(groundPortIn, '0');
  });

  const unconnectedNets = new Set<string>();
  const nodeTypeById = new Map<string, string>();
  nodes.forEach(n => nodeTypeById.set(n.id, n.type ?? ''));
  /** Every terminal `getNet` was asked for, in the order it was asked for. */
  const pinsByPort = new Map<string, PinRef>();

  // Helper to get net for a node's handle
  const getNet = (nodeId: string, handleId: string) => {
    const port = `${nodeId}-${handleId}`;
    const existing = portToNet[port];
    const net = existing || `NC_${nodeId}_${handleId}`;
    if (!existing) unconnectedNets.add(net);
    if (!pinsByPort.has(port)) {
      pinsByPort.set(port, {
        nodeId,
        nodeType: nodeTypeById.get(nodeId) ?? '',
        handleId,
        net,
        connected: !!existing,
      });
    }
    return net;
  };

  /*
   * ` AC 1` on the one source an AC sweep is driven from. Appended to the card
   * rather than woven into each source's spelling: ngspice takes the AC
   * magnitude in any position on the line, and every other source is left
   * exactly as it was — which is what makes them contribute nothing to the
   * sweep, since a source with no AC magnitude has one of zero.
   */
  const acDrive = (nodeId: string) =>
    analysis.kind === 'ac' && analysis.sourceNodeId === nodeId ? ' AC 1' : '';

  // A carried state resumes the run's clock; see SimState.
  const startTime = analysis.kind === 'tran' ? simTime(initialConditions) : 0;

  // 2. Each part's cards, then each library its parts instance, once
  const partsByType = new Map<string, Node[]>();
  nodes.forEach(node => {
    // Board-only parts. A header pin or via is a wire, so the nets its edges
    // create are still real — the part itself just contributes no device.
    if (NON_SIMULATING_TYPES.has(node.type as string)) return;
    const emitter = partEmitters[node.type ?? ''];
    if (!emitter) return;
    netlist += emitter.emit(node, {
      net: handle => getNet(node.id, handle),
      acDrive: acDrive(node.id),
      initialConditions,
      mcuDrive: mcuDrives[node.id],
      time: startTime,
    });
    const same = partsByType.get(node.type!) ?? [];
    same.push(node);
    partsByType.set(node.type!, same);
  });

  for (const [type, emitter] of Object.entries(partEmitters)) {
    const parts = partsByType.get(type);
    if (parts && emitter.library) netlist += emitter.library(parts);
  }
  const hasAudio = [...partsByType].some(([type, parts]) => parts.some(node => partEmitters[type].audio?.(node)));

  /*
   * Power rails. A rail symbol is a DC source between its net and ground, and
   * one source per *net* rather than per symbol: several flags on the same
   * rail are the same supply, and two sources across one pair of nodes is a
   * voltage-source loop ngspice refuses to solve. A rail wired to ground is
   * skipped for the same reason - it would be a source with both ends on 0.
   */
  const railSources = new Set<string>();
  nodes.forEach(node => {
    if (node.type !== 'powerrail') return;
    const name = nodeNetName(node.type, node.data);
    if (!name) return;
    const net = portToNet[`${node.id}-in`] ?? portToNet[virtualNetPort(name)];
    if (!net || net === '0' || railSources.has(net)) return;
    railSources.add(net);
    netlist += `V_rail_${net} ${net} 0 DC ${railVoltage(node.data)}\n`;
  });

  // Shunt unconnected nodes to ground to prevent singular matrix errors
  unconnectedNets.forEach(net => {
    netlist += `R_shunt_${net} ${net} 0 1G\n`;
  });

  // Save all voltages to ensure they are returned
  netlist += `.save all\n`;
  
  /*
   * Everything from here down is transient-only.
   *
   * An operating point and an AC sweep are both solved at a single instant, so
   * a `.ic` — which seeds a transient run's starting state — means nothing to
   * either, and handing one to ngspice alongside `.op` only invites it to
   * disagree with the bias point it is being asked to find.
   */
  if (analysis.kind === 'op') {
    netlist += `.op\n`;
    netlist += `.end\n`;
    return { netlist, portToNet, pins: [...pinsByPort.values()] };
  }

  if (analysis.kind === 'ac') {
    const decades = Math.max(1, Math.round(analysis.pointsPerDecade));
    netlist += `.ac dec ${decades} ${analysis.fStart} ${analysis.fStop}\n`;
    netlist += `.end\n`;
    return { netlist, portToNet, pins: [...pinsByPort.values()] };
  }

  // Apply initial conditions if present
  if (initialConditions && Object.keys(initialConditions).length > 0) {
    const icParts = nodeVoltages(initialConditions)
      .map(([net, val]) => `V(${net})=${val.toFixed(6)}`)
      .join(' ');
    if (icParts) {
      netlist += `.ic ${icParts}\n`;
    }
  }

  // Basic transient analysis (variable total)
  // Audio circuits need much finer time steps for proper frequency resolution
  const useUic = (initialConditions && Object.keys(initialConditions).length > 0) ? ' uic' : '';
  if (hasAudio) {
    // 0.05ms step → 20kHz Nyquist → captures full audio bandwidth
    netlist += `.tran 0.05m ${simLength}s 0 0.05m${useUic}\n`;
  } else if (hilMaxStepMs !== undefined) {
    // HIL-only override: the reporting/max-internal-step size scales with how fast the
    // simulated oscillator is currently running (see hilHalfPeriodMsRef in App.tsx),
    // instead of a fixed 1ms. At a few Hz, 1ms is plenty of resolution relative to the
    // period; at a few hundred Hz, a half-period can be only 1-2ms, and 1ms quantization
    // would make derived edge timestamps wrong by a large fraction of that half-period.
    netlist += `.tran ${hilMaxStepMs}m ${simLength}s 0 ${hilMaxStepMs}m${useUic}\n`;
  } else if (simResolution === 'high') {
    netlist += `.tran 1m ${simLength}s 0 0.1m${useUic}\n`;
  } else {
    netlist += `.tran 1m ${simLength}s${useUic}\n`;
  }
  netlist += `.end\n`;

  return { netlist, portToNet, pins: [...pinsByPort.values()] };
}
