import React, { useState, useMemo, useEffect } from 'react';
import { loadMachiningSettings, saveMachiningSettings, saveLayoutSnapshot } from '../utils/storage';
import type { Node, Edge } from '@xyflow/react';
import {
  X,
  Cpu,
  Play,
  Layers,
  Check,
  RefreshCw,
  AlertTriangle,
  ShieldCheck,
  Box,
  Scissors,
  Layers2,
  Archive,
  Star,
  Plug,
  Settings2,
  Map,
  Move3d,
  Undo2,
  Package,
} from 'lucide-react';
import {
  generateAirCutPerimeterGcode,
  calculateSuggestedBoardSize,
  groupDrillsByBit,
  DEFAULT_PCB_OPTIONS,
  type PcbOptions,
  type Rotation,
} from '../utils/pcbExporter';
import { coreFrameMove, nudgeLayout } from '../utils/pcbNudge';
import { PcbPlacementOverlay } from './PcbPlacementOverlay';
import { generateGerberZip } from '../utils/gerberExporter';
import { isProAccount } from '../utils/apiClient';
import { cloudAutosave } from '../utils/cloudDocuments';
import { pcbJobName, pcbRunSettings } from '../utils/pcbRunSettings';
import {
  PCB_MATERIAL_PRESETS,
  calculatePcbFeeds,
  addCustomTool,
  retireRackTool,
  readToolRack,
  toolRackStore,
  toolChoices,
  canonicalToolId,
  findToolIn,
  suggestedChiploadMm,
  feedFromChipload,
  minIsolationChannelMm,
  autoIsolationDepthMm,
  bottomIsolationDepthMm,
  isolationFlatnessAllowanceMm,
  loadSelectedMaterialId,
  saveSelectedMaterialId,
  loadSelectedToolIds,
  saveSelectedToolId,
  loadAutoIsolationDepth,
  saveAutoIsolationDepth,
  type PcbToolPreset,
  type ToolType,
  type CustomToolInput,
} from '../utils/pcbTooling';
import {
  generatePasteStencilStl,
  generatePasteShimStl,
  pasteStencilSvg,
  DEFAULT_PASTE_STENCIL_OPTIONS,
  DEFAULT_PASTE_SHIM_OPTIONS,
} from '../utils/pcbPasteStencil';
import { openSvgInEtch } from '../utils/etchHandoff';
import { layoutToMeshSpec, openPcbInMesh } from '../utils/meshPcbHandoff';
import { usePcbLayout } from '../hooks/usePcbLayout';
import { webSerialManager } from '../utils/webSerialManager';
import { NumberInput, readMachineLink, setMachineLink, setTouchPlateMm, useSafetyGate, useTouchPlateMm } from '@physbox-io/ui';
import {
  getGridStats,
  suggestProbeGrid,
  interpolateGridZ,
  type ProbeGrid,
} from '../utils/meshLeveler';
import { setActiveHeightmap } from '../utils/machineMcp';
import { heightmapCoversBoard } from '../utils/boardLevelling';
import { PcbToolpathPreview } from './PcbToolpathPreview';
import { InfoTip } from './InfoTip';
import { PanZoomContainer } from './PanZoomContainer';
import { MachineConnectModal } from './MachineConnectModal';
import { JobOverrides } from './JobOverrides';
import { BoardMapPanel } from './BoardMapPanel';
import { RunFromPanel } from './RunFromPanel';
import { runFromView } from '../utils/runFrom';

/** Stable empty inputs for machine-only mode — see the layout call. */
const EMPTY_NODES: Node[] = [];
const EMPTY_EDGES: Edge[] = [];

/**
 * What each of the three stencil buttons makes. Long enough to matter on a
 * tooltip: people reach for a "solder mask" expecting the green lacquer, and
 * these are three routes to a paste stencil — a sheet you squeegee through and
 * then take off again.
 */
const PASTE_STENCIL_HINT =
  `Download ${DEFAULT_PASTE_STENCIL_OPTIONS.thicknessMm}mm 3D-printable SMD paste stencil (.stl) for ≥1.27mm pitch.`;

const ETCH_HINT =
  'Open paste stencil in Etch for laser cutting (use dark stock for diode lasers; never PVC).';

const SHIM_HINT =
  `Download blank ${DEFAULT_PASTE_SHIM_OPTIONS.thicknessMm}mm shim (.stl) — print 1 layer in black PLA to laser-cut a stencil.`;

/** Search distance for a mesh probe point, measured down from the retract. */
const DEFAULT_PROBE_DEPTH_MM = 3;
/** Thickness of the touch plate used to set work Z0. */

/**
 * Reads a persisted machine setting. These are bench measurements — plate
 * thickness, retract height — that belong to the machine rather than to any
 * one board, so they survive both the modal closing and a page reload.
 * A stored value that is not a finite positive number is ignored: a bad
 * thickness silently zeroes Z in the wrong place.
 */
/**
 * The message off whatever was thrown, read by shape rather than through
 * `instanceof Error`. Everything caught in this file comes back from the
 * serial layer or from an exporter, and a controller alarm or a rejected
 * fetch arrives as a plain object; `instanceof` would drop its text and
 * leave the panel showing the generic fallback for a fault it could name.
 */
function errorMessage(e: unknown): string | undefined {
  return (e as { message?: string } | null | undefined)?.message;
}

function readNumericSetting(key: string, fallback: number): number {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  const value = parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

interface ExportPcbModalProps {
  onClose: () => void;
  nodes?: Node[];
  edges?: Edge[];
  /**
   * Show only the machine dialog, with no export panel behind it.
   *
   * There are two doors into this component and they are opened for different
   * reasons. The print icon means "look at my board"; the spanner beside the
   * machine status in the status bar means "the machine needs seeing to". The
   * spanner should not raise the board panel at all — it is not what was being
   * asked about, and a full-screen layout dialog sitting behind a small one is
   * just something in the way.
   *
   * The layout itself is still computed, because the machine controls need it:
   * Frame traces this board's outline and the mesh probe samples inside it.
   * It runs in a worker either way, so nothing is blocked waiting for it.
   */
  machineOnly?: boolean;
}

export const ExportPcbModal: React.FC<ExportPcbModalProps> = ({
  onClose,
  nodes = [],
  edges = [],
  machineOnly = false,
}) => {
  const [rawOptions, setOptions] = useState<PcbOptions>(() => {
    return {
      ...DEFAULT_PCB_OPTIONS,
      // Deliberately NOT seeded from calculateSuggestedBoardSize: with auto-size
      // on (the default) these two are a floor, and seeding them with a padded
      // estimate stopped the board ever cropping down to the copper. The
      // estimate is still what "Fit to circuit" offers in fixed-size mode.
      boardWidthMm: DEFAULT_PCB_OPTIONS.boardWidthMm,
      boardHeightMm: DEFAULT_PCB_OPTIONS.boardHeightMm,
      // Whatever this board was last set up with — trace width, clearances,
      // feeds, depths — including anything a loaded preset brought with it.
      // Spread over the defaults so a setting added since a preset was saved
      // still arrives at its default rather than as undefined.
      ...loadMachiningSettings(),
      // Retract height is a property of the bench, not of this board, so the
      // saved one wins over both.
      safeZ: readNumericSetting('grblSafeZMm', DEFAULT_PCB_OPTIONS.safeZ),
    };
  });

  // Persisted as they change, so closing the dialog does not discard them and
  // so saving a preset picks up what is on screen now.
  useEffect(() => {
    saveMachiningSettings(rawOptions);
  }, [rawOptions]);

  // A job put back from before a reload opens where its Run From is.
  const [activeTab, setActiveTab] = useState<'layout' | 'cam'>(() =>
    webSerialManager.getState().interruption?.restored ? 'cam' : 'layout'
  );
  /**
   * The bench, in its own dialog rather than as a third tab. It has to be able
   * to sit over either view: the reason to jog is usually something you can see
   * on the toolpath, and a tab took the board away to show you the keypad.
   */
  /**
   * The machine dialog raised from this panel's own Connect button. In
   * machine-only mode the dialog *is* the component, so it is derived below
   * rather than seeded into state — seeding it left the two out of step if the
   * mode ever changed under a live mount.
   */
  const [panelMachineOpen, setPanelMachineOpen] = useState(false);
  const showMachine = machineOnly || panelMachineOpen;
  /**
   * A single-sided board is milled copper-up and assembled from the other face,
   * so the two jobs need mirror-image pictures. Defaulting to the copper side
   * keeps the preview matching the blank on the bed; the component side is what
   * you hold a module against to check which hole is pin 1.
   */
  const [viewSide, setViewSide] = useState<'copper' | 'component' | 'bottom' | 'composite'>('copper');
  const [showPadNumbers, setShowPadNumbers] = useState(true);
  const [serialState, setSerialState] = useState(webSerialManager.getState());

  const safetyGate = useSafetyGate('grblSafetyAck');
  /**
   * How far the tool searches downward for the copper on each probe point, as
   * a travel distance from the retract height. It has to clear the retract plus
   * however far the blank sags — too short and the probe runs out of travel
   * without touching, which GRBL reports as ALARM:5.
   */
  const [probeDepthMm, setProbeDepthMm] = useState<number>(() =>
    readNumericSetting('grblProbeDepthMm', DEFAULT_PROBE_DEPTH_MM)
  );
  /**
   * Thickness of the conductive touch plate, in mm. After the tool touches the
   * top of the plate, work Z0 is set to this height — so it has to match the
   * plate actually on the bench, or every cut is off by the difference.
   */
  const touchPlateMm = useTouchPlateMm();
  const [busy, setBusy] = useState<'' | 'probing' | 'zeroing' | 'milling' | 'framing' | 'homing'>('');
  const [machineError, setMachineError] = useState<string | null>(null);
  /** Last word from the stencil export — the file written, or why not. */
  const [stencilNote, setStencilNote] = useState<string | null>(null);
  /** Last word from the Gerber export — the zip written, or the Pro upsell. */
  const [gerberNote, setGerberNote] = useState<string | null>(null);
  const [showGerberUpsell, setShowGerberUpsell] = useState(false);
  /**
   * Which footer button is currently hovered/focused, so its one-line
   * explanation can fill the fixed-height status slot next to the buttons.
   * The row's own height never changes with this — a message replacing the
   * message above it, not new height appearing under the buttons — which is
   * the whole reason the slot has a fixed height rather than growing to fit.
   */
  const [hoveredFooterHint, setHoveredFooterHint] = useState<string | null>(null);
  const [heightmap, setHeightmap] = useState<ProbeGrid | null>(null);

  /*
   * The bits this board is cut with, remembered rather than reset.
   *
   * These were component state seeded with a constant, so closing the dialog
   * put the 30-degree V-bit and the 1.5mm end mill back every time — and with
   * them the feeds, speeds and depths the pickers derive on change. They are
   * also what a saved circuit now carries, so the board opens on another
   * machine set up the way it was milled.
   */
  const [selectedToolId, setSelectedToolId] = useState<string>(() => loadSelectedToolIds().isolation);
  const [profileToolId, setProfileToolId] = useState<string>(() => loadSelectedToolIds().profile);
  /*
   * The shared rack the pickers offer from. Subscribed rather than read once:
   * the Tools dialog edits it from over this panel, and a bit added there
   * should be on the picker when it closes.
   */
  const [rack, setRack] = useState(() => readToolRack());
  useEffect(() => toolRackStore.subscribe(setRack), []);
  const [showToolEditor, setShowToolEditor] = useState(false);
  const [toolDraft, setToolDraft] = useState<CustomToolInput>({
    name: '',
    type: 'vbit',
    tipDiameterMm: 0.1,
    angleDeg: 30,
    fluteCount: 1,
    recommendedRpm: 12000,
  });
  const [selectedMaterialId, setSelectedMaterialId] = useState<string>(loadSelectedMaterialId);
  /**
   * When on, the isolation depth is derived from the copper thickness and the
   * board's measured flatness instead of the tool catalogue's blanket figure.
   * Shallower means a narrower channel from a V-bit, which is copper kept.
   */
  const [autoIsolationDepth, setAutoIsolationDepth] = useState<boolean>(loadAutoIsolationDepth);
  const [jogStep, setJogStep] = useState<number>(1.0);

  /*
   * How the machine is reached: a USB cable to this computer, or a Tekno Box
   * over WiFi. Shared with the other PhysBox apps and saved only on connect:
   * every app reconnects to it at launch, so a tab merely looked at must not
   * become what they all dial.
   */
  const [transportMode, setTransportMode] = useState<'usb' | 'wifi'>(() =>
    readMachineLink().kind === 'cloud' ? 'wifi' : 'usb'
  );
  const [cloudDeviceId, setCloudDeviceId] = useState(() => readMachineLink().deviceId ?? '');


  React.useEffect(() => {
    return webSerialManager.addListener(state => {
      setSerialState(state);
    });
  }, []);

  /**
   * Wipes the slate before an operation that is about to produce its own
   * verdict.
   *
   * `serialState.lastError` is written by an alarm or a refused line and then
   * simply left standing — nothing in the protocol layer ever retracts it — so
   * one failed probe kept a red banner up through every successful thing that
   * followed, which is most of the "random errors" this panel showed. Clearing
   * it as the next action starts is the moment it stops describing anything.
   */
  const clearErrors = () => {
    setMachineError(null);
    webSerialManager.clearLastError();
  };

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !panelMachineOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, panelMachineOpen]);

  /*
   * The ids the pickers show. A selection stored before the rack — or the
   * default, or one a saved circuit brought — names a catalogue bit; when the
   * rack holds that bit it is the rack's entry that is shown and planned with.
   */
  const isolationToolId = canonicalToolId(rack, 'isolation', selectedToolId);
  const outlineToolId = canonicalToolId(rack, 'profile', profileToolId);
  const isolationChoices = useMemo(() => toolChoices(rack, 'isolation', isolationToolId), [rack, isolationToolId]);
  const profileChoices = useMemo(() => toolChoices(rack, 'profile', outlineToolId), [rack, outlineToolId]);
  // Memoised: a rack tool is mapped afresh on every lookup, and these feed the
  // options object the layout worker is keyed on — a new object per render
  // would re-plan the board on every render.
  const selectedTool = useMemo(() => findToolIn(rack, isolationToolId), [rack, isolationToolId]);

  /**
   * Flatness taken from the last probe, whether or not it still matches this
   * board's size. The span is a property of the stock and the spoilboard, not
   * of the layout, so a stale map is still the best estimate available — and
   * reading it from the raw map keeps the depth from oscillating: the depth
   * changes the channel width, which changes the auto-sized board, which would
   * otherwise invalidate the map that set the depth in the first place.
   */
  const [heightmapDatumEpoch, setHeightmapDatumEpoch] = useState<number | undefined>(undefined);
  if (heightmap !== null && serialState.datumEpoch !== heightmapDatumEpoch) {
    setHeightmap(null);
    setHeightmapDatumEpoch(undefined);
  }
  const [staleMapIgnored, setStaleMapIgnored] = useState(false);
  const probedSpanZ = useMemo(
    () => (heightmap && !staleMapIgnored ? getGridStats(heightmap).spanZ : undefined),
    [heightmap, staleMapIgnored]
  );

  /**
   * Depth taken from what is actually being cut rather than the catalogue's
   * blanket figure: copper thickness plus the room the board's own flatness
   * demands.
   */
  const autoDepthZ = useMemo(() => {
    const material = PCB_MATERIAL_PRESETS.find(m => m.id === selectedMaterialId);
    if (!selectedTool || !material) return null;
    return autoIsolationDepthMm(
      selectedTool,
      material,
      isolationFlatnessAllowanceMm(probedSpanZ)
    );
  }, [selectedTool, selectedMaterialId, probedSpanZ]);

  /**
   * What everything downstream sees. The auto depth is layered on here instead
   * of being written back into state by an effect: state that syncs itself to
   * other state costs a second render every time either side moves, and leaves
   * two places that both believe they own the number. Editing any other field
   * spreads this object, so switching Auto off simply leaves the depth where
   * Auto had it — which is where a hand edit wants to start from.
   */
  const profileTool = useMemo(() => findToolIn(rack, outlineToolId), [rack, outlineToolId]);
  const spindleMaxRpm = serialState.connected ? webSerialManager.getGrblSetting(30) : undefined;
  const spindleMinRpm = serialState.connected ? webSerialManager.getGrblSetting(31) : undefined;
  const options: PcbOptions = useMemo(() => {
    const depthed =
      autoIsolationDepth && autoDepthZ !== null
        ? { ...rawOptions, isolationDepthZ: autoDepthZ }
        : rawOptions;
    const material = PCB_MATERIAL_PRESETS.find(m => m.id === selectedMaterialId);
    return {
      ...depthed,
      // A map levels the top face only; the bottom of a double-sided board is
      // cut unlevelled, so it must not inherit a depth the map shaved down.
      bottomIsolationDepthZ:
        depthed.layers === 2 && probedSpanZ !== undefined && selectedTool && material
          ? bottomIsolationDepthMm(depthed.isolationDepthZ, selectedTool, material)
          : undefined,
      // Each bit at its own speed, capped to what the controller can do — see
      // toolSpindle in the exporter.
      profileSpindleRpm: profileTool?.recommendedRpm,
      spindleLimitsRpm:
        spindleMaxRpm !== undefined || spindleMinRpm !== undefined
          ? { maxRpm: spindleMaxRpm, minRpm: spindleMinRpm }
          : undefined,
    };
  }, [
    rawOptions,
    autoIsolationDepth,
    autoDepthZ,
    probedSpanZ,
    selectedTool,
    selectedMaterialId,
    profileTool,
    spindleMaxRpm,
    spindleMinRpm,
  ]);

  /*
   * Routing runs in a worker: a dense board takes seconds, and blocking the
   * main thread for that long makes the whole editor feel broken.
   *
   * Skipped altogether in machine-only mode. Nothing in the machine dialog is
   * about a board any more — framing and probing both moved to the CAM tab
   * with the outline they need — so reaching the bench through the spanner
   * should not start a place-and-route nobody is going to look at.
   *
   * `enabled` is what skips it. Handing the hook empty arrays, which is what
   * this did before, still spawned a worker and still routed — a board with
   * nothing on it, but a real run all the same. The empty arrays stay because
   * they keep the hook's own bookkeeping cheap: the payload it builds walks
   * and sanitizes every node and then stringifies the lot, on every render.
   */
  const layoutNodes = machineOnly ? EMPTY_NODES : nodes;
  const layoutEdges = machineOnly ? EMPTY_EDGES : edges;
  const { result, isRouting, progress, hasResult, effortStep, effortSteps } = usePcbLayout(
    layoutNodes,
    layoutEdges,
    options,
    { enabled: !machineOnly }
  );

  /**
   * Moving a part on the board, without laying the board out again.
   *
   * The move is applied to the routed board directly — only the nets the part
   * touches are ripped up and routed again — and the result is written to the
   * layout slot before the options are updated. The hook then finds a snapshot
   * that fingerprints as the board it is being asked for and restores it, so
   * the board on screen is the board the drag produced rather than a fresh
   * place-and-route that would move everything else with it.
   */
  const [placementNote, setPlacementNote] = useState<string | null>(null);
  const handPlacedCount = Object.keys(options.placementOverrides || {}).length;

  const moveComponent = (
    componentId: string,
    xMm: number,
    yMm: number,
    rotationDeg: Rotation
  ) => {
    const moved = nudgeLayout(
      result,
      layoutNodes,
      layoutEdges,
      options,
      // The preview of a single-sided board is the mirror of the board the
      // layout holds, so what was dragged has to be reflected back first.
      coreFrameMove(result.boardWidthMm, options, { componentId, xMm, yMm, rotationDeg })
    );
    if (!moved.result) {
      setPlacementNote(moved.reason);
      return;
    }
    setPlacementNote(null);
    saveLayoutSnapshot(moved.result.snapshot);
    setOptions(prev => ({ ...prev, placementOverrides: moved.options.placementOverrides }));
  };

  /** Back to the board the router decided, for every part. */
  const clearHandPlacement = () => {
    setPlacementNote(null);
    setOptions(prev => ({ ...prev, placementOverrides: undefined }));
  };

  const suggestedGrid = useMemo(() => {
    const w = hasResult && result.boardWidthMm > 0 ? result.boardWidthMm : options.boardWidthMm;
    const h = hasResult && result.boardHeightMm > 0 ? result.boardHeightMm : options.boardHeightMm;
    return suggestProbeGrid(w, h, 4, 8);
  }, [hasResult, result.boardWidthMm, result.boardHeightMm, options.boardWidthMm, options.boardHeightMm]);

  const errorCount = result.violations.filter(v => v.severity === 'error').length;
  const coversBoard = heightmapCoversBoard(heightmap, result);

  const activeHeightmap = coversBoard ? heightmap : null;
  const heightmapStale = heightmap !== null && activeHeightmap === null;

  // When a saved heightmap no longer covers the board, drop its span from
  // `autoDepthZ` automatically so the unlevelled depth is used without blocking
  // the user with an error banner.
  const wantStaleIgnored = heightmap !== null && heightmapStale;
  if (staleMapIgnored !== wantStaleIgnored) {
    setStaleMapIgnored(wantStaleIgnored);
  }

  const gridStats = activeHeightmap ? getGridStats(activeHeightmap) : null;

  /*
   * Hand the live map to the MCP side, so a board milled from a conversation is
   * levelled against the same probe the Mill button here would have used. A map
   * that no longer covers the board is published as null rather than withheld:
   * the agent's mill path has to see it go away, or it would go on assuming a
   * compensation that is not being applied.
   */
  useEffect(() => {
    setActiveHeightmap(activeHeightmap);
  }, [activeHeightmap]);

  /**
   * What the machine measured about itself, in the units the depth budget is
   * spent in.
   *
   * `verifyDeviationMm` is the mesh re-probing the point it started on;
   * `zeroZScatterMm` is the gap between the fast and slow stabs of the last Z
   * zeroing. Both are error the height map cannot remove — it compensates the
   * board's shape, not the probe's aim — so they eat directly into the margin
   * between the isolation depth and the copper.
   */
  const machineAccuracy = [
    activeHeightmap?.verifyDeviationMm !== undefined
      ? `${activeHeightmap.verifyDeviationMm.toFixed(3)}mm re-probe`
      : null,
    serialState.zeroZScatterMm !== undefined
      ? `${serialState.zeroZScatterMm.toFixed(3)}mm zero`
      : null,
  ].filter(Boolean) as string[];

  /**
   * Poor against the margin this job actually has, not against a fixed figure:
   * a deep cut in thin foil can absorb scatter that a shallow one cannot.
   */
  const copperMm =
    (PCB_MATERIAL_PRESETS.find(m => m.id === selectedMaterialId)?.copperThicknessUm ?? 35) / 1000;
  const depthMargin = Math.abs(options.isolationDepthZ) - copperMm;
  const accuracyIsPoor = [
    activeHeightmap?.verifyDeviationMm,
    serialState.zeroZScatterMm,
  ].some(v => v !== undefined && v > depthMargin * 0.5);

  /**
   * The one machine failure worth a banner.
   *
   * `serialState.lastError` is the machine's own last word and is never
   * retracted by the protocol layer, so it is shown only until the operator
   * dismisses it or starts the next action (see `clearErrors`) — otherwise a
   * single bad probe sat in red over every good job that followed it.
   */
  const machineNote = machineError ?? serialState.lastError ?? null;

  /**
   * A straight-walled cutter has no included angle, so the V-bit width formula
   * does not apply to it. Feeding the exporter an angle of 0 makes its
   * effective-width calculation collapse to the tip diameter, which is exactly
   * right for an engraver or endmill.
   */
  const toolAngleForExport = (tool: PcbToolPreset) =>
    tool.type === 'vbit' || tool.type === 'ballnose' ? (tool.angleDeg ?? 30) : 0;

  const handleToolPresetChange = (toolId: string) => {
    setSelectedToolId(toolId);
    saveSelectedToolId('isolation', toolId);
    const tool = findToolIn(readToolRack(), toolId);
    const material = PCB_MATERIAL_PRESETS.find(m => m.id === selectedMaterialId);
    if (tool && material) {
      const feeds = calculatePcbFeeds(tool, material);
      setOptions(prev => ({
        ...prev,
        vBitAngleDeg: toolAngleForExport(tool),
        vBitTipMm: tool.tipDiameterMm,
        cutFeedrate: feeds.cutFeedrate,
        plungeFeedrate: feeds.plungeFeedrate,
        spindleRpm: feeds.spindleRpm,
        isolationDepthZ: feeds.isolationDepthZ,
        zStepdown: feeds.zStepdown,
      }));
    }
  };

  /**
   * The profile bit only decides the outline kerf and how deep each pass may
   * go. Isolation feeds come from the isolation bit, so they are deliberately
   * left alone here — picking a bigger endmill should not slow the engraving.
   */
  const handleProfileToolChange = (toolId: string) => {
    setProfileToolId(toolId);
    saveSelectedToolId('profile', toolId);
    const tool = findToolIn(readToolRack(), toolId);
    if (!tool) return;
    setOptions(prev => ({
      ...prev,
      profileToolDiaMm: tool.tipDiameterMm,
      zStepdown: tool.maxStepdownMm ?? prev.zStepdown,
    }));
  };

  /**
   * Bits this board actually needs, in the order the job runs them. The drill
   * rows come from the holes the layout produced, so they change with the
   * circuit rather than being a fixed list.
   */
  const requiredBits = useMemo(() => {
    const groups = groupDrillsByBit(
      result.drills ?? [],
      options.drillConsolidationMm ?? 0
    );
    return groups.map(g => ({
      requiredMm: g.bitMm,
      nominals: g.nominals,
      holeCount: g.holes.length,
      loadedMm: options.drillBitOverridesMm?.[String(g.bitMm)] ?? g.bitMm,
    }));
  }, [result.drills, options.drillConsolidationMm, options.drillBitOverridesMm]);

  // The drills in the rack, by size. A retired one is not offered for a new
  // hole, but an override already pointing at its size keeps working: the
  // override is a diameter, not a tool.
  const drillPresets = useMemo(
    () => toolChoices(rack, 'drill').sort((a, b) => a.tool.tipDiameterMm - b.tool.tipDiameterMm),
    [rack]
  );

  const setDrillOverride = (requiredMm: number, loadedMm: number) => {
    setOptions(prev => {
      const next = { ...(prev.drillBitOverridesMm ?? {}) };
      if (loadedMm === requiredMm) delete next[String(requiredMm)];
      else next[String(requiredMm)] = loadedMm;
      return { ...prev, drillBitOverridesMm: Object.keys(next).length ? next : undefined };
    });
  };

  const handleSaveCustomTool = () => {
    if (!toolDraft.name.trim() || !(toolDraft.tipDiameterMm > 0)) return;
    // Into the shared rack, with the next free T number — Etch and Mesh offer it too.
    const next = addCustomTool(toolDraft);
    const created = next[next.length - 1];
    setShowToolEditor(false);
    // Select the new bit into the slot it belongs to; a drill has no slot of
    // its own, it just becomes an option on every drill row.
    if (created.role === 'profile') handleProfileToolChange(created.id);
    else if (created.role === 'isolation') handleToolPresetChange(created.id);
  };

  /**
   * Retires the bit in the rack rather than deleting it, as the shared dialog
   * does. The selection is left on it — labelled retired — so the numbers on
   * screen still describe the job about to run until another bit is picked.
   */
  const handleRetireTool = (id: string) => {
    retireRackTool(id);
  };

  const handleMaterialPresetChange = (matId: string) => {
    setSelectedMaterialId(matId);
    // Remembered for the next board, and read by the MCP mill verb, which has
    // no dialog to ask.
    saveSelectedMaterialId(matId);
    const tool = selectedTool;
    const material = PCB_MATERIAL_PRESETS.find(m => m.id === matId);
    if (tool && material) {
      const feeds = calculatePcbFeeds(tool, material);
      setOptions(prev => ({
        ...prev,
        cutFeedrate: feeds.cutFeedrate,
        plungeFeedrate: feeds.plungeFeedrate,
        spindleRpm: feeds.spindleRpm,
        isolationDepthZ: feeds.isolationDepthZ,
      }));
    }
  };

  const handleFitToCircuit = () => {
    const suggested = calculateSuggestedBoardSize(nodes, options);
    setOptions(prev => ({
      ...prev,
      boardWidthMm: suggested.widthMm,
      boardHeightMm: suggested.heightMm,
    }));
  };

  /** Probes the board surface and stores the resulting offset grid. */
  const runProbe = async (): Promise<ProbeGrid | null> => {
    setBusy('probing');
    clearErrors();
    try {
      const grid = await webSerialManager.probeSurfaceMesh({
        // The board is inset from work zero by the profile tool radius, so the
        // mesh has to be too — probing from 0 would sample the stock outside
        // the finished edge and miss a strip of the board itself.
        minX: result.boardOriginMm,
        minY: result.boardOriginMm,
        maxX: result.boardOriginMm + result.boardWidthMm,
        maxY: result.boardOriginMm + result.boardHeightMm,
        cols: suggestedGrid.cols,
        rows: suggestedGrid.rows,
        probeDepthMm: Math.max(probeDepthMm, options.safeZ + 0.5),
        clearanceMm: options.safeZ,
      });
      setHeightmap(grid);
      setHeightmapDatumEpoch(webSerialManager.getState().datumEpoch);
      return grid;
    } catch (e) {
      setMachineError(errorMessage(e) || 'Surface probe failed');
      return null;
    } finally {
      setBusy('');
    }
  };

  const isPaused =
    serialState.status === 'PAUSED_TOOL' ||
    serialState.status === 'PAUSED_MATERIAL' ||
    serialState.status === 'PAUSED_OPERATOR';
  const isRunning = serialState.status === 'RUNNING';
  const machineBusy =
    !!busy || isPaused || serialState.status === 'RUNNING' || serialState.status === 'PROBING';

  /*
   * The line the Run From panel will start at. A new stop offers its own
   * suggested line, not the one typed for the last — reset during render
   * rather than in an effect, so no frame shows the old line against the new
   * stop.
   */
  const [runFromLineInput, setRunFromLineInput] = useState<number | null>(null);
  const [runFromStopAt, setRunFromStopAt] = useState<number | null>(null);
  const interruption = serialState.interruption ?? null;
  if (interruption && runFromStopAt !== interruption.at) {
    setRunFromStopAt(interruption.at);
    setRunFromLineInput(interruption.suggestedLine);
  }
  const runFrom = runFromView({
    interruption,
    status: serialState.status,
    totalLines: serialState.totalLines,
    line: runFromLineInput,
    machineBlockedReason: interruption ? webSerialManager.startBlockedReason([]) : null,
    busy: !!busy,
  });

  /**
   * Jogging and re-zeroing are allowed when idle *and* during a stream pause —
   * changing a bit is exactly when work Z0 stops being valid, so re-probing has
   * to be reachable without cancelling the job.
   *
   * Not during an operator feed hold: GRBL is in Hold and would refuse the
   * move, and shifting position part-way through a cut would ruin the resume.
   *
   * And not without a machine on the other end. The jog keypad and both zero
   * buttons sat live while disconnected, so the first thing anyone does in
   * this dialog — press an arrow to check the link — was a button that
   * accepted the click and did nothing, which reads as the app having hung.
   */
  const manualMoveBlocked =
    !serialState.connected ||
    !!busy ||
    isRunning ||
    serialState.status === 'PROBING' ||
    serialState.status === 'PAUSED_OPERATOR';

  const ensureConnected = async () => {
    if (serialState.connected) return true;
    if (!(await safetyGate.request())) return false;
    clearErrors();
    if (transportMode === 'wifi' && !cloudDeviceId) {
      setMachineError('Choose a Tekno Box first');
      return false;
    }
    setMachineLink(transportMode === 'wifi' ? { kind: 'cloud', deviceId: cloudDeviceId } : { kind: 'usb' });
    webSerialManager.setTransport(transportMode, cloudDeviceId);
    const connected = await webSerialManager.connect();
    if (!connected) {
      setMachineError(
        transportMode === 'wifi'
          ? 'Could not reach that Tekno Box'
          : 'Could not open the serial port'
      );
    }
    return connected;
  };

  /**
   * What this run should be remembered as.
   *
   * Gathered here, where the board, the laminate and the bits are all in scope,
   * and handed to `startJob` — the machine layer sees only G-code. It is what
   * turns "a job ran for 40 minutes" in the archive into "that board was milled
   * from FR4 with a 30° V-bit", which is the question people come back to their
   * history with.
   */
  const jobContext = (kind?: string) => ({
    name: pcbJobName(cloudAutosave.getDocumentName(), kind),
    settings: pcbRunSettings({
      materialId: selectedMaterialId,
      options,
      result: result.success ? result : undefined,
      isolationToolId,
      profileToolId: outlineToolId,
      kind,
    }),
  });

  const handleMillBoard = async () => {
    if (!result.success || machineBusy) return;
    setActiveTab('cam');
    if (!(await ensureConnected())) return;

    const grid = activeHeightmap;

    // Warped here, once, and this exact string is what streams: the machine
    // keeps the program `startJob` was handed for Run From, so a stopped job
    // replays levelled — the same depths it was cutting at — rather than the
    // flat program the exporter produced.
    const program = webSerialManager.applyHeightmapToGcode(result.gcode, grid);
    // Every refusal the start would make, asked before anything changes on
    // screen, so the answer to "why did nothing happen" is the banner.
    const refused = webSerialManager.jobBlockedReason(program);
    if (refused) {
      setMachineError(refused);
      return;
    }

    setBusy('milling');
    webSerialManager.setJobHeightmap(grid);
    try {
      await webSerialManager.startJob(program, jobContext());
    } catch (e) {
      setMachineError(errorMessage(e) || 'Milling job failed');
    } finally {
      setBusy('');
    }
  };

  /**
   * Picks the stopped job up from a line. See `RunFromPanel`.
   *
   * Awaited like a milling job, because it is one: `runFromLine` streams until
   * the program ends, and its refusals — the travel of what is left, above
   * all — arrive as a throw.
   */
  const handleRunFrom = async () => {
    if (runFromLineInput === null || machineBusy) return;
    clearErrors();
    const refused = webSerialManager.startBlockedReason([]);
    if (refused) {
      setMachineError(refused);
      return;
    }
    setBusy('milling');
    try {
      await webSerialManager.runFromLine(runFromLineInput, { isLaser: false });
    } catch (e) {
      setMachineError(errorMessage(e) || 'Could not run from that line');
    } finally {
      setBusy('');
    }
  };

  /*
   * Said on hover, before the click: the machine's reason a job would be
   * refused right now. Only once connected — unconnected, the button is also
   * the way to connect, and "connect first" would talk somebody out of it.
   */
  const startRefusal =
    serialState.connected && !machineBusy ? webSerialManager.startBlockedReason([]) : null;
  const startMillingHint = startRefusal
    ? `Will not start yet: ${startRefusal}`
    : 'Start live isolation milling on the CNC machine over WebSerial.';

  const handleFrameBoard = async () => {
    if (!result.success || machineBusy) return;
    // Same reason as milling: the frame is a real move to watch, and the air-cut
    // banner that says the Z offset is applied lives on the CAM preview.
    setActiveTab('cam');
    if (!(await ensureConnected())) return;

    setBusy('framing');
    try {
      // The outline, not the job lifted up: it bounds every cut in the program,
      // so one lap answers the registration question — is the blank where the
      // job thinks it is, do the clamps foul the travel — in seconds instead of
      // re-flying ten thousand isolation moves.
      //
      // No probe and no height map either. The map compensates depth, and there
      // is no depth here; needing one would only stop an air cut being the
      // quick check it is supposed to be.
      // Read where the tool actually is first. The offset is what says the work
      // frame is pinned down; without it `wpos` is a guess, and the generator
      // would rather lift relative than trust one.
      const live = await webSerialManager.refreshPosition();
      const currentZ = live.workOffset ? live.wpos.z : undefined;
      await webSerialManager.startAuxiliaryJob(
        generateAirCutPerimeterGcode(result, options, currentZ),
        jobContext('frame')
      );
    } catch (e) {
      setMachineError(errorMessage(e) || 'Framing failed');
    } finally {
      setBusy('');
    }
  };

  /**
   * Writes the printable solder mask out as an STL.
   *
   * Purely local: nothing here touches the machine, so it stays available with
   * no serial port connected — the plate is printed on a different machine
   * than the one that mills the board, usually before the board is even cut.
   */
  const handleExportPasteStencil = () => {
    if (!result.success) return;
    setStencilNote(null);
    try {
      const stencil = generatePasteStencilStl(result, options);
      if (stencil.triangleCount === 0 || stencil.apertureCount === 0) {
        setStencilNote(stencil.warnings[0] || 'Nothing to export — the stencil came out empty.');
        return;
      }

      const blob = new Blob([stencil.stl.buffer as ArrayBuffer], { type: 'model/stl' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download =
        `pcb-paste-stencil-${Math.round(stencil.widthMm)}x${Math.round(stencil.heightMm)}.stl`;
      link.click();
      URL.revokeObjectURL(url);

      // The warning is the useful half when there is one: an aperture too fine
      // to print, or too deep to release its paste, reflows into a bridge and
      // looks fine in the slicer preview on the way there.
      setStencilNote(
        stencil.warnings[0] ||
          `Paste stencil written: ${stencil.apertureCount} apertures at ${stencil.thicknessMm}mm.`
      );
    } catch (e) {
      setStencilNote(errorMessage(e) || 'Could not build the paste stencil.');
    }
  };

  /**
   * Hands the same stencil to Etch as vector artwork, to be laser cut.
   *
   * A cut foil beats a printed sheet on the two numbers that matter — a
   * 0.1mm beam holds apertures a printed one closes up, and film comes in
   * thicknesses an FDM machine cannot reach — so the fine-pitch boards this
   * refuses to print are exactly the ones worth sending here.
   */
  const hasSmdPads = useMemo(
    () => (result.pads ?? []).some(p => (p.spec.drillDiameter ?? 0) <= 0),
    [result.pads]
  );

  const handleStencilToEtch = async () => {
    if (!result.success || !hasSmdPads) return;
    setStencilNote(null);
    try {
      const svg = pasteStencilSvg(result, options);
      await openSvgInEtch(
        svg,
        `PCB paste stencil ${Math.round(result.boardWidthMm)}x${Math.round(result.boardHeightMm)}`,
        { material: 'film', thicknessMm: DEFAULT_PASTE_SHIM_OPTIONS.thicknessMm }
      );
      setStencilNote('Sent stencil to Etch.');
    } catch (e) {
      setStencilNote(errorMessage(e) || 'Could not open stencil in Etch.');
    }
  };

  /**
   * Hands the board to Mesh, which builds an enclosure round it: standoffs
   * under the mounting holes, a lid with screws, and holes in it for the
   * knobs, buttons and lights. Mesh opens its PCB dialog with the board in it.
   */
  const handleSendToMesh = () => {
    if (!result.success) return;
    setStencilNote(null);
    try {
      openPcbInMesh(layoutToMeshSpec(result, options));
      setStencilNote('Board sent to Mesh — the enclosure dialog opens there.');
    } catch (e) {
      setStencilNote(errorMessage(e) || 'Could not open the board in Mesh.');
    }
  };

  /**
   * Bundles the routed board as Gerber (RS-274X) + Excellon, for a fab house
   * rather than the mill sitting on the bench. Pro-only in the web app: the
   * desktop build exports the same files for free, since it carries none of
   * the cloud costs a subscription recovers here. See `isProAccount` in
   * `utils/apiClient.ts` for why this is a client-side hint rather than an
   * authority — a free account is never allowed to attempt the export at all,
   * so there is nothing here for a server to refuse.
   */
  const handleExportGerber = async () => {
    if (!result.success) return;
    if (!isProAccount()) {
      setShowGerberUpsell(true);
      return;
    }
    setShowGerberUpsell(false);
    setGerberNote(null);
    try {
      const zip = await generateGerberZip(result);
      const url = URL.createObjectURL(zip);
      const link = document.createElement('a');
      link.href = url;
      link.download = `pcb-gerbers-${Math.round(result.boardWidthMm)}x${Math.round(result.boardHeightMm)}.zip`;
      link.click();
      URL.revokeObjectURL(url);
      setGerberNote(`Gerber package written: ${result.drills.length} drills, ${result.layers ?? 1} layer(s).`);
    } catch (e) {
      setGerberNote(errorMessage(e) || 'Could not build the Gerber package.');
    }
  };

  /**
   * Downloads the blank shim the stencil gets cut out of.
   *
   * No layout geometry in it at all — it is stock, sized to the job. The
   * apertures arrive on the laser, from the SVG the scissors button sends.
   */
  const handleExportShim = () => {
    if (!result.success) return;
    setStencilNote(null);
    try {
      const shim = generatePasteShimStl(result);
      const blob = new Blob([shim.stl.buffer as ArrayBuffer], { type: 'model/stl' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `pcb-stencil-shim-${Math.round(shim.widthMm)}x${Math.round(shim.heightMm)}.stl`;
      link.click();
      URL.revokeObjectURL(url);
      setStencilNote(
        `Saved shim (${Math.round(shim.widthMm)}×${Math.round(shim.heightMm)}mm) — print 1 layer in black.`
      );
    } catch (e) {
      setStencilNote(errorMessage(e) || 'Could not build the shim.');
    }
  };

  const handleStartSurfaceProbe = async () => {
    if (machineBusy) return;
    if (!(await ensureConnected())) return;
    await runProbe();
  };

  /**
   * What the height map says the copper does at the tool's current XY, in mm
   * relative to the plane the map is referenced to.
   *
   * This is what lets a re-zero happen anywhere. Probing redefines work Z0 as
   * "the surface under the bit", and on a warped board that surface is not the
   * plane the rest of the job is cut to — park somewhere 0.1mm high, re-zero,
   * and every remaining cut is 0.1mm shallow. Declaring the contact point as
   * Z = <the map's reading here> instead puts Z0 back on the map's own plane,
   * whichever spot the operator happened to stop over.
   */
  const surfaceOffsetHere = () => {
    // Past the flip the bit is over the other face, which the map does not
    // describe; offsetting this zero by the top face's reading at this XY
    // would shift the whole bottom side by the top's warp.
    if (!activeHeightmap || webSerialManager.isPastBoardFlip()) return 0;
    const { x, y } = serialState.wpos;
    return interpolateGridZ(activeHeightmap, x, y);
  };

  const handleZeroZ = async () => {
    if (manualMoveBlocked) return;
    if (!(await ensureConnected())) return;
    setBusy('zeroing');
    clearErrors();
    try {
      // The map survives: it still describes this board against the same
      // plane, which is exactly what the offset above re-establishes.
      await webSerialManager.zeroZOnSurface(surfaceOffsetHere());
    } catch (e) {
      setMachineError(errorMessage(e) || 'Zeroing Z failed');
    } finally {
      setBusy('');
    }
  };

  /**
   * Sets work Z0 using the touch plate rather than the copper itself. The tool
   * stops on top of the plate, so Z0 lands `touchPlateMm` below the contact
   * point — which is why the thickness has to be the real one.
   */
  const handleZeroZOnPlate = async () => {
    if (manualMoveBlocked) return;
    if (!(await ensureConnected())) return;
    setBusy('zeroing');
    clearErrors();
    try {
      await webSerialManager.zeroZ(touchPlateMm, surfaceOffsetHere());
    } catch (e) {
      setMachineError(errorMessage(e) || 'Zeroing Z on the touch plate failed');
    } finally {
      setBusy('');
    }
  };

  const handleZeroXY = async () => {
    if (machineBusy) return;
    if (!(await ensureConnected())) return;
    clearErrors();
    try {
      await webSerialManager.zeroXY();
    } catch (e) {
      setMachineError(errorMessage(e) || 'Zeroing XY failed');
    }
  };

  /**
   * Rapids back to the work origin, lifting Z first. This is the move you want
   * after framing or a tool change, and doing it by jogging is both slow and
   * imprecise.
   */
  const handleGoToZero = async () => {
    if (manualMoveBlocked) return;
    if (!(await ensureConnected())) return;
    clearErrors();
    try {
      await webSerialManager.gotoWorkOrigin();
    } catch (e) {
      setMachineError(errorMessage(e) || 'Go to zero failed');
    }
  };

  /**
   * Closes the link and releases the port.
   *
   * Only reachable while nothing is moving — the dialog disables it otherwise —
   * because dropping the wire mid-stream leaves the controller running the
   * blocks it has already buffered with nothing left watching them.
   */
  const handleDisconnect = async () => {
    clearErrors();
    try {
      await webSerialManager.disconnect();
    } catch (e) {
      setMachineError(errorMessage(e) || 'Could not close the machine link');
    }
  };

  /**
   * Clears a GRBL alarm lockout ($X). Until this runs the controller answers
   * every G-code line with error:9, so nothing else on this tab can work.
   */
  const handleUnlock = async () => {
    if (!(await ensureConnected())) return;
    clearErrors();
    try {
      await webSerialManager.unlockAlarm();
    } catch (e) {
      setMachineError(errorMessage(e) || 'Unlock failed');
    }
  };

  /** Runs the homing cycle ($H) — the other way out of an alarm lockout. */
  const handleHome = async () => {
    if (!(await ensureConnected())) return;
    clearErrors();
    setBusy('homing');
    try {
      await webSerialManager.homeMachine();
    } catch (e) {
      setMachineError(errorMessage(e) || 'Homing failed');
    } finally {
      setBusy('');
    }
  };

  const handleJog = async (axis: 'X' | 'Y' | 'Z', direction: 1 | -1) => {
    if (manualMoveBlocked) return;
    if (!(await ensureConnected())) return;
    const dist = jogStep * direction;
    try {
      await webSerialManager.jog({ [axis.toLowerCase()]: dist });
    } catch (e) {
      setMachineError(errorMessage(e) || 'Jog command failed');
    }
  };

  /** Feed-holds a running job. Motion stops; nothing is lost. */
  const handlePause = async () => {
    clearErrors();
    try {
      await webSerialManager.pauseJob();
    } catch (e) {
      setMachineError(errorMessage(e) || 'Could not pause the job');
    }
  };

  /**
   * Abandons the operation being cut and runs it again from its first line —
   * which stops at that layer's tool change, bringing the re-zero prompt back
   * up before anything is re-cut.
   */
  const handleRestartLayer = async () => {
    if (busy) return;
    clearErrors();
    setBusy('milling');
    try {
      await webSerialManager.restartCurrentLayer();
    } catch (e) {
      setMachineError(errorMessage(e) || 'Could not restart this layer');
    } finally {
      setBusy('');
    }
  };

  // Read during render rather than mirrored into state: it is derived purely
  // from the queue position, which only changes alongside a status update the
  // listener already re-renders on.
  const liveLayer = isRunning || isPaused ? webSerialManager.getCurrentLayer() : null;

  // The machine drives the preview whenever a job is on the wire, paused
  // included — freezing mid-job at the last streamed line is the useful view.
  const liveProgress =
    isRunning || isPaused ? (serialState.progressPercent ?? 0) / 100 : null;

  /*
   * The machine dialog and the safety warning are shared by both modes, so they
   * are built once here and rendered under whichever root applies below.
   */
  const machineDialog = showMachine && (
    <MachineConnectModal
      standalone={machineOnly}
      onClose={() => (machineOnly ? onClose() : setPanelMachineOpen(false))}
      serialState={serialState}
      busy={busy}
      machineBusy={machineBusy}
      manualMoveBlocked={manualMoveBlocked}
      isRunning={isRunning}
      error={machineError || serialState.lastError || null}
      onDismissError={clearErrors}
      transportMode={transportMode}
      onTransportModeChange={setTransportMode}
      cloudDeviceId={cloudDeviceId}
      onCloudDeviceIdChange={setCloudDeviceId}
      onPairedBox={deviceId => {
        // Straight on to the machine: having just proved you are standing in
        // front of it, being asked to press Connect is a step with nothing
        // behind it.
        setCloudDeviceId(deviceId);
        void safetyGate.request().then(ack => {
          if (!ack) return;
          setMachineLink({ kind: 'cloud', deviceId });
          webSerialManager.setTransport('wifi', deviceId);
          void webSerialManager.connect();
        });
      }}
      onConnect={() => void ensureConnected()}
      onDisconnect={() => void handleDisconnect()}
      onUnlock={handleUnlock}
      onHome={handleHome}
      onPause={handlePause}
      jogStep={jogStep}
      onJogStepChange={setJogStep}
      onJog={(axis, dir) => void handleJog(axis, dir)}
      onZeroXY={handleZeroXY}
      onZeroZOnCopper={handleZeroZ}
      onZeroZOnPlate={handleZeroZOnPlate}
      onGoToZero={handleGoToZero}
      touchPlateMm={touchPlateMm}
      onTouchPlateChange={setTouchPlateMm}
      safeZMm={options.safeZ}
      onSafeZChange={v => {
        setOptions(prev => ({ ...prev, safeZ: v }));
        localStorage.setItem('grblSafeZMm', String(v));
      }}
    />
  );

  if (machineOnly) {
    return (
      <>
        {machineDialog}
        {safetyGate.dialog}
      </>
    );
  }

  return (
    // z-[99999] is the modal layer every other full-screen dialog here uses.
    // At z-50 this sat *below* the note card's z-[100], so a preset's card
    // floated over the dialog the user had just opened.
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
      {/* A fixed height, not a maximum: at max-h the dialog shrink-wrapped its
          content, so anything that changed the length of the settings column —
          switching tabs, a warning appearing, a checkbox label wrapping onto a
          second line — resized the whole modal under the pointer. Both columns
          scroll internally, so a fixed height costs nothing. */}
      <div role="dialog" aria-modal="true" aria-label="PCB Milling and CAM Engine" className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl shadow-2xl w-full max-w-6xl overflow-hidden flex flex-col h-[92dvh]">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-100/70 dark:bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-600 dark:text-emerald-400">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                PCB Milling &amp; CAM
                <span className="text-xs font-normal px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                  WebSerial CNC
                </span>
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-md border text-[10px] font-semibold ${
                activeHeightmap
                  ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-700 dark:text-cyan-300'
                  : heightmapStale
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300'
                  : 'bg-slate-500/10 border-slate-400/30 text-slate-500 dark:text-slate-400'
              }`}
              title={
                activeHeightmap
                  ? `${activeHeightmap.gridX}×${activeHeightmap.gridY} probe mesh · ${gridStats!.spanZ.toFixed(3)}mm warp`
                  : heightmapStale
                  ? 'Board outgrew map — re-probe on CAM tab'
                  : 'Unprobed — cutting at fixed depth'
              }
            >
              <Map className="w-3 h-3 shrink-0" />
              {activeHeightmap
                ? `Mapped — ${gridStats!.spanZ.toFixed(2)}mm warp`
                : heightmapStale
                ? 'Map stale'
                : 'No board map'}
            </span>

            {/* The machine lives behind this, not behind a tab. The dot is the
                one piece of its state the rest of the panel has to show all the
                time: whether there is anything on the other end. */}
            <button
              onClick={() => setPanelMachineOpen(true)}
              title={
                serialState.connected
                  ? `Connected (${serialState.portName || 'Serial'}) — ${serialState.status}. Jog, zero, probe.`
                  : 'Connect a GRBL machine — then jog, zero and probe from here.'
              }
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                serialState.connected
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20'
                  : 'bg-slate-200/70 dark:bg-slate-800/70 border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-300/70 dark:hover:bg-slate-700/70'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  serialState.connected
                    ? machineBusy
                      ? 'bg-amber-500 animate-pulse'
                      : 'bg-emerald-500'
                    : 'bg-slate-400 dark:bg-slate-600'
                }`}
              />
              <Plug className="w-3.5 h-3.5 shrink-0" />
              {serialState.connected ? serialState.status : 'Connect'}
              <Settings2 className="w-3 h-3 shrink-0 opacity-60" />
            </button>

            <button
              onClick={onClose}
              className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 grid grid-cols-1 md:grid-cols-12 overflow-y-auto md:overflow-hidden">
          {/* Main Visualizer Area */}
          <div className="md:col-span-7 p-4 sm:p-5 bg-slate-100/70 dark:bg-slate-950/40 flex flex-col justify-between border-b md:border-b-0 md:border-r border-slate-200 dark:border-slate-800 md:overflow-y-auto">
            {activeTab === 'cam' ? (
              <div className="flex-1 flex flex-col min-h-[360px]">
                <PcbToolpathPreview
                  result={result}
                  options={options}
                  heightmap={activeHeightmap}
                  isAirCut={busy === 'framing'}
                  liveProgress={liveProgress}
                  liveLayerLabel={liveLayer?.label ?? null}
                  onRestartLayer={isRunning || isPaused ? handleRestartLayer : undefined}
                  machineBusy={!!busy}
                />
                {/* With the live toolpath rather than behind the machine
                    dialog: the trim is for what you are watching cut. */}
                <div className="mt-3">
                  <JobOverrides serialState={serialState} />
                </div>
                {runFrom && (
                  <div className="mt-3">
                    <RunFromPanel
                      view={runFrom}
                      jobName={webSerialManager.lastJobName()}
                      line={runFromLineInput}
                      onLineChange={setRunFromLineInput}
                      onRun={() => void handleRunFrom()}
                      onDiscard={() => webSerialManager.dismissInterruption()}
                      running={busy === 'milling'}
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center min-h-[360px]">
                <div className="w-full flex items-center justify-between mb-2 text-xs text-slate-500 dark:text-slate-400">
                  <span className="flex items-center gap-1.5 font-mono">
                    <Layers className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    {options.layers === 2 ? '2-Layer' : '1-Layer'} PCB Board: {result.boardWidthMm}mm × {result.boardHeightMm}mm
                  </span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-mono">
                    {result.components.length} Parts | {result.nets.length} Nets | {result.drills.length} Drills
                    {options.layers === 2 && result.vias ? ` | ${result.vias.length} Vias` : ''}
                  </span>
                </div>

                {/* Which face you are looking at. Named after the face rather
                    than "front/back" or "flipped", because the only reading of
                    this control that matters is "is this the picture I check the
                    toolpath against, or the one I seat the parts against". */}
                <div className="w-full flex items-center justify-between mb-2 text-[11px]">
                  <div className="inline-flex rounded-md border border-slate-300 dark:border-slate-700 overflow-hidden">
                    {(
                      (options.layers === 2
                        ? [
                            ['copper', 'Top (F.Cu)', 'Top copper layer (milled first).'],
                            ['bottom', 'Bottom (B.Cu)', 'Bottom copper layer (milled after flip).'],
                            ['composite', 'Both (Composite)', 'Both copper layers, vias, and alignment pins.'],
                            ['component', 'Parts', 'Component placement outline.'],
                          ]
                        : [
                            ['copper', 'Copper side', 'The board as milled, seen from the spindle. Matches the toolpath and the blank on the bed.'],
                            ['component', 'Component side', 'Seen through the board from the face the parts sit on — the view you assemble against.'],
                          ]) as [typeof viewSide, string, string][]
                    ).map(([side, label, title]) => (
                      <button
                        key={side}
                        title={title}
                        onClick={() => setViewSide(side)}
                        className={`px-2.5 py-1 font-semibold transition-colors cursor-pointer ${
                          viewSide === side
                            ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                            : 'text-slate-500 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-3">
                    {/* Said plainly, because nothing about a static preview
                        suggests the parts on it can be picked up. */}
                    <span
                      className="hidden sm:flex items-center gap-1 text-slate-500 dark:text-slate-400"
                      title="Drag a part to move it. Only the nets it touches are routed again — the rest of the board stays as it is."
                    >
                      <Move3d className="w-3.5 h-3.5" />
                      Drag a part to move it · R to turn
                    </span>
                    {handPlacedCount > 0 && (
                      <button
                        onClick={clearHandPlacement}
                        title="Throw away every hand placement and lay the board out from scratch"
                        className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
                      >
                        <Undo2 className="w-3.5 h-3.5" />
                        {handPlacedCount} placed by hand — auto-place
                      </button>
                    )}
                    <label className="flex items-center gap-1.5 cursor-pointer select-none text-slate-500 dark:text-slate-400">
                      <input
                        type="checkbox"
                        checked={showPadNumbers}
                        onChange={e => setShowPadNumbers(e.target.checked)}
                        className="accent-emerald-500 cursor-pointer"
                      />
                      Pin numbers
                    </label>
                  </div>
                </div>

                <div className="w-full aspect-[4/3] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-2 shadow-inner flex items-center justify-center overflow-hidden relative">
                  <PanZoomContainer resetKey={`${viewSide}_${options.layers}_${result.boardWidthMm}_${result.boardHeightMm}`}>
                    <div className="relative w-full h-full pointer-events-auto">
                      <div
                        className={`w-full h-full flex items-center justify-center ${showPadNumbers ? '' : '[&_.pcb-pad-numbers]:hidden'}`}
                        dangerouslySetInnerHTML={{
                          __html:
                            viewSide === 'component'
                              ? result.svgComponentSide
                              : viewSide === 'bottom'
                              ? (result.svgBottomSide || result.svg)
                              : viewSide === 'composite'
                              ? (result.svgComposite || result.svg)
                              : result.svg,
                        }}
                      />
                      {/* Over the board rather than instead of it: the picture
                          stays the one the exporter drew, and this only adds
                          the handles. */}
                      {result.components.length > 0 && (
                        <PcbPlacementOverlay
                          className="absolute inset-0"
                          result={result}
                          view={viewSide}
                          busy={isRouting}
                          onMove={moveComponent}
                        />
                      )}
                    </div>
                  </PanZoomContainer>
                </div>

                {placementNote && (
                  <div className="w-full mt-2 flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                    <span>{placementNote}</span>
                  </div>
                )}

                <div className="w-full mt-2 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#d4af37]"></span> Copper
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#ff5252]"></span> Isolation
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#64b5f6]"></span> Profile
                    </span>
                  </div>
                  {/* The map's own status is in the header, next to Connect,
                      where it is readable from either tab. This row is for what
                      the machine measured about itself. */}
                  {/* The two numbers that say whether this machine can hold the
                      depth the job is about to cut at. Warp is what levelling
                      removes; these are what it cannot, and they are spent out
                      of the same margin over the foil. Shown next to the warp
                      rather than buried, because a repeatability figure the
                      operator never sees is one nobody can act on. */}
                  {accuracyIsPoor && machineAccuracy.length > 0 && (
                    <span className="font-bold flex items-center gap-1 text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="w-3 h-3" />
                      Probe scatter high ({machineAccuracy.join(', ')}) — check collet/clip
                    </span>
                  )}
                </div>
              </div>
            )}

            {machineNote && (
              <div className="p-2 mt-2 bg-red-500/10 border border-red-500/30 rounded text-[11px] text-red-700 dark:text-red-300 flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                <span className="flex-1">{machineNote}</span>
                <button
                  onClick={clearErrors}
                  className="shrink-0 p-0.5 hover:bg-red-500/20 rounded cursor-pointer"
                  title="Dismiss"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* Design Rule Check Warnings / Errors.
                Nothing is called an error until there is a layout to have
                errors in. The placeholder result a routing pass starts from
                carries `success: false` and a single violation reading
                "Routing…", so the panel opened on a red "1 DRC Error — G-code
                output blocked" every single time, for as long as the route
                took, on a board with nothing wrong with it. */}
            <div className="w-full mt-3 space-y-1 max-h-28 overflow-y-auto">
              {isRouting && !hasResult ? (
                <div className="flex items-center gap-1.5 text-[11px] font-mono text-sky-700 dark:text-sky-300">
                  <RefreshCw className="w-3.5 h-3.5 shrink-0 animate-spin" />
                  {progress
                    ? `Routing — pass ${progress.pass}/${progress.totalPasses}, board ` +
                      `${progress.attempt}/${progress.totalAttempts}, ` +
                      `${(progress.completion * 100).toFixed(0)}% connected`
                    : effortStep > 1
                    ? `Retrying with more effort (${effortStep} of ${effortSteps})…`
                    : 'Routing…'}
                </div>
              ) : (
                <>
                  {result.success ? (
                    <div className="flex items-center gap-1.5 text-[11px] font-mono text-emerald-600 dark:text-emerald-400">
                      <Check className="w-3.5 h-3.5 shrink-0" />
                      DRC Passed — {Math.round(result.completion * 100)}% routed, isolation safe.
                      {isRouting && ' (re-routing…)'}
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-[11px] font-mono text-red-600 dark:text-red-400 font-bold">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      {errorCount} DRC Error{errorCount === 1 ? '' : 's'} — G-code output blocked.
                    </div>
                  )}
                  {result.violations.map((v, i) => (
                    <div
                      key={i}
                      className={`text-[10px] font-mono pl-5 ${
                        v.severity === 'error' ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'
                      }`}
                    >
                      {v.severity === 'error' ? '✕' : '⚠'} {v.message}
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>

          {/* Settings & Machine Control Panel */}
          <div className="md:col-span-5 bg-white/70 dark:bg-slate-900/60 flex flex-col justify-between overflow-hidden">
            <div className="flex border-b border-slate-200 dark:border-slate-800 bg-slate-100/70 dark:bg-slate-950/40 text-slate-500 dark:text-slate-400 text-xs">
              <button
                onClick={() => setActiveTab('layout')}
                className={`flex-1 py-3 border-b-2 text-center transition-colors cursor-pointer ${
                  activeTab === 'layout'
                    ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400 font-bold'
                    : 'border-transparent hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                Layout
              </button>
              <button
                onClick={() => setActiveTab('cam')}
                className={`flex-1 py-3 border-b-2 text-center transition-colors cursor-pointer ${
                  activeTab === 'cam'
                    ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400 font-bold'
                    : 'border-transparent hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                CAM &amp; Tooling
              </button>
            </div>

            <div className="p-4 flex-1 space-y-3 text-xs overflow-y-auto">
              {activeTab === 'layout' && (
                <div className="space-y-3">
                  {/* Board Layers (1-Sided vs 2-Sided) - First Setting */}
                  <div className="p-2.5 bg-slate-50 dark:bg-slate-900/60 rounded-lg border border-slate-200 dark:border-slate-800">
                    <label className="flex items-center justify-between text-slate-700 dark:text-slate-200 font-semibold mb-1.5">
                      <span className="flex items-center gap-1.5">
                        <Layers className="w-3.5 h-3.5 text-emerald-500" />
                        Board Layers
                      </span>
                      <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">
                        {options.layers === 2 ? '2-Sided (Double)' : '1-Sided (Single)'}
                      </span>
                    </label>
                    <div className="grid grid-cols-2 gap-1 p-0.5 bg-slate-200 dark:bg-slate-950 rounded-md">
                      <button
                        type="button"
                        onClick={() => {
                          setOptions({ ...options, layers: 1 });
                          if (viewSide === 'bottom' || viewSide === 'composite') {
                            setViewSide('copper');
                          }
                        }}
                        className={`py-1.5 px-2 text-xs font-semibold rounded transition-colors cursor-pointer text-center ${
                          (options.layers ?? 1) === 1
                            ? 'bg-emerald-600 text-white shadow-sm'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                        }`}
                      >
                        1 Layer (Single)
                      </button>
                      <button
                        type="button"
                        onClick={() => setOptions({ ...options, layers: 2 })}
                        className={`py-1.5 px-2 text-xs font-semibold rounded transition-colors cursor-pointer text-center ${
                          options.layers === 2
                            ? 'bg-emerald-600 text-white shadow-sm'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                        }`}
                      >
                        2 Layer (Double)
                      </button>
                    </div>
                    {(options.layers ?? 1) === 1 && (
                      <div className="mt-2.5 pt-2 border-t border-slate-200 dark:border-slate-800">
                        <label className="flex items-start gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={options.mirrorSingleSided !== false}
                            onChange={e => setOptions(prev => ({ ...prev, mirrorSingleSided: e.target.checked }))}
                            className="mt-0.5 accent-emerald-600 cursor-pointer"
                          />
                          <span className="text-[11px] text-slate-600 dark:text-slate-300">
                            <span className="font-semibold">Mirror for assembly from the bare face</span>
                            {options.mirrorSingleSided === false && (
                              <span className="block text-amber-600 dark:text-amber-400 mt-0.5">
                                Unmirrored: through-hole parts must sit on the copper side.
                              </span>
                            )}
                          </span>
                        </label>
                      </div>
                    )}

                    {options.layers === 2 && (
                      <div className="mt-2.5 pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 font-semibold mb-0.5">
                              Via Pad (mm)
                              <InfoTip>Copper ring diameter around drilled vias.</InfoTip>
                            </label>
                            <NumberInput
                              step="0.1"
                              min={0.8}
                              value={options.viaPadMm ?? 1.4}
                              onChange={v => setOptions({ ...options, viaPadMm: v })}
                              className="w-full px-2 py-1 text-xs bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200"
                            />
                          </div>
                          <div>
                            <label className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 font-semibold mb-0.5">
                              Via Drill (mm)
                              <InfoTip>Hole diameter for vias and alignment pins.</InfoTip>
                            </label>
                            <NumberInput
                              step="0.1"
                              min={0.4}
                              value={options.viaDrillMm ?? 0.8}
                              onChange={v => setOptions({ ...options, viaDrillMm: v })}
                              className="w-full px-2 py-1 text-xs bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 font-semibold mb-0.5">
                            Pin Registration Depth in Spoilboard (mm)
                            <InfoTip>Extra plunge depth into spoilboard for alignment pin holes.</InfoTip>
                          </label>
                          <NumberInput
                            step="0.5"
                            min={0.5}
                            value={options.spoilboardRegistrationDepthMm ?? 2.0}
                            onChange={v => setOptions({ ...options, spoilboardRegistrationDepthMm: v })}
                            className="w-full px-2 py-1 text-xs bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200"
                          />
                        </div>
                        <p className="text-[10px] text-slate-400">
                          Alignment holes use the via drill bit ({options.viaDrillMm ?? 0.8}mm). Drop in resistor legs or header pins to register the flipped board.
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={options.autoGrowBoard}
                        onChange={e =>
                          setOptions(prev => ({
                            ...prev,
                            autoGrowBoard: e.target.checked,
                            ...(e.target.checked
                              ? {}
                              : {
                                  boardWidthMm: result.boardWidthMm,
                                  boardHeightMm: result.boardHeightMm,
                                }),
                          }))
                        }
                        className="cursor-pointer"
                      />
                      <span className="text-slate-600 dark:text-slate-300 font-semibold">Auto-size board</span>
                    </label>

                    {!options.autoGrowBoard && (
                      <button
                        type="button"
                        onClick={handleFitToCircuit}
                        className="text-[11px] text-cyan-700 dark:text-cyan-400 hover:text-cyan-600 dark:hover:text-cyan-300 hover:underline cursor-pointer flex items-center gap-1 font-semibold"
                        title="Size board to fit components"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Fit to circuit
                      </button>
                    )}
                  </div>

                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={options.isolateUnusedPads !== false}
                      onChange={e => setOptions(prev => ({ ...prev, isolateUnusedPads: e.target.checked }))}
                      className="cursor-pointer"
                    />
                    <span className="text-slate-600 dark:text-slate-300 font-semibold">Isolate unused pins</span>
                    <InfoTip>Disconnects unused pins from surrounding copper.</InfoTip>
                  </label>


                  <div>
                    <label className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 font-semibold mb-1">
                      {options.autoGrowBoard ? 'Minimum Width (mm)' : 'Board Width (mm)'}
                    </label>
                    <NumberInput
                      value={options.boardWidthMm}
                      onChange={v => setOptions(prev => ({ ...prev, boardWidthMm: v }))}
                      className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 font-semibold mb-1">
                      {options.autoGrowBoard ? 'Minimum Height (mm)' : 'Board Height (mm)'}
                    </label>
                    <NumberInput
                      value={options.boardHeightMm}
                      onChange={v => setOptions(prev => ({ ...prev, boardHeightMm: v }))}
                      className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200"
                    />
                  </div>
                  {options.autoGrowBoard && (
                    <div>
                      <label className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 font-semibold mb-1">
                        Edge Margin (mm)
                        <InfoTip>Border left around outermost copper.</InfoTip>
                      </label>
                      <NumberInput
                        step="0.5"
                        min={0}
                        value={options.boardMarginMm ?? 1.5}
                        onChange={v => setOptions(prev => ({ ...prev, boardMarginMm: v }))}
                        className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200"
                      />
                    </div>
                  )}
                  <div>
                    <label className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 font-semibold mb-1">
                      Trace Width (mm)
                      <InfoTip>Minimum routed trace width.</InfoTip>
                    </label>
                    <NumberInput
                      step="0.05"
                      value={options.traceWidthMm}
                      onChange={v => setOptions(prev => ({ ...prev, traceWidthMm: v }))}
                      className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 font-semibold mb-1">
                      Copper Flood (mm)
                      <InfoTip>Widens traces into unused copper to reduce milling time.</InfoTip>
                    </label>
                    <NumberInput
                      step="0.1"
                      min={0}
                      value={options.copperFloodMm ?? 0}
                      onChange={v => setOptions(prev => ({ ...prev, copperFloodMm: v }))}
                      className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 font-semibold mb-1">
                      Pad Clearance (mm)
                      <InfoTip>Extra bare gap around pads to prevent solder bridges.</InfoTip>
                    </label>
                    <NumberInput
                      step="0.1"
                      min={0}
                      value={options.padClearanceMm ?? 0}
                      onChange={v => setOptions(prev => ({ ...prev, padClearanceMm: v }))}
                      className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 font-semibold mb-1">Trace Clearance (mm)</label>
                    <NumberInput
                      step="0.05"
                      value={options.clearanceMm}
                      onChange={v => setOptions(prev => ({ ...prev, clearanceMm: v }))}
                      className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 font-semibold mb-1">
                      Pad Margin (mm)
                      <InfoTip>Extra copper ring around pads for easier soldering.</InfoTip>
                    </label>
                    <NumberInput
                      step="0.05"
                      min={0}
                      value={options.padMarginMm ?? 0}
                      onChange={v => setOptions(prev => ({ ...prev, padMarginMm: v }))}
                      className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 font-semibold mb-1">
                      Drill Bit Merge (mm)
                      <InfoTip>Groups hole sizes within this tolerance to reduce bit changes.</InfoTip>
                    </label>
                    <NumberInput
                      step="0.1"
                      min={0}
                      value={options.drillConsolidationMm ?? 0}
                      onChange={v => setOptions(prev => ({ ...prev, drillConsolidationMm: v }))}
                      className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200"
                    />
                  </div>
                  {isRouting ? (
                    <div className="flex items-center gap-2 text-[11px] text-sky-700 dark:text-sky-300">
                      <RefreshCw size={11} className="animate-spin shrink-0" />
                      <span>
                        {progress
                          ? `Routing — pass ${progress.pass}/${progress.totalPasses}, ` +
                            `board ${progress.attempt}/${progress.totalAttempts}, ` +
                            `${(progress.completion * 100).toFixed(0)}% connected`
                          : effortStep > 1
                          ? `Retrying (${effortStep}/${effortSteps})…`
                          : 'Routing…'}
                      </span>
                    </div>
                  ) : null}
                </div>
              )}

              {activeTab === 'cam' && (
                <div className="space-y-3">
                  <div className="p-2.5 rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600 dark:text-slate-300 font-semibold">
                        Bits this job needs
                      </span>
                      <button
                        onClick={() => setShowToolEditor(v => !v)}
                        className="text-[10px] text-emerald-600 dark:text-emerald-400 hover:underline font-sans"
                      >
                        {showToolEditor ? 'Cancel' : '+ Add tool'}
                      </button>
                    </div>

                    {/* --- 1. Isolation --- */}
                    <div className="flex items-start gap-2">
                      <span className="mt-1.5 w-4 shrink-0 text-center font-mono text-[10px] text-slate-400">1</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold">
                            Isolation
                          </span>
                          {selectedTool && (
                            <span className="font-mono text-[10px] text-emerald-700 dark:text-emerald-300 shrink-0">
                              {minIsolationChannelMm(selectedTool, options.isolationDepthZ).toFixed(3)}mm channel
                            </span>
                          )}
                        </div>
                        <select
                          value={isolationToolId}
                          onChange={e => handleToolPresetChange(e.target.value)}
                          className="mt-0.5 w-full px-2 py-1 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-[11px] text-slate-800 dark:text-slate-200 font-sans"
                        >
                          {isolationChoices.map(({ tool, label }) => (
                            <option key={tool.id} value={tool.id}>
                              {label}
                            </option>
                          ))}
                        </select>
                        {selectedTool?.rackUid && !selectedTool.retired && (
                          <button
                            onClick={() => handleRetireTool(selectedTool.id)}
                            className="mt-0.5 text-[10px] text-red-500 hover:underline"
                            title="Remove bit from tool rack"
                          >
                            Retire
                          </button>
                        )}
                      </div>
                    </div>

                    {/* --- 2..n. Drills, one row per bit the holes call for --- */}
                    {requiredBits.map((bit, i) => (
                      <div key={bit.requiredMm} className="flex items-start gap-2">
                        <span className="mt-1.5 w-4 shrink-0 text-center font-mono text-[10px] text-slate-400">
                          {i + 2}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold">
                              Drill &empty;{bit.requiredMm}mm
                            </span>
                            <span className="font-mono text-[10px] text-slate-500 shrink-0">
                              {bit.holeCount} hole{bit.holeCount === 1 ? '' : 's'}
                            </span>
                          </div>
                          <select
                            value={bit.loadedMm}
                            onChange={e => setDrillOverride(bit.requiredMm, parseFloat(e.target.value))}
                            className="mt-0.5 w-full px-2 py-1 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-[11px] text-slate-800 dark:text-slate-200 font-sans"
                          >
                            <option value={bit.requiredMm}>Exact &mdash; {bit.requiredMm}mm</option>
                            {drillPresets
                              .filter(({ tool }) => Math.abs(tool.tipDiameterMm - bit.requiredMm) > 0.01)
                              .map(({ tool, label }) => (
                                <option key={tool.id} value={tool.tipDiameterMm}>
                                  {label}
                                  {tool.tipDiameterMm < bit.requiredMm ? ' (helical)' : ''}
                                </option>
                              ))}
                          </select>
                          {bit.nominals.length > 1 && (
                            <p className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400 leading-snug">
                              Covers {bit.nominals.map(n => `${n}mm`).join(', ')}
                            </p>
                          )}
                          {bit.loadedMm > bit.requiredMm && (
                            <p className="mt-0.5 text-[10px] text-amber-600 dark:text-amber-400 leading-snug">
                              +{(bit.loadedMm - bit.requiredMm).toFixed(2)}mm oversize
                            </p>
                          )}
                        </div>
                      </div>
                    ))}

                    {/* --- last. Profile --- */}
                    <div className="flex items-start gap-2">
                      <span className="mt-1.5 w-4 shrink-0 text-center font-mono text-[10px] text-slate-400">
                        {requiredBits.length + 2}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 font-semibold">
                            Board outline
                          </span>
                          <span className="font-mono text-[10px] text-slate-500 shrink-0">
                            {options.profileToolDiaMm}mm kerf
                          </span>
                        </div>
                        <select
                          value={outlineToolId}
                          onChange={e => handleProfileToolChange(e.target.value)}
                          className="mt-0.5 w-full px-2 py-1 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-[11px] text-slate-800 dark:text-slate-200 font-sans"
                        >
                          {profileChoices.map(({ tool, label }) => (
                            <option key={tool.id} value={tool.id}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="pt-1.5 border-t border-slate-200 dark:border-slate-800 flex items-baseline justify-between gap-2">
                      <span className="text-[10px] text-slate-500 dark:text-slate-400">
                        Board{' '}
                        <span className="font-mono text-slate-700 dark:text-slate-200">
                          {result.boardWidthMm} &times; {result.boardHeightMm} mm
                        </span>
                        {options.autoGrowBoard ? ' (auto-sized)' : ' (fixed)'}
                      </span>
                      <button
                        onClick={() => setActiveTab('layout')}
                        className="text-[10px] text-cyan-700 dark:text-cyan-400 hover:underline shrink-0"
                      >
                        Change size
                      </button>
                    </div>
                  </div>

                  <BoardMapPanel
                    heightmap={heightmap}
                    activeHeightmap={activeHeightmap}
                    heightmapStale={heightmapStale}
                    onClearHeightmap={() => setHeightmap(null)}
                    board={{
                      originMm: result.boardOriginMm,
                      widthMm: result.boardWidthMm,
                      heightMm: result.boardHeightMm,
                    }}
                    depthMarginMm={depthMargin}
                    boardReady={hasResult && result.success}
                    suggestedGrid={suggestedGrid}
                    probeDepthMm={probeDepthMm}
                    onProbeDepthChange={v => {
                      setProbeDepthMm(v);
                      localStorage.setItem('grblProbeDepthMm', String(v));
                    }}
                    safeZMm={options.safeZ}
                    probing={busy === 'probing'}
                    probeProgress={serialState.probeProgress}
                    machineBusy={machineBusy}
                    onProbeSurface={handleStartSurfaceProbe}
                  />

                  {showToolEditor && (
                    <div className="p-2.5 rounded border border-emerald-500/40 bg-emerald-500/5 space-y-2">
                      <p className="text-[10px] text-slate-600 dark:text-slate-300 leading-snug">
                        Describe the bit and the feeds are derived from its chipload
                        (bite per tooth &times; teeth &times; RPM). It goes into your tool
                        rack, so Etch and Mesh offer it too. Override any feed afterwards in
                        the fields below.
                      </p>

                      <input
                        value={toolDraft.name}
                        onChange={e => setToolDraft({ ...toolDraft, name: e.target.value })}
                        placeholder="Name, e.g. 10° 0.1mm V-bit (Chinese blue)"
                        className="w-full px-2 py-1 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-[11px] font-sans"
                      />

                      <div className="grid grid-cols-2 gap-2">
                        <label className="block">
                          <span className="block text-[10px] text-slate-500 dark:text-slate-400 mb-0.5">Type</span>
                          <select
                            value={toolDraft.type}
                            onChange={e => setToolDraft({ ...toolDraft, type: e.target.value as ToolType })}
                            className="w-full px-2 py-1 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-[11px] font-sans"
                          >
                            <option value="vbit">V-Bit (isolation)</option>
                            <option value="engraver">Flat engraver (isolation)</option>
                            <option value="drill">Drill</option>
                            <option value="endmill">Flat endmill (profile)</option>
                            <option value="ballnose">Ball-nose</option>
                          </select>
                        </label>

                        <label className="block">
                          <span className="block text-[10px] text-slate-500 dark:text-slate-400 mb-0.5">
                            {toolDraft.type === 'vbit' ? 'Tip diameter (mm)' : 'Diameter (mm)'}
                          </span>
                          <NumberInput step={0.01} min={0.01}
                            value={toolDraft.tipDiameterMm}
                            onChange={v => setToolDraft({ ...toolDraft, tipDiameterMm: v })}
                      className="w-full px-2 py-1 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-[11px] font-mono"
                    />
                        </label>

                        {(toolDraft.type === 'vbit' || toolDraft.type === 'ballnose') && (
                          <label className="block">
                            <span className="block text-[10px] text-slate-500 dark:text-slate-400 mb-0.5">Included angle (°)</span>
                            <NumberInput step={1} min={1} max={179}
                              value={toolDraft.angleDeg ?? 30}
                              onChange={v => setToolDraft({ ...toolDraft, angleDeg: v })}
                      className="w-full px-2 py-1 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-[11px] font-mono"
                    />
                          </label>
                        )}

                        <label className="block">
                          <span className="block text-[10px] text-slate-500 dark:text-slate-400 mb-0.5">Flutes</span>
                          <NumberInput step={1} min={1} max={8}
                            value={toolDraft.fluteCount ?? 1}
                            onChange={v => setToolDraft({ ...toolDraft, fluteCount: v })}
                      className="w-full px-2 py-1 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-[11px] font-mono"
                      integer
                    />
                        </label>

                        <label className="block">
                          <span className="block text-[10px] text-slate-500 dark:text-slate-400 mb-0.5">Spindle RPM</span>
                          <NumberInput step={500} min={1000}
                            value={toolDraft.recommendedRpm ?? 12000}
                            onChange={v => setToolDraft({ ...toolDraft, recommendedRpm: v })}
                      className="w-full px-2 py-1 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-[11px] font-mono"
                      integer
                    />
                        </label>
                      </div>

                      <p className="text-[10px] font-mono text-emerald-700 dark:text-emerald-300">
                        Derived cut feed:{' '}
                        {feedFromChipload(
                          suggestedChiploadMm(toolDraft.type, toolDraft.tipDiameterMm),
                          toolDraft.fluteCount ?? 1,
                          toolDraft.recommendedRpm ?? 12000
                        )}{' '}
                        mm/min
                      </p>

                      <button
                        onClick={handleSaveCustomTool}
                        disabled={!toolDraft.name.trim() || !(toolDraft.tipDiameterMm > 0)}
                        className="w-full px-2 py-1.5 bg-emerald-600 disabled:bg-slate-400 disabled:cursor-not-allowed text-white rounded text-[11px] font-semibold font-sans hover:bg-emerald-700 transition"
                      >
                        Save tool
                      </button>
                    </div>
                  )}

                  <div>
                    <label className="flex items-center justify-between text-slate-600 dark:text-slate-300 font-semibold mb-1">
                      <span>Material Substrate</span>
                      <span className="text-[10px] text-emerald-600 dark:text-emerald-400">Feeds &amp; Speeds</span>
                    </label>
                    <select
                      value={selectedMaterialId}
                      onChange={e => handleMaterialPresetChange(e.target.value)}
                      className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200 font-sans"
                    >
                      {PCB_MATERIAL_PRESETS.map(mat => (
                        <option key={mat.id} value={mat.id}>
                          {mat.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-slate-500 dark:text-slate-400 font-semibold mb-1 block">
                        Cut Feed (mm/min)
                      </label>
                      <NumberInput
                        value={options.cutFeedrate}
                        onChange={v => setOptions(prev => ({ ...prev, cutFeedrate: v }))}
                        className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200"
                        integer
                      />
                    </div>
                    <div>
                      <label className="text-slate-500 dark:text-slate-400 font-semibold mb-1 block">
                        Plunge Feed (mm/min)
                      </label>
                      <NumberInput
                        value={options.plungeFeedrate}
                        onChange={v => setOptions(prev => ({ ...prev, plungeFeedrate: v }))}
                        className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200"
                        integer
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-slate-500 dark:text-slate-400 font-semibold mb-1 block">
                        Spindle RPM
                      </label>
                      <NumberInput
                        value={options.spindleRpm}
                        onChange={v => setOptions(prev => ({ ...prev, spindleRpm: v }))}
                        className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200"
                        integer
                      />
                    </div>
                    <div>
                      <label className="text-slate-500 dark:text-slate-400 font-semibold mb-1 block">
                        Isolation Depth (mm)
                      </label>
                      <NumberInput
                        step="0.01"
                        value={options.isolationDepthZ}
                        disabled={autoIsolationDepth}
                        onChange={v => setOptions(prev => ({ ...prev, isolationDepthZ: v }))}
                        className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200 disabled:opacity-60"
                      />
                      <label className="flex items-center gap-1.5 mt-1 cursor-pointer text-[10px] text-slate-500 dark:text-slate-400">
                        <input
                          type="checkbox"
                          checked={autoIsolationDepth}
                          onChange={e => {
                            const nextAuto = e.target.checked;
                            if (!nextAuto && autoDepthZ !== null) {
                              setOptions(prev => ({ ...prev, isolationDepthZ: autoDepthZ }));
                            }
                            setAutoIsolationDepth(nextAuto);
                            saveAutoIsolationDepth(nextAuto);
                          }}
                          className="accent-emerald-500"
                        />
                        <span>Auto depth</span>
                      </label>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-slate-500 dark:text-slate-400 font-semibold mb-1 flex items-center gap-1.5">
                        Isolation Passes
                        <InfoTip>Extra widening passes around traces (1 is usually enough).</InfoTip>
                      </label>
                      <NumberInput
                        integer
                        min={1}
                        max={3}
                        value={options.isolationPasses}
                        onChange={v => setOptions(prev => ({ ...prev, isolationPasses: v }))}
                        className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200"
                      />
                    </div>
                  </div>

                  <div className="p-2.5 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded space-y-1">
                    <label className="flex items-center gap-2 cursor-pointer text-slate-600 dark:text-slate-300 font-medium">
                      <input
                        type="checkbox"
                        checked={options.rubOutClearing === true}
                        onChange={e => setOptions(prev => ({ ...prev, rubOutClearing: e.target.checked }))}
                        className="accent-emerald-500"
                      />
                      <span>Clear excess copper</span>
                    </label>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 pl-5">
                      Removes unused copper with the {options.profileToolDiaMm}mm end mill.
                    </p>
                  </div>

                  <div className="p-2.5 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded">
                    <label className="flex items-center gap-2 cursor-pointer text-slate-600 dark:text-slate-300 font-medium">
                      <input
                        type="checkbox"
                        checked={options.rampedPlunge !== false}
                        onChange={e => setOptions(prev => ({ ...prev, rampedPlunge: e.target.checked }))}
                        className="accent-emerald-500"
                      />
                      <span>Ramped entry plunges</span>
                    </label>
                  </div>
                </div>
              )}

            </div>

            {/* Bottom Action Footer — pinned outside the scrolling tab
                content above (see the column wrapper's overflow-hidden), so
                these buttons never move under the pointer. The status line
                is a fixed height for the same reason: it swaps its one line
                of text between the Pro upsell, the last export's result, and
                a hovered button's explanation, but never grows the footer to
                fit any of them. */}
            <div className="border-t border-slate-200 dark:border-slate-800 bg-slate-100/70 dark:bg-slate-950/60">
              <div className="px-4 pt-2.5 h-8 flex items-center text-[11px] text-slate-500 dark:text-slate-400">
                {showGerberUpsell ? (
                  <span className="truncate flex items-center gap-1">
                    <Star className="w-3 h-3 shrink-0 text-emerald-500" />
                    Gerber export is part of PhysBox Pro —{' '}
                    <a
                      href="https://physbox.io/pro.html"
                      target="_blank"
                      rel="noreferrer"
                      className="text-emerald-600 dark:text-emerald-400 hover:underline font-semibold shrink-0"
                    >
                      See PhysBox Pro
                    </a>
                  </span>
                ) : (
                  <span className="truncate" title={gerberNote || stencilNote || hoveredFooterHint || undefined}>
                    {gerberNote || stencilNote || hoveredFooterHint || ''}
                  </span>
                )}
              </div>

              <div className="p-4 pt-1.5 flex flex-wrap items-center justify-end gap-2">
                <button
                  onClick={handleFrameBoard}
                  disabled={!result.success || machineBusy}
                  onMouseEnter={() => setHoveredFooterHint('Trace board outline live with spindle off.')}
                  onMouseLeave={() => setHoveredFooterHint(null)}
                  onFocus={() => setHoveredFooterHint('Trace board outline live with spindle off.')}
                  onBlur={() => setHoveredFooterHint(null)}
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white font-bold rounded flex items-center gap-1.5 cursor-pointer text-xs shadow-sm whitespace-nowrap"
                  title={`Dry-run outline at Z${Math.max(options.safeZ, options.toolChangeZ)} (spindle off)`}
                >
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                  Frame
                </button>

                <button
                  onClick={handleExportPasteStencil}
                  disabled={!result.success || !hasSmdPads}
                  onMouseEnter={() => setHoveredFooterHint(hasSmdPads ? 'Download printable SMD paste stencil (.stl).' : 'No SMD pads to stencil.')}
                  onMouseLeave={() => setHoveredFooterHint(null)}
                  onFocus={() => setHoveredFooterHint(hasSmdPads ? 'Download printable SMD paste stencil (.stl).' : 'No SMD pads to stencil.')}
                  onBlur={() => setHoveredFooterHint(null)}
                  className="px-2 py-1.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 text-slate-800 dark:text-slate-200 font-bold rounded flex items-center cursor-pointer text-xs"
                  title={hasSmdPads ? PASTE_STENCIL_HINT : 'No SMD pads on this board'}
                >
                  <Box className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={handleExportShim}
                  disabled={!result.success || !hasSmdPads}
                  onMouseEnter={() => setHoveredFooterHint(hasSmdPads ? 'Download blank shim (.stl) for laser stencil.' : 'No SMD pads to stencil.')}
                  onMouseLeave={() => setHoveredFooterHint(null)}
                  onFocus={() => setHoveredFooterHint(hasSmdPads ? 'Download blank shim (.stl) for laser stencil.' : 'No SMD pads to stencil.')}
                  onBlur={() => setHoveredFooterHint(null)}
                  className="px-2 py-1.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 text-slate-800 dark:text-slate-200 font-bold rounded flex items-center cursor-pointer text-xs"
                  title={hasSmdPads ? SHIM_HINT : 'No SMD pads on this board'}
                >
                  <Layers2 className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={handleStencilToEtch}
                  disabled={!result.success || !hasSmdPads}
                  onMouseEnter={() => setHoveredFooterHint(hasSmdPads ? 'Open paste stencil in Etch for laser cutting.' : 'No SMD pads to stencil.')}
                  onMouseLeave={() => setHoveredFooterHint(null)}
                  onFocus={() => setHoveredFooterHint(hasSmdPads ? 'Open paste stencil in Etch for laser cutting.' : 'No SMD pads to stencil.')}
                  onBlur={() => setHoveredFooterHint(null)}
                  className="px-2 py-1.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 text-slate-800 dark:text-slate-200 font-bold rounded flex items-center cursor-pointer text-xs"
                  title={hasSmdPads ? ETCH_HINT : 'No SMD pads on this board'}
                >
                  <Scissors className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={handleSendToMesh}
                  disabled={!result.success}
                  onMouseEnter={() => setHoveredFooterHint('Send the board to PhysBox: Mesh, to build an enclosure round it.')}
                  onMouseLeave={() => setHoveredFooterHint(null)}
                  onFocus={() => setHoveredFooterHint('Send the board to PhysBox: Mesh, to build an enclosure round it.')}
                  onBlur={() => setHoveredFooterHint(null)}
                  className="px-2 py-1.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 text-slate-800 dark:text-slate-200 font-bold rounded flex items-center cursor-pointer text-xs"
                  title="Send to Mesh (enclosure): standoffs under the mounting holes, a screwed lid, and holes for the knobs, buttons and lights"
                  aria-label="Send to Mesh (enclosure)"
                >
                  <Package className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={() => void handleExportGerber()}
                  disabled={!result.success}
                  onMouseEnter={() =>
                    setHoveredFooterHint(
                      isProAccount()
                        ? 'Export Gerber (RS-274X) + Excellon drill files, zipped, for a fab house like JLCPCB.'
                        : 'Gerber export for JLCPCB and other fab houses — part of PhysBox Pro.'
                    )
                  }
                  onMouseLeave={() => setHoveredFooterHint(null)}
                  onFocus={() =>
                    setHoveredFooterHint(
                      isProAccount()
                        ? 'Export Gerber (RS-274X) + Excellon drill files, zipped, for a fab house like JLCPCB.'
                        : 'Gerber export for JLCPCB and other fab houses — part of PhysBox Pro.'
                    )
                  }
                  onBlur={() => setHoveredFooterHint(null)}
                  className="px-2 py-1.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 text-slate-800 dark:text-slate-200 font-bold rounded flex items-center gap-1 cursor-pointer text-xs"
                  title="Export Gerber (RS-274X) + Excellon drill files, zipped, for a fab house like JLCPCB"
                >
                  <Archive className="w-3.5 h-3.5" />
                  {!isProAccount() && <Star className="w-2.5 h-2.5 text-emerald-500" />}
                </button>

                <button
                  onClick={handleMillBoard}
                  disabled={!result.success || machineBusy}
                  onMouseEnter={() => setHoveredFooterHint(startMillingHint)}
                  onMouseLeave={() => setHoveredFooterHint(null)}
                  onFocus={() => setHoveredFooterHint(startMillingHint)}
                  onBlur={() => setHoveredFooterHint(null)}
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold rounded flex items-center gap-1.5 cursor-pointer text-xs shadow-sm whitespace-nowrap"
                  title="Start live isolation milling on CNC machine via Web Serial"
                >
                  {busy ? <RefreshCw className="w-3.5 h-3.5 shrink-0 animate-spin" /> : <Play className="w-3.5 h-3.5 shrink-0" />}
                  Start Milling
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {machineDialog}

      {safetyGate.dialog}
    </div>
  );
};
