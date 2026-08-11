// ---------------------------------------------------------------------------
// Schematic -> PCB Net Extraction
//
// Turns the React Flow graph into electrical nets (groups of pins that must be
// connected by copper) and decides which schematic symbols become physical
// parts on the board.
//
// Connectivity is delegated to buildPortAdjacency() in graphTopology.ts, which
// already handles junction pass-throughs and merges every ground symbol onto a
// virtual 'GND-global' port. That is the same graph the SPICE netlist is built
// from, so the board and the simulation agree on what is connected.
// ---------------------------------------------------------------------------

import type { Node, Edge } from '@xyflow/react';
import { buildPortAdjacency } from './graphTopology';
import type { ComponentFootprint } from './pcbFootprints';

/** What a schematic symbol becomes on the physical board. */
export type NodeRole =
  /** A real part with a footprint (resistor, LED, IC...). */
  | 'component'
  /** A real part, but one the user wires the outside world to (sources, boards). */
  | 'connector'
  /** Merges nets but has no physical presence (ground, junction). */
  | 'virtual'
  /** Test equipment - excluded from the board entirely (scope, multimeter). */
  | 'instrument';

const VIRTUAL_TYPES = new Set(['ground', 'junction']);
const INSTRUMENT_TYPES = new Set(['scope', 'multimeter']);
const CONNECTOR_TYPES = new Set([
  'voltage',
  'acvoltage',
  'signalgen',
  'currentsource',
  'mcu',
  'heltec_v4',
]);

export function classifyNode(nodeType?: string): NodeRole {
  const t = (nodeType || '').toLowerCase();
  if (VIRTUAL_TYPES.has(t)) return 'virtual';
  if (INSTRUMENT_TYPES.has(t)) return 'instrument';
  if (CONNECTOR_TYPES.has(t)) return 'connector';
  return 'component';
}

/** True if the node gets a footprint placed on the board. */
export function isPhysical(nodeType?: string): boolean {
  const role = classifyNode(nodeType);
  return role === 'component' || role === 'connector';
}

/** A reference to one pin of one placed part. */
export interface PortRef {
  nodeId: string;
  handleId: string;
  /** Canonical port key, `${nodeId}-${handleId}` — matches graphTopology. */
  key: string;
}

export interface PcbNet {
  id: string;
  /** Display name: 'GND' for the ground net, otherwise N1, N2, ... */
  name: string;
  isGround: boolean;
  /** Pins on physical parts only. Virtual/instrument ports are stripped. */
  ports: PortRef[];
}

export interface NetExtractionResult {
  nets: PcbNet[];
  /** Port key -> net id, for every port on a physical part. */
  portToNet: Record<string, string>;
  warnings: string[];
}

function parsePortKey(key: string): { nodeId: string; handleId: string } | null {
  const idx = key.indexOf('-');
  if (idx <= 0) return null;
  return { nodeId: key.slice(0, idx), handleId: key.slice(idx + 1) };
}

/**
 * Groups ports into electrical nets via connected components over the
 * schematic's port adjacency graph.
 *
 * Nets that end up with fewer than two physical pins are dropped — they need
 * no copper (e.g. a net that only touches a multimeter probe).
 */
export function extractNets(nodes: Node[], edges: Edge[]): NetExtractionResult {
  const warnings: string[] = [];
  const adj = buildPortAdjacency(nodes, edges);

  const nodeById = new Map<string, Node>();
  nodes.forEach(n => nodeById.set(n.id, n));

  // Port keys use `${nodeId}-${handleId}`, and node ids may themselves contain
  // '-', so resolve the node by longest-matching-id rather than first dash.
  const resolvePort = (key: string): { nodeId: string; handleId: string } | null => {
    if (key === 'GND-global') return null;
    let best: { nodeId: string; handleId: string } | null = null;
    for (const id of nodeById.keys()) {
      if (key.startsWith(id + '-')) {
        if (!best || id.length > best.nodeId.length) {
          best = { nodeId: id, handleId: key.slice(id.length + 1) };
        }
      }
    }
    return best ?? parsePortKey(key);
  };

  const visited = new Set<string>();
  const rawGroups: { keys: string[]; touchesGround: boolean }[] = [];

  for (const start of Object.keys(adj)) {
    if (visited.has(start)) continue;
    const queue = [start];
    visited.add(start);
    const keys: string[] = [];
    let touchesGround = false;

    while (queue.length > 0) {
      const curr = queue.shift()!;
      if (curr === 'GND-global') {
        touchesGround = true;
      } else {
        keys.push(curr);
      }
      for (const nb of adj[curr] || []) {
        if (!visited.has(nb)) {
          visited.add(nb);
          queue.push(nb);
        }
      }
    }
    rawGroups.push({ keys, touchesGround });
  }

  const nets: PcbNet[] = [];
  const portToNet: Record<string, string> = {};
  let netCounter = 0;

  for (const group of rawGroups) {
    const ports: PortRef[] = [];
    for (const key of group.keys) {
      const parsed = resolvePort(key);
      if (!parsed) continue;
      const node = nodeById.get(parsed.nodeId);
      if (!node) {
        warnings.push(`Net references unknown node '${parsed.nodeId}' — ignored.`);
        continue;
      }
      if (!isPhysical(node.type)) continue;
      ports.push({ nodeId: parsed.nodeId, handleId: parsed.handleId, key });
    }

    if (ports.length === 0) continue;

    const isGround = group.touchesGround;
    const id = isGround ? 'GND' : `N${++netCounter}`;

    if (ports.length === 1 && !isGround) {
      // A single physical pin with nothing else on the net: nothing to route.
      warnings.push(
        `Net ${id} touches only one component pin (${ports[0].key}) — no copper needed.`
      );
      continue;
    }

    const net: PcbNet = { id, name: id, isGround, ports };
    nets.push(net);
    ports.forEach(p => { portToNet[p.key] = id; });
  }

  // Ground net should sort first; it is usually the biggest and routed first.
  nets.sort((a, b) => (a.isGround === b.isGround ? 0 : a.isGround ? -1 : 1));

  return { nets, portToNet, warnings };
}

// ---------------------------------------------------------------------------
// Handle -> footprint pin mapping
// ---------------------------------------------------------------------------

/**
 * Ordered handle lists per node type. The index into the array is the index of
 * the footprint pad the handle maps to, used when the handle id does not
 * directly match a pad's pinNumber.
 *
 * Handle names mirror the getNet() calls in spice.ts, which is the de-facto
 * registry of pin names for each component type.
 */
const HANDLE_ORDER: Record<string, string[]> = {
  resistor: ['in', 'out'],
  capacitor: ['in', 'out'],
  inductor: ['in', 'out'],
  ldr: ['in', 'out'],
  switch: ['in', 'out'],
  diode: ['anode', 'cathode'],
  zener: ['anode', 'cathode'],
  led: ['anode', 'cathode'],
  voltage: ['pos', 'neg'],
  acvoltage: ['pos', 'neg'],
  currentsource: ['pos', 'neg'],
  signalgen: ['out', 'gnd'],
  speaker: ['in', 'gnd'],
  microphone: ['out', 'gnd'],
  // POT-3PIN puts the wiper on the centre pad.
  potentiometer: ['in', 'wiper', 'out'],
  transformer: ['p1', 'p2', 's1', 's2'],
  dff: ['d', 'clk', 'q', 'qbar'],
  sevenseg: ['common', 'a', 'b', 'c', 'd', 'e', 'f', 'g'],
  and: ['in1', 'in2', 'out'],
  or: ['in1', 'in2', 'out'],
  nand: ['in1', 'in2', 'out'],
  nor: ['in1', 'in2', 'out'],
  xor: ['in1', 'in2', 'out'],
  not: ['in1', 'out'],
  // TO-92, flat face towards viewer: 1 = Emitter, 2 = Base, 3 = Collector.
  npn: ['e', 'b', 'c'],
  pnp: ['e', 'b', 'c'],
  // TO-220 power MOSFET: 1 = Gate, 2 = Drain, 3 = Source.
  nmos: ['g', 'd', 's'],
  pmos: ['g', 'd', 's'],
  mcu: ['5V', 'GND', 'D0', 'D1', 'D2', 'D3', 'A0', 'A1'],
  heltec_v4: ['3V3', 'GND', 'GPIO_1', 'GPIO_3', 'GPIO_33', 'GPIO_36', 'GPIO_37', 'GPIO_41'],
};

/**
 * Explicit handle -> pin number overrides, where a part's schematic handles do
 * not map onto consecutive footprint pads. Single op-amp in a DIP-8 is the
 * classic case (pins 1, 5 and 8 are unused).
 */
const HANDLE_PIN_OVERRIDE: Record<string, Record<string, string>> = {
  // Single op-amp in a DIP-8 (pins 1, 5, 8 unused).
  opamp: {
    in_inv: '2',
    in_non: '3',
    vee: '4',
    out: '6',
    vcc: '7',
  },
  // 7474-style D flip-flop in a DIP-14.
  dff: {
    d: '2',
    clk: '3',
    q: '5',
    qbar: '6',
  },
  // 6x6mm tact switch: pads 1/2 are one pole, 3/4 the other.
  switch: {
    in: '1',
    out: '3',
  },
};

export interface PinMapping {
  pinNumber: string | number;
  padIndex: number;
}

/**
 * Resolves a schematic handle id to a specific pad on a footprint.
 *
 * Returns undefined when there is no defensible mapping. Callers must treat
 * that as an error and surface it — silently falling back to pad 0 (as the
 * original implementation did) shorts both ends of a two-pin part together.
 */
export function resolveHandleToPin(
  nodeType: string | undefined,
  handleId: string,
  footprint: ComponentFootprint
): PinMapping | undefined {
  const pads = footprint.pads;
  if (pads.length === 0) return undefined;

  const type = (nodeType || '').toLowerCase();
  const handle = (handleId || '').trim();

  // 1. Explicit override table.
  const override = HANDLE_PIN_OVERRIDE[type]?.[handle];
  if (override !== undefined) {
    const idx = pads.findIndex(p => String(p.pinNumber) === override);
    if (idx >= 0) return { pinNumber: pads[idx].pinNumber, padIndex: idx };
  }

  // 2. Direct match against a pad's pin number (555 '1'..'8', headers, etc).
  const direct = pads.findIndex(
    p => String(p.pinNumber).toLowerCase() === handle.toLowerCase()
  );
  if (direct >= 0) return { pinNumber: pads[direct].pinNumber, padIndex: direct };

  // 3. Positional mapping from the type's canonical handle order.
  const order = HANDLE_ORDER[type];
  if (order) {
    const pos = order.findIndex(h => h.toLowerCase() === handle.toLowerCase());
    if (pos >= 0 && pos < pads.length) {
      return { pinNumber: pads[pos].pinNumber, padIndex: pos };
    }
  }

  // 4. Generic two-terminal fallback for unknown types.
  if (pads.length === 2) {
    const first = ['in', 'anode', 'pos', 'a', '1', 'p1'];
    const second = ['out', 'cathode', 'neg', 'k', '2', 'p2', 'gnd'];
    const h = handle.toLowerCase();
    if (first.includes(h)) {
      return { pinNumber: pads[0].pinNumber, padIndex: 0 };
    }
    if (second.includes(h)) {
      return { pinNumber: pads[1].pinNumber, padIndex: 1 };
    }
  }

  return undefined;
}
