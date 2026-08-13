import { useCallback, useState } from 'react';
import type { Node, Edge } from '@xyflow/react';
import { presets, DEFAULT_PRESET_KEY } from '../utils/presets';
import { loadUserPresets, addUserPreset, removeUserPreset, nameToKey, type CircuitPreset } from '../utils/storage';

interface UsePresetsArgs {
  nodes: Node[];
  edges: Edge[];
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  setInitialConditions: (ic: Record<string, number>) => void;
  setSimLength: (len: number) => void;
  stopSimulation: () => void;
}

/** Owns preset selection/loading so the "apply preset to state" sequence exists in exactly one place instead of being copy-pasted at every call site. */
export function usePresets({ nodes, edges, setNodes, setEdges, setInitialConditions, setSimLength, stopSimulation }: UsePresetsArgs) {
  const [selectedPreset, setSelectedPreset] = useState(DEFAULT_PRESET_KEY);
  const [userPresets, setUserPresets] = useState<Record<string, CircuitPreset>>(() => loadUserPresets());
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
  const [saveDialogName, setSaveDialogName] = useState('');

  const allPresets: Record<string, CircuitPreset> = { ...presets, ...userPresets };

  const loadPreset = useCallback((key: string) => {
    const preset = allPresets[key];
    if (!preset) return;
    stopSimulation();
    setInitialConditions({});
    setNodes(preset.nodes);
    setEdges(preset.edges);
    setSelectedPreset(key);
    if (preset.recommendedSimLength) {
      setSimLength(preset.recommendedSimLength);
    }
  }, [allPresets, stopSimulation, setInitialConditions, setNodes, setEdges, setSimLength]);

  const handlePresetChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    loadPreset(e.target.value);
  }, [loadPreset]);

  const savePreset = useCallback(() => {
    const trimmed = saveDialogName.trim();
    if (!trimmed) return;
    const key = nameToKey(trimmed);
    const preset: CircuitPreset = {
      name: `User: ${trimmed}`,
      nodes: nodes.map(n => ({ ...n, selected: false })),
      edges: edges.map(e => ({
        ...e,
        data: (e.data as any)?.waypoints ? { waypoints: (e.data as any).waypoints } : undefined
      })),
    };
    const updated = addUserPreset(key, preset);
    setUserPresets(updated);
    setSelectedPreset(key);
    setIsSaveDialogOpen(false);
    setSaveDialogName('');
  }, [saveDialogName, nodes, edges]);

  const savePresetByName = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const key = nameToKey(trimmed);
    const preset: CircuitPreset = {
      name: `User: ${trimmed}`,
      nodes: nodes.map(n => ({ ...n, selected: false })),
      edges: edges.map(e => ({
        ...e,
        data: (e.data as any)?.waypoints ? { waypoints: (e.data as any).waypoints } : undefined
      })),
    };
    const updated = addUserPreset(key, preset);
    setUserPresets(updated);
    setSelectedPreset(key);
  }, [nodes, edges]);

  const deleteUserPreset = useCallback((key: string) => {
    const updated = removeUserPreset(key);
    setUserPresets(updated);
    if (selectedPreset === key) {
      loadPreset(DEFAULT_PRESET_KEY);
    }
  }, [selectedPreset, loadPreset]);

  return {
    selectedPreset,
    userPresets,
    allPresets,
    loadPreset,
    handlePresetChange,
    isSaveDialogOpen,
    setIsSaveDialogOpen,
    saveDialogName,
    setSaveDialogName,
    savePreset,
    savePresetByName,
    deleteUserPreset,
  };
}
