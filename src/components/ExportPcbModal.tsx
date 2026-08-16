import React, { useState, useMemo } from 'react';
import type { Node, Edge } from '@xyflow/react';
import {
  X,
  Cpu,
  Download,
  Play,
  Layers,
  Sparkles,
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
} from 'lucide-react';
import {
  generateExcellon,
  generateAirCutGcode,
  calculateSuggestedBoardSize,
  DEFAULT_PCB_OPTIONS,
  type PcbOptions,
} from '../utils/pcbExporter';
import {
  PCB_TOOL_PRESETS,
  PCB_MATERIAL_PRESETS,
  calculatePcbFeeds,
} from '../utils/pcbTooling';
import { usePcbLayout } from '../hooks/usePcbLayout';
import { webSerialManager } from '../utils/webSerialManager';
import { getGridStats, findUnwarpableCommands, suggestProbeGrid, type ProbeGrid } from '../utils/meshLeveler';
import { PcbToolpathPreview } from './PcbToolpathPreview';
import { InfoTip } from './InfoTip';

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

/** Search distance for a mesh probe point, measured down from the retract. */
const DEFAULT_PROBE_DEPTH_MM = 3;
/** Retract height between probe points and rapid moves. */
const DEFAULT_SAFE_Z_MM = 2;
/** Thickness of the touch plate used to set work Z0. */
const DEFAULT_TOUCH_PLATE_MM = 12;

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
  onOpenAICopilot?: (contextPrompt?: string) => void;
}

export const ExportPcbModal: React.FC<ExportPcbModalProps> = ({
  onClose,
  nodes = [],
  edges = [],
  onOpenAICopilot,
}) => {
  const [options, setOptions] = useState<PcbOptions>(() => {
    const suggested = calculateSuggestedBoardSize(nodes, DEFAULT_PCB_OPTIONS);
    return {
      ...DEFAULT_PCB_OPTIONS,
      boardWidthMm: suggested.widthMm,
      boardHeightMm: suggested.heightMm,
      // Retract height is a property of the bench, not of this board, so the
      // saved one wins over the built-in default.
      safeZ: readNumericSetting('grblSafeZMm', DEFAULT_PCB_OPTIONS.safeZ),
    };
  });
  const [activeTab, setActiveTab] = useState<'layout' | 'cam' | 'serial'>('layout');
  const [serialState, setSerialState] = useState(webSerialManager.getState());
  const [autoLevel, setAutoLevel] = useState(true);
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
  const [heightmap, setHeightmap] = useState<{ grid: ProbeGrid; boardTag: string } | null>(null);

  const [selectedToolId, setSelectedToolId] = useState<string>('t1_vbit_30');
  const [selectedMaterialId, setSelectedMaterialId] = useState<string>('fr4_1oz');
  const [airCutZOffset, setAirCutZOffset] = useState<number>(20);
  const [isAirCutMode, setIsAirCutMode] = useState<boolean>(false);
  const [jogStep, setJogStep] = useState<number>(1.0);

  // How the machine is reached: direct USB (Web Serial) or WiFi via an ESP32
  // WebSocket proxy. USB stays the default; the WiFi IP is remembered.
  const [transportMode, setTransportMode] = useState<'usb' | 'wifi'>(
    () => (localStorage.getItem('grblTransport') === 'wifi' ? 'wifi' : 'usb')
  );
  const [wifiIp, setWifiIp] = useState<string>(() => localStorage.getItem('grblWifiIp') || '');

  React.useEffect(() => {
    return webSerialManager.addListener(state => {
      setSerialState(state);
    });
  }, []);

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
  const boardTag = `${result.boardWidthMm}x${result.boardHeightMm}mm`;

  const activeHeightmap = heightmap && heightmap.boardTag === boardTag ? heightmap.grid : null;
  const heightmapStale = heightmap !== null && activeHeightmap === null;

  const gridStats = activeHeightmap ? getGridStats(activeHeightmap) : null;

  const unwarpable = useMemo(
    () => (activeHeightmap ? findUnwarpableCommands(result.gcode) : []),
    [activeHeightmap, result.gcode]
  );

  const handleToolPresetChange = (toolId: string) => {
    setSelectedToolId(toolId);
    const tool = PCB_TOOL_PRESETS.find(t => t.id === toolId);
    const material = PCB_MATERIAL_PRESETS.find(m => m.id === selectedMaterialId);
    if (tool && material) {
      const feeds = calculatePcbFeeds(tool, material);
      setOptions(prev => ({
        ...prev,
        vBitAngleDeg: tool.angleDeg ?? prev.vBitAngleDeg,
        vBitTipMm: tool.tipDiameterMm,
        cutFeedrate: feeds.cutFeedrate,
        plungeFeedrate: feeds.plungeFeedrate,
        spindleRpm: feeds.spindleRpm,
        isolationDepthZ: feeds.isolationDepthZ,
        zStepdown: feeds.zStepdown,
      }));
    }
  };

  const handleMaterialPresetChange = (matId: string) => {
    setSelectedMaterialId(matId);
    const tool = PCB_TOOL_PRESETS.find(t => t.id === selectedToolId);
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
        minX: 0,
        minY: 0,
        maxX: result.boardWidthMm,
        maxY: result.boardHeightMm,
        cols: suggestedGrid.cols,
        rows: suggestedGrid.rows,
        probeDepthMm,
        clearanceMm: options.safeZ,
      });
      setHeightmap({ grid, boardTag });
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

  const ensureConnected = async () => {
    if (serialState.connected) return true;
    setMachineError(null);
    if (transportMode === 'wifi' && !wifiIp.trim()) {
      setMachineError('Enter the device IP address for WiFi mode');
      return false;
    }
    webSerialManager.setTransport(transportMode, wifiIp.trim());
    const connected = await webSerialManager.connect();
    if (!connected) {
      setMachineError(
        transportMode === 'wifi'
          ? `Could not connect to the device at ${wifiIp.trim()}`
          : 'Could not open the serial port'
      );
    }
    return connected;
  };

  const downloadFile = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadDrill = () => {
    downloadFile(generateExcellon(result), `pcb_drills_${boardTag}.drl`, 'text/plain;charset=utf-8');
  };

  const handleDownloadSvg = () => {
    downloadFile(result.svg, `pcb_layout_${boardTag}.svg`, 'image/svg+xml;charset=utf-8');
  };

  const handleMillBoard = async () => {
    if (!result.success || machineBusy) return;
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

  const handleAirCutBoard = async () => {
    if (!result.success || machineBusy) return;
    if (!(await ensureConnected())) return;

    let grid = activeHeightmap;
    if (autoLevel && !grid) {
      grid = await runProbe();
      if (!grid) return;
    }

    setBusy('milling');
    try {
      const baseGcode = webSerialManager.applyHeightmapToGcode(result.gcode, grid);
      const airCutGcode = generateAirCutGcode(baseGcode, airCutZOffset);
      await webSerialManager.startJob(airCutGcode);
    } catch (e: any) {
      setMachineError(e?.message || 'Air Cut job failed');
    } finally {
      setBusy('');
    }
  };

  const handleStartSurfaceProbe = async () => {
    if (machineBusy) return;
    if (!(await ensureConnected())) return;
    await runProbe();
  };

  const handleZeroZ = async () => {
    if (machineBusy) return;
    if (!(await ensureConnected())) return;
    setBusy('zeroing');
    setMachineError(null);
    try {
      await webSerialManager.zeroZOnSurface();
      setHeightmap(null);
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
    if (machineBusy) return;
    if (!(await ensureConnected())) return;
    setBusy('zeroing');
    setMachineError(null);
    try {
      await webSerialManager.zeroZ(touchPlateMm);
      setHeightmap(null);
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
    if (machineBusy) return;
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
  const handleFrameBoard = async () => {
    if (machineBusy) return;
    if (!(await ensureConnected())) return;
    setMachineError(null);
    setBusy('milling');
    try {
      await webSerialManager.frameJob(
        { minX: 0, minY: 0, maxX: result.boardWidthMm, maxY: result.boardHeightMm },
        { safeZMm: options.safeZ }
      );
    } catch (e: any) {
      setMachineError(e?.message || 'Framing failed');
    } finally {
      setBusy('');
    }
  };

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

  const handleTriggerSparklesCopilot = () => {
    const contextPrompt = `Analyze this PCB design for milling accuracy, trace isolation clearances, component footprint placements, or potential isolation issues:
- Board Dimensions: ${options.boardWidthMm}mm x ${options.boardHeightMm}mm
- Trace Width: ${options.traceWidthMm}mm | Clearance: ${options.clearanceMm}mm
- Component Count: ${result.components.length} | Drill Hole Count: ${result.drills.length}
- Isolation Depth: ${options.isolationDepthZ}mm | V-Bit Angle: ${options.vBitAngleDeg}°
Please check if trace clearances are safe for a 30° V-bit and recommend any routing or CAM adjustments if something looks slightly off.`;

    if (onOpenAICopilot) {
      onOpenAICopilot(contextPrompt);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl shadow-2xl w-full max-w-6xl overflow-hidden flex flex-col max-h-[92vh]">
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
                Automated trace routing, isolation toolpaths, through-hole drilling, air cuts, and surface heightmaps.
                <InfoTip>
                  Generates a single-sided copper board from your schematic. Download the G-code and drill
                  files, or drive a GRBL machine directly over WebSerial.
                </InfoTip>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleTriggerSparklesCopilot}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer"
              title="Open AI Copilot to analyze PCB design and fix layout issues"
            >
              <Sparkles className="w-4 h-4 text-indigo-700 dark:text-indigo-200" />
              <span>Sparkles Copilot</span>
            </button>

            <button
              onClick={onClose}
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
                      <Check className="w-3 h-3" /> Levelled — {suggestedGrid.cols}×{suggestedGrid.rows} mesh ({gridStats.spanZ.toFixed(3)}mm warp)
                    </span>
                  )}
                  {heightmapStale && (
                    <span className="text-amber-600 dark:text-amber-400 font-bold flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> Heightmap discarded (board resized)
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

                    <button
                      type="button"
                      onClick={handleFitToCircuit}
                      className="text-[11px] text-cyan-700 dark:text-cyan-400 hover:text-cyan-600 dark:hover:text-cyan-300 hover:underline cursor-pointer flex items-center gap-1 font-semibold"
                      title="Recalculate dimensions to comfortably fit all components in the circuit"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Fit to circuit
                    </button>
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
                    <p className="text-[11px] text-slate-500">
                      Auto-sized to{' '}
                      <span className="text-slate-600 dark:text-slate-300 font-semibold">
                        {result.boardWidthMm} x {result.boardHeightMm} mm
                      </span>
                      . Untick to force an exact size.
                    </p>
                  )}
                  <div>
                    <label className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 font-semibold mb-1">Trace Width (mm)</label>
                    <input
                      type="number"
                      step="0.05"
                      value={options.traceWidthMm}
                      onChange={e => setOptions({ ...options, traceWidthMm: parseFloat(e.target.value) || 0.4 })}
                      className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200"
                    />
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
                  <div>
                    <label className="flex items-center justify-between text-slate-600 dark:text-slate-300 font-semibold mb-1">
                      <span>Tool Preset</span>
                      <span className="text-[10px] text-emerald-600 dark:text-emerald-400">T1-T6 Catalog</span>
                    </label>
                    <select
                      value={selectedToolId}
                      onChange={e => handleToolPresetChange(e.target.value)}
                      className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200 font-sans"
                    >
                      {PCB_TOOL_PRESETS.map(tool => (
                        <option key={tool.id} value={tool.id}>
                          {tool.name}
                        </option>
                      ))}
                    </select>
                  </div>

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
                      <span>Air Cut Z-Offset</span>
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
                      <label className="text-slate-500 dark:text-slate-400 font-semibold mb-1 block">Isolation Depth (mm)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={options.isolationDepthZ}
                        onChange={e => setOptions({ ...options, isolationDepthZ: parseFloat(e.target.value) || -0.08 })}
                        className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200"
                      />
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

                    {transportMode === 'wifi' && (
                      <div>
                        <label className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold mb-1 block">
                          Device IP address
                        </label>
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="192.168.1.50"
                          value={wifiIp}
                          disabled={serialState.connected}
                          onChange={e => {
                            setWifiIp(e.target.value);
                            localStorage.setItem('grblWifiIp', e.target.value);
                          }}
                          className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200 font-mono text-[11px] disabled:opacity-40"
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

                  {/* Tool changes pause banner */}
                  {isPaused && (
                    <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded space-y-2">
                      <div className="text-amber-700 dark:text-amber-200 font-semibold flex items-start gap-1.5">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
                        <span>{serialState.pauseMessage || 'Job paused'}</span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={handleResume}
                          className="flex-1 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-semibold cursor-pointer"
                        >
                          Resume
                        </button>
                        <button
                          onClick={handleCancel}
                          className="px-3 py-1.5 bg-slate-200 dark:bg-slate-800 hover:bg-red-100 dark:hover:bg-red-900/60 text-slate-800 dark:text-slate-200 rounded font-semibold cursor-pointer"
                        >
                          Cancel job
                        </button>
                      </div>
                    </div>
                  )}

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
                        disabled={machineBusy}
                        className="w-10 h-8 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 text-slate-800 dark:text-slate-200 rounded flex items-center justify-center cursor-pointer"
                        title="Jog Y+"
                      >
                        <ArrowUp className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleJog('Z', 1)}
                        disabled={machineBusy}
                        className="px-2 h-8 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 text-slate-800 dark:text-slate-200 rounded text-[10px] font-bold cursor-pointer"
                        title="Jog Z+"
                      >
                        Z+
                      </button>

                      <button
                        onClick={() => handleJog('X', -1)}
                        disabled={machineBusy}
                        className="w-10 h-8 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 text-slate-800 dark:text-slate-200 rounded flex items-center justify-center cursor-pointer"
                        title="Jog X-"
                      >
                        <ArrowLeft className="w-4 h-4" />
                      </button>
                      <button
                        onClick={handleZeroXY}
                        disabled={machineBusy}
                        className="w-10 h-8 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white rounded text-[10px] font-bold cursor-pointer"
                        title="Zero XY Work Coordinates (G92 X0 Y0)"
                      >
                        XY0
                      </button>
                      <button
                        onClick={() => handleJog('X', 1)}
                        disabled={machineBusy}
                        className="w-10 h-8 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 text-slate-800 dark:text-slate-200 rounded flex items-center justify-center cursor-pointer"
                        title="Jog X+"
                      >
                        <ArrowRight className="w-4 h-4" />
                      </button>

                      <div></div>
                      <button
                        onClick={() => handleJog('Y', -1)}
                        disabled={machineBusy}
                        className="w-10 h-8 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 text-slate-800 dark:text-slate-200 rounded flex items-center justify-center cursor-pointer"
                        title="Jog Y-"
                      >
                        <ArrowDown className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleJog('Z', -1)}
                        disabled={machineBusy}
                        className="px-2 h-8 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 text-slate-800 dark:text-slate-200 rounded text-[10px] font-bold cursor-pointer"
                        title="Jog Z-"
                      >
                        Z-
                      </button>
                    </div>

                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={handleZeroZ}
                        disabled={machineBusy}
                        title="Probe straight onto the copper, using the continuity clip"
                        className="flex-1 py-1 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 text-slate-800 dark:text-slate-200 rounded font-semibold text-[11px] flex items-center justify-center gap-1 cursor-pointer"
                      >
                        {busy === 'zeroing' && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                        Probe Z0 on Copper
                      </button>
                      <button
                        onClick={handleZeroZOnPlate}
                        disabled={machineBusy}
                        title={`Probe onto the touch plate and set Z0 ${touchPlateMm}mm below the contact point`}
                        className="flex-1 py-1 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 text-slate-800 dark:text-slate-200 rounded font-semibold text-[11px] flex items-center justify-center gap-1 cursor-pointer"
                      >
                        Probe Z0 on Plate
                      </button>
                    </div>

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

                    <div className="flex gap-2 pt-2">
                      <button
                        onClick={handleAirCutBoard}
                        disabled={!result.success || machineBusy}
                        className="flex-1 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white rounded font-bold flex items-center justify-center gap-1.5 cursor-pointer text-xs shadow-sm"
                      >
                        <ShieldCheck className="w-4 h-4" />
                        Start Air Cut (+{airCutZOffset}mm)
                      </button>

                      <button
                        onClick={handleMillBoard}
                        disabled={!result.success || machineBusy}
                        className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded font-bold flex items-center justify-center gap-1.5 cursor-pointer text-xs shadow-sm"
                      >
                        {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                        Mill PCB Live
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Bottom Action Footer */}
            <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-100/70 dark:bg-slate-950/60 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDownloadSvg}
                  className="px-3.5 py-1.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-semibold rounded flex items-center gap-1.5 cursor-pointer text-xs transition-colors"
                  title="Download SVG vector layout for fabrication or etching"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  Download SVG
                </button>
                <button
                  onClick={handleDownloadDrill}
                  disabled={result.drills.length === 0}
                  className="px-3.5 py-1.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 text-slate-800 dark:text-slate-200 font-semibold rounded flex items-center gap-1.5 cursor-pointer text-xs transition-colors"
                  title="Download Excellon drill file (.drl)"
                >
                  <Download className="w-3.5 h-3.5 text-cyan-700 dark:text-cyan-400" />
                  Download Drill (.drl)
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleAirCutBoard}
                  disabled={!result.success || machineBusy}
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white font-bold rounded flex items-center gap-1.5 cursor-pointer text-xs shadow-sm"
                  title="Run air cut dry run live on connected machine"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Air Cut (+{airCutZOffset}mm)
                </button>

                <button
                  onClick={handleMillBoard}
                  disabled={!result.success || machineBusy}
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold rounded flex items-center gap-1.5 cursor-pointer text-xs shadow-sm"
                  title="Start live isolation milling on CNC machine via Web Serial"
                >
                  {busy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  Mill PCB Live
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
