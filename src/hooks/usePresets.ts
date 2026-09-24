import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Node, Edge } from '@xyflow/react';
import { presets, DEFAULT_PRESET_KEY } from '../utils/presets';
import { upgradeLegacyLabels } from '../utils/legacyLabels';
import {
  loadUserPresets,
  addUserPreset,
  removeUserPreset,
  nameToKey,
  loadMachiningSettings,
  saveMachiningSettings,
  loadLayoutSnapshot,
  saveLayoutSnapshot,
  type CircuitPreset,
} from '../utils/storage';
import { applyCamSetup, loadCamSetup } from '../utils/pcbTooling';
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

  /**
   * Puts a circuit on the canvas, wherever it came from.
   *
   * Split out of `loadPreset` when links joined the dropdown as a way in: the
   * sequence below is the "apply a preset to the app" one this hook exists to
   * keep in a single place, and a shared circuit has no key to look up.
   */
  const applyPreset = useCallback((preset: CircuitPreset) => {
    stopSimulation();
    setInitialConditions({});
    setNodes(upgradeLegacyLabels(preset.nodes));
    setEdges(preset.edges);
    if (preset.recommendedSimLength) {
      setSimLength(preset.recommendedSimLength);
    }
    // Handed to the CAM tab through storage rather than through props: the
    // export dialog is mounted on demand and reads its settings when it opens,
    // so there is nothing to push them into at this point.
    if (preset.pcbOptions && Object.keys(preset.pcbOptions).length > 0) {
      saveMachiningSettings(preset.pcbOptions);
    }
    // And the choices those settings were derived from. Without these the
    // numbers arrive but the tool and the laminate do not, and the auto
    // isolation depth immediately recomputes itself from whatever this machine
    // was last set to.
    applyCamSetup(preset.camSetup);
    // And the board itself, if this circuit was ever laid out. Written
    // unconditionally so that opening a circuit that has no saved board also
    // takes the previous one away: the exporter would refuse to use it, but a
    // slot that describes a circuit nobody has open is just a board's worth of
    // storage held against the presets.
    saveLayoutSnapshot(preset.pcbLayout);
  }, [stopSimulation, setInitialConditions, setNodes, setEdges, setSimLength]);

  const loadPreset = useCallback((key: string) => {
    const preset = allPresets[key];
    if (!preset) return;
    applyPreset(preset);
    setSelectedPreset(key);
  }, [allPresets, applyPreset]);

  const handlePresetChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    loadPreset(e.target.value);
  }, [loadPreset]);

  /**
   * The circuit as it stands, in the shape a preset is stored in.
   *
   * One builder because a saved circuit, a cloud revision and a share link must
   * all carry the same thing — this was two identical copies in the two save
   * paths, and a third copy for sharing would be the one that quietly stopped
   * carrying the board settings.
   */
  const currentCircuit = useCallback((name: string): CircuitPreset => ({
    name,
    nodes: nodes.map(n => ({ ...n, selected: false })),
    edges: edges.map(e => ({
      ...e,
      data: e.data?.waypoints ? { waypoints: e.data.waypoints } : undefined
    })),
    // The board is milled with the trace width and clearance it was routed
    // for, so the CAM settings travel with the circuit rather than being
    // re-derived every time it is opened.
    pcbOptions: loadMachiningSettings(),
    // The bit, the laminate and the auto-depth switch behind those numbers.
    camSetup: loadCamSetup(),
    // The board as it was placed and routed, so a design laid out on a fast
    // machine is milled from a slow one rather than re-searched there.
    pcbLayout: loadLayoutSnapshot(),
    // Saving over a preset keeps its note card. There is no way to write one
    // from the save dialog, so rebuilding the preset without it meant pressing
    // Save silently threw away the card the preset opened with.
    noteCard: loadUserPresets()[nameToKey(name.replace(/^User:\s*/, ''))]?.noteCard,
  }), [nodes, edges]);

  const savePreset = useCallback(() => {
    const trimmed = saveDialogName.trim();
    if (!trimmed) return;
    const key = nameToKey(trimmed);
    const preset = currentCircuit(`User: ${trimmed}`);
    const updated = addUserPreset(key, preset);
    setUserPresets(updated);
    // A deliberate save is also a named revision of the cloud document, which the
    // pruner never discards — unlike the automatic checkpoints.
    void cloudAutosave.saveExplicit(trimmed, preset, `Saved as “${trimmed}”`);
    setSelectedPreset(key);
    setIsSaveDialogOpen(false);
    setSaveDialogName('');
  }, [saveDialogName, currentCircuit]);

  const savePresetByName = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const key = nameToKey(trimmed);
    const preset = currentCircuit(`User: ${trimmed}`);
    const updated = addUserPreset(key, preset);
    setUserPresets(updated);
    void cloudAutosave.saveExplicit(trimmed, preset, `Saved as “${trimmed}”`);
    setSelectedPreset(key);
  }, [currentCircuit]);

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
    applyPreset,
    currentCircuit,
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
