import { useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';

/**
 * Numeric fields the netlist builder reads in preference to a part's label.
 * Presets write them alongside the label ("1kΩ" plus resistance: 1000), so a
 * new label that left them in place changed the text on the schematic and
 * nothing in the simulation.
 */
export const LABEL_OVERRIDE_KEYS = ['voltage', 'resistance', 'capacitance', 'inductance'] as const;

/** Sets a node's value label and drops the overrides that would shadow it. */
export function useRelabel(id: string) {
  const { setNodes } = useReactFlow();
  return useCallback((label: string) => {
    setNodes(nds => nds.map(n => {
      if (n.id !== id) return n;
      const data: Record<string, unknown> = { ...n.data, label };
      for (const k of LABEL_OVERRIDE_KEYS) delete data[k];
      return { ...n, data };
    }));
  }, [id, setNodes]);
}
