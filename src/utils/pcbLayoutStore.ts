/**
 * The saved board, and the one rule for using it.
 *
 * Laying a board out is a search against a wall-clock budget, so it answers
 * differently on different hardware — which is why a decided board is worth
 * saving and carrying between machines rather than re-deriving. Everything
 * that needs a board goes through here so that saving one is not a feature of
 * the export dialog: an agent milling over MCP gets the same board the panel
 * shows, laid out once, wherever it was laid out.
 *
 * The rule is that a snapshot is only ever used when it fingerprints as the
 * board currently on the canvas, under the settings currently asked for.
 * `restorePcbLayout` enforces that and returns null otherwise; this module
 * never second-guesses it, and the fallback is always to route.
 */

import type { Edge, Node } from '@xyflow/react';
import {
  restorePcbLayout,
  type PcbLayoutResult,
  type PcbOptions,
} from './pcbExporter';
import { layoutWithOverrides } from './pcbNudge';
import { loadLayoutSnapshot, loadMachiningSettings } from './storage';

/**
 * The board on the canvas: the saved one if it is still the same board, and a
 * freshly routed one if it is not.
 *
 * `options` is spread over the machining settings rather than replacing them,
 * so a caller overriding one figure still gets the board the user set up.
 */
export function layoutForCircuit(
  nodes: Node[],
  edges: Edge[],
  overrides?: Partial<PcbOptions>
): PcbLayoutResult {
  const options = { ...loadMachiningSettings(), ...overrides };
  const restored = restorePcbLayout(loadLayoutSnapshot(), nodes, edges, options);
  return restored ?? layoutWithOverrides(nodes, edges, options);
}
