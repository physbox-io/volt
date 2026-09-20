import { createContext, useContext } from 'react';
import { getNodeDefaultName } from '../../utils/nodeNaming';

/**
 * Every part's reference designator, keyed by node id.
 *
 * Numbering is per letter across the whole canvas, so no symbol can work its
 * own out from its own props — R3 is only R3 relative to the other resistors.
 * App computes the table once and puts it here; a symbol reads its own name out
 * of it, and a canvas rendered without the provider (a test, a preview) falls
 * back to the id-derived name rather than showing nothing.
 */
export const DesignatorContext = createContext<Record<string, string>>({});

/** This part's designator: a hand-set name wins, then the canvas-wide table. */
export function useDesignator(id: string, type: string, name?: unknown): string {
  const table = useContext(DesignatorContext);
  if (typeof name === 'string' && name.trim()) return name.trim();
  return table[id] ?? getNodeDefaultName(id, type);
}
