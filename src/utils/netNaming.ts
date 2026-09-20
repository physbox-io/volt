// ---------------------------------------------------------------------------
// Named nets: labels and power rails
//
// Ground was the only implicit net on this canvas: every ground symbol joins
// one global net without a wire, and everything else had to be drawn. So a
// supply reaching six parts was six wires across the schematic, and a signal
// that went from one corner to the other was drawn rather than named.
//
// A net label and a power rail are the same mechanism with different symbols:
// a one-pin part that carries a name, and every pin whose part carries the
// same name is on the same net. The rail additionally *drives* that net - it
// is a DC source against ground, which is what makes `+5V` mean five volts
// rather than merely "the same node as that other +5V".
// ---------------------------------------------------------------------------

import type { RawNodeData } from '../types/nodes';

/** The rails offered in the properties panel, and what each one supplies. */
export const POWER_RAIL_PRESETS: { rail: string; voltage: number }[] = [
  { rail: '+5V', voltage: 5 },
  { rail: '+3.3V', voltage: 3.3 },
  { rail: '+12V', voltage: 12 },
  { rail: '-12V', voltage: -12 },
  { rail: 'VCC', voltage: 5 },
  { rail: 'VEE', voltage: -5 },
];

export const DEFAULT_RAIL = '+5V';
export const DEFAULT_NET_LABEL = 'NET1';

/**
 * The name as it is written on the symbol and on the board: trimmed, upper
 * case, and never empty. Case is folded because `sda` and `SDA` are one net to
 * everyone except a string comparison.
 */
export function netDisplayName(raw: unknown, fallback: string): string {
  const s = String(raw ?? '').trim();
  return s ? s.toUpperCase() : fallback;
}

/**
 * The same name as a SPICE-safe token, which is also what the virtual port key
 * and the net id are built from.
 *
 * ngspice takes a node name apart on the punctuation a rail name is full of, so
 * the sign becomes a letter (`+5V` -> `P5V`, `-12V` -> `N12V`) and everything
 * else that is not a letter, a digit or an underscore becomes one underscore
 * (`+3.3V` -> `P3_3V`). A name that would start with a digit is prefixed, since
 * a bare number is a net number to SPICE.
 */
export function netKey(name: string): string {
  let s = name.trim().toUpperCase();
  let sign = '';
  if (s.startsWith('+')) { sign = 'P'; s = s.slice(1); }
  else if (s.startsWith('-')) { sign = 'N'; s = s.slice(1); }
  s = sign + s.replace(/[^A-Z0-9_]+/g, '_');
  s = s.replace(/^_+|_+$/g, '');
  if (!s) return 'NET';
  return /^[0-9]/.test(s) ? `N_${s}` : s;
}

const VIRTUAL_PORT_PREFIX = 'NAMEDNET~';

/** What a rail supplies: the node's own value, else the preset, else 0V. */
export function railVoltage(data: RawNodeData | undefined): number {
  const v = data?.voltage;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  const rail = netDisplayName(data?.rail, DEFAULT_RAIL);
  return POWER_RAIL_PRESETS.find(p => p.rail.toUpperCase() === rail)?.voltage ?? 0;
}

/** The name a net-label or power-rail node joins its pin to. */
export function nodeNetName(nodeType: string | undefined, data: RawNodeData | undefined): string | null {
  if (nodeType === 'netlabel') return netDisplayName(data?.net, DEFAULT_NET_LABEL);
  if (nodeType === 'powerrail') return netDisplayName(data?.rail, DEFAULT_RAIL);
  return null;
}

/**
 * The virtual port every symbol carrying `name` is joined to, in the same port
 * namespace as `GND-global`. The prefix ends in a `~`, which no node id can
 * contain, so `resolvePort` in pcbNets can tell a net from a pin.
 *
 * The port carries the name as written rather than its SPICE token, because
 * the board net wants to be called `+5V` on the drawing and in the exporter's
 * report - `netKey` is applied where an identifier is needed, not before.
 */
export function virtualNetPort(name: string): string {
  const display = netDisplayName(name, 'NET');
  // A label written GND is the ground net, not a net that happens to be called
  // GND - naming it anything else would give a circuit two grounds that never
  // meet. VSS is the same net under its other name.
  const key = netKey(display);
  if (key === 'GND' || key === 'GROUND' || key === 'VSS' || key === 'N_0') return 'GND-global';
  return `${VIRTUAL_PORT_PREFIX}${display}`;
}

/** True for a port that stands for a net rather than a pin on a part. */
export function isVirtualPortKey(key: string): boolean {
  return key === 'GND-global' || key.startsWith(VIRTUAL_PORT_PREFIX);
}

/** The display name back out of a virtual port key, for naming a board net. */
export function netNameFromVirtualPort(key: string): string | null {
  if (key === 'GND-global') return 'GND';
  if (!key.startsWith(VIRTUAL_PORT_PREFIX)) return null;
  return key.slice(VIRTUAL_PORT_PREFIX.length);
}

/** Node types that name a net and have no electrical behaviour of their own. */
export const NAMED_NET_TYPES = new Set(['netlabel', 'powerrail']);

/**
 * A net-label name that is free on this canvas.
 *
 * Labels connect by name, so seeding every one of them `NET1` would join each
 * new label to the last one dropped — an accidental short the moment a second
 * flag lands. Counting past the names already in use means a fresh label starts
 * on a net of its own and is renamed on purpose, not by necessity.
 */
export function nextNetLabelName(
  nodes: { type?: string; data?: RawNodeData }[],
): string {
  const used = new Set(
    nodes
      .filter(n => n.type === 'netlabel')
      .map(n => netDisplayName(n.data?.net, DEFAULT_NET_LABEL)),
  );
  for (let i = 1; ; i++) {
    const candidate = `NET${i}`;
    if (!used.has(candidate)) return candidate;
  }
}
