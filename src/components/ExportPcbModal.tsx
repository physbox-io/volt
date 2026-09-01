import React, { useState, useMemo, useEffect } from 'react';
import { loadMachiningSettings, saveMachiningSettings } from '../utils/storage';
import type { Node, Edge } from '@xyflow/react';
import {
  X,
  Cpu,
  Play,
  Layers,
  Check,
  RefreshCw,
  Compass,
  AlertTriangle,
  ShieldCheck,
  Crosshair,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Box,
  Scissors,
  Layers2,
} from 'lucide-react';
import {
  generateAirCutPerimeterGcode,
  calculateSuggestedBoardSize,
  groupDrillsByBit,
  DEFAULT_PCB_OPTIONS,
  type PcbOptions,
} from '../utils/pcbExporter';
import {
  PCB_TOOL_PRESETS,
  PCB_MATERIAL_PRESETS,
  calculatePcbFeeds,
  loadCustomTools,
  addCustomTool,
  deleteCustomTool,
  suggestedChiploadMm,
  feedFromChipload,
  minIsolationChannelMm,
  autoIsolationDepthMm,
  isolationFlatnessAllowanceMm,
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
import { usePcbLayout } from '../hooks/usePcbLayout';
import { webSerialManager } from '../utils/webSerialManager';
import { TeknoBoxPicker } from './TeknoBoxPicker';
import {
  getGridStats,
  findUnwarpableCommands,
  suggestProbeGrid,
  interpolateGridZ,
  type ProbeGrid,
} from '../utils/meshLeveler';
import { PcbToolpathPreview } from './PcbToolpathPreview';
import { InfoTip } from './InfoTip';
import { JobPauseModal } from './JobPauseModal';

/**
 * Wall-clock budgets offered for the maze router. Most boards finish in well
 * under a second; the larger budgets exist for dense boards where the router
 * needs to try many net orderings before one of them fits.
 */
const ROUTING_EFFORT_PRESETS = [
  { ms: 2000, label: 'Fast — 2s' },
  { ms: 8000, label: 'Standard — 8s' },
  { ms: 30000, label: 'Thorough — 30s' },
  { ms: 120000, label: 'Exhaustive — 2min' },
];

/**
 * What each of the three stencil buttons makes. Long enough to matter on a
 * tooltip: people reach for a "solder mask" expecting the green lacquer, and
 * these are three routes to a paste stencil — a sheet you squeegee through and
 * then take off again.
 */
const PASTE_STENCIL_HINT =
  'Download a printable solder paste stencil: a ' +
  `${DEFAULT_PASTE_STENCIL_OPTIONS.thicknessMm}mm sheet with an aperture over every SMD pad and ` +
  'corner brackets that register it on the milled board. Squeegee paste across it, lift it off, ' +
  'place the parts, reflow. Printed apertures close up below about 0.5mm, so this route stops at ' +
  'roughly SOIC/1.27mm pitch — finer boards want the laser.';

/**
 * Why the scissors sit next to the download.
 *
 * The material advice is the part worth getting right: a blue diode cuts what
 * absorbs blue, which is a much shorter list than "plastic film".
 */
const ETCH_HINT =
  'Open the stencil in Physbox Etch as vector artwork, to laser cut it. A ~0.1mm beam holds ' +
  'apertures a nozzle closes up — roughly 0.65mm pitch against 1.27mm. Best cut from a printed ' +
  'black shim (the button beside this one) or any black film: a 450nm diode cuts what absorbs ' +
  'blue. Amber polyimide (Kapton) is what a CO2 would use and only part-absorbs blue, so on a ' +
  '12W diode it is marginal — thin gauges, several passes, air assist, and some films will not ' +
  'take at all. Cutting film needs ducted fume extraction either way. Etch offsets the cut by ' +
  'half its kerf, so set that figure in its status bar and the apertures come out the size drawn.';

/**
 * The shim is stock, not a part, which is the bit that needs saying: it comes
 * out of the printer blank and only becomes a stencil on the laser.
 */
const SHIM_HINT =
  `Download a blank ${DEFAULT_PASTE_SHIM_OPTIONS.thicknessMm}mm shim to laser the stencil out of ` +
  '— a single layer, sized to the stencil plus ' +
  `${DEFAULT_PASTE_SHIM_OPTIONS.marginMm}mm of holding margin. Print it in BLACK, which is the ` +
  'whole point: black absorbs 450nm, so this is the one stencil material a diode laser is ' +
  'reliable on. Thin dark film is awkward to buy in ones; a single layer of black filament is ' +
  'the same thing, and you already have it.';


/** Search distance for a mesh probe point, measured down from the retract. */
const DEFAULT_PROBE_DEPTH_MM = 3;
/** Retract height between probe points and rapid moves. */
const DEFAULT_SAFE_Z_MM = 2;
/** Thickness of the touch plate used to set work Z0. */
const DEFAULT_TOUCH_PLATE_MM = 12;
/**
 * How far the board may extend past the probed mesh before the map counts as
 * no longer describing it. Inside this margin the leveller's clamped
 * interpolation carries the edge samples outward, which is a fair reading over
 * a strip this narrow.
 */
const HEIGHTMAP_EDGE_MARGIN_MM = 1;

/**
 * Reads a persisted machine setting. These are bench measurements — plate
 * thickness, retract height — that belong to the machine rather than to any
 * one board, so they survive both the modal closing and a page reload.
 * A stored value that is not a finite positive number is ignored: a bad
 * thickness silently zeroes Z in the wrong place.
 */
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
}

export const ExportPcbModal: React.FC<ExportPcbModalProps> = ({
  onClose,
  nodes = [],
  edges = [],
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
  const [activeTab, setActiveTab] = useState<'layout' | 'cam' | 'serial'>('layout');
  const [serialState, setSerialState] = useState(webSerialManager.getState());
  /**
   * Off by default: a mesh probe is minutes of machine time and needs the
   * continuity clip attached, so it belongs behind a deliberate press of the
   * Probe button rather than silently in front of every job.
   */
  const [autoLevel, setAutoLevel] = useState(false);
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
  const [touchPlateMm, setTouchPlateMm] = useState<number>(() =>
    readNumericSetting('grblTouchPlateMm', DEFAULT_TOUCH_PLATE_MM)
  );
  const [busy, setBusy] = useState<'' | 'probing' | 'zeroing' | 'milling' | 'homing'>('');
  const [machineError, setMachineError] = useState<string | null>(null);
  /** Last word from the stencil export — the file written, or why not. */
  const [stencilNote, setStencilNote] = useState<string | null>(null);
  const [heightmap, setHeightmap] = useState<ProbeGrid | null>(null);

  const [selectedToolId, setSelectedToolId] = useState<string>('t1_vbit_30');
  const [profileToolId, setProfileToolId] = useState<string>('t6b_endmill_15');
  const [customTools, setCustomTools] = useState<PcbToolPreset[]>(() => loadCustomTools());
  const [showToolEditor, setShowToolEditor] = useState(false);
  const [toolDraft, setToolDraft] = useState<CustomToolInput>({
    name: '',
    type: 'vbit',
    tipDiameterMm: 0.1,
    angleDeg: 30,
    fluteCount: 1,
    recommendedRpm: 12000,
  });
  const [selectedMaterialId, setSelectedMaterialId] = useState<string>('fr4_1oz');
  /**
   * When on, the isolation depth is derived from the copper thickness and the
   * board's measured flatness instead of the tool catalogue's blanket figure.
   * Shallower means a narrower channel from a V-bit, which is copper kept.
   */
  const [autoIsolationDepth, setAutoIsolationDepth] = useState<boolean>(
    () => localStorage.getItem('pcbAutoIsolationDepth') !== '0'
  );
  const [airCutZOffset, setAirCutZOffset] = useState<number>(20);
  const [isAirCutMode, setIsAirCutMode] = useState<boolean>(false);
  const [jogStep, setJogStep] = useState<number>(1.0);

  // How the machine is reached: a USB cable to this computer, or a Tekno Box
  // over WiFi. USB stays the default; the chosen box is remembered.
  const [transportMode, setTransportMode] = useState<'usb' | 'wifi'>(
    () => (localStorage.getItem('grblTransport') === 'wifi' ? 'wifi' : 'usb')
  );
  const [cloudDeviceId, setCloudDeviceId] = useState<string>(
    () => localStorage.getItem('grblCloudDeviceId') || ''
  );


  React.useEffect(() => {
    return webSerialManager.addListener(state => {
      setSerialState(state);
    });
  }, []);

  const handleSafeClose = () => {
    const isJobActive = serialState.status === 'RUNNING' || serialState.status === 'PROBING' || busy !== '';
    if (isJobActive) {
      if (!window.confirm('A machine operation is currently in progress. Closing this dialog will leave the machine running. Are you sure you want to close?')) {
        return;
      }
    }
    onClose();
  };

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleSafeClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [serialState.status, busy]);

  const availableTools = useMemo(
    () => [...PCB_TOOL_PRESETS, ...customTools],
    [customTools]
  );
  const selectedTool = availableTools.find(t => t.id === selectedToolId);

  /**
   * Flatness taken from the last probe, whether or not it still matches this
   * board's size. The span is a property of the stock and the spoilboard, not
   * of the layout, so a stale map is still the best estimate available — and
   * reading it from the raw map keeps the depth from oscillating: the depth
   * changes the channel width, which changes the auto-sized board, which would
   * otherwise invalidate the map that set the depth in the first place.
   */
  const probedSpanZ = useMemo(
    () => (heightmap ? getGridStats(heightmap).spanZ : undefined),
    [heightmap]
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
  const options: PcbOptions = useMemo(
    () =>
      autoIsolationDepth && autoDepthZ !== null
        ? { ...rawOptions, isolationDepthZ: autoDepthZ }
        : rawOptions,
    [rawOptions, autoIsolationDepth, autoDepthZ]
  );

  // Routing runs in a worker: a dense board takes seconds, and blocking the
  // main thread for that long makes the whole editor feel broken.
  const { result, isRouting, progress, hasResult } = usePcbLayout(nodes, edges, options);

  const suggestedGrid = useMemo(() => {
    return suggestProbeGrid(options.boardWidthMm, options.boardHeightMm, 4, 8);
  }, [options.boardWidthMm, options.boardHeightMm]);

  const nextEffortMs =
    ROUTING_EFFORT_PRESETS.find(p => p.ms > options.routingBudgetMs)?.ms ??
    options.routingBudgetMs;
  const atMaxEffort = nextEffortMs === options.routingBudgetMs;

  const errorCount = result.violations.filter(v => v.severity === 'error').length;
  /**
   * A map stays usable as long as it still spans the board. Comparing bounds
   * rather than board dimensions matters because probing itself moves the
   * board: the measured flatness feeds the auto isolation depth, which changes
   * the channel width and so the auto-sized board by a fraction of a mm. That
   * shift leaves the mesh covering the board perfectly well, and an equality
   * test on the size would throw away every map the moment it was made. The
   * margin is what the edge samples can be stretched over before the flat
   * extrapolation outside the mesh is a guess rather than a reading.
   */
  const coversBoard =
    heightmap !== null &&
    heightmap.minX <= result.boardOriginMm + HEIGHTMAP_EDGE_MARGIN_MM &&
    heightmap.minY <= result.boardOriginMm + HEIGHTMAP_EDGE_MARGIN_MM &&
    heightmap.maxX >= result.boardOriginMm + result.boardWidthMm - HEIGHTMAP_EDGE_MARGIN_MM &&
    heightmap.maxY >= result.boardOriginMm + result.boardHeightMm - HEIGHTMAP_EDGE_MARGIN_MM;

  const activeHeightmap = coversBoard ? heightmap : null;
  const heightmapStale = heightmap !== null && activeHeightmap === null;

  const gridStats = activeHeightmap ? getGridStats(activeHeightmap) : null;

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

  const unwarpable = useMemo(
    () => (activeHeightmap ? findUnwarpableCommands(result.gcode) : []),
    [activeHeightmap, result.gcode]
  );

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
    const tool = availableTools.find(t => t.id === toolId);
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
    const tool = availableTools.find(t => t.id === toolId);
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

  const drillPresets = useMemo(
    () => availableTools.filter(t => t.role === 'drill').sort((a, b) => a.tipDiameterMm - b.tipDiameterMm),
    [availableTools]
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
    const next = addCustomTool(toolDraft);
    setCustomTools(next);
    const created = next[next.length - 1];
    setShowToolEditor(false);
    // Select the new bit into the slot it belongs to; a drill has no slot of
    // its own, it just becomes an option on every drill row.
    if (created.role === 'profile') handleProfileToolChange(created.id);
    else if (created.role === 'isolation') handleToolPresetChange(created.id);
  };

  const handleDeleteCustomTool = (id: string) => {
    const next = deleteCustomTool(id);
    setCustomTools(next);
    if (selectedToolId === id) handleToolPresetChange('t1_vbit_30');
    if (profileToolId === id) handleProfileToolChange('t6b_endmill_15');
  };

  const handleMaterialPresetChange = (matId: string) => {
    setSelectedMaterialId(matId);
    const tool = availableTools.find(t => t.id === selectedToolId);
    const material = PCB_MATERIAL_PRESETS.find(m => m.id === matId);
    if (tool && material) {
      const feeds = calculatePcbFeeds(tool, material);
      setOptions(prev => ({
        ...prev,
        cutFeedrate: feeds.cutFeedrate,
        plungeFeedrate: feeds.plungeFeedrate,
        spindleRpm: feeds.spindleRpm,
        isolationDepthZ: feeds.isolationDepthZ,
        zStepdown: feeds.zStepdown,
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
    setMachineError(null);
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
        probeDepthMm,
        clearanceMm: options.safeZ,
      });
      setHeightmap(grid);
      return grid;
    } catch (e: any) {
      setMachineError(e?.message || 'Surface probe failed');
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

  /**
   * An M0 / M6 pause: the stream stopped between lines and the machine has
   * drained, so it is standing still and will accept commands.
   */
  const isStreamPaused =
    serialState.status === 'PAUSED_TOOL' || serialState.status === 'PAUSED_MATERIAL';

  /**
   * Jogging and re-zeroing are allowed when idle *and* during a stream pause —
   * changing a bit is exactly when work Z0 stops being valid, so re-probing has
   * to be reachable without cancelling the job.
   *
   * Not during an operator feed hold: GRBL is in Hold and would refuse the
   * move, and shifting position part-way through a cut would ruin the resume.
   */
  const manualMoveBlocked =
    !!busy ||
    isRunning ||
    serialState.status === 'PROBING' ||
    serialState.status === 'PAUSED_OPERATOR';

  const ensureConnected = async () => {
    if (serialState.connected) return true;
    setMachineError(null);
    if (transportMode === 'wifi' && !cloudDeviceId) {
      setMachineError('Enter the device IP address for WiFi mode');
      return false;
    }
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
   * Refuses a job whose depth was calculated against a height map that will not
   * be applied to it.
   *
   * The isolation depth is shaved down on the strength of a probed map — the
   * levelling is what buys back the margin. If the map no longer covers the
   * board (`heightmapStale`) it is dropped from the warp, and unless auto-level
   * is going to re-probe, the job would stream at the shallower depth with no
   * compensation at all: the two halves of the same decision disagreeing, which
   * cuts traces too faint to isolate and misses the copper entirely on the high
   * spots.
   */
  const heightmapWontBeApplied = heightmapStale && !autoLevel;

  const handleMillBoard = async () => {
    if (!result.success || machineBusy) return;
    if (heightmapWontBeApplied) {
      setMachineError(
        'The probed height map no longer covers this board, so it will not be applied — but the ' +
          'isolation depth was calculated assuming it would be. Re-probe the surface, or turn ' +
          'auto-level on so the job probes before it cuts.'
      );
      return;
    }
    if (!(await ensureConnected())) return;

    let grid = activeHeightmap;
    if (autoLevel && !grid) {
      grid = await runProbe();
      if (!grid) return;
    }

    setBusy('milling');
    try {
      await webSerialManager.startJob(webSerialManager.applyHeightmapToGcode(result.gcode, grid));
    } catch (e: any) {
      setMachineError(e?.message || 'Milling job failed');
    } finally {
      setBusy('');
    }
  };

  const handleFrameBoard = async () => {
    if (!result.success || machineBusy) return;
    if (!(await ensureConnected())) return;

    setBusy('milling');
    try {
      // The outline, not the job lifted up: it bounds every cut in the program,
      // so one lap answers the registration question — is the blank where the
      // job thinks it is, do the clamps foul the travel — in seconds instead of
      // re-flying ten thousand isolation moves.
      //
      // No probe and no height map either. The map compensates depth, and there
      // is no depth here; needing one would only stop an air cut being the
      // quick check it is supposed to be.
      await webSerialManager.startJob(
        generateAirCutPerimeterGcode(result, options, airCutZOffset)
      );
    } catch (e: any) {
      setMachineError(e?.message || 'Framing failed');
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
    } catch (e: any) {
      setStencilNote(e?.message || 'Could not build the paste stencil.');
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
  const handleStencilToEtch = async () => {
    if (!result.success) return;
    setStencilNote(null);
    try {
      const svg = pasteStencilSvg(result, options);
      await openSvgInEtch(svg, `PCB paste stencil ${Math.round(result.boardWidthMm)}x${Math.round(result.boardHeightMm)}`);
      setStencilNote('Stencil sent to Etch — set the kerf compensation there before cutting.');
    } catch (e: any) {
      setStencilNote(e?.message || 'Could not open the stencil in Etch.');
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
        `Shim written: ${Math.round(shim.widthMm)}×${Math.round(shim.heightMm)}mm at ` +
          `${shim.thicknessMm}mm. Print it in black, one layer, then cut the stencil from it.`
      );
    } catch (e: any) {
      setStencilNote(e?.message || 'Could not build the shim.');
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
    if (!activeHeightmap) return 0;
    const { x, y } = serialState.wpos;
    return interpolateGridZ(activeHeightmap, x, y);
  };

  const handleZeroZ = async () => {
    if (manualMoveBlocked) return;
    if (!(await ensureConnected())) return;
    setBusy('zeroing');
    setMachineError(null);
    try {
      // The map survives: it still describes this board against the same
      // plane, which is exactly what the offset above re-establishes.
      await webSerialManager.zeroZOnSurface(surfaceOffsetHere());
    } catch (e: any) {
      setMachineError(e?.message || 'Zeroing Z failed');
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
    setMachineError(null);
    try {
      await webSerialManager.zeroZ(touchPlateMm, surfaceOffsetHere());
    } catch (e: any) {
      setMachineError(e?.message || 'Zeroing Z on the touch plate failed');
    } finally {
      setBusy('');
    }
  };

  const handleZeroXY = async () => {
    if (machineBusy) return;
    if (!(await ensureConnected())) return;
    setMachineError(null);
    try {
      await webSerialManager.zeroXY();
    } catch (e: any) {
      setMachineError(e?.message || 'Zeroing XY failed');
    }
  };

  /**
   * Rapids back to the work origin, lifting Z first. This is the move you want
   * after framing or a tool change, and doing it by jogging is both slow and
   * imprecise.
   */
  const handleGoToZero = async () => {
    if (machineBusy) return;
    if (!(await ensureConnected())) return;
    setMachineError(null);
    try {
      await webSerialManager.gotoWorkOrigin();
    } catch (e: any) {
      setMachineError(e?.message || 'Go to zero failed');
    }
  };

  /**
   * Clears a GRBL alarm lockout ($X). Until this runs the controller answers
   * every G-code line with error:9, so nothing else on this tab can work.
   */
  const handleUnlock = async () => {
    if (!(await ensureConnected())) return;
    setMachineError(null);
    try {
      await webSerialManager.unlockAlarm();
    } catch (e: any) {
      setMachineError(e?.message || 'Unlock failed');
    }
  };

  /** Runs the homing cycle ($H) — the other way out of an alarm lockout. */
  const handleHome = async () => {
    if (!(await ensureConnected())) return;
    setMachineError(null);
    setBusy('homing');
    try {
      await webSerialManager.homeMachine();
    } catch (e: any) {
      setMachineError(e?.message || 'Homing failed');
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
    } catch (e: any) {
      setMachineError(e?.message || 'Jog command failed');
    }
  };

  /** Feed-holds a running job. Motion stops; nothing is lost. */
  const handlePause = async () => {
    setMachineError(null);
    try {
      await webSerialManager.pauseJob();
    } catch (e: any) {
      setMachineError(e?.message || 'Could not pause the job');
    }
  };

  /**
   * Traces the board outline with the spindle off, so the blank can be checked
   * against the job before any of it is cut.
   */
  const handleResume = async () => {
    setMachineError(null);
    try {
      await webSerialManager.resumeJob();
    } catch (e: any) {
      setMachineError(e?.message || 'Could not resume the job');
    }
  };

  const handleCancel = async () => {
    await webSerialManager.cancelJob();
    setBusy('');
  };

  /**
   * Abandons the operation being cut and runs it again from its first line —
   * which stops at that layer's tool change, bringing the re-zero prompt back
   * up before anything is re-cut.
   */
  const handleRestartLayer = async () => {
    if (busy) return;
    setMachineError(null);
    setBusy('milling');
    try {
      await webSerialManager.restartCurrentLayer();
    } catch (e: any) {
      setMachineError(e?.message || 'Could not restart this layer');
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
      <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl shadow-2xl w-full max-w-6xl overflow-hidden flex flex-col h-[92vh]">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-100/70 dark:bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-600 dark:text-emerald-400">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                PCB Milling &amp; CAM Engine
                <span className="text-xs font-normal px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                  WebSerial CNC
                </span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Automated trace routing, isolation toolpaths, through-hole drilling, outline framing, printable paste stencils, and surface heightmaps.
                <InfoTip>
                  Generates a single-sided copper board from your schematic, then drives a GRBL
                  machine directly over WebSerial.
                </InfoTip>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSafeClose}
              className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 grid grid-cols-1 md:grid-cols-12 overflow-hidden">
          {/* Main Visualizer Area */}
          <div className="md:col-span-7 p-5 bg-slate-100/70 dark:bg-slate-950/40 flex flex-col justify-between border-r border-slate-200 dark:border-slate-800 overflow-y-auto">
            {activeTab === 'cam' ? (
              <div className="flex-1 flex flex-col min-h-[360px]">
                <PcbToolpathPreview
                  result={result}
                  options={options}
                  heightmap={activeHeightmap}
                  isAirCut={isAirCutMode}
                  airCutZOffset={airCutZOffset}
                  liveProgress={liveProgress}
                  liveLayerLabel={liveLayer?.label ?? null}
                  onRestartLayer={isRunning || isPaused ? handleRestartLayer : undefined}
                  machineBusy={!!busy}
                />
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center min-h-[360px]">
                <div className="w-full flex items-center justify-between mb-2 text-xs text-slate-500 dark:text-slate-400">
                  <span className="flex items-center gap-1.5 font-mono">
                    <Layers className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    {result.boardWidthMm}mm × {result.boardHeightMm}mm PCB Board
                  </span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-mono">
                    {result.components.length} Parts | {result.nets.length} Nets | {result.drills.length} Drills
                  </span>
                </div>

                <div className="w-full aspect-[4/3] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-2 shadow-inner flex items-center justify-center overflow-hidden">
                  <div
                    className="w-full h-full"
                    dangerouslySetInnerHTML={{ __html: result.svg }}
                  />
                </div>

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
                  {gridStats && (
                    <span className="text-cyan-700 dark:text-cyan-400 font-bold flex items-center gap-1">
                      <Check className="w-3 h-3" /> Levelled — {activeHeightmap!.gridX}×{activeHeightmap!.gridY} mesh ({gridStats.spanZ.toFixed(3)}mm warp)
                    </span>
                  )}
                  {/* The two numbers that say whether this machine can hold the
                      depth the job is about to cut at. Warp is what levelling
                      removes; these are what it cannot, and they are spent out
                      of the same margin over the foil. Shown next to the warp
                      rather than buried, because a repeatability figure the
                      operator never sees is one nobody can act on. */}
                  {machineAccuracy.length > 0 && (
                    <span
                      className={`font-bold flex items-center gap-1 ${
                        accuracyIsPoor
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                      title={
                        'Measured on this setup: how far a second reading of the same spot landed ' +
                        'from the first. It comes out of the same margin over the copper as the warp does.'
                      }
                    >
                      {accuracyIsPoor && <AlertTriangle className="w-3 h-3" />}
                      Machine repeatability — {machineAccuracy.join(', ')}
                    </span>
                  )}
                  {heightmapStale && (
                    <span className="text-amber-600 dark:text-amber-400 font-bold flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> Heightmap discarded (board outgrew the probed mesh)
                    </span>
                  )}
                </div>
              </div>
            )}

            {unwarpable.length > 0 && (
              <div className="p-2 mt-2 bg-amber-500/10 border border-amber-500/30 rounded text-[11px] text-amber-700 dark:text-amber-300">
                Not compensated: {unwarpable.join(', ')} — these run at commanded depth.
              </div>
            )}

            {(machineError || serialState.lastError) && (
              <div className="p-2 mt-2 bg-red-500/10 border border-red-500/30 rounded text-[11px] text-red-700 dark:text-red-300 flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                <span>{machineError || serialState.lastError}</span>
              </div>
            )}

            {/* Design Rule Check Warnings / Errors */}
            <div className="w-full mt-3 space-y-1 max-h-28 overflow-y-auto">
              {result.success ? (
                <div className="flex items-center gap-1.5 text-[11px] font-mono text-emerald-600 dark:text-emerald-400">
                  <Check className="w-3.5 h-3.5 shrink-0" />
                  DRC Passed — {Math.round(result.completion * 100)}% routed, isolation safe.
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
            </div>
          </div>

          {/* Settings & Machine Control Panel */}
          <div className="md:col-span-5 bg-white/70 dark:bg-slate-900/60 flex flex-col justify-between overflow-y-auto">
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
              <button
                onClick={() => setActiveTab('serial')}
                className={`flex-1 py-3 border-b-2 text-center transition-colors cursor-pointer ${
                  activeTab === 'serial'
                    ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400 font-bold'
                    : 'border-transparent hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                WebSerial
              </button>
            </div>

            <div className="p-4 flex-1 space-y-3 text-xs">
              {activeTab === 'layout' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={options.autoGrowBoard}
                        onChange={e =>
                          setOptions({
                            ...options,
                            autoGrowBoard: e.target.checked,
                            ...(e.target.checked
                              ? {}
                              : {
                                  boardWidthMm: result.boardWidthMm,
                                  boardHeightMm: result.boardHeightMm,
                                }),
                          })
                        }
                        className="cursor-pointer"
                      />
                      <span className="text-slate-600 dark:text-slate-300 font-semibold">Auto-size board</span>
                      <InfoTip>
                        On, the board is sized dynamically to fit the parts. Off, the board is exactly the fixed dimensions you set.
                      </InfoTip>
                    </label>

                    {/* Redundant while auto-sizing: that already fits the board to
                        the circuit, and setting the floor to a padded estimate
                        would only stop it cropping. */}
                    {!options.autoGrowBoard && (
                      <button
                        type="button"
                        onClick={handleFitToCircuit}
                        className="text-[11px] text-cyan-700 dark:text-cyan-400 hover:text-cyan-600 dark:hover:text-cyan-300 hover:underline cursor-pointer flex items-center gap-1 font-semibold"
                        title="Recalculate dimensions to comfortably fit all components in the circuit"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Fit to circuit
                      </button>
                    )}
                  </div>

                  <div>
                    <label className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 font-semibold mb-1">
                      {options.autoGrowBoard ? 'Minimum Width (mm)' : 'Board Width (mm)'}
                    </label>
                    <input
                      type="number"
                      value={options.boardWidthMm}
                      onChange={e => setOptions({ ...options, boardWidthMm: parseFloat(e.target.value) || 50 })}
                      className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 font-semibold mb-1">
                      {options.autoGrowBoard ? 'Minimum Height (mm)' : 'Board Height (mm)'}
                    </label>
                    <input
                      type="number"
                      value={options.boardHeightMm}
                      onChange={e => setOptions({ ...options, boardHeightMm: parseFloat(e.target.value) || 40 })}
                      className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200"
                    />
                  </div>
                  {options.autoGrowBoard && (
                    <>
                      <p className="text-[11px] text-slate-500">
                        Auto-sized to{' '}
                        <span className="text-slate-600 dark:text-slate-300 font-semibold">
                          {result.boardWidthMm} x {result.boardHeightMm} mm
                        </span>
                        . Untick to force an exact size.
                      </p>
                      <div>
                        <label className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 font-semibold mb-1">
                          Edge Margin (mm)
                          <InfoTip>
                            Blank laminate left around the outermost copper, per side. The board
                            is cropped to the traces once routing is done, so this is what is
                            left to hold and clamp. The isolation ring and the profile kerf are
                            allowed for separately, so a small value here cannot cut into them.
                          </InfoTip>
                        </label>
                        <input
                          type="number"
                          step="0.5"
                          min="0"
                          value={options.boardMarginMm ?? 1.5}
                          onChange={e =>
                            setOptions({
                              ...options,
                              boardMarginMm: Math.max(0, parseFloat(e.target.value) || 0),
                            })
                          }
                          className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200"
                        />
                      </div>
                    </>
                  )}
                  <div>
                    <label className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 font-semibold mb-1">
                      Trace Width (mm)
                      <InfoTip>
                        What the router routes with — the width it reserves when deciding where a
                        track may go. It is the <em>minimum</em> copper, not the finished copper:
                        with flooding on, every track that has room ends up wider than this.
                      </InfoTip>
                    </label>
                    <input
                      type="number"
                      step="0.05"
                      value={options.traceWidthMm}
                      onChange={e => setOptions({ ...options, traceWidthMm: parseFloat(e.target.value) || 0.4 })}
                      className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 font-semibold mb-1">
                      Copper Flood (mm)
                      <InfoTip>
                        How far copper is allowed to spread outward past the routed trace, per
                        side. Everything the bit does not cut stays copper anyway, so a gap wider
                        than the bit's own channel is copper thrown away for nothing: flooding
                        grows each net back out until it is one channel width from its neighbour.
                        Traces in open laminate take the whole figure; traces squeezed between
                        pads keep only what the channel leaves. Fat copper couples more strongly
                        to its neighbours, so keep this small on RF or oscillator boards. 0 mills
                        the nominal trace width and nothing more.
                      </InfoTip>
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      value={options.copperFloodMm ?? 0}
                      onChange={e =>
                        setOptions({
                          ...options,
                          copperFloodMm: Math.max(0, parseFloat(e.target.value) || 0),
                        })
                      }
                      className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200"
                    />
                    <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400 leading-snug">
                      {result.copperFloodMm > 0
                        ? `Traces widen to ${(options.traceWidthMm + result.copperFloodMm * 2).toFixed(2)}mm ` +
                          `where there is room, stopping ${result.effectiveToolDiaMm.toFixed(3)}mm ` +
                          `short of the next net.`
                        : `Every trace is milled to ${options.traceWidthMm}mm and the rest of the gap is cut away.`}
                    </p>
                  </div>
                  <div>
                    <label className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 font-semibold mb-1">Trace Clearance (mm)</label>
                    <input
                      type="number"
                      step="0.05"
                      value={options.clearanceMm}
                      onChange={e => setOptions({ ...options, clearanceMm: parseFloat(e.target.value) || 0.3 })}
                      className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 font-semibold mb-1">
                      Pad Margin (mm)
                      <InfoTip>
                        Extra copper grown around every pad, per side. Footprint pads are sized for
                        a factory process and come out small on a milled board; a bigger annulus is
                        easier to solder by hand and tolerates a drill that wanders. The router
                        keeps clear of the grown copper, so a large value on a dense board can
                        leave nets unroutable.
                      </InfoTip>
                    </label>
                    <input
                      type="number"
                      step="0.05"
                      min="0"
                      value={options.padMarginMm ?? 0}
                      onChange={e =>
                        setOptions({ ...options, padMarginMm: Math.max(0, parseFloat(e.target.value) || 0) })
                      }
                      className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 font-semibold mb-1">
                      Drill Bit Merge (mm)
                      <InfoTip>
                        Hole sizes within this span share one drill bit, sized to the largest hole
                        in the group. Footprints carry the exact lead diameter of each part, so a
                        board with four part types otherwise means four drill changes. Set to 0 to
                        drill every nominal size with its own bit.
                      </InfoTip>
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      value={options.drillConsolidationMm ?? 0}
                      onChange={e =>
                        setOptions({
                          ...options,
                          drillConsolidationMm: Math.max(0, parseFloat(e.target.value) || 0),
                        })
                      }
                      className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 font-semibold mb-1">
                      Routing Effort
                      <InfoTip>
                        How long the maze router may search for a way around obstacles before
                        giving up. A denser board needs a bigger budget; routing runs in the
                        background either way.
                      </InfoTip>
                    </label>
                    <select
                      value={options.routingBudgetMs}
                      onChange={e =>
                        setOptions({ ...options, routingBudgetMs: parseInt(e.target.value, 10) })
                      }
                      className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200 font-sans"
                    >
                      {ROUTING_EFFORT_PRESETS.map(p => (
                        <option key={p.ms} value={p.ms}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                    {isRouting && (
                      <div className="mt-2 flex items-center gap-2 text-[11px] text-sky-700 dark:text-sky-300">
                        <RefreshCw size={11} className="animate-spin shrink-0" />
                        <span>
                          {progress
                            ? `Routing — pass ${progress.pass}/${progress.totalPasses}, ` +
                              `board ${progress.attempt}/${progress.totalAttempts}, ` +
                              `${(progress.completion * 100).toFixed(0)}% connected`
                            : 'Routing…'}
                        </span>
                      </div>
                    )}
                    {!isRouting && hasResult && result.completion < 1 && !atMaxEffort && (
                      <button
                        onClick={() => setOptions({ ...options, routingBudgetMs: nextEffortMs })}
                        className="mt-2 w-full px-2 py-1.5 bg-amber-500/10 border border-amber-500/40 rounded text-[11px] text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 transition"
                      >
                        {(result.completion * 100).toFixed(0)}% routed — try again with a bigger budget
                      </button>
                    )}
                  </div>
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
                        {showToolEditor ? 'Cancel' : '+ Add my own tool'}
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-snug">
                      Loaded in this order, one pause per change. Swap any row for a bit you
                      actually have: a bigger drill just leaves the hole oversize, and a smaller
                      one gets spiralled out to the right size instead.
                    </p>

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
                          value={selectedToolId}
                          onChange={e => handleToolPresetChange(e.target.value)}
                          className="mt-0.5 w-full px-2 py-1 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-[11px] text-slate-800 dark:text-slate-200 font-sans"
                        >
                          {availableTools.filter(t => t.role === 'isolation').map(tool => (
                            <option key={tool.id} value={tool.id}>
                              {tool.name}{tool.isCustom ? ' (mine)' : ''}
                            </option>
                          ))}
                        </select>
                        {selectedTool && (
                          <p className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400 leading-snug">
                            {selectedTool.description}
                            {selectedTool.isCustom && (
                              <button
                                onClick={() => handleDeleteCustomTool(selectedTool.id)}
                                className="ml-1 text-red-500 hover:underline"
                              >
                                Delete
                              </button>
                            )}
                          </p>
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
                              .filter(t => t.tipDiameterMm > bit.requiredMm)
                              .map(tool => (
                                <option key={tool.id} value={tool.tipDiameterMm}>
                                  {tool.name}{tool.isCustom ? ' (mine)' : ''}
                                </option>
                              ))}
                          </select>
                          {bit.nominals.length > 1 && (
                            <p className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400 leading-snug">
                              Covers {bit.nominals.map(n => `${n}mm`).join(', ')} &mdash; merged by the
                              drill-bit merge setting on the Layout tab.
                            </p>
                          )}
                          {bit.loadedMm > bit.requiredMm && (
                            <p className="mt-0.5 text-[10px] text-amber-600 dark:text-amber-400 leading-snug">
                              Holes come out {(bit.loadedMm - bit.requiredMm).toFixed(2)}mm oversize.
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
                          value={profileToolId}
                          onChange={e => handleProfileToolChange(e.target.value)}
                          className="mt-0.5 w-full px-2 py-1 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-[11px] text-slate-800 dark:text-slate-200 font-sans"
                        >
                          {availableTools.filter(t => t.role === 'profile').map(tool => (
                            <option key={tool.id} value={tool.id}>
                              {tool.name}{tool.isCustom ? ' (mine)' : ''}
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

                  {showToolEditor && (
                    <div className="p-2.5 rounded border border-emerald-500/40 bg-emerald-500/5 space-y-2">
                      <p className="text-[10px] text-slate-600 dark:text-slate-300 leading-snug">
                        Describe the bit and the feeds are derived from its chipload
                        (bite per tooth &times; teeth &times; RPM). Override any of them
                        afterwards in the fields below.
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
                          <input
                            type="number" step={0.01} min={0.01}
                            value={toolDraft.tipDiameterMm}
                            onChange={e => setToolDraft({ ...toolDraft, tipDiameterMm: parseFloat(e.target.value) || 0 })}
                            className="w-full px-2 py-1 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-[11px] font-mono"
                          />
                        </label>

                        {(toolDraft.type === 'vbit' || toolDraft.type === 'ballnose') && (
                          <label className="block">
                            <span className="block text-[10px] text-slate-500 dark:text-slate-400 mb-0.5">Included angle (°)</span>
                            <input
                              type="number" step={1} min={1} max={179}
                              value={toolDraft.angleDeg ?? 30}
                              onChange={e => setToolDraft({ ...toolDraft, angleDeg: parseFloat(e.target.value) || 30 })}
                              className="w-full px-2 py-1 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-[11px] font-mono"
                            />
                          </label>
                        )}

                        <label className="block">
                          <span className="block text-[10px] text-slate-500 dark:text-slate-400 mb-0.5">Flutes</span>
                          <input
                            type="number" step={1} min={1} max={8}
                            value={toolDraft.fluteCount ?? 1}
                            onChange={e => setToolDraft({ ...toolDraft, fluteCount: parseInt(e.target.value, 10) || 1 })}
                            className="w-full px-2 py-1 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-[11px] font-mono"
                          />
                        </label>

                        <label className="block">
                          <span className="block text-[10px] text-slate-500 dark:text-slate-400 mb-0.5">Spindle RPM</span>
                          <input
                            type="number" step={500} min={1000}
                            value={toolDraft.recommendedRpm ?? 12000}
                            onChange={e => setToolDraft({ ...toolDraft, recommendedRpm: parseInt(e.target.value, 10) || 12000 })}
                            className="w-full px-2 py-1 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-[11px] font-mono"
                          />
                        </label>

                        <label className="block">
                          <span className="block text-[10px] text-slate-500 dark:text-slate-400 mb-0.5">Chipload (mm/tooth)</span>
                          <input
                            type="number" step={0.005} min={0.001}
                            value={toolDraft.chiploadMm ?? suggestedChiploadMm(toolDraft.type, toolDraft.tipDiameterMm)}
                            onChange={e => setToolDraft({ ...toolDraft, chiploadMm: parseFloat(e.target.value) || undefined })}
                            className="w-full px-2 py-1 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-[11px] font-mono"
                          />
                        </label>
                      </div>

                      <p className="text-[10px] font-mono text-emerald-700 dark:text-emerald-300">
                        Derived cut feed:{' '}
                        {feedFromChipload(
                          toolDraft.chiploadMm ?? suggestedChiploadMm(toolDraft.type, toolDraft.tipDiameterMm),
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

                  <div>
                    <label className="flex items-center justify-between text-slate-600 dark:text-slate-300 font-semibold mb-1">
                      <span>Frame Z-Offset</span>
                      <span className="text-[10px] text-amber-600 dark:text-amber-400 font-mono">+{airCutZOffset}mm Z</span>
                    </label>
                    <div className="flex gap-1.5">
                      {[10, 20, 50].map(off => (
                        <button
                          key={off}
                          onClick={() => {
                            setAirCutZOffset(off);
                            setIsAirCutMode(true);
                          }}
                          className={`flex-1 py-1 rounded cursor-pointer text-[11px] font-semibold border ${
                            airCutZOffset === off
                              ? 'bg-amber-100 dark:bg-amber-600/30 border-amber-500 text-amber-700 dark:text-amber-300'
                              : 'bg-slate-100 dark:bg-slate-950 border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                          }`}
                        >
                          +{off}mm
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-slate-500 dark:text-slate-400 font-semibold mb-1 block">Cut Feed (mm/min)</label>
                      <input
                        type="number"
                        value={options.cutFeedrate}
                        onChange={e => setOptions({ ...options, cutFeedrate: parseInt(e.target.value, 10) || 300 })}
                        className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200"
                      />
                    </div>
                    <div>
                      <label className="text-slate-500 dark:text-slate-400 font-semibold mb-1 block">Plunge Feed (mm/min)</label>
                      <input
                        type="number"
                        value={options.plungeFeedrate}
                        onChange={e => setOptions({ ...options, plungeFeedrate: parseInt(e.target.value, 10) || 80 })}
                        className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-slate-500 dark:text-slate-400 font-semibold mb-1 block">Spindle RPM</label>
                      <input
                        type="number"
                        value={options.spindleRpm}
                        onChange={e => setOptions({ ...options, spindleRpm: parseInt(e.target.value, 10) || 12000 })}
                        className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200"
                      />
                    </div>
                    <div>
                      <label className="text-slate-500 dark:text-slate-400 font-semibold mb-1 flex items-center gap-1.5">
                        Isolation Depth (mm)
                        <InfoTip>
                          A V-bit gets wider the deeper it goes, so this number decides the
                          channel width and therefore how much copper is left either side of it.
                          Auto cuts just past the copper: foil thickness from the material
                          preset, plus the room the board's flatness demands. Probe a height map
                          and that allowance drops, the channel narrows, and the traces come out
                          fatter.
                        </InfoTip>
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={options.isolationDepthZ}
                        disabled={autoIsolationDepth}
                        onChange={e => setOptions({ ...options, isolationDepthZ: parseFloat(e.target.value) || -0.08 })}
                        className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200 disabled:opacity-60"
                      />
                      <label className="flex items-center gap-1.5 mt-1 cursor-pointer text-[10px] text-slate-500 dark:text-slate-400">
                        <input
                          type="checkbox"
                          checked={autoIsolationDepth}
                          onChange={e => {
                            setAutoIsolationDepth(e.target.checked);
                            localStorage.setItem('pcbAutoIsolationDepth', e.target.checked ? '1' : '0');
                          }}
                          className="accent-emerald-500"
                        />
                        <span>Auto — shallowest cut that clears the copper</span>
                      </label>
                    </div>
                  </div>

                  <div className="p-2.5 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded space-y-1.5">
                    <label className="flex items-center gap-2 cursor-pointer text-slate-600 dark:text-slate-300 font-medium">
                      <input
                        type="checkbox"
                        checked={options.rampedPlunge !== false}
                        onChange={e => setOptions({ ...options, rampedPlunge: e.target.checked })}
                        className="accent-emerald-500"
                      />
                      <span>Enable Ramped Entry Plunges</span>
                    </label>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed pl-5">
                      Angles Z entry into copper over 1.2mm travel, protecting fragile V-bit tip points from chip shock.
                    </p>
                  </div>
                </div>
              )}

              {activeTab === 'serial' && (
                <div className="space-y-3">
                  <div className="p-3 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-slate-800 dark:text-slate-200">GRBL Machine Connection</div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400">
                          {serialState.connected ? `Connected (${serialState.portName || 'Serial'})` : 'Disconnected'}
                        </div>
                      </div>
                      <button
                        onClick={ensureConnected}
                        disabled={serialState.connected}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-500 text-white font-semibold rounded cursor-pointer"
                      >
                        {serialState.connected
                          ? 'Connected'
                          : transportMode === 'wifi'
                          ? 'Connect WiFi'
                          : 'Connect Serial'}
                      </button>
                    </div>

                    {/* Transport picker: USB (Web Serial) or WiFi (ESP32 proxy) */}
                    <div className="grid grid-cols-2 gap-1.5">
                      {(['usb', 'wifi'] as const).map(mode => (
                        <button
                          key={mode}
                          onClick={() => {
                            setTransportMode(mode);
                            localStorage.setItem('grblTransport', mode);
                          }}
                          disabled={serialState.connected}
                          className={`py-1.5 rounded text-[11px] font-semibold border cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                            transportMode === mode
                              ? 'bg-emerald-100 dark:bg-emerald-600/30 border-emerald-500 text-emerald-700 dark:text-emerald-300'
                              : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                          }`}
                        >
                          {mode === 'usb' ? 'USB (Web Serial)' : 'WiFi'}
                        </button>
                      ))}
                    </div>

                    {/* WiFi means a Tekno Box, reached through physbox rather
                        than by address: the box is behind the customer's router
                        with nothing to dial, and a page on https may not open a
                        plain connection to a home network in any case. */}
                    {transportMode === 'wifi' && (
                      <div className="space-y-1.5">
                        <label className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold block">
                          Tekno Box
                        </label>
                        <TeknoBoxPicker
                          value={cloudDeviceId}
                          onChange={deviceId => {
                            setCloudDeviceId(deviceId);
                            localStorage.setItem('grblCloudDeviceId', deviceId);
                          }}
                          disabled={serialState.connected}
                          accentClass="bg-emerald-600 hover:bg-emerald-500 text-white"
                        />
                      </div>
                    )}
                  </div>

                  {/* Alarm banner. GRBL boots into Alarm whenever homing is
                      enabled, and lands there again after a limit trip or a
                      failed probe, refusing every G-code line with error:9
                      until it is cleared. The banner explains the state; the
                      controls below it are always present, because homing and
                      unlocking are equally wanted when nothing is wrong. */}
                  {serialState.status === 'ALARM' && (
                    <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-600/60 rounded-lg text-amber-700 dark:text-amber-300 text-[11px] leading-relaxed">
                      <span className="font-semibold">Machine is in alarm.</span>{' '}
                      It will reject every command (error:9) until it is unlocked or homed.
                      {serialState.lastError ? ` ${serialState.lastError}` : ''}
                    </div>
                  )}

                  <div className="p-3 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg space-y-2">
                    <div className="font-semibold text-slate-800 dark:text-slate-200 text-[11px]">Machine controls</div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        onClick={handleUnlock}
                        disabled={!!busy || !serialState.connected}
                        title="Clear a GRBL alarm lockout"
                        className="py-1.5 rounded text-[11px] font-semibold bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white cursor-pointer"
                      >
                        Unlock ($X)
                      </button>
                      <button
                        onClick={handleHome}
                        disabled={!!busy || !serialState.connected}
                        title="Run the homing cycle"
                        className="py-1.5 rounded text-[11px] font-semibold bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 border border-slate-400 dark:border-slate-600 disabled:opacity-40 disabled:cursor-not-allowed text-slate-800 dark:text-slate-200 cursor-pointer"
                      >
                        {busy === 'homing' ? 'Homing…' : 'Home ($H)'}
                      </button>
                    </div>
                  </div>

                  {/* Operator feed hold, while a job is actually moving */}
                  {isRunning && (
                    <button
                      onClick={handlePause}
                      className="w-full py-2 bg-amber-600 hover:bg-amber-500 text-white rounded font-semibold cursor-pointer"
                    >
                      Pause job
                    </button>
                  )}

                  {/* The pause itself is presented as a full-screen modal
                      (JobPauseModal, rendered below) — a stopped machine with a
                      bit half out is not something to leave behind a tab. */}

                  {/* Interactive Jog Keypad Controls */}
                  <div className="p-3 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg space-y-2">
                    <div className="flex items-center justify-between text-slate-600 dark:text-slate-300 font-semibold">
                      <span className="flex items-center gap-1">
                        <Crosshair className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                        Manual Jog Controls
                      </span>
                      <div className="flex gap-1 text-[10px]">
                        {[0.1, 1.0, 10.0].map(st => (
                          <button
                            key={st}
                            onClick={() => setJogStep(st)}
                            className={`px-1.5 py-0.5 rounded cursor-pointer ${
                              jogStep === st ? 'bg-emerald-500 text-white font-bold' : 'bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            {st}mm
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-1.5 items-center justify-items-center py-1">
                      <div></div>
                      <button
                        onClick={() => handleJog('Y', 1)}
                        disabled={manualMoveBlocked}
                        className="w-10 h-8 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 text-slate-800 dark:text-slate-200 rounded flex items-center justify-center cursor-pointer"
                        title="Jog Y+"
                      >
                        <ArrowUp className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleJog('Z', 1)}
                        disabled={manualMoveBlocked}
                        className="px-2 h-8 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 text-slate-800 dark:text-slate-200 rounded text-[10px] font-bold cursor-pointer"
                        title="Jog Z+"
                      >
                        Z+
                      </button>

                      <button
                        onClick={() => handleJog('X', -1)}
                        disabled={manualMoveBlocked}
                        className="w-10 h-8 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 text-slate-800 dark:text-slate-200 rounded flex items-center justify-center cursor-pointer"
                        title="Jog X-"
                      >
                        <ArrowLeft className="w-4 h-4" />
                      </button>
                      {/* The centre of a jog cross is where every other machine
                          control puts "go home", so a button here read as one —
                          and setting the work origin is the one action on this
                          panel you cannot undo by jogging back. It lives below
                          with the other zeros now, named. */}
                      <div
                        className="w-10 h-8 flex items-center justify-center text-slate-300 dark:text-slate-700"
                        aria-hidden
                      >
                        <Crosshair className="w-3.5 h-3.5" />
                      </div>
                      <button
                        onClick={() => handleJog('X', 1)}
                        disabled={manualMoveBlocked}
                        className="w-10 h-8 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 text-slate-800 dark:text-slate-200 rounded flex items-center justify-center cursor-pointer"
                        title="Jog X+"
                      >
                        <ArrowRight className="w-4 h-4" />
                      </button>

                      <div></div>
                      <button
                        onClick={() => handleJog('Y', -1)}
                        disabled={manualMoveBlocked}
                        className="w-10 h-8 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 text-slate-800 dark:text-slate-200 rounded flex items-center justify-center cursor-pointer"
                        title="Jog Y-"
                      >
                        <ArrowDown className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleJog('Z', -1)}
                        disabled={manualMoveBlocked}
                        className="px-2 h-8 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 text-slate-800 dark:text-slate-200 rounded text-[10px] font-bold cursor-pointer"
                        title="Jog Z-"
                      >
                        Z-
                      </button>
                    </div>

                    <div className="pt-2 mt-1 border-t border-slate-200 dark:border-slate-800">
                      <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                        Set the work origin
                      </p>
                      {/* XY first because that is the order it is done in: park
                          the bit on the corner of the blank, fix X0 Y0 there,
                          then probe Z on the copper. */}
                      <button
                        onClick={handleZeroXY}
                        disabled={machineBusy}
                        title="Sets the work origin X0 Y0 at the tool's current position (G10 L20)"
                        className={`w-full py-1.5 rounded font-semibold text-[11px] flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40 ${
                          serialState.zeroXYConfirmed
                            ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                            : 'bg-emerald-700 hover:bg-emerald-600 text-white'
                        }`}
                      >
                        {serialState.zeroXYConfirmed ? (
                          <Check className="w-3.5 h-3.5" />
                        ) : (
                          <Crosshair className="w-3.5 h-3.5" />
                        )}
                        {serialState.zeroXYConfirmed ? 'XY0 set here' : 'Set XY0 at this spot'}
                      </button>
                      <p className="mt-1 mb-2 text-[9px] text-slate-400 dark:text-slate-500 leading-normal">
                        Jog the bit over the front-left corner of the blank first — everything the
                        job cuts is measured from the spot you set here.
                      </p>

                      <div className="flex gap-2">
                      <button
                        onClick={handleZeroZ}
                        disabled={manualMoveBlocked}
                        title="Probe straight onto the copper, using the continuity clip"
                        className="flex-1 py-1 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 text-slate-800 dark:text-slate-200 rounded font-semibold text-[11px] flex items-center justify-center gap-1 cursor-pointer"
                      >
                        {busy === 'zeroing' && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                        Probe Z0 on Copper
                      </button>
                      <button
                        onClick={handleZeroZOnPlate}
                        disabled={manualMoveBlocked}
                        title={`Probe onto the touch plate and set Z0 ${touchPlateMm}mm below the contact point`}
                        className="flex-1 py-1 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 text-slate-800 dark:text-slate-200 rounded font-semibold text-[11px] flex items-center justify-center gap-1 cursor-pointer"
                      >
                        Probe Z0 on Plate
                      </button>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={handleGoToZero}
                        disabled={manualMoveBlocked}
                        title="Lift Z to clearance, then rapid back to the work origin (X0 Y0)"
                        className="flex-1 py-1 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 text-slate-800 dark:text-slate-200 rounded font-semibold text-[11px] flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <Crosshair className="w-3.5 h-3.5" />
                        Go to Zero
                      </button>
                    </div>

                    {/* Setting the work origin is otherwise silent: the button
                        sends a line, GRBL says nothing a human sees, and the
                        only evidence is the DRO changing. */}
                    {(serialState.zeroXYPending || serialState.zeroXYConfirmed ||
                      serialState.zeroZPending || serialState.zeroZConfirmed) && (
                      <div className="space-y-0.5 text-[10px] font-semibold">
                        {serialState.zeroXYConfirmed && (
                          <div className="text-emerald-600 dark:text-emerald-400">
                            XY zeroed - work origin set here
                          </div>
                        )}
                        {serialState.zeroXYPending && (
                          <div className="text-amber-600 dark:text-amber-400">
                            XY zeroing - waiting for the machine to confirm...
                          </div>
                        )}
                        {serialState.zeroZConfirmed && (
                          <div className="text-emerald-600 dark:text-emerald-400">
                            Z zeroed at {(serialState.zeroZTargetMm ?? 0).toFixed(2)}mm
                          </div>
                        )}
                        {serialState.zeroZPending && (
                          <div className="text-amber-600 dark:text-amber-400">
                            Z zeroing - waiting for the machine to confirm...
                          </div>
                        )}
                      </div>
                    )}

                    {/* The zeros outlive the tab. Closing it mid-job used to lose
                        the only record of where the origin was, and a re-zero by
                        eye does not land back on the same spot. */}
                    {serialState.savedZero && !serialState.zeroXYConfirmed && !serialState.zeroZConfirmed && (
                      <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                        Work origin kept from last session
                        {serialState.zeroRestored && ' - restored onto the machine'}
                        {' '}({(['x', 'y', 'z'] as const)
                          .filter(a => serialState.savedZero![a] !== undefined)
                          .map(a => `${a.toUpperCase()} ${serialState.savedZero![a]!.toFixed(2)}`)
                          .join(' ')})
                      </div>
                    )}

                    {/* The plate thickness is what makes plate-probing land on
                        the right Z — a wrong number here is a wrong cut depth
                        on every path, so it is edited right next to the button
                        that uses it. */}
                    <div>
                      <label className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold mb-1 block">
                        Touch plate thickness (mm)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="0.1"
                        value={touchPlateMm}
                        disabled={machineBusy}
                        onChange={e => {
                          const v = parseFloat(e.target.value) || DEFAULT_TOUCH_PLATE_MM;
                          setTouchPlateMm(v);
                          localStorage.setItem('grblTouchPlateMm', String(v));
                        }}
                        className="w-full px-2 py-1.5 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200 font-mono text-[11px] disabled:opacity-40"
                      />
                    </div>
                  </div>

                  {/* Surface Probing & Action Buttons */}
                  <div className="p-3 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-600 dark:text-slate-300">Surface Mesh Probing</span>
                      <span className="text-[10px] text-cyan-700 dark:text-cyan-400 font-mono">
                        {suggestedGrid.cols}×{suggestedGrid.rows} Auto Mesh
                      </span>
                    </div>
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={autoLevel}
                        onChange={e => setAutoLevel(e.target.checked)}
                        className="mt-0.5 accent-cyan-500"
                      />
                      <span className="text-[11px] text-slate-600 dark:text-slate-300">
                        Auto-level surface before milling (re-references heightmap to Z0)
                      </span>
                    </label>

                    {/* Retract height and probe search distance. Both feed the
                        probe cycle directly: the tool lifts to safe Z between
                        points, then searches `probeDepthMm` downward from
                        there. */}
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <div>
                        <label className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold mb-1 block">
                          Retract / safe Z (mm)
                        </label>
                        <input
                          type="number"
                          step="0.5"
                          min="0.5"
                          value={options.safeZ}
                          disabled={machineBusy}
                          onChange={e => {
                            const v = parseFloat(e.target.value) || DEFAULT_SAFE_Z_MM;
                            setOptions({ ...options, safeZ: v });
                            localStorage.setItem('grblSafeZMm', String(v));
                          }}
                          className="w-full px-2 py-1.5 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200 font-mono text-[11px] disabled:opacity-40"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold mb-1 block">
                          Probe search depth (mm)
                        </label>
                        <input
                          type="number"
                          step="0.5"
                          min="0.5"
                          value={probeDepthMm}
                          disabled={machineBusy}
                          onChange={e => {
                            const v = parseFloat(e.target.value) || DEFAULT_PROBE_DEPTH_MM;
                            setProbeDepthMm(v);
                            localStorage.setItem('grblProbeDepthMm', String(v));
                          }}
                          className="w-full px-2 py-1.5 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200 font-mono text-[11px] disabled:opacity-40"
                        />
                      </div>
                    </div>

                    {/* The probe starts at the retract height, so anything less
                        than that never reaches Z0 at all — it alarms out on the
                        first point rather than after a slow full-grid pass. */}
                    {probeDepthMm <= options.safeZ && (
                      <div className="text-[10px] text-amber-700 dark:text-amber-400 leading-relaxed">
                        Search depth must exceed the {options.safeZ}mm retract height, or the probe
                        stops above the copper and the machine raises ALARM:5.
                      </div>
                    )}

                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={handleStartSurfaceProbe}
                        disabled={machineBusy}
                        className="flex-1 py-1.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 text-slate-600 dark:text-slate-300 rounded font-semibold flex items-center justify-center gap-1 cursor-pointer text-[11px]"
                      >
                        <Compass className="w-3.5 h-3.5" />
                        {activeHeightmap ? 'Re-probe surface' : 'Probe surface'}
                      </button>

                      <button
                        onClick={handleFrameBoard}
                        disabled={machineBusy}
                        title="Trace the board outline with the spindle off, to check the blank before cutting"
                        className="flex-1 py-1.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 text-slate-800 dark:text-slate-200 rounded font-semibold flex items-center justify-center gap-1.5 cursor-pointer text-xs"
                      >
                        <Crosshair className="w-3.5 h-3.5" />
                        Frame {result.boardWidthMm}x{result.boardHeightMm}
                      </button>
                    </div>

                    <div className="flex items-center justify-between pt-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      <span className="flex items-center gap-1">
                        Solder paste stencil
                        <InfoTip>
                          Three routes to the same part. <strong>Print</strong> it as a
                          0.2mm sheet — simplest, but printed apertures close up below about
                          0.5mm, so it stops at roughly SOIC/1.27mm pitch.{' '}
                          <strong>Laser</strong> it in Etch — a ~0.1mm beam holds about 0.65mm
                          pitch. Or, better on a diode, print the <strong>shim</strong>: one layer
                          of black filament, or buy 0.1–0.15mm opaque black polyester (PET/Mylar).
                          Blue cuts what absorbs blue, so black is the dependable stock and
                          polyimide — the CO2 answer — is only marginal on a diode. Never cut
                          vinyl/PVC &quot;stencil film&quot;: hydrogen chloride wrecks the machine
                          and your lungs. Ducted extraction either way.
                        </InfoTip>
                      </span>
                    </div>

                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={handleExportPasteStencil}
                        disabled={!result.success}
                        title={PASTE_STENCIL_HINT}
                        className="flex-1 min-w-0 py-2 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 text-slate-800 dark:text-slate-200 rounded font-bold flex items-center justify-center gap-1.5 cursor-pointer text-xs whitespace-nowrap"
                      >
                        <Box className="w-4 h-4 shrink-0" />
                        Paste Stencil
                      </button>

                      <button
                        onClick={handleExportShim}
                        disabled={!result.success}
                        title={SHIM_HINT}
                        className="shrink-0 px-2 py-2 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 text-slate-800 dark:text-slate-200 rounded font-bold flex items-center justify-center cursor-pointer text-xs"
                      >
                        <Layers2 className="w-4 h-4" />
                      </button>

                      <button
                        onClick={handleStencilToEtch}
                        disabled={!result.success}
                        title={ETCH_HINT}
                        className="shrink-0 px-2 py-2 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 text-slate-800 dark:text-slate-200 rounded font-bold flex items-center justify-center cursor-pointer text-xs"
                      >
                        <Scissors className="w-4 h-4" />
                      </button>

                      <button
                        onClick={handleMillBoard}
                        disabled={!result.success || machineBusy}
                        className="flex-1 min-w-0 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded font-bold flex items-center justify-center gap-1.5 cursor-pointer text-xs shadow-sm whitespace-nowrap"
                      >
                        {busy ? <RefreshCw className="w-4 h-4 shrink-0 animate-spin" /> : <Play className="w-4 h-4 shrink-0" />}
                        Start Milling
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Bottom Action Footer */}
            <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-100/70 dark:bg-slate-950/60 flex items-center justify-between gap-2">
              {/* Whatever the last export had to say — a file written, or why
                  the mask is not worth printing for this board. */}
              <div className="flex flex-1 items-center gap-2 min-w-0">
                {stencilNote && (
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate" title={stencilNote}>
                    {stencilNote}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={handleFrameBoard}
                  disabled={!result.success || machineBusy}
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white font-bold rounded flex items-center gap-1.5 cursor-pointer text-xs shadow-sm whitespace-nowrap"
                  title={`Trace the board outline live, ${airCutZOffset}mm above safe Z, with no spindle and no plunges — checks the blank is where the job thinks it is`}
                >
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                  Frame
                </button>

                <button
                  onClick={handleExportPasteStencil}
                  disabled={!result.success}
                  className="px-3 py-1.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 text-slate-800 dark:text-slate-200 font-bold rounded flex items-center gap-1.5 cursor-pointer text-xs whitespace-nowrap"
                  title={PASTE_STENCIL_HINT}
                >
                  <Box className="w-3.5 h-3.5 shrink-0" />
                  Export Paste Stencil
                </button>

                <button
                  onClick={handleExportShim}
                  disabled={!result.success}
                  className="px-2 py-1.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 text-slate-800 dark:text-slate-200 font-bold rounded flex items-center cursor-pointer text-xs"
                  title={SHIM_HINT}
                >
                  <Layers2 className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={handleStencilToEtch}
                  disabled={!result.success}
                  className="px-2 py-1.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 text-slate-800 dark:text-slate-200 font-bold rounded flex items-center cursor-pointer text-xs"
                  title={ETCH_HINT}
                >
                  <Scissors className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={handleMillBoard}
                  disabled={!result.success || machineBusy}
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

      {isPaused && (
        <JobPauseModal
          message={serialState.pauseMessage || 'Job paused'}
          isStreamPaused={isStreamPaused}
          touchPlateMm={touchPlateMm}
          spindleRpm={options.spindleRpm}
          zeroScatterMm={serialState.zeroZScatterMm}
          busy={busy}
          needsZero={!!serialState.needsZeroBeforeResume}
          error={machineError}
          onResume={handleResume}
          onCancel={handleCancel}
          onZeroOnCopper={handleZeroZ}
          onZeroOnPlate={handleZeroZOnPlate}
        />
      )}
    </div>
  );
};
