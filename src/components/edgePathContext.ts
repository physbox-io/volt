import { createContext } from 'react';

/**
 * The registry of drawn wire paths, plus which wire the pointer is over.
 *
 * It is a context object rather than a component, and a component file that
 * also exports one of those loses React Fast Refresh: every edit then reloads
 * the page, which resets the simulation and the circuit view mid-edit. The
 * provider that fills it is a component and stays in `AuraEdge.tsx`.
 */
export const EdgePathContext = createContext<{
  registerPath: (id: string, points: {x: number; y: number}[]) => void;
  unregisterPath: (id: string) => void;
  paths: Record<string, {x: number; y: number}[]>;
  hoveredEdgeId: string | null;
  setHoveredEdgeId: (id: string | null) => void;
} | null>(null);
