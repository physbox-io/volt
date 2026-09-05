import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Node, Edge } from '@xyflow/react';
import { presets, DEFAULT_PRESET_KEY } from '../utils/presets';
import {
  loadUserPresets,
  addUserPreset,
  removeUserPreset,
  nameToKey,
  loadMachiningSettings,
  saveMachiningSettings,
  type CircuitPreset,
} from '../utils/storage';
import { PRESETS_UPDATED_EVENT } from '../utils/cloudSync';
import { cloudAutosave } from '../utils/cloudDocuments';

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

  /*
   * Presets are seeded from localStorage once, so a sign-in that merges the
   * account's circuits in behind this state would change nothing on screen until a
   * reload. `mergePulledPresets` announces itself; this is the ear.
   */
  useEffect(() => {
    const reread = () => setUserPresets(loadUserPresets());
    window.addEventListener(PRESETS_UPDATED_EVENT, reread);
    return () => window.removeEventListener(PRESETS_UPDATED_EVENT, reread);
  }, []);

  const allPresets: Record<string, CircuitPreset> = useMemo(
    () => ({ ...presets, ...userPresets }),
    [userPresets]
  );

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
    // Handed to the CAM tab through storage rather than through props: the
    // export dialog is mounted on demand and reads its settings when it opens,
    // so there is nothing to push them into at this point.
    if (preset.pcbOptions && Object.keys(preset.pcbOptions).length > 0) {
      saveMachiningSettings(preset.pcbOptions);
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
      // The board is milled with the trace width and clearance it was routed
      // for, so the CAM settings travel with the circuit rather than being
      // re-derived every time it is opened.
      pcbOptions: loadMachiningSettings(),
    };
    const updated = addUserPreset(key, preset);
    setUserPresets(updated);
    // A deliberate save is also a named revision of the cloud document, which the
    // pruner never discards — unlike the automatic checkpoints.
    void cloudAutosave.saveExplicit(trimmed, preset, `Saved as “${trimmed}”`);
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
      // The board is milled with the trace width and clearance it was routed
      // for, so the CAM settings travel with the circuit rather than being
      // re-derived every time it is opened.
      pcbOptions: loadMachiningSettings(),
    };
    const updated = addUserPreset(key, preset);
    setUserPresets(updated);
    void cloudAutosave.saveExplicit(trimmed, preset, `Saved as “${trimmed}”`);
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
