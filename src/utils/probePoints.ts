/**
 * Where a frequency sweep can be measured, and which of those to offer first.
 *
 * One entry per net, because a sweep measures a node and not a pin — but named
 * after a pin, because "the output of U1" is how someone says which node they
 * mean and `N7` is not.
 *
 * Extracted from the panel that shows it so the default can be argued with in a
 * test: opening Bode on a filter and being handed a flat line because the list
 * defaulted to the input node is the difference between a feature that answers
 * a question and one that has to be worked out first.
 */
import type { PinRef } from './spice';
import { pinLabel } from './erc';

/** Node types that emit a `V` card, and so can drive a sweep. */
export const AC_DRIVE_TYPES = new Set(['signalgen', 'acvoltage', 'voltage']);

const INSTRUMENT_TYPES = new Set(['scope', 'multimeter']);

/** Parts that drive a node rather than sit on it. */
const ACTIVE_TYPES = new Set([
  'opamp', 'timer555', 'dff', 'mcu', 'heltec_v4',
  'and', 'or', 'nand', 'nor', 'xor', 'not',
  'npn', 'pnp', 'nmos', 'pmos',
]);

/** The handles those parts drive out of. */
const DRIVING_HANDLES = new Set(['out', 'q', 'qbar', 'c', 'd', '3']);

/**
 * How good a pin's name is for the node it sits on.
 *
 * A node takes its name from whatever puts the signal there. The output of the
 * op-amp in a Sallen-Key filter is also the far end of the feedback capacitor,
 * and calling that node "C1 output" is technically true and useless — it is the
 * filter output, and the part that makes it so is the op-amp.
 */
function labelRank(nodeType: string, handleId: string): number {
  if (INSTRUMENT_TYPES.has(nodeType)) return 3;
  if (ACTIVE_TYPES.has(nodeType) && DRIVING_HANDLES.has(handleId)) return 0;
  if (handleId === 'out') return 1;
  return 2;
}

export type ProbePoint = { net: string; label: string };

/**
 * How good a guess a pin is at "the output".
 *
 * A scope's first channel is the strongest statement anyone makes about where
 * they are looking. Channel two is conventionally the reference it is being
 * compared against, so it is worth less than an ordinary pin rather than more.
 */
function pinRank(nodeType: string, handleId: string): number {
  if (nodeType === 'scope') return handleId === 'ch1' ? 0 : 3;
  if (nodeType === 'multimeter') return handleId === 'pos' ? 1 : 3;
  return 2;
}

/** How far a net carrying a source's own terminal is pushed down the list. */
const DRIVEN_PENALTY = 10;

export function buildProbePoints(pins: PinRef[], nameOf: (nodeId: string) => string): ProbePoint[] {
  const byNet = new Map<string, { rank: number; driven: boolean; label: string; labelRank: number }>();

  for (const pin of pins) {
    if (!pin.connected || pin.net === '0') continue;
    const name = `${nameOf(pin.nodeId)} ${pinLabel(pin.nodeType, pin.handleId)}`;
    const lr = labelRank(pin.nodeType, pin.handleId);
    const entry = byNet.get(pin.net) ?? { rank: 99, driven: false, label: name, labelRank: 99 };

    /*
     * Two separate judgements about the same net.
     *
     * Where it sorts comes from the best pin on it — a scope says which node is
     * being watched. What it is called comes from the part that puts the signal
     * there, which is usually a different pin: "SCOPE1 channel 1" names the
     * thing looking at the node, not the node.
     */
    entry.rank = Math.min(entry.rank, pinRank(pin.nodeType, pin.handleId));
    if (lr < entry.labelRank) {
      entry.labelRank = lr;
      entry.label = name;
    }
    /*
     * The source is a veto rather than a rank of its own. Measuring the
     * response at the generator measures the generator, and on any filter with
     * a series resistor that terminal shares a net with the resistor it feeds —
     * so a best-of-the-pins rank would let the resistor promote the input node
     * straight back to the top of the list.
     */
    if (AC_DRIVE_TYPES.has(pin.nodeType)) entry.driven = true;
    byNet.set(pin.net, entry);
  }

  return [...byNet.entries()]
    .map(([net, e]) => ({ net, label: e.label, rank: e.rank + (e.driven ? DRIVEN_PENALTY : 0) }))
    .sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label))
    .map(({ net, label }) => ({ net, label }));
}
