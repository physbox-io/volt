/**
 * Electrical rules check — the pre-flight that says what the solver silently
 * worked around.
 *
 * `generateSpiceNetlist` shunts every unconnected terminal to ground through
 * 1G, because ngspice refuses a singular matrix and a circuit that will not
 * solve is worse than one that solves oddly. The cost is that a floating op-amp
 * input, an unwired VCC pin or a transformer secondary with nowhere to go runs
 * anyway and produces a waveform that looks like an answer. This reads the same
 * pin list the netlist was built from and says which of those the run is
 * standing on.
 *
 * Nothing here changes what is simulated. It is commentary on a run that
 * happens either way.
 */
import type { Node } from '@xyflow/react';
import type { Advisory } from '../types/advisories';
import type { PinRef } from './spice';
import { isVirtualPortKey, nodeNetName, virtualNetPort } from './netNaming';
import { NON_SIMULATING_TYPES } from './spice';

/** The net every DC path is measured against. */
const GND = '0';

/** Pin ids written the way the part's datasheet writes them. */
const PIN_LABELS: Record<string, string> = {
  in_non: 'non-inverting input (+)',
  in_inv: 'inverting input (−)',
  vcc: 'VCC pin',
  vee: 'VEE pin',
  anode: 'anode',
  cathode: 'cathode',
  b: 'base',
  c: 'collector',
  e: 'emitter',
  g: 'gate',
  d: 'drain',
  s: 'source',
  wiper: 'wiper',
  ch1: 'channel 1',
  ch2: 'channel 2',
  clk: 'clock input',
  qbar: 'Q̅ output',
  p1: 'primary 1',
  p2: 'primary 2',
  s1: 'secondary 1',
  s2: 'secondary 2',
};

export function pinLabel(nodeType: string, handleId: string): string {
  const known = PIN_LABELS[handleId.toLowerCase()];
  if (known) return known;
  if (nodeType === 'timer555') {
    const names: Record<string, string> = {
      '1': 'GND (pin 1)', '2': 'TRIG (pin 2)', '3': 'OUT (pin 3)', '4': 'RESET (pin 4)',
      '5': 'CTRL (pin 5)', '6': 'THR (pin 6)', '7': 'DIS (pin 7)', '8': 'VCC (pin 8)',
    };
    if (names[handleId]) return names[handleId];
  }
  if (handleId === 'in') return 'input';
  if (handleId === 'out') return 'output';
  if (handleId === 'pos') return '+ terminal';
  if (handleId === 'neg') return '− terminal';
  if (handleId === 'gnd') return 'ground pin';
  return `pin ${handleId}`;
}

/**
 * Which of a part's terminals ngspice can actually push DC between.
 *
 * Read off what `spice.ts` emits for that part, not off what the symbol looks
 * like: a capacitor draws as two plates and emits a `C`, which blocks DC; an
 * op-amp draws as one block and emits a subcircuit whose VCC pin reaches
 * nothing but a clamp expression, so an unwired VCC really is floating and
 * really does need saying. A part not listed here has all its pins in one
 * group, which is right for the two-lead passives and for anything new.
 *
 * `'0'` in a group means the part reaches ground internally — a B-source
 * writing its output against node 0 does exactly that.
 */
export function dcPathGroups(nodeType: string, data: Record<string, unknown>, handles: string[]): string[][] {
  switch (nodeType) {
    // A capacitor is the definition of a DC block, and a current source is
    // treated as one by every SPICE topology check for the same reason: no
    // current flows through it because the circuit asked, so it cannot be what
    // gives a node its reference.
    case 'capacitor':
    case 'currentsource':
      return [];
    // 1G probes. They will keep the matrix non-singular and they must not be
    // what silences this check, or every floating net with a scope clipped to
    // it reads as grounded.
    case 'scope':
      return [];
    case 'multimeter':
      return data.mode === 'current' ? [handles] : [];
    case 'opamp':
      return [['in_non', 'in_inv'], ['out', GND]];
    // Pins 1, 5 and 8 sit on the internal divider; OUT and DIS are driven
    // against pin 1. TRIG, RESET and THR are switch controls and reach nothing.
    case 'timer555':
      return [['1', '5', '8', '3', '7']];
    case 'and': case 'or': case 'nand': case 'nor': case 'xor': case 'not':
      return [['out', GND]];
    case 'dff':
      return [['q', GND], ['qbar', GND]];
    // A transformer couples magnetically and not at DC, so a secondary with
    // nothing else on it is genuinely unreferenced — which is the case ngspice
    // would otherwise fail to solve.
    case 'transformer':
      return [['p1', 'p2'], ['s1', 's2']];
    // Both carry their own ground pin and internal pull-downs on every IO, so
    // every pin on the part is referenced whether or not it is wired.
    case 'mcu':
    case 'heltec_v4':
      return [[...handles, GND]];
    default:
      return [handles];
  }
}

/** Terminals the operator has said to stop mentioning. */
function isIgnored(node: Node | undefined, handleId: string): boolean {
  const data = (node?.data ?? {}) as Record<string, unknown>;
  if (data.ercIgnore === true) return true;
  const list = data.ercIgnorePins;
  return Array.isArray(list) && list.includes(handleId);
}

class DisjointSet {
  private parent = new Map<string, string>();
  find(a: string): string {
    const p = this.parent.get(a);
    if (p === undefined) { this.parent.set(a, a); return a; }
    if (p === a) return a;
    const root = this.find(p);
    this.parent.set(a, root);
    return root;
  }
  union(a: string, b: string) {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

export type ErcInput = {
  nodes: Node[];
  pins: PinRef[];
  portToNet: Record<string, string>;
  /** Reference designator for a node, e.g. `R3`. */
  nameOf: (nodeId: string) => string;
};

export function runErc({ nodes, pins, portToNet, nameOf }: ErcInput): Advisory[] {
  const out: Advisory[] = [];
  const nodeById = new Map(nodes.map(n => [n.id, n]));

  // A canvas with nothing on it is not a circuit with problems.
  const simulatingNodes = nodes.filter(n => !NON_SIMULATING_TYPES.has(n.type as string) && n.type !== 'ground' && n.type !== 'junction');
  if (simulatingNodes.length === 0) return out;

  // ── 1. A reference at all ────────────────────────────────────────────
  // Measured at the devices, not at the symbols: a ground flag dropped on the
  // canvas and never wired to anything gives the circuit a ground in the port
  // map and no reference at all in the netlist.
  const hasGround = pins.some(p => p.net === GND);
  if (!hasGround) {
    out.push({
      id: 'erc:no-ground',
      severity: 'warning',
      title: 'The circuit has no ground',
      detail:
        'Every voltage SPICE reports is measured against ground, and without one the solver picks its own reference. Drop a ground symbol on the node you want to call zero.',
    });
  }

  // ── 2. Terminals with nothing on them ────────────────────────────────
  const floatingPins = pins.filter(p => !p.connected && !isIgnored(nodeById.get(p.nodeId), p.handleId));
  for (const p of floatingPins) {
    out.push({
      id: `erc:floating:${p.nodeId}:${p.handleId}`,
      severity: 'warning',
      nodeId: p.nodeId,
      title: `${nameOf(p.nodeId)} — ${pinLabel(p.nodeType, p.handleId)} is not connected`,
      detail:
        'The run holds it at ground through a 1GΩ resistor so the solver has something to solve, which means the waveform is a real answer to a circuit you did not draw.',
    });
  }

  // ── 3. A name nothing else answers to ────────────────────────────────
  // Two pins a screen apart share a net by carrying the same label, so a label
  // written once is a wire drawn to nowhere — and it looks exactly like a wire
  // drawn to somewhere.
  const portsPerNet = new Map<string, number>();
  for (const [port, net] of Object.entries(portToNet)) {
    if (isVirtualPortKey(port)) continue;
    portsPerNet.set(net, (portsPerNet.get(net) ?? 0) + 1);
  }
  const namedSeen = new Set<string>();
  for (const node of nodes) {
    const name = nodeNetName(node.type, node.data);
    if (!name) continue;
    const net = portToNet[`${node.id}-in`] ?? portToNet[virtualNetPort(name)];
    if (!net || net === GND) continue;
    if (namedSeen.has(net)) continue;
    // Every label symbol on the net is itself a port on it; more than that many
    // means something real is attached.
    const labelCount = nodes.filter(n => {
      const nm = nodeNetName(n.type, n.data);
      return !!nm && (portToNet[`${n.id}-in`] ?? portToNet[virtualNetPort(nm)]) === net;
    }).length;
    if ((portsPerNet.get(net) ?? 0) > labelCount) continue;
    namedSeen.add(net);
    out.push({
      id: `erc:lonely-net:${net}`,
      severity: 'advisory',
      nodeId: node.id,
      title: `Nothing else is on the net "${name}"`,
      detail:
        'A net label joins pins that carry the same name. Only this symbol does, so nothing is connected to it — check the spelling on the other end.',
    });
  }

  // ── 4. Nets with no DC path to ground ────────────────────────────────
  const ds = new DisjointSet();
  ds.find(GND);
  const handlesByNode = new Map<string, string[]>();
  for (const p of pins) {
    const list = handlesByNode.get(p.nodeId);
    if (list) list.push(p.handleId);
    else handlesByNode.set(p.nodeId, [p.handleId]);
  }
  /*
   * A power rail is a source against ground, so it references its net — but it
   * has no device of its own and therefore no terminals in the pin list, which
   * would leave an op-amp fed only by a `+12V` flag looking unreferenced. The
   * rail nets are joined to ground here, matching the `V_rail_<net> <net> 0`
   * card `spice.ts` emits for each of them.
   */
  for (const node of nodes) {
    if (node.type !== 'powerrail') continue;
    const name = nodeNetName(node.type, node.data);
    if (!name) continue;
    const net = portToNet[`${node.id}-in`] ?? portToNet[virtualNetPort(name)];
    if (net) ds.union(net, GND);
  }

  for (const [nodeId, handles] of handlesByNode) {
    const node = nodeById.get(nodeId);
    const type = node?.type ?? '';
    const netOf = (h: string) => (h === GND ? GND : portToNet[`${nodeId}-${h}`]);
    for (const group of dcPathGroups(type, (node?.data ?? {}) as Record<string, unknown>, handles)) {
      const nets = group.map(netOf).filter((n): n is string => !!n);
      for (let i = 1; i < nets.length; i++) ds.union(nets[0], nets[i]);
    }
  }

  // A pin already reported as floating explains its own net; saying the same
  // thing twice in different words is how a warning panel becomes noise.
  const floatingNets = new Set(floatingPins.map(p => p.net));
  const islanded = new Set<string>();
  for (const p of pins) {
    if (!p.connected || p.net === GND) continue;
    if (floatingNets.has(p.net)) continue;
    if (ds.find(p.net) === ds.find(GND)) continue;
    islanded.add(p.net);
  }
  for (const net of islanded) {
    const on = pins.filter(p => p.net === net);
    const parts = [...new Set(on.map(p => nameOf(p.nodeId)))].join(', ');
    out.push({
      id: `erc:no-dc-path:${net}`,
      severity: 'advisory',
      nodeId: on[0]?.nodeId,
      title: `No DC path to ground from ${parts}`,
      detail:
        'Only capacitors, current sources or a transformer winding reach this part of the circuit, so its DC level is not set by anything. The run pins it to ground through 1GΩ; a real bench supply would not.',
    });
  }

  return out;
}
