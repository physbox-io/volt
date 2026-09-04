import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { HELTEC_V4_GPIO_PINS } from './components/nodes/HeltecV4Node';
import { generateSpiceNetlist, sanitizeSpiceValue } from './utils/spice';
import { getEffectiveMcuConfig } from './utils/mcuConfig';
import { buildNetlistResultIndex, findNetGraph } from './utils/netlistResult';
import { isPortConnected } from './utils/graphTopology';
import { Play, Square, Trash2, Info, Menu, Settings, Save, Download, Upload, Undo, Redo, Crosshair, Sparkles, Sun, Moon, Zap, Activity, Printer, PanelRight, Wrench } from 'lucide-react';
import AICopilotPanel from './components/AICopilotPanel';
import { ExportPcbModal } from './components/ExportPcbModal';
import { webSerialManager, type MachineState } from './utils/webSerialManager';
import { playbackTicker } from './utils/playbackTicker';
import { presets, DEFAULT_PRESET_KEY } from './utils/presets';
import { EdgePathProvider } from './components/AuraEdge';
import { SettingsModal } from './components/SettingsModal';
import { UserProfileButton } from './components/UserProfileButton';
import { loadSettings, saveSettings } from './utils/storage';
import { useMCPBridge } from './hooks/useMCPBridge';
import { usePresets } from './hooks/usePresets';
import { useCircuitHistory } from './hooks/useCircuitHistory';
import { useNoteCards } from './hooks/useNoteCards';
import { useCircuitFile } from './hooks/useCircuitFile';
import { Logo } from './components/Logo';
import { DocsModal } from './components/DocsModal';
import { NoteCardOverlay } from './components/NoteCardOverlay';
import { Sidebar } from './components/Sidebar';
import { PropertiesPanel } from './components/PropertiesPanel';
import { FlowArea } from './components/FlowArea';
import { ProbeTooltip } from './components/ProbeTooltip';
import { HILMemoizer } from './utils/hilMemoizer';
import { NumberInput } from './components/NumberInput';



let simulationWorker: Worker | null = null;
const pendingSimulations = new Map<string, { resolve: (res: any) => void; reject: (err: any) => void }>();

const getSimulationWorker = () => {
  if (!simulationWorker) {
    simulationWorker = new Worker(new URL('./workers/simulation.worker.ts', import.meta.url), { type: 'module' });
    simulationWorker.onmessage = (evt) => {
      const { type, id, result, ok, error } = evt.data;
      if (type === 'RESULT') {
        const pending = pendingSimulations.get(id);
        if (pending) {
          pendingSimulations.delete(id);
          if (ok) {
            pending.resolve(result);
          } else {
            pending.reject(new Error(error));
          }
        }
      }
    };
    simulationWorker.onerror = (err) => {
      console.error("[SimulationWorker] General error:", err);
      terminateWorker();
    };
  }
  return simulationWorker;
};

const terminateWorker = () => {
  if (simulationWorker) {
    simulationWorker.terminate();
    simulationWorker = null;
  }
  for (const pending of pendingSimulations.values()) {
    pending.reject(new Error("Simulation worker terminated."));
  }
  pendingSimulations.clear();
};

const runSimInWorker = (netlist: string): Promise<any> => {
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).slice(2);
    pendingSimulations.set(id, { resolve, reject });
    try {
      const worker = getSimulationWorker();
      worker.postMessage({ type: 'RUN', id, netlist });
    } catch (err) {
      reject(err);
    }
  });
};


export default function App() {
  // ── Initialise from localStorage ────────────────────────────────────────────
  const savedSettings = loadSettings();

  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem('circuit_dark_mode') === 'true';
  });

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('circuit_dark_mode', 'true');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('circuit_dark_mode', 'false');
    }
  }, [darkMode]);

  const toggleDarkMode = () => setDarkMode(prev => !prev);

  const [nodes, setNodes] = useState<Node[]>(presets[DEFAULT_PRESET_KEY].nodes);
  const [edges, setEdges] = useState<Edge[]>(presets[DEFAULT_PRESET_KEY].edges);
  const [isSimulating, setIsSimulating] = useState(false);
  const isSimulatingRef = useRef(false);
  useEffect(() => { isSimulatingRef.current = isSimulating; }, [isSimulating]);
  const [mcpActiveCount, setMcpActiveCount] = useState(0);
  const [isSpiceRunning, setIsSpiceRunning] = useState(false);
  const [simLength, setSimLength] = useState(() => {
    const val = savedSettings.simLength;
    return val === 0.05 ? 1.0 : (val ?? 1.0);
  });
  const [simResolution, setSimResolution] = useState<'normal' | 'high'>(savedSettings.simResolution ?? 'normal');
  // Which CYD-side handler executes a HIL slice/batch — this is per-Heltec-node data
  // (selectedNode.data.hilExecutionMode, edited in PropertiesPanel), not a global app
  // setting, since it depends on what firmware that specific board is running. 'legacy'
  // sends hil_slice (CYD MicroPython loops gpio_write/adc_read itself, one blocking
  // UART round trip per op — simple, works against any Heltec firmware). 'native' sends
  // hil_batch (CYD forwards the whole writes/reads payload in one UART transaction; the
  // Heltec's own C++ firmware runs the write/sleep/read loop, so there's no per-edge
  // ~11ms UART round trip distorting the GPIO_3 timing) — requires firmware built with
  // the hil_batch handler (heltec/src/uart_cmd.cpp). Cached into a ref at HIL start
  // (see runSimulation) since editing is locked while a simulation is running anyway.
  const hilExecutionModeRef = useRef<'legacy' | 'native'>('native');
  const [isDocsOpen, setIsDocsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showAICopilot, setShowAICopilot] = useState(false);
  const [isPcbModalOpen, setIsPcbModalOpen] = useState(false);

  /*
   * Machine state for the bottom bar.
   *
   * Seeded from the manager rather than a literal, so a bar that mounts after a
   * connection shows the real state instead of a disconnected one — the same
   * arrangement Mesh and Etch use.
   */
  const [machineState, setMachineState] = useState<MachineState>(webSerialManager.getState());
  useEffect(() => webSerialManager.addListener(setMachineState), []);
  const [showAura, setShowAura] = useState(savedSettings.showAura ?? false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth > 1024);
  // A palette entry tapped on a touch device, waiting for FlowArea to place it
  // at the middle of the canvas. `seq` makes two taps of the same part two
  // distinct requests rather than one unchanged object the effect ignores.
  const [pickedPart, setPickedPart] = useState<{ type: string; label?: string; seq: number } | null>(null);
  /**
   * Whether the properties inspector is showing as an overlay drawer.
   *
   * Only consulted below `lg` — on a desktop the inspector is a permanent
   * column beside the canvas and this is ignored, so nothing here can change
   * the desktop layout. Below `lg` the drawer covers most of the canvas, so it
   * opens when it is asked for and not merely because a part was selected:
   * touching a component to move it is not a request to read its datasheet.
   */
  const [isPropertiesOpen, setIsPropertiesOpen] = useState(false);
  const [probeMode, setProbeMode] = useState(false);
  const [probeData, setProbeData] = useState<{
    netName: string;
    voltage: number;
    history?: number[];
    timePoints?: number[];
    maxV?: number;
    minV?: number;
    avgV?: number;
    x: number;
    y: number;
  } | null>(null);
  const simResultRef = useRef<{ portToNet: Record<string, string>; result: any } | null>(null);
  const [initialConditions, setInitialConditions] = useState<Record<string, number>>({});
  
  // Hardware-in-the-Loop (HIL) state refs
  const hilSocketRef = useRef<WebSocket | null>(null);
  const hilConnectedRef = useRef(false);
  const hilValuesRef = useRef<Record<string, number>>({});
  const hilPrevValuesRef = useRef<Record<string, number>>({});
  const hilSmoothedValuesRef = useRef<Record<string, number>>({});
  const hilHistoryRef = useRef<Record<string, { t: number; v: number }[]>>({});
  const hilAccumTimeRef = useRef(0);
  const hilNetlistAccumTimeRef = useRef(0);
  const hilStartTimeRef = useRef<number | null>(null);
  const hilBackgroundPollActiveRef = useRef(true);
  const hilRunningRef = useRef(false);
  const lastSendTimeRef = useRef<number | null>(null);
  const lastSimulatedVoltagesRef = useRef<Record<string, number>>({});
  const lastSimulatedResultRef = useRef<any>(null);
  const lastPortToNetRef = useRef<Record<string, string>>({});
  const lastSliceDurationRef = useRef<number>(50);
  const hilInitialConditionsRef = useRef<Record<string, number>>({});
  const hilBufferRef = useRef('');
  // Lookahead buffer of already-computed-but-not-yet-dispatched hil_slice commands.
  // A single-slot lookahead (compute exactly the next slice while the current one
  // plays) has zero margin: any one slow SPICE call makes the device run out of
  // GPIO writes and idle mid-blink (visible as a freeze/pause on the LED) before
  // the next command arrives. Queuing several slices deep absorbs that jitter so
  // playback stays continuous even when an individual compute call runs long.
  const hilQueueRef = useRef<{ writes: { pin: number; seq: [number, number][] }[]; reads: { pin: number; type: 'analog' | 'digital' }[]; durationMs: number }[]>([]);
  const hilQueuedMsRef = useRef(0);
  const hilToppingUpRef = useRef(false);
  // Per-digital_out-pin EMA of the shortest recent half-period (ms), used to scale the
  // netlist's transient step size — see hilMaxStepMs in runHILSimulationSlice. Generic
  // across any digital_out pin (not just one preset's oscillator output): each pin's
  // entry is seeded at 50ms (~10Hz-ish, a reasonable default) and updated from real
  // observed edge spacing once that pin is actually toggling.
  const hilHalfPeriodMsRef = useRef<Record<string, number>>({});
  const hilWaitingForCommandRef = useRef(false);
  const hilMemoizerRef = useRef(new HILMemoizer());
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);

  const stopSimulation = () => {
    setIsSimulating(false);
    setIsSpiceRunning(false);
    playbackTicker.stop();
    setProbeData(null);

    // Stop and teardown HIL
    // Stop HIL and stay quiet — do not resume background polling automatically
    // (it self-perpetuates via recursive setTimeout with no other way to cancel it).
    hilRunningRef.current = false;
    hilBackgroundPollActiveRef.current = false;
    hilMemoizerRef.current.clear();
    if (hilSocketRef.current && hilConnectedRef.current) {
      try {
        const heltecNode = nodes.find(n => n.type === 'heltec_v4');
        if (heltecNode) {
          let code = "import lib.webserver as ws\n";
          code += "h = ws._mesh_get_heltec()\n";
          code += "h.gpio_write(3, 0)\n";
          code += "h.lora_mode('mesh')\n";
          code += "h.gps_power(1)\n";
          hilSocketRef.current.send(JSON.stringify({ cmd: "repl_input", code }));
        }
      } catch (e) {
        console.error("[HIL] Failed to send stop state:", e);
      }
    }
    hilHistoryRef.current = {};
    hilSmoothedValuesRef.current = {};
    hilAccumTimeRef.current = 0;
    hilNetlistAccumTimeRef.current = 0;
    hilStartTimeRef.current = null;
    hilQueueRef.current = [];
    hilQueuedMsRef.current = 0;
    hilHalfPeriodMsRef.current = {};

    setNodes(nds => nds.map(n => {
      if (n.type === 'led') {
        return { ...n, data: { ...n.data, brightness: 0, current_array: undefined, time_points: undefined } };
      }
      if (n.type === 'speaker' || n.type === 'scope') {
        return { ...n, data: { ...n.data, voltageData: undefined } };
      }
      if (n.type === 'heltec_v4') {
        return { ...n, data: { ...n.data, isConnected: false } };
      }
      return n;
    }));
    setEdges(eds => eds.map(e => ({
      ...e,
      className: '',
      animated: false,
      data: { ...e.data, current_array: undefined, time_points: undefined }
    })));
  };

  const {
    selectedPreset,
    userPresets,
    loadPreset,
    handlePresetChange,
    isSaveDialogOpen,
    setIsSaveDialogOpen,
    saveDialogName,
    setSaveDialogName,
    savePreset,
    savePresetByName,
    deleteUserPreset,
  } = usePresets({ nodes, edges, setNodes, setEdges, setInitialConditions, setSimLength, stopSimulation });

  const selectedPresetRef = useRef(selectedPreset);
  selectedPresetRef.current = selectedPreset;

  const { noteCards, editingCardId, toggleEdit, toggleMinimize, updateMarkdown, closeCard, moveCard } = useNoteCards({ selectedPreset, userPresets });

  // Scope resize handler — inject into every scope node's data
  const scopeResizeHandler = useCallback((nodeId: string, w: number, h: number) => {
    setNodes(nds => nds.map(n =>
      n.id === nodeId ? { ...n, data: { ...n.data, width: w, height: h } } : n
    ));
  }, [setNodes]);

  // Inject onResize callback into scope nodes
  useEffect(() => {
    setNodes(nds => nds.map(n => {
      if (n.type === 'scope' && !n.data.onResize) {
        return { ...n, data: { ...n.data, onResize: (w: number, h: number) => scopeResizeHandler(n.id, w, h) } };
      }
      return n;
    }));
  }, [nodes.length, scopeResizeHandler, setNodes]);

  // Auto-close sidebar on small screens
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth <= 1024) {
        setIsSidebarOpen(false);
      } else {
        setIsSidebarOpen(true);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Preload SPICE simulation module on mount
  useEffect(() => {
    try {
      const worker = getSimulationWorker();
      worker.postMessage({ type: 'INIT' });
    } catch (e) {
      console.error("[App] Failed to preload simulation worker:", e);
    }
  }, []);

  // Keep microphone nodes aware of the simulation duration
  useEffect(() => {
    setNodes(nds => {
      const hasMic = nds.some(n => n.type === 'microphone');
      if (!hasMic) return nds;
      return nds.map(n =>
        n.type === 'microphone' && n.data.simLength !== simLength
          ? { ...n, data: { ...n.data, simLength } }
          : n
      );
    });
  }, [simLength, setNodes]);

  // ── Auto-save settings ──────────────────────────────────────────────────────
  useEffect(() => { saveSettings({ showAura }); }, [showAura]);
  useEffect(() => { saveSettings({ simResolution }); }, [simResolution]);
  useEffect(() => {
    if (simLength <= 0.05) return;
    const t = setTimeout(() => saveSettings({ simLength }), 500);
    return () => clearTimeout(t);
  }, [simLength]);

  // Update edges when aura setting changes
  useEffect(() => {
    setEdges(eds => eds.map(e => ({
      ...e,
      type: showAura ? 'aura' : 'smoothstep'
    })));
  }, [showAura, setEdges]);

  // Sync isSimulating state to all nodes so they can gate animations
  useEffect(() => {
    setNodes(nds => nds.map(n => ({
      ...n,
      data: { ...n.data, isSimulating }
    })));
  }, [isSimulating, setNodes]);

  // Background connection effect for Heltec HIL node
  const heltecNode = nodes.find(n => n.type === 'heltec_v4');
  const heltecId = heltecNode?.id;
  const heltecIp = heltecNode?.data?.ip;
  // Opt-in only: the board is reached over plain ws://, which the browser blocks as
  // mixed content when the app is served over https (and a blocked/failing connection
  // attempt can take WebSerial down with it). Nothing dials out until the user clicks
  // Connect on the node or starts a HIL run.
  const heltecHilEnabled = !!heltecNode?.data?.hilEnabled;

  useEffect(() => {
    if (heltecId && heltecIp && heltecHilEnabled) {
      if (!hilConnectedRef.current && (!hilSocketRef.current || hilSocketRef.current.readyState === WebSocket.CLOSED)) {
        const node = nodes.find(n => n.id === heltecId);
        if (node) {
          ensureHILConnection(heltecIp as string, node);
        }
      }
    } else if (!heltecHilEnabled && hilSocketRef.current) {
      // User turned HIL off (or the node lost its enable flag): tear the socket down.
      hilRunningRef.current = false;
      hilConnectedRef.current = false;
      try { hilSocketRef.current.close(); } catch (e) {}
      hilSocketRef.current = null;
      if (heltecId) {
        setNodes(nds => nds.map(n => n.id === heltecId ? { ...n, data: { ...n.data, isConnected: false } } : n));
      }
    }
    return () => {
      // Clean up connection if no Heltec V4 node is present on the canvas
      if (!nodes.some(n => n.type === 'heltec_v4')) {
        hilRunningRef.current = false;
        hilConnectedRef.current = false;
        if (hilSocketRef.current) {
          try {
            hilSocketRef.current.close();
          } catch (e) {}
          hilSocketRef.current = null;
        }
      }
    };
  }, [heltecId, heltecIp, heltecHilEnabled, nodes]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => {
      // Block structural changes (add/remove) while a simulation is running: HIL in
      // particular caches things like the connected-pin Set on the assumption that
      // circuit topology doesn't change mid-run (see hilConnectedPinsCacheRef), and
      // removing a node out from under an in-flight netlist/portToNet mapping would
      // produce stale net references. Position/selection/dimension changes are still
      // allowed — those don't affect the netlist.
      const filtered = hilRunningRef.current || isSimulatingRef.current
        ? changes.filter(c => c.type !== 'remove')
        : changes;
      return applyNodeChanges(filtered, nds);
    }),
    []
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => {
      const filtered = hilRunningRef.current || isSimulatingRef.current
        ? changes.filter(c => c.type !== 'remove')
        : changes;
      return applyEdgeChanges(filtered, eds);
    }),
    []
  );

  const onConnect = useCallback(
    (params: Connection) => {
      if (hilRunningRef.current || isSimulatingRef.current) return;
      const sourcePort = `${params.source}-${params.sourceHandle || 'out'}`;
      const targetPort = `${params.target}-${params.targetHandle || 'in'}`;
      if (isPortConnected(sourcePort, targetPort, nodes, edges)) {
        alert("Connection is redundant (these points are already electrically connected).");
        return;
      }
      setEdges((eds) => addEdge(params, eds));
    },
    [nodes, edges]
  );





  /** Returns false if no connection could even be attempted (e.g. blocked as mixed content). */
  const ensureHILConnection = (ip: string, node: Node): boolean => {
    if (hilSocketRef.current && (hilSocketRef.current.readyState === WebSocket.OPEN || hilSocketRef.current.readyState === WebSocket.CONNECTING)) {
      return true;
    }

    // ws:// from an https page is blocked by the browser as mixed content, and the
    // failed handshake can also wedge WebSerial. Bail out with a clear message instead
    // of letting the socket fail opaquely.
    const isSecurePage = typeof window !== 'undefined' && window.location.protocol === 'https:';
    const isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(ip);
    if (isSecurePage && !isLocalHost && !/^wss:\/\//i.test(ip)) {
      console.warn(`[HIL] Refusing to open ws://${ip} from an https page — the browser blocks mixed content. Serve the app over http (or tunnel the board over wss://) to use HIL.`);
      setNodes(nds => nds.map(n => n.id === node.id
        ? { ...n, data: { ...n.data, isConnected: false, hilEnabled: false, hilError: 'Blocked: ws:// cannot be opened from an https page.' } }
        : n));
      return false;
    }

    const url = /^wss?:\/\//i.test(ip) ? ip : `ws://${ip}`;
    console.log(`[HIL] Connecting to CYD board at ${url}`);
    // Mark the node as HIL-enabled so the background effect doesn't tear this socket
    // down when the connection was initiated by starting a run rather than by the button.
    setNodes(nds => nds.map(n => n.id === node.id ? { ...n, data: { ...n.data, isConnected: false, hilEnabled: true, hilError: undefined } } : n));

    try {
      const ws = new WebSocket(url);
      hilSocketRef.current = ws;

      ws.onopen = () => {
        console.log(`[HIL] WebSocket connected to CYD at ${url}`);
        hilConnectedRef.current = true;
        setNodes(nds => nds.map(n => n.id === node.id ? { ...n, data: { ...n.data, isConnected: true } } : n));

        const pins = (node.data.pins as Record<string, string>) || {};
        let code = "print('[HIL] Bootstrap: starting...')\n";
        code += "import lib.webserver as ws\n";
        code += "import machine, utime\n";
        code += "h = ws._mesh_get_heltec()\n";
        code += "print('[HIL] Bootstrap: h =', h)\n";
        if (hilRunningRef.current) {
          // HIL is latency-sensitive: mesh relaying blocks the Heltec's main loop
          // for 100-500ms per relayed packet, and GPS parsing adds more overhead.
          // Disable both while running so gpio round-trips aren't stalled behind them.
          code += "h.lora_mode('raw')\n";
          code += "h.gps_power(0)\n";
        }
        const connectedBootPins = getConnectedHeltecPins(node.id, edgesRef.current);
        Object.entries(pins).forEach(([pinId, mode]) => {
          if (!connectedBootPins.has(pinId)) return;
          const pinNum = parseInt(pinId.replace('GPIO_', ''));
          const modeStr = mode === 'digital_out' ? 'out' : 'in';
          code += `h.gpio_mode(${pinNum}, '${modeStr}')\n`;
        });
        ws.send(JSON.stringify({ cmd: 'repl_input', code }));

        if (hilRunningRef.current) {
          startHILPipeline();
        } else {
          setTimeout(runBackgroundHILPoll, 100);
        }
      };

      ws.onmessage = async (evt) => {
        try {
          const msg = JSON.parse(evt.data);

          if (msg.type === 'hil_slice_result') {
            // Fast path: structured response from the fixed hil_slice handler (no exec()).
            if (msg.ok && msg.values) {
              const activeHILNode = nodesRef.current.find(n => n.type === 'heltec_v4') || node;
              const pins = (activeHILNode.data.pins as Record<string, string>) || {};
              for (const pinId of HELTEC_V4_GPIO_PINS) {
                const pinNum = parseInt(pinId.replace('GPIO_', ''));
                const raw = msg.values[String(pinNum)];
                if (raw === undefined) continue;
                let volt = raw;
                if (pins[pinId] === 'analog_in') {
                  volt = raw / 4095 * 3.3;
                  if (pinId === 'GPIO_1' && selectedPresetRef.current === 'heltecLightToFreqHIL') {
                    const minPhys = 0.45;
                    const maxPhys = 2.2;
                    const minVirt = 0.73;
                    const maxVirt = 0.92;
                    const norm = Math.min(Math.max((volt - minPhys) / (maxPhys - minPhys), 0), 1);
                    volt = minVirt + norm * (maxVirt - minVirt);
                  }
                  // Low-pass filter analog readings before they drive the sim: the VCO's
                  // operating point sits close to the transistor's turn-on threshold (needed
                  // to get the requested frequency range), which amplifies ordinary ADC/light
                  // sensor noise into visible oscillation-frequency jitter. Smoothing the input
                  // damps that out while still tracking real light-level changes.
                  const prevSmoothed = hilSmoothedValuesRef.current[pinId];
                  const alpha = 0.15;
                  volt = prevSmoothed === undefined ? volt : alpha * volt + (1 - alpha) * prevSmoothed;
                  hilSmoothedValuesRef.current[pinId] = volt;
                }
                hilValuesRef.current[pinId] = volt;
              }

              setNodes(nds => nds.map(n => {
                if (n.type === 'heltec_v4') {
                  return { ...n, data: { ...n.data, pinVoltages: { ...hilValuesRef.current } } };
                }
                return n;
              }));
            }

            // Pipeline dispatch: immediately send a batch of queued slices if ready
            const batch = mergeAndDequeueHILBatch();
            if (batch && ws.readyState === WebSocket.OPEN) {
              lastSendTimeRef.current = performance.now();
              ws.send(batch.payload);
              hilWaitingForCommandRef.current = false;
            } else {
              hilWaitingForCommandRef.current = true;
            }

            // Keep the lookahead buffer topped up in the background so a slow
            // SPICE call (e.g. a slice that lands on a switching edge) doesn't
            // starve the device of its next command.
            topUpHILQueue().catch(err => {
              console.error("[HIL] Queue top-up failed:", err);
            });
            flushHILDisplay();
            return;
          }

          if (msg.type === 'repl_output') {
            if (msg.output && !msg.output.includes('HIL_BG_DATA:')) {
              console.log("[HIL REPL Output]:", msg.output);
            }
            // Buffer the incoming REPL output chunks
            hilBufferRef.current += msg.output;

            // Process all complete lines in the buffer
            let newlineIdx;
            while ((newlineIdx = hilBufferRef.current.indexOf('\n')) !== -1) {
              const line = hilBufferRef.current.slice(0, newlineIdx).trim();
              hilBufferRef.current = hilBufferRef.current.slice(newlineIdx + 1);

              if (line.startsWith('HIL_BG_DATA:')) {
                const dataStr = line.replace('HIL_BG_DATA:', '').trim();

                // Parse readings
                if (dataStr !== 'ok') {
                  const parts = dataStr.split(',');
                  const activeHILNode = nodesRef.current.find(n => n.type === 'heltec_v4') || node;
                  const pins = (activeHILNode.data.pins as Record<string, string>) || {};
                  const connectedPins = getConnectedHeltecPins(activeHILNode.id, edgesRef.current);
                  const inputPins = HELTEC_V4_GPIO_PINS
                    .filter(pinId => connectedPins.has(pinId) && (pins[pinId] === 'analog_in' || pins[pinId] === 'digital_in'));

                  parts.forEach((valStr, idx) => {
                    const pinId = inputPins[idx];
                    if (pinId) {
                      let volt = parseFloat(valStr) || 0.0;
                      if (pinId === 'GPIO_1' && selectedPresetRef.current === 'heltecLightToFreqHIL') {
                        const minPhys = 0.45;
                        const maxPhys = 2.2;
                        const minVirt = 0.73;
                        const maxVirt = 0.92;
                        const norm = Math.min(Math.max((volt - minPhys) / (maxPhys - minPhys), 0), 1);
                        volt = minVirt + norm * (maxVirt - minVirt);
                      }
                      hilValuesRef.current[pinId] = volt;
                    }
                  });

                  // Update UI node voltages immediately
                  setNodes(nds => nds.map(n => {
                    if (n.type === 'heltec_v4') {
                      return {
                        ...n,
                        data: {
                          ...n.data,
                          pinVoltages: { ...hilValuesRef.current }
                        }
                      };
                    }
                    return n;
                  }));
                }

                setTimeout(runBackgroundHILPoll, 250);
              }
            }
          }
        } catch (e) {
          console.error("[HIL] Error parsing websocket message:", e);
        }
      };

      ws.onclose = () => {
        console.log("[HIL] WebSocket connection closed");
        hilConnectedRef.current = false;
        setNodes(nds => nds.map(n => n.type === 'heltec_v4' ? { ...n, data: { ...n.data, isConnected: false } } : n));
      };

      ws.onerror = (err) => {
        console.error("[HIL] WebSocket error:", err);
      };
    } catch (err) {
      console.error("[HIL] Failed to open WebSocket:", err);
      return false;
    }
    return true;
  };

  // Which of the heltec node's GPIO pins actually have a wire attached in the circuit graph.
  // Pin *mode* (digital_in/analog_in/digital_out) still comes from the node's `pins` config,
  // but polling/writing a pin that's configured yet unwired wastes a round trip for nothing —
  // this bit us once already (a stale preset had 4 unconnected pins configured as digital_in,
  // each costing its own UART round trip every slice for no reason).
  const getConnectedHeltecPins = (nodeId: string, edgeList: Edge[]): Set<string> => {
    const connected = new Set<string>();
    for (const edge of edgeList) {
      if (edge.source === nodeId && edge.sourceHandle && edge.sourceHandle.startsWith('GPIO_')) {
        connected.add(edge.sourceHandle);
      }
      if (edge.target === nodeId && edge.targetHandle && edge.targetHandle.startsWith('GPIO_')) {
        connected.add(edge.targetHandle);
      }
    }
    return connected;
  };

  // Cached wrapper for the hot HIL slice loop: wiring essentially never changes mid-run,
  // so recomputing this Set from scratch on every ~40ms slice is wasted work. Cache is
  // keyed on the edgesRef array identity (which changes whenever edges state actually
  // changes), so a live rewire is still picked up correctly, just without redoing the
  // scan on every unrelated slice.
  const hilConnectedPinsCacheRef = useRef<{ edges: Edge[]; nodeId: string; pins: Set<string> } | null>(null);
  const getConnectedHeltecPinsCached = (nodeId: string): Set<string> => {
    const cached = hilConnectedPinsCacheRef.current;
    if (cached && cached.edges === edgesRef.current && cached.nodeId === nodeId) return cached.pins;
    const pins = getConnectedHeltecPins(nodeId, edgesRef.current);
    hilConnectedPinsCacheRef.current = { edges: edgesRef.current, nodeId, pins };
    return pins;
  };

  // Picks which CYD-side handler processes the writes/reads payload — see
  // hilExecutionMode above. Both produce the identical `{type:"hil_slice_result",
  // ok, values}` response shape, so nothing downstream of dispatch needs to care
  // which mode is active.
  const hilCommandName = (): string => hilExecutionModeRef.current === 'native' ? 'hil_batch' : 'hil_slice';

  // Builds the fast-path "hil_slice"/"hil_batch" WS payload (see handle_hil_slice /
  // handle_hil_batch in cyd-native's lib/webserver.py) instead of a Python source
  // string to exec() — exec() measured 700-800ms+ per call on-device even for a
  // ~15-line script (compile overhead on this PSRAM-backed heap), which dominated
  // HIL round-trip time. This is a fixed, already-loaded handler taking structured
  // JSON, so there's no per-slice compilation at all.
  const buildHILSliceCommand = (pins: Record<string, string>, voltages: Record<string, any>, connectedPins: Set<string>) => {
    const writes: { pin: number; seq: [number, number][] }[] = [];
    const reads: { pin: number; type: 'analog' | 'digital' }[] = [];
    for (const pinId of HELTEC_V4_GPIO_PINS) {
      if (!connectedPins.has(pinId)) continue;
      const pinNum = parseInt(pinId.replace('GPIO_', ''));
      if (pins[pinId] === 'digital_out') {
        writes.push({ pin: pinNum, seq: voltages[pinId] || [[0, 0]] });
      } else if (pins[pinId] === 'analog_in') {
        reads.push({ pin: pinNum, type: 'analog' });
      } else if (pins[pinId] === 'digital_in') {
        reads.push({ pin: pinNum, type: 'digital' });
      }
    }
    return { writes, reads };
  };

  // Merge several already-computed queue entries into one hil_slice command: the
  // device plays a write's whole `seq` list in one shot before reporting back, so
  // concatenating consecutive slices' seq arrays turns N WebSocket round trips into
  // 1. This was previously unsafe because handle_hil_slice() played each (val,
  // delay_us) entry as sleep-then-write, holding each value for the *next* entry's
  // duration instead of its own — fine for the 0-1 edges in a lone 40ms slice, but
  // batching pushed many more edges through one uninterrupted burst and the
  // resulting drift snapped back visibly at each (now larger, less frequent) burst
  // boundary. Now fixed device-side (write-then-sleep, matching the run-length
  // encoding), so batching no longer distorts edge timing — only the analog-in
  // reads (used to drive the next SPICE call) happen less often, which is fine
  // since GPIO_1 already tracks a slow-changing light level.
  const HIL_BATCH_TARGET_MS = 120;

  const mergeAndDequeueHILBatch = (): { payload: string; durationMs: number } | null => {
    if (hilQueueRef.current.length === 0) return null;
    let totalMs = 0;
    const writeOrder: number[] = [];
    const writesByPin = new Map<number, [number, number][]>();
    let reads: { pin: number; type: 'analog' | 'digital' }[] = [];
    while (hilQueueRef.current.length > 0 && totalMs < HIL_BATCH_TARGET_MS) {
      const item = hilQueueRef.current.shift()!;
      hilQueuedMsRef.current -= item.durationMs;
      totalMs += item.durationMs;
      reads = item.reads;
      for (const w of item.writes) {
        let seq = writesByPin.get(w.pin);
        if (!seq) {
          seq = [];
          writesByPin.set(w.pin, seq);
          writeOrder.push(w.pin);
        }
        seq.push(...w.seq);
      }
    }
    const writes = writeOrder.map(pin => ({ pin, seq: writesByPin.get(pin)! }));
    return { payload: JSON.stringify({ cmd: hilCommandName(), writes, reads }), durationMs: totalMs };
  };

  function runBackgroundHILPoll() {
    if (!hilBackgroundPollActiveRef.current || hilRunningRef.current || !hilConnectedRef.current || !hilSocketRef.current) return;
    
    const activeHILNode = nodesRef.current.find(n => n.type === 'heltec_v4');
    if (!activeHILNode) return;
    
    const pins = (activeHILNode.data.pins as Record<string, string>) || {};
    const connectedPins = getConnectedHeltecPins(activeHILNode.id, edgesRef.current);
    let code = "print('HIL_BG_DATA:', ";
    const reads: string[] = [];
    for (const pinId of HELTEC_V4_GPIO_PINS) {
      if (!connectedPins.has(pinId)) continue;
      if (pins[pinId] === 'analog_in') {
        const pinNum = parseInt(pinId.replace('GPIO_', ''));
        reads.push(`h.adc_read(${pinNum}) / 4095 * 3.3`);
      } else if (pins[pinId] === 'digital_in') {
        const pinNum = parseInt(pinId.replace('GPIO_', ''));
        reads.push(`h.gpio_read(${pinNum})`);
      }
    }
    if (reads.length > 0) {
      code += reads.map(r => `str(${r})`).join(" + ',' + ");
    } else {
      code += "'ok'";
    }
    code += ")\n";
    
    try {
      hilSocketRef.current.send(JSON.stringify({ cmd: "repl_input", code }));
    } catch (e) {
      console.error("[HIL] Background poll send failed:", e);
    }
  }

  // Target amount of buffered-but-not-yet-dispatched playback time. Depth (not
  // per-slice size) is what absorbs a slow SPICE call, so this stays fixed
  // regardless of how long any individual compute takes.
  const HIL_BUFFER_TARGET_MS = 240;
  const HIL_SLICE_STEP_MS = 40;

  const topUpHILQueue = async () => {
    if (hilToppingUpRef.current) return;
    hilToppingUpRef.current = true;
    try {
      while (hilRunningRef.current && hilQueuedMsRef.current < HIL_BUFFER_TARGET_MS) {
        await runHILSimulationSlice();
      }
    } finally {
      hilToppingUpRef.current = false;
    }
  };

  const startHILPipeline = async () => {
    if (!hilConnectedRef.current || !hilSocketRef.current) return;

    // Reset pipeline state
    hilQueueRef.current = [];
    hilQueuedMsRef.current = 0;
    hilWaitingForCommandRef.current = false;

    try {
      // Fill the lookahead buffer before sending anything
      await topUpHILQueue();

      const firstBatch = mergeAndDequeueHILBatch();
      if (firstBatch && hilSocketRef.current && hilSocketRef.current.readyState === WebSocket.OPEN) {
        lastSendTimeRef.current = performance.now();
        hilSocketRef.current.send(firstBatch.payload);

        // Keep refilling in the background so the buffer stays topped up
        // once the device starts reporting back slice results
        topUpHILQueue().catch(err => {
          console.error("[HIL] Queue top-up failed:", err);
        });
      }
    } catch (err) {
      console.error("[HIL] Pipeline start failed:", err);
    }
  };

  // Flushes accumulated scope/LED history to React state. Called once per real
  // hil_slice_result (device round trip), not once per computed SPICE slice — see
  // the comment in runHILSimulationSlice for why those two cadences are decoupled.
  const flushHILDisplay = () => {
    const cutoff = hilNetlistAccumTimeRef.current - 1000;
    setNodes(nds => nds.map(n => {
      if (n.type === 'scope') {
        const hist1 = hilHistoryRef.current[`${n.id}-ch1`];
        const hist2 = hilHistoryRef.current[`${n.id}-ch2`];
        if (!hist1 && !hist2) return n;
        const relativePoints1 = (hist1 || []).map(p => ({ t: p.t - cutoff, v: p.v }));
        const relativePoints2 = (hist2 || []).map(p => ({ t: p.t - cutoff, v: p.v }));
        return { ...n, data: { ...n.data, voltageData: relativePoints1, voltageData1: relativePoints1, voltageData2: relativePoints2 } };
      }
      if (n.type === 'led') {
        const hist = hilHistoryRef.current[n.id];
        if (!hist) return n;
        return { ...n, data: { ...n.data, time_points: hist.map(p => p.t - cutoff), current_array: hist.map(p => p.v) } };
      }
      return n;
    }));
  };

  const runHILSimulationSlice = async () => {
    if (!hilRunningRef.current) return;

    const activeHILNode = nodesRef.current.find(n => n.type === 'heltec_v4');
    if (!activeHILNode) return;

    try {
      const nextNodes = nodesRef.current.map(n => {
        if (n.id === activeHILNode.id) {
          return {
            ...n,
            data: {
              ...n.data,
              pinVoltages: { ...hilValuesRef.current },
              isConnected: hilConnectedRef.current
            }
          };
        }
        return n;
      });

      const now = performance.now();
      if (hilStartTimeRef.current === null) hilStartTimeRef.current = now;
      // Fixed-size steps: the lookahead queue (see hilQueueRef/topUpHILQueue) is what
      // absorbs variance in how long any one SPICE call takes (e.g. a slice that lands
      // on a switching edge vs. one that doesn't), so slice sizing no longer needs to
      // reactively chase wall-clock drift the way a single-slot lookahead did.
      const sliceDurationMs = HIL_SLICE_STEP_MS;
      // The netlist must simulate the full slice duration, not a fixed smaller window — GPIO_3's
      // hardware toggle sequence is now derived from the astable multivibrator's own simulated
      // oscillation (see below), so it needs a waveform covering the whole real-time gap this
      // burst has to fill. This used to be decoupled and fixed at 50ms as a workaround for
      // ngspice convergence failure, but that was caused by the transistor model having zero
      // switching timescale (CJC=0/CJE=0/TR=0/TF=0, see spice.ts), now fixed there — so longer
      // simulated durations no longer blow up compute time or point counts unboundedly.
      const netlistDurationMs = sliceDurationMs;
      // Force 'normal' here regardless of the UI's simResolution setting: 'high' forces a
      // fixed 0.1ms internal step across the whole slice, which is meant for smoother manual-run
      // waveform display, not for HIL. ngspice's adaptive stepping already refines automatically
      // near a switching edge (see the CJC/CJE fix), so forcing a small step here would just
      // multiply point count/serialization cost per slice with no benefit at low frequencies.
      // But at high frequencies the opposite problem appears: a fixed 1ms step can't resolve
      // edges accurately once a half-period gets down to a few ms, so scale the step to
      // whichever tracked digital_out pin is oscillating fastest (see hilHalfPeriodMsRef below)
      // — resolve each half-period with ~10 samples, ceiling at 1ms (matches the existing
      // low-frequency behavior, so nothing changes there for a slow-changing or non-oscillating
      // pin). The floor is a POINT-COUNT BUDGET, not a guessed frequency cutoff: this hasn't
      // been measured against actual per-slice SPICE compute time (see the earlier discussion
      // on what really gates max frequency), so MAX_POINTS_PER_SLICE is a placeholder pending
      // real profiling, not a validated ceiling — tune it down if slices start missing their
      // real-time budget, up if there's compute headroom to spare.
      const MAX_POINTS_PER_SLICE = 2000;
      const minStepMs = netlistDurationMs / MAX_POINTS_PER_SLICE;
      const trackedHalfPeriods = Object.values(hilHalfPeriodMsRef.current);
      const fastestHalfPeriodMs = trackedHalfPeriods.length > 0 ? Math.min(...trackedHalfPeriods) : 50;
      const hasSpeaker = nextNodes.some(n => n.type === 'speaker');
      const maxStepLimit = hasSpeaker ? 0.1 : 1.0;
      const hilMaxStepMs = Math.min(maxStepLimit, Math.max(minStepMs, fastestHalfPeriodMs / 10));

      // Map physical voltages of heltec_v4 to connected mcu input pins
      const mcuWaveforms: any = {};
      const heltecNode = nextNodes.find(n => n.type === 'heltec_v4');
      const mcuNode = nextNodes.find(n => n.type === 'mcu');
      if (heltecNode && mcuNode) {
        mcuWaveforms[mcuNode.id] = {};
        for (const edge of edgesRef.current) {
          if (edge.source === heltecNode.id && edge.target === mcuNode.id) {
            const heltecPin = edge.sourceHandle;
            const mcuPin = edge.targetHandle;
            if (heltecPin && mcuPin && heltecPin.startsWith('GPIO_')) {
              const volt = hilValuesRef.current[heltecPin] ?? 0.0;
              const prevVolt = hilPrevValuesRef.current[heltecPin] ?? volt;
              mcuWaveforms[mcuNode.id][mcuPin] = [
                { t: 0, v: prevVolt },
                { t: sliceDurationMs, v: volt }
              ];
            }
          }
        }
        // Save current values as previous values for the next slice
        hilPrevValuesRef.current = { ...hilValuesRef.current };
      }

      // Configure HILMemoizer options from component properties
      const memoizer = hilMemoizerRef.current;
      memoizer.enabled = typeof activeHILNode.data.hilMemoizationEnabled === 'boolean' ? activeHILNode.data.hilMemoizationEnabled : true;
      memoizer.inputDP = typeof activeHILNode.data.hilInputDP === 'number' ? activeHILNode.data.hilInputDP : 3;
      memoizer.icDP = typeof activeHILNode.data.hilIcDP === 'number' ? activeHILNode.data.hilIcDP : 3;
      memoizer.maxConsecutiveHits = typeof activeHILNode.data.hilMaxConsecutiveHits === 'number' ? activeHILNode.data.hilMaxConsecutiveHits : 50;

      if (activeHILNode.data.hilClearCacheRequested) {
        memoizer.clear();
        setNodes(nds => nds.map(n => n.id === activeHILNode.id ? { ...n, data: { ...n.data, hilClearCacheRequested: undefined } } : n));
      }

      const curInputs = { ...hilValuesRef.current };
      const curICs = { ...hilInitialConditionsRef.current };
      const cachedSlice = memoizer.get(curInputs, curICs, netlistDurationMs, hilMaxStepMs);

      let result: any;
      let portToNet: Record<string, string>;
      let nextICs: Record<string, number>;
      let outputs: Record<string, any>;
      let writes: { pin: number; seq: [number, number][] }[];
      let reads: { pin: number; type: 'analog' | 'digital' }[];

      if (cachedSlice) {
        // CACHE HIT: Bypass SPICE WASM solver run
        result = cachedSlice.result;
        portToNet = cachedSlice.portToNet;
        nextICs = cachedSlice.nextICs;
        outputs = cachedSlice.outputs;
        writes = cachedSlice.writes;
        reads = cachedSlice.reads;
        hilHalfPeriodMsRef.current = { ...cachedSlice.halfPeriods };
      } else {
        // CACHE MISS: Run SPICE WASM simulation
        const netlistRes = generateSpiceNetlist(nextNodes, edgesRef.current, netlistDurationMs / 1000, 'normal', mcuWaveforms, hilInitialConditionsRef.current, hilMaxStepMs);
        portToNet = netlistRes.portToNet;

        result = await runSimInWorker(netlistRes.netlist);
        const resultIndex = buildNetlistResultIndex(result);

        const lastIndex = result.numPoints - 1;
        nextICs = {};
        if (result.variableNames && result.data && result.data.length > 0) {
          result.variableNames.forEach((name: string, i: number) => {
            if (name.startsWith('v(') && name.endsWith(')')) {
              const nodeName = name.slice(2, -1);
              nextICs[nodeName] = result.data[i].values[lastIndex];
            }
          });
        }

        outputs = {};
        const pins = (activeHILNode.data.pins as Record<string, string>) || {};
        for (const pinId of HELTEC_V4_GPIO_PINS) {
          if (pins[pinId] === 'digital_out') {
            const seq: [number, number][] = [];
            const net = portToNet[`${activeHILNode.id}-${pinId}`];
            const graph = findNetGraph(result, net, resultIndex);
            const threshold = 1.65; // half of 3.3V logic level
            const MIN_PULSE_US = hilMaxStepMs * 1000 * 1.5;
            let shortestPulseUs: number | null = null;
            if (graph && graph.timestamps_ms.length > 0) {
              let lastState = graph.voltage_levels[0] > threshold ? 1 : 0;
              let lastT = 0;
              for (let i = 1; i < graph.timestamps_ms.length; i++) {
                const state = graph.voltage_levels[i] > threshold ? 1 : 0;
                if (state !== lastState) {
                  const t = graph.timestamps_ms[i];
                  const durationUs = (t - lastT) * 1000;
                  if (durationUs < MIN_PULSE_US) continue;
                  seq.push([lastState, Math.round(durationUs)]);
                  if (shortestPulseUs === null || durationUs < shortestPulseUs) shortestPulseUs = durationUs;
                  lastState = state;
                  lastT = t;
                }
              }
              seq.push([lastState, Math.round((sliceDurationMs - lastT) * 1000)]);
            } else {
              seq.push([0, Math.round(sliceDurationMs * 1000)]);
            }
            if (shortestPulseUs !== null) {
              const alpha = 0.3;
              const prev = hilHalfPeriodMsRef.current[pinId] ?? 50;
              hilHalfPeriodMsRef.current[pinId] = alpha * (shortestPulseUs / 1000) + (1 - alpha) * prev;
            }
            outputs[pinId] = seq;
          }
        }

        const connectedPins = getConnectedHeltecPinsCached(activeHILNode.id);
        const builtCmd = buildHILSliceCommand(pins, outputs, connectedPins);
        writes = builtCmd.writes;
        reads = builtCmd.reads;

        memoizer.set(curInputs, curICs, netlistDurationMs, hilMaxStepMs, {
          result,
          portToNet,
          nextICs,
          outputs,
          writes,
          reads,
          halfPeriods: { ...hilHalfPeriodMsRef.current }
        });
      }

      lastSimulatedResultRef.current = result;
      lastPortToNetRef.current = portToNet;
      lastSliceDurationRef.current = netlistDurationMs;
      lastSimulatedVoltagesRef.current = outputs;
      const resultIndex = buildNetlistResultIndex(result);

      // Stream simulated speaker audio to the CYD board over WebSocket
      if (hilConnectedRef.current && hilSocketRef.current && hilSocketRef.current.readyState === WebSocket.OPEN) {
        const speakerNode = nextNodes.find(n => n.type === 'speaker' && n.data.outputTarget === 'cyd');
        if (speakerNode) {
          const spkNet = portToNet[`${speakerNode.id}-in`];
          const gndNet = portToNet[`${speakerNode.id}-gnd`];
          const spkGraph = findNetGraph(result, spkNet, resultIndex);
          const gndGraph = findNetGraph(result, gndNet, resultIndex);
          if (spkGraph && spkGraph.timestamps_ms.length > 0) {
            const times = spkGraph.timestamps_ms;
            const volts = spkGraph.voltage_levels;
            const gndVolts = gndGraph ? gndGraph.voltage_levels : null;
            
            const sampleRate = 16000;
            const durationSec = sliceDurationMs / 1000;
            const frameCount = Math.floor(sampleRate * durationSec);
            const audioBuffer = new Int16Array(frameCount);
            
            let dataIdx = 0;
            let sumV = 0;
            const rawV = new Float32Array(frameCount);
            for (let i = 0; i < frameCount; i++) {
              const t_ms = (i / sampleRate) * 1000;
              while (dataIdx < times.length - 2 && times[dataIdx + 1] < t_ms) {
                dataIdx++;
              }
              const t1 = times[dataIdx];
              const t2 = times[dataIdx + 1];
              const v1 = volts[dataIdx] - (gndVolts ? gndVolts[dataIdx] : 0);
              const v2 = volts[dataIdx + 1] - (gndVolts ? gndVolts[dataIdx + 1] : 0);
              let v = v1;
              if (t2 > t1) {
                const fraction = (t_ms - t1) / (t2 - t1);
                v = v1 + fraction * (v2 - v1);
              }
              rawV[i] = v;
              sumV += v;
            }
            
            // Subtract DC offset
            const meanV = sumV / frameCount;
            let maxAbs = 0.001;
            for (let i = 0; i < frameCount; i++) {
              rawV[i] -= meanV;
              if (Math.abs(rawV[i]) > maxAbs) {
                maxAbs = Math.abs(rawV[i]);
              }
            }
            
            // Normalize and convert to Int16
            const targetPeak = 20000;
            for (let i = 0; i < frameCount; i++) {
              audioBuffer[i] = Math.round((rawV[i] / maxAbs) * targetPeak);
            }
            
            // Send binary packet
            hilSocketRef.current.send(audioBuffer.buffer);
          }
        }
      }

      // Carry ICs forward
      hilInitialConditionsRef.current = nextICs;
      setInitialConditions(nextICs);

      const newAccum = hilAccumTimeRef.current + sliceDurationMs;
      hilAccumTimeRef.current = newAccum;
      const newNetlistAccum = hilNetlistAccumTimeRef.current + netlistDurationMs;
      hilNetlistAccumTimeRef.current = newNetlistAccum;

      if (hilWaitingForCommandRef.current && hilSocketRef.current && hilSocketRef.current.readyState === WebSocket.OPEN) {
        lastSendTimeRef.current = performance.now();
        hilSocketRef.current.send(JSON.stringify({ cmd: hilCommandName(), writes, reads }));
        hilWaitingForCommandRef.current = false;
      } else {
        hilQueueRef.current.push({ writes, reads, durationMs: sliceDurationMs });
        hilQueuedMsRef.current += sliceDurationMs;
      }

      // Update live memoization stats on node data for PropertiesPanel
      const currentStats = memoizer.getStats();
      setNodes(nds => nds.map(n => n.id === activeHILNode.id ? { ...n, data: { ...n.data, hilStats: currentStats } } : n));

      // Update scope/LED history every slice (needed for correct, gap-free traces),
      // but don't build a full node array + setNodes here — topUpHILQueue calls this
      // several times back-to-back while refilling the lookahead buffer, and that
      // would fire a React re-render for every one of them before any of that data
      // has even reached the device. The actual UI flush (flushHILDisplay) happens
      // once per real hil_slice_result instead, matching the device's own cadence.
      for (const n of nextNodes) {
        if (n.type === 'scope') {
          const ch1Net = portToNet[`${n.id}-ch1`];
          const ch2Net = portToNet[`${n.id}-ch2`];
          const gndNet = portToNet[`${n.id}-gnd`];

          const ch1Graph = findNetGraph(result, ch1Net, resultIndex);
          const ch2Graph = findNetGraph(result, ch2Net, resultIndex);
          const gndGraph = findNetGraph(result, gndNet, resultIndex);

          if (ch1Graph) {
            const newPoints = ch1Graph.timestamps_ms.map((t: number, idx: number) => ({
              t: hilNetlistAccumTimeRef.current - netlistDurationMs + t,
              v: ch1Graph.voltage_levels[idx] - (gndGraph ? gndGraph.voltage_levels[idx] : 0.0)
            }));
            const hist = [...(hilHistoryRef.current[`${n.id}-ch1`] || []), ...newPoints].filter(p => p.t >= newNetlistAccum - 1000);
            hilHistoryRef.current[`${n.id}-ch1`] = hist;
          }

          if (ch2Graph) {
            const newPoints = ch2Graph.timestamps_ms.map((t: number, idx: number) => ({
              t: hilNetlistAccumTimeRef.current - netlistDurationMs + t,
              v: ch2Graph.voltage_levels[idx] - (gndGraph ? gndGraph.voltage_levels[idx] : 0.0)
            }));
            const hist = [...(hilHistoryRef.current[`${n.id}-ch2`] || []), ...newPoints].filter(p => p.t >= newNetlistAccum - 1000);
            hilHistoryRef.current[`${n.id}-ch2`] = hist;
          }
        }

        if (n.type === 'led') {
          const net = portToNet[`${n.id}-anode`];
          const anodeGraph = findNetGraph(result, net, resultIndex);
          const intGraph = findNetGraph(result, `int_led_${n.id}`, resultIndex);
          if (anodeGraph && intGraph) {
            const newPoints = anodeGraph.timestamps_ms.map((t: number, idx: number) => ({
              t: hilNetlistAccumTimeRef.current - netlistDurationMs + t,
              v: anodeGraph.voltage_levels[idx] - intGraph.voltage_levels[idx]
            }));
            const hist = [...(hilHistoryRef.current[n.id] || []), ...newPoints].filter(p => p.t >= newNetlistAccum - 1000);
            hilHistoryRef.current[n.id] = hist;
          }
        }
      }
    } catch (e) {
      console.error("[HIL] Simulation slice run failed:", e);
    }
  };

  /** True while a solve is in flight, so live re-runs queue instead of piling up. */
  const simInFlightRef = useRef(false);

  const runSimulation = async (nodesOverride?: Node[], customICs?: Record<string, number>) => {
    simInFlightRef.current = true;
    try {
      const baseNodes = nodesOverride || nodes;
      const currentNodes = baseNodes.map(n => n.type === 'mcu' ? { ...n, data: { ...n.data, state: undefined } } : n);
      setNodes(currentNodes);
      const heltecNode = currentNodes.find(n => n.type === 'heltec_v4');
      if (heltecNode) {
        if (hilRunningRef.current) {
          // HIL pipeline is already active — starting a second one would double up
          // repl_input traffic to the device and stall both, so no-op instead.
          return { ok: true };
        }
        setIsSpiceRunning(true);
        setIsSimulating(true);
        hilRunningRef.current = true;
        hilExecutionModeRef.current = (heltecNode.data.hilExecutionMode as 'legacy' | 'native') || 'native';
        hilBackgroundPollActiveRef.current = true;
        hilAccumTimeRef.current = 0;
        hilNetlistAccumTimeRef.current = 0;
        hilStartTimeRef.current = null;
        hilHistoryRef.current = {};
        hilSmoothedValuesRef.current = {};
        hilInitialConditionsRef.current = {};
        hilBufferRef.current = '';
        hilQueueRef.current = [];
        hilQueuedMsRef.current = 0;
        hilHalfPeriodMsRef.current = {};
        setInitialConditions({});
        
        const ip = (heltecNode.data.ip as string) || '192.168.1.244';
        if (hilConnectedRef.current && hilSocketRef.current) {
          const ws = hilSocketRef.current;
          if (ws.readyState === WebSocket.OPEN) {
            const pins = (heltecNode.data.pins as Record<string, string>) || {};
            let code = "print('[HIL] Bootstrap: starting (existing ws)...')\n";
            code += "import lib.webserver as ws\n";
            code += "import machine, utime\n";
            code += "h = ws._mesh_get_heltec()\n";
            code += "print('[HIL] Bootstrap: h =', h)\n";
            code += "h.lora_mode('raw')\n";
            code += "h.gps_power(0)\n";
            const connectedBootPins = getConnectedHeltecPins(heltecNode.id, edgesRef.current);
            Object.entries(pins).forEach(([pinId, mode]) => {
              if (!connectedBootPins.has(pinId)) return;
              const pinNum = parseInt(pinId.replace('GPIO_', ''));
              const modeStr = mode === 'digital_out' ? 'out' : 'in';
              code += `h.gpio_mode(${pinNum}, '${modeStr}')\n`;
            });
            ws.send(JSON.stringify({ cmd: 'repl_input', code }));
          }
          setTimeout(() => {
            if (hilRunningRef.current) {
              startHILPipeline();
            }
          }, 150);
        } else {
          if (!ensureHILConnection(ip, heltecNode)) {
            // Couldn't even attempt the socket (e.g. ws:// blocked on an https page) —
            // unwind the run instead of leaving the UI stuck in "simulating".
            hilRunningRef.current = false;
            hilBackgroundPollActiveRef.current = false;
            setIsSpiceRunning(false);
            setIsSimulating(false);
            alert(`Can't reach the board at ${ip}: the browser blocks plain ws:// connections from an https page. Run the app over http (or expose the board over wss://) to use hardware-in-the-loop.`);
            return { ok: false };
          }
        }
        return { ok: true };
      }

      setIsSpiceRunning(true);
      setIsSimulating(true);
      // Yield to allow React/browser to render the "SPICE Simulating" notice
      await new Promise(resolve => setTimeout(resolve, 50));

      let { netlist, portToNet, mcuLogs } = generateSpiceNetlist(currentNodes, edges, simLength, simResolution, {}, customICs !== undefined ? customICs : initialConditions);
      
      const mcuNodes = currentNodes.filter(n => n.type === 'mcu');
      const needsTwoPass = mcuNodes.some(n => {
        const code = (n.data.code as string) || "pinMode('D0', 'OUTPUT');\nwhile(true) {\n  digitalWrite('D0', 1);\n  sleep(500);\n  digitalWrite('D0', 0);\n  sleep(500);\n}";
        return code.includes('Read');
      });

      let result = await runSimInWorker(netlist);

      if (needsTwoPass) {
         const mcuWaveforms: any = {};
         for (const mcu of mcuNodes) {
           mcuWaveforms[mcu.id] = {};
           const mcuPins = getEffectiveMcuConfig(mcu.data).pins;
           for (const pin of mcuPins) {
             const pinId = pin.id;
             const net = portToNet[`${mcu.id}-${pinId}`];
             const graph = findNetGraph(result, net);
             if (graph) {
               mcuWaveforms[mcu.id][pinId] = graph.timestamps_ms.map((t: number, i: number) => ({
                 t, v: graph.voltage_levels[i]
               }));
             }
           }
         }
         
         const pass2 = generateSpiceNetlist(currentNodes, edges, simLength, simResolution, mcuWaveforms, customICs !== undefined ? customICs : initialConditions);
         netlist = pass2.netlist;
         portToNet = pass2.portToNet;
         mcuLogs = pass2.mcuLogs;
         result = await runSimInWorker(netlist);
      }
      
      const findGraph = (netName: string) => findNetGraph(result, netName);

      const updatedNodes = currentNodes.map(n => {
        let newNode = { ...n } as any;
        newNode.data = { ...newNode.data, isSimulating: true };
        
        const v1Net = portToNet[`${n.id}-in`] || portToNet[`${n.id}-pos`] || portToNet[`${n.id}-anode`] || portToNet[`${n.id}-c`];
        const v2Net = portToNet[`${n.id}-out`] || portToNet[`${n.id}-neg`] || portToNet[`${n.id}-gnd`] || portToNet[`${n.id}-cathode`] || portToNet[`${n.id}-e`];
        const v1G = findGraph(v1Net);
        const v2G = findGraph(v2Net) || (v1G ? { voltage_levels: new Array(v1G.voltage_levels.length).fill(0) } : null);
        
        if (v1G && v2G) {
          let R = 1000;
          if (n.type === 'resistor' || n.type === 'inductor') {
            const valStr = sanitizeSpiceValue(String(n.data.label || (n.type === 'resistor' ? '1k' : '100u')));
            R = parseFloat(valStr) || 1000;
            const suffix = valStr.slice(-1).toLowerCase();
            if (suffix === 'k') R *= 1000;
            if (suffix === 'u') R /= 1000000;
            if (suffix === 'm' && valStr.slice(-2).toLowerCase() !== 'me') R /= 1000;
          } else if (n.type === 'switch') {
            const isOpen = n.data.isOpen !== false;
            R = isOpen ? 1e12 : 0.01; 
          } else if (n.type === 'led' || n.type === 'diode') {
            R = 100;
          } else if (n.type === 'npn' || n.type === 'pnp') {
            R = 50;
          }
          const curArr = v1G.voltage_levels.map((v, i) => Math.abs(v - (v2G.voltage_levels[i] || 0)) / (R || 1));
          newNode.data = { ...newNode.data, current_array: curArr, time_points: v1G.timestamps_ms };
        }

        // 2. Component-specific logic
        if (n.type === 'led') {
          const intNet = `int_led_${n.id}`;
          const anodeGraph = findGraph(portToNet[`${n.id}-anode`]);
          const intGraph = findGraph(intNet);
          let brightness = 0;
          let isExploded = !!n.data.isExploded;
          if (!isExploded && anodeGraph && intGraph) {
            const curArray = [];
            let maxI = 0;
            for (let i = 0; i < anodeGraph.timestamps_ms.length; i++) {
              const I = Math.abs(anodeGraph.voltage_levels[i] - intGraph.voltage_levels[i]); 
              curArray.push(I);
              if (I > maxI) maxI = I;
            }
            const max_allowed = Number(n.data.max_current || 20) / 1000;
            if (maxI > max_allowed * 1.5) isExploded = true;
            else if (maxI > 0.0005) brightness = Math.min(1, maxI / max_allowed);
            newNode.data = { ...newNode.data, brightness, isExploded, current_array: curArray, time_points: anodeGraph.timestamps_ms };
          }
        } else if (n.type === 'multimeter') {
          if (n.data.mode === 'current') {
            const currentGraph = findGraph(`i(v_ammeter_${n.id})`);
            const valCurrent = currentGraph ? currentGraph.voltage_levels[currentGraph.voltage_levels.length - 1] : 0;
            const timePoints = currentGraph ? currentGraph.timestamps_ms : null;
            const cArr = currentGraph ? currentGraph.voltage_levels : null;
            newNode.data = {
              ...newNode.data,
              voltage: valCurrent,
              voltage_array: cArr,
              time_points: timePoints
            };
          } else {
            const vPos = findGraph(portToNet[`${n.id}-pos`]);
            const vNeg = findGraph(portToNet[`${n.id}-neg`]);
            const valPos = vPos ? vPos.voltage_levels[vPos.voltage_levels.length - 1] : 0;
            const valNeg = vNeg ? vNeg.voltage_levels[vNeg.voltage_levels.length - 1] : 0;
            const timePoints = vPos ? vPos.timestamps_ms : (vNeg ? vNeg.timestamps_ms : null);
            const vArr = vPos && vNeg 
              ? vPos.voltage_levels.map((v, i) => v - (vNeg.voltage_levels[i] || 0))
              : (vPos ? vPos.voltage_levels : (vNeg ? vNeg.voltage_levels.map(v => -v) : null));
            newNode.data = { 
              ...newNode.data, 
              voltage: valPos - valNeg,
              voltage_array: vArr,
              time_points: timePoints
            };
          }
        } else if (n.type === 'scope') {
          const ch1 = findGraph(portToNet[`${n.id}-ch1`]);
          const ch2 = findGraph(portToNet[`${n.id}-ch2`]);
          const gnd = findGraph(portToNet[`${n.id}-gnd`]);
          let vd1: any[] = [];
          let vd2: any[] = [];
          if (ch1) vd1 = ch1.timestamps_ms.map((t, i) => ({ t, v: ch1.voltage_levels[i] - (gnd ? gnd.voltage_levels[i] : 0) }));
          if (ch2) vd2 = ch2.timestamps_ms.map((t, i) => ({ t, v: ch2.voltage_levels[i] - (gnd ? gnd.voltage_levels[i] : 0) }));
          newNode.data = { ...newNode.data, voltageData1: vd1, voltageData2: vd2 };
        } else if (n.type === 'speaker') {
          const graph = findGraph(portToNet[`${n.id}-in`]);
          const gnd = findGraph(portToNet[`${n.id}-gnd`]);
          let vd: any[] = [];
          if (graph) vd = graph.timestamps_ms.map((t, i) => ({ t, v: graph.voltage_levels[i] - (gnd ? gnd.voltage_levels[i] : 0) }));
          newNode.data = { ...newNode.data, voltageData: vd };
        } else if (n.type === 'mcu') {
          newNode.data.logs = mcuLogs[n.id];
        } else if (n.type === 'sevenseg') {
          const segs = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
          const commonGraph = findGraph(portToNet[`${n.id}-common`]);
          const segmentVoltages: Record<string, number> = {};
          const segmentVoltageArrays: Record<string, number[]> = {};
          let timePoints: number[] = [];
          
          segs.forEach(s => {
            const segGraph = findGraph(portToNet[`${n.id}-${s}`]);
            if (segGraph) {
              if (timePoints.length === 0) timePoints = segGraph.timestamps_ms;
              const diffs = segGraph.voltage_levels.map((v, i) => v - (commonGraph ? commonGraph.voltage_levels[i] : 0));
              segmentVoltageArrays[s] = diffs;
              
              let peak = 0;
              diffs.forEach(d => { if (Math.abs(d) > Math.abs(peak)) peak = d; });
              segmentVoltages[s] = peak;
            } else {
              segmentVoltages[s] = 0;
              segmentVoltageArrays[s] = [];
            }
          });
          newNode.data = { ...newNode.data, segmentVoltages, segmentVoltageArrays, timePoints };
        }
        
        return newNode;
      });

      setNodes(updatedNodes);
      simResultRef.current = { portToNet, result };

      const updatedEdges = edges.map(e => {
        const srcNode = updatedNodes.find(n => n.id === e.source);
        const tgtNode = updatedNodes.find(n => n.id === e.target);
        let curArr = srcNode?.data.current_array || tgtNode?.data.current_array;
        let tPts = srcNode?.data.time_points || tgtNode?.data.time_points;
        
        if (!curArr) {
          const netName = portToNet[`${e.target}-${e.targetHandle}`] || portToNet[`${e.source}-${e.sourceHandle}`];
          const vG = findNetGraph(result, netName);
          if (vG) {
            // Virtual current based on 10k virtual input impedance to animate logic signals
            curArr = vG.voltage_levels.map((v: number) => Math.abs(v) / 10000);
            tPts = vG.timestamps_ms;
          }
        }

        return { 
          ...e, 
          type: showAura ? 'aura' : 'smoothstep', 
          data: { ...e.data, current_array: curArr, time_points: tPts } 
        };
      });
      setEdges(updatedEdges);
      
      // Save final voltages for initial conditions in subsequent interactive runs
      const nextICs: Record<string, number> = {};
      if (result && result.variableNames && result.data) {
        result.variableNames.forEach((varName: string, idx: number) => {
          const name = varName.toLowerCase();
          if (name.startsWith('v(') && name.endsWith(')')) {
            const net = name.slice(2, -1);
            const vals = result.data[idx]?.values;
            if (vals && vals.length > 0) {
              nextICs[net] = vals[vals.length - 1];
            }
          }
        });
      }
      setInitialConditions(nextICs);

      setIsSpiceRunning(false);
      playbackTicker.start(simLength * 1000);
      
      return {
        ok: true,
        nodes: updatedNodes,
        edges: updatedEdges,
        rawResult: result
      };
      
    } catch (e: any) {
      console.error("Simulation failed:", e);
      setIsSpiceRunning(false);
      setIsSimulating(false);
      return { ok: false, error: e.message || String(e) };
    } finally {
      simInFlightRef.current = false;
      // Values moved on while this solve was running; take the newest ones.
      if (rerunPendingRef.current) {
        rerunPendingRef.current = false;
        if (isSimulatingRef.current && !hilRunningRef.current) {
          setTimeout(() => void runSimulation(), 0);
        }
      }
    }
  };

  /*
   * Back to t=0 with the circuit intact — Mesh's Reset, for a schematic.
   *
   * Stopping a run leaves its results painted on the canvas: node voltages, LED
   * brightness, scope traces, MCU logs and the per-edge currents. That is what
   * you want when you pause to read them, and wrong when you want a clean slate
   * — an agent inspecting the circuit after a stop cannot tell a stale waveform
   * from a fresh one. This strips exactly the fields the run writes and leaves
   * everything a person set.
   */
  const resetSimulation = () => {
    stopSimulation();
    setInitialConditions({});
    setNodes(nds => nds.map(n => {
      const {
        voltage: _v, voltageData: _vd, voltageData1: _vd1, voltageData2: _vd2,
        current_array: _ca, time_points: _tp, timePoints: _tps,
        segmentVoltages: _sv, segmentVoltageArrays: _sva,
        pinVoltages: _pv, state: _st, logs: _lg, isSimulating: _is,
        ...kept
      } = n.data as Record<string, unknown>;
      return { ...n, data: kept };
    }));
    setEdges(eds => eds.map(e => {
      if (!e.data) return e;
      const { current_array: _ca, time_points: _tp, ...kept } = e.data as Record<string, unknown>;
      return { ...e, data: kept };
    }));
  };

  const { undo, redo, canUndo, canRedo } = useCircuitHistory({ nodes, edges, isSimulating, stopSimulation, setNodes, setEdges });

  // Clear initial conditions on structural changes
  useEffect(() => {
    setInitialConditions({});
  }, [nodes.length, edges.length]);

  /*
   * Node data the netlist is actually built from.
   *
   * Listed rather than hashing the whole of `data` because the simulation
   * writes its results back onto the nodes — voltages, LED brightness, MCU pin
   * state — and a signature that included those would re-trigger on its own
   * output and never settle. Everything here is something a person sets; the
   * two fields the netlist reads that the run also writes, `pinVoltages` and
   * `state`, are deliberately absent.
   */
  const NETLIST_FIELDS = [
    'amplification', 'amplitude', 'bf', 'capacitance', 'code', 'dutyCycle', 'frequency',
    'inductance', 'isOpen', 'k', 'kp', 'l_pri', 'l_pri_label', 'l_sec', 'l_sec_label',
    'label', 'lightLevel', 'lightSensitivity', 'mcuConfig', 'mode', 'photodiodeMode',
    'pins', 'position', 'pwlData', 'r_dark', 'resistance', 'v_drop', 'voltage', 'vto',
    'waveform',
  ] as const;

  const netlistSignature = useMemo(() => {
    const parts: string[] = [];
    for (const n of nodes) {
      parts.push(n.id, n.type ?? '');
      const d = n.data as Record<string, unknown> | undefined;
      for (const k of NETLIST_FIELDS) {
        const v = d?.[k];
        if (v === undefined) continue;
        parts.push(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
      }
    }
    for (const e of edges) {
      parts.push(e.source, e.sourceHandle ?? '', e.target, e.targetHandle ?? '');
    }
    return parts.join('|');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges]);

  /*
   * Re-run while the simulation is up and someone is changing a value.
   *
   * Waiting for the mouse to come up makes a scrub feel disconnected from the
   * thing it is driving — the point of dragging a frequency is watching the
   * trace follow. A quarter of a second is short enough to track a drag and
   * long enough that a solve is not started for every pixel.
   *
   * Not a dependency on `isSimulating`: this fires on a change of values, and
   * having it fire on the run starting would re-solve the circuit that had just
   * been solved. HIL drives its own cadence over the wire and is left alone.
   */
  const rerunPendingRef = useRef(false);
  useEffect(() => {
    if (!isSimulatingRef.current || hilRunningRef.current) return;
    const t = setTimeout(() => {
      if (!isSimulatingRef.current || hilRunningRef.current) return;
      if (simInFlightRef.current) {
        // A solve is already running; take the newest values when it lands.
        rerunPendingRef.current = true;
        return;
      }
      void runSimulation();
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [netlistSignature]);

  const onNodeClick = useCallback((_: any, node: Node) => {
    if (node.type === 'switch') {
      setNodes((nds) => {
        const nextNodes = nds.map((n) => {
          if (n.id === node.id) {
            return { ...n, data: { ...n.data, isOpen: n.data.isOpen === false } };
          }
          return n;
        });
        
        // Auto-re-trigger simulation with the NEW state
        if (isSimulating) {
          setTimeout(() => runSimulation(nextNodes, initialConditions), 50);
        }
        return nextNodes;
      });
    }
  }, [setNodes, runSimulation, isSimulating, initialConditions]);

  // Losing the selection closes the drawer, so that the next component tapped
  // does not reopen it unasked — below `lg` it is opened from the bar, never as
  // a side effect of touching the circuit. Inert at `lg`, where the inspector
  // is a column and this flag is not read.
  useEffect(() => {
    if (!nodes.some(n => n.selected)) setIsPropertiesOpen(false);
  }, [nodes]);

  const deleteSelected = useCallback(() => {
    if (isSimulatingRef.current) return;
    setNodes(nds => nds.filter(n => !n.selected));
    setEdges(eds => eds.filter(e => !e.selected));
  }, [setNodes, setEdges]);

  // Keyboard Shortcuts Handler (Undo / Redo / Delete / Deselect)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) {
        return;
      }
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const isModifier = isMac ? e.metaKey : e.ctrlKey;

      if (isModifier && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          if (canRedo) redo();
        } else {
          if (canUndo) undo();
        }
        return;
      }

      if (isModifier && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        if (canRedo) redo();
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelected();
        return;
      }

      if (e.key === 'Escape') {
        if (probeMode) {
          setProbeMode(false);
          setProbeData(null);
        }
        setNodes(nds => nds.map(n => n.selected ? { ...n, selected: false } : n));
        setEdges(eds => eds.map(edge => edge.selected ? { ...edge, selected: false } : edge));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteSelected, undo, redo, canUndo, canRedo, probeMode]);

  const { exportJson, importJson } = useCircuitFile({ nodes, edges, setNodes, setEdges, stopSimulation });

  useMCPBridge({
    nodes, edges, isSimulating, selectedPreset, probeMode,
    runSimulation, stopSimulation, resetSimulation,
    setProbeMode,
    setNodes: (n: any) => setNodes(n),
    setEdges: (e: any) => setEdges(e),
    loadPreset,
    onTransactionStart: () => setMcpActiveCount(prev => prev + 1),
    onTransactionEnd: () => setMcpActiveCount(prev => Math.max(0, prev - 1)),
  });

  return (
    /*
      `h-dvh`, not `h-screen`: on a phone `100vh` is the viewport measured with
      the URL bar hidden, so the status bar along the bottom — probe toggle,
      duration, resolution — sat underneath the browser chrome and could not be
      reached. On a desktop the two are the same number.
    */
    <div className={`flex flex-col h-dvh w-full transition-colors duration-200 ${darkMode ? 'dark bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'} font-sans overflow-hidden`}>
      {/*
        Below `lg` the bar wraps onto as many rows as it needs instead of
        squeezing everything onto one. Written as `max-lg:` overrides on top of
        the classes that were already here, so at desktop width this element
        carries exactly what it carried before.
      */}
      <header className="shrink-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-3 md:px-6 py-1.5 flex items-center justify-between shadow-xs z-10 transition-colors max-lg:flex-wrap max-lg:justify-start max-lg:gap-y-1.5 max-lg:px-2">
        <div className="flex items-center gap-2 md:gap-4 min-w-0 max-lg:w-full">
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-850 rounded-md lg:hidden text-slate-650 dark:text-slate-400 cursor-pointer"
            title="Toggle Menu"
          >
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <Logo />
            {/* The mark alone identifies the app on a phone; the wordmark,
                badge and tagline are the first thing to give up the width. */}
            <div className="hidden md:block">
              <div className="flex items-center gap-2">
                <h1 className="text-base font-extrabold tracking-tight text-slate-900 dark:text-white font-sans">
                  Physbox <span className="text-emerald-600 dark:text-emerald-400 font-normal">Volt</span>
                </h1>
                <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-cyan-100 dark:bg-cyan-950/80 border border-cyan-200 dark:border-cyan-800/50 text-cyan-700 dark:text-cyan-300">
                  Circuit Studio
                </span>
              </div>
              <p className="text-[10px] text-slate-500 dark:text-slate-400">SPICE Simulation &amp; HIL Studio</p>
            </div>
          </div>
          <div className="h-6 w-px bg-slate-200 dark:bg-slate-800 hidden lg:block"></div>
          
          {/* Preset Selector */}
          <div className="flex items-center min-w-0 max-lg:flex-1 bg-slate-100 dark:bg-slate-800/80 p-0.5 rounded-lg border border-slate-200/80 dark:border-slate-700/60 shadow-inner">
            <select
              value={selectedPreset}
              onChange={handlePresetChange}
              className="bg-transparent text-slate-700 dark:text-slate-100 text-xs rounded-md block px-2 py-1 outline-none font-medium cursor-pointer border-none max-lg:flex-1 max-lg:min-w-0"
            >
              <optgroup label="⬜ Built-in Presets" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300">
                {Object.keys(presets).map(key => (
                  <option key={key} value={key} className="bg-white dark:bg-slate-900 text-slate-750 dark:text-slate-350">{presets[key].name}</option>
                ))}
              </optgroup>
              {Object.keys(userPresets).length > 0 && (
                <optgroup label="📁 Saved Presets" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300">
                  {Object.keys(userPresets).map(key => (
                    <option key={key} value={key} className="bg-white dark:bg-slate-900 text-slate-750 dark:text-slate-350">💾 {userPresets[key].name}</option>
                  ))}
                </optgroup>
              )}
            </select>
            {selectedPreset && userPresets[selectedPreset] && (
              <>
                <button
                  onClick={() => {
                    const name = userPresets[selectedPreset].name.replace(/^User:\s*/, '');
                    savePresetByName(name);
                  }}
                  className="flex items-center justify-center p-1 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors focus:outline-none cursor-pointer"
                  title={`Update preset "${userPresets[selectedPreset].name.replace(/^User:\s*/, '')}"`}
                >
                  <Save className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => {
                    if (window.confirm(`Are you sure you want to delete the preset "${userPresets[selectedPreset].name}"?`)) {
                      deleteUserPreset(selectedPreset);
                    }
                  }}
                  className="flex items-center justify-center p-1 rounded-md text-red-500 hover:bg-red-50 dark:hover:bg-red-950/50 transition-colors focus:outline-none cursor-pointer"
                  title={`Delete preset "${userPresets[selectedPreset].name}"`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        </div>
        
        {/*
          Simulation, files and utilities. Below `lg` this takes a row of its
          own and wraps within it rather than dropping buttons: everything here
          is either a file operation or a simulation control, and deciding on
          the user's behalf that they won't want to export a netlist or mill a
          PCB from a phone is how a mobile layout ends up being a demo of the
          app rather than the app.
        */}
        <div className="flex items-center gap-2 md:gap-3 min-w-0 max-lg:w-full max-lg:flex-wrap max-lg:justify-between max-lg:gap-y-1.5">
          {/* Simulation Controller Block */}
          <div className="flex items-center shrink-0 bg-slate-100 dark:bg-slate-800/80 p-0.5 rounded-lg border border-slate-200/80 dark:border-slate-700/60 shadow-inner">
            <button 
              onClick={() => { setInitialConditions({}); runSimulation(undefined, {}); }}
              disabled={isSimulating}
              className={`flex items-center justify-center gap-1.5 px-3 py-1 rounded-md font-semibold text-xs transition-all disabled:opacity-50 flex-shrink-0 cursor-pointer ${
                isSimulating
                  ? 'hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 dark:text-slate-500'
                  : 'hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-100'
              }`}
              title="Simulate"
            >
              <Play className="w-3 h-3 text-emerald-500 dark:text-emerald-400" />
              <span className="hidden md:inline">Run</span>
            </button>

            <button 
              onClick={stopSimulation}
              disabled={!isSimulating}
              className={`flex items-center justify-center gap-1.5 px-3 py-1 rounded-md font-semibold text-xs transition-all disabled:opacity-50 flex-shrink-0 cursor-pointer ${
                isSimulating
                  ? 'bg-red-500 hover:bg-red-650 text-white shadow-xs'
                  : 'hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-650 dark:text-slate-455'
              }`}
              title="Stop"
            >
              <Square className="w-3 h-3" />
              <span className="hidden md:inline">Stop</span>
            </button>
          </div>

          {/* Files & Actions Segmented Group */}
          <div className="flex items-center shrink-0 bg-slate-100 dark:bg-slate-800/80 p-0.5 rounded-lg border border-slate-200/80 dark:border-slate-700/60 shadow-inner">
            <button 
              onClick={() => {
                if (selectedPreset && userPresets[selectedPreset]) {
                  const name = userPresets[selectedPreset].name.replace(/^User:\s*/, '');
                  savePresetByName(name);
                } else {
                  setSaveDialogName('');
                  setIsSaveDialogOpen(true);
                }
              }}
              className="flex items-center justify-center p-1 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-650 dark:text-slate-300 transition-colors focus:outline-none cursor-pointer"
              title={selectedPreset && userPresets[selectedPreset] ? `Save "${userPresets[selectedPreset].name.replace(/^User:\s*/, '')}"` : 'Save circuit preset'}
            >
              <Save className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={deleteSelected}
              disabled={isSimulating}
              className="flex items-center justify-center p-1 rounded-md hover:bg-red-50 dark:hover:bg-red-950/40 text-red-500 disabled:opacity-30 disabled:hover:bg-transparent transition-colors focus:outline-none cursor-pointer"
              title={isSimulating ? "Stop the simulation to edit the circuit." : "Delete Selected (Delete / Backspace)"}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={exportJson}
              className="flex items-center justify-center p-1 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-650 dark:text-slate-300 transition-colors focus:outline-none cursor-pointer"
              title="JSON"
            >
              <Download className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={importJson}
              className="flex items-center justify-center p-1 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-655 dark:text-slate-300 transition-colors focus:outline-none cursor-pointer"
              title="Import JSON"
            >
              <Upload className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={() => setIsPcbModalOpen(true)}
              className="flex items-center justify-center p-1 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 text-amber-600 dark:text-amber-400 transition-colors focus:outline-none cursor-pointer"
              title="PCB Mill (CNC & WebSerial)"
            >
              <Printer className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={undo}
              disabled={!canUndo}
              className="flex items-center justify-center p-1 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-655 dark:text-slate-300 disabled:opacity-30 disabled:hover:bg-transparent transition-colors focus:outline-none cursor-pointer"
              title="Undo (Ctrl+Z)"
            >
              <Undo className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={redo}
              disabled={!canRedo}
              className="flex items-center justify-center p-1 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-655 dark:text-slate-300 disabled:opacity-30 disabled:hover:bg-transparent transition-colors focus:outline-none cursor-pointer"
              title="Redo (Ctrl+Y)"
            >
              <Redo className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="h-5 w-px bg-slate-200 dark:bg-slate-800 mx-0.5 hidden sm:block" />

          {/* Right Utilities (Dark Mode, Docs, Settings, Copilot, GitHub) */}
          <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
            {/* Dark Mode Toggle */}
            <button
              onClick={toggleDarkMode}
              className="flex items-center justify-center w-8 h-8 rounded-full border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors focus:outline-none flex-shrink-0 cursor-pointer shadow-xs"
              title={darkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
            >
              {darkMode ? <Sun className="w-4 h-4 text-amber-500" /> : <Moon className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />}
            </button>

            {/*
              Properties inspector — a permanent column at `lg`, a drawer below
              it, opened from here. The mirror of the components hamburger on
              the other end of the bar: one button for the palette going in, one
              for the inspector coming out. Disabled with nothing selected,
              because the inspector has nothing to show until then.
            */}
            <button
              onClick={() => setIsPropertiesOpen(!isPropertiesOpen)}
              disabled={!nodes.some(n => n.selected)}
              className={`lg:hidden flex items-center justify-center w-8 h-8 rounded-full border transition-colors focus:outline-none flex-shrink-0 cursor-pointer shadow-xs disabled:opacity-40 disabled:cursor-not-allowed ${
                isPropertiesOpen
                  ? 'bg-emerald-100 border-emerald-400 text-emerald-700 dark:bg-emerald-950 dark:border-emerald-700 dark:text-emerald-400'
                  : 'border-slate-200 dark:border-slate-700 text-slate-650 dark:text-slate-300 bg-white dark:bg-slate-900'
              }`}
              title={nodes.some(n => n.selected) ? 'Properties' : 'Select a component to see its properties'}
            >
              <PanelRight className="w-4 h-4" />
            </button>

            {/* Docs (Info) */}
            <button
              onClick={() => setIsDocsOpen(true)}
              className="flex items-center justify-center w-8 h-8 rounded-full border border-indigo-200 dark:border-indigo-850 text-indigo-655 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors focus:outline-none flex-shrink-0 cursor-pointer shadow-xs"
              title="Documentation"
            >
              <Info className="w-4 h-4" />
            </button>

            {/* Settings */}
            <button
              onClick={() => setIsSettingsOpen(!isSettingsOpen)}
              className={`flex items-center justify-center w-8 h-8 rounded-full border transition-colors focus:outline-none flex-shrink-0 cursor-pointer shadow-xs ${
                isSettingsOpen 
                  ? 'bg-emerald-100 border-emerald-400 text-emerald-700 dark:bg-emerald-950 dark:border-emerald-700 dark:text-emerald-400' 
                  : 'border-slate-200 dark:border-slate-700 text-slate-650 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
              title="Settings"
            >
              <Settings className="w-4 h-4" />
            </button>

            {/* AI Copilot Expert */}
            <button
              onClick={() => setShowAICopilot(!showAICopilot)}
              className={`flex items-center justify-center w-8 h-8 rounded-full border transition-colors focus:outline-none flex-shrink-0 cursor-pointer shadow-xs ${
                showAICopilot 
                  ? 'bg-purple-100 border-purple-400 text-purple-750 dark:bg-purple-955 dark:border-purple-700 dark:text-purple-400' 
                  : 'border-purple-200 dark:border-purple-800 text-purple-655 dark:text-purple-450 bg-purple-50 dark:bg-purple-950/30 hover:bg-purple-100 dark:hover:bg-purple-900/40'
              }`}
              title="AI Copilot Expert"
            >
              <Sparkles className="w-4 h-4" />
            </button>

            {/* User Profile & Cloud Sync */}
            <UserProfileButton />

            {/* GitHub link */}
            <a
              href="https://github.com/physbox-io/volt"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center w-8 h-8 rounded-full border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors focus:outline-none flex-shrink-0 cursor-pointer shadow-xs"
              title="View on GitHub"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg>
            </a>
          </div>
        </div>
      </header>

      <div className="flex flex-1 relative min-h-0 overflow-hidden">
        <Sidebar
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
          onPickPart={(type, label) => setPickedPart(prev => ({ type, label, seq: (prev?.seq ?? 0) + 1 }))}
        />
        
        {/* Floating Status Indicators */}
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-20 flex flex-col gap-2 pointer-events-none items-center">
          {isSpiceRunning && (
            <div className="bg-white/90 dark:bg-slate-900/90 text-slate-800 dark:text-slate-100 border border-slate-200/80 dark:border-slate-800/80 px-3.5 py-1.5 rounded-full shadow-md flex items-center gap-2.5 text-xs font-semibold backdrop-blur-md transition-all duration-300 pointer-events-auto">
              <div className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </div>
              <Activity className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span className="tracking-wide">SPICE Simulating</span>
            </div>
          )}
          {mcpActiveCount > 0 && (
            <div className="bg-white/90 dark:bg-slate-900/90 text-slate-800 dark:text-slate-100 border border-slate-200/80 dark:border-slate-800/80 px-3.5 py-1.5 rounded-full shadow-md flex items-center gap-2.5 text-xs font-semibold backdrop-blur-md transition-all duration-300 pointer-events-auto">
              <div className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </div>
              <Zap className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
              <span className="tracking-wide">MCP Active</span>
            </div>
          )}
        </div>

        <EdgePathProvider edges={edges}>
          <ReactFlowProvider>
            <FlowArea
            nodes={nodes} edges={edges}
            fitKey={selectedPreset}
            hasNoteCard={noteCards.length > 0}
            noteCardRect={() => document.querySelector('[data-note-card]')?.getBoundingClientRect() ?? null}
            setNodes={setNodes} setEdges={setEdges}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
            onNodeClick={onNodeClick}
            isSimulating={isSimulating}
            pickedPart={pickedPart}
            onPickedPartPlaced={() => setPickedPart(null)}
            probeMode={probeMode}
            onEdgeProbe={(edgeId: string, event: React.MouseEvent) => {
              if (!probeMode || !simResultRef.current) return;
              const { portToNet, result } = simResultRef.current;
              const edge = edges.find(e => e.id === edgeId);
              if (!edge) return;
              const srcPort = `${edge.source}-${edge.sourceHandle || 'out'}`;
              const netName = portToNet[srcPort] || 'unknown';
              // Find voltage
              let voltage = 0;
              let history: number[] = [];
              let timePoints: number[] = [];
              let maxV = 0;
              let minV = 0;
              let avgV = 0;
              if (result?.variableNames && result?.data) {
                const search = netName.toLowerCase();
                const idx = result.variableNames.findIndex((v: string) => v.toLowerCase() === search || v.toLowerCase() === `v(${search})`);
                if (idx !== -1 && result.data[idx]) {
                  const vals = result.data[idx].values;
                  voltage = vals[vals.length - 1];
                  history = vals;
                  maxV = Math.max(...vals);
                  minV = Math.min(...vals);
                  const sum = vals.reduce((a: number, b: number) => a + b, 0);
                  avgV = sum / vals.length;
                  
                  if (result.data[0]) {
                    timePoints = result.data[0].values.map((t: number) => t * 1000);
                  }
                }
              }
              setProbeData({ netName, voltage, history, timePoints, maxV, minV, avgV, x: event.clientX, y: event.clientY });
            }}
          />
        </ReactFlowProvider>
      </EdgePathProvider>
        {/* Dimmer behind the inspector drawer. Only exists below `lg`, where the
            inspector is an overlay; tapping the circuit puts it away. */}
        {isPropertiesOpen && nodes.find(n => n.selected) && (
          <div
            className="lg:hidden absolute inset-0 z-[105] bg-slate-950/30"
            onClick={() => setIsPropertiesOpen(false)}
          />
        )}
        {nodes.find(n => n.selected) && (
          <PropertiesPanel
            selectedNode={nodes.find(n => n.selected)!}
            setNodes={setNodes}
            setEdges={setEdges}
            isSimulating={isSimulating}
            runSimulation={runSimulation}
            simLength={simLength}
            isOpen={isPropertiesOpen}
            onClose={() => setIsPropertiesOpen(false)}
          />
        )}
        {noteCards.map(card => (
          <NoteCardOverlay
            key={card.id}
            card={card}
            isEditing={editingCardId === card.id}
            onToggleEdit={() => toggleEdit(card.id)}
            onToggleMinimize={() => toggleMinimize(card.id)}
            onMarkdownChange={(md) => updateMarkdown(card.id, md)}
            onClose={() => closeCard(card.id)}
            onMove={(x, y) => moveCard(card.id, x, y)}
          />
        ))}
        {showAICopilot && (
          <AICopilotPanel
            nodes={nodes}
            edges={edges}
            setNodes={setNodes}
            setEdges={setEdges}
            onClose={() => setShowAICopilot(false)}
          />
        )}
        {isPcbModalOpen && (
          <ExportPcbModal
            onClose={() => setIsPcbModalOpen(false)}
            nodes={nodes}
            edges={edges}
          />
        )}
        {isDocsOpen && <DocsModal onClose={() => setIsDocsOpen(false)} />}
        {isSettingsOpen && (
          <SettingsModal
            onClose={() => setIsSettingsOpen(false)}
            showAura={showAura}
            setShowAura={setShowAura}
            userPresets={userPresets}
            onDeleteUserPreset={deleteUserPreset}
          />
        )}

        {/* Save Circuit Dialog */}
        {isSaveDialogOpen && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-2xl max-w-md w-full p-6 flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-200">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-emerald-100 dark:bg-emerald-950 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                  <Save className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="font-bold text-slate-800 dark:text-slate-200 text-base">Save Circuit Preset</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Give your circuit a name to save it locally</p>
                </div>
              </div>
              <input
                autoFocus
                type="text"
                placeholder="e.g. Astable Multivibrator"
                value={saveDialogName}
                onChange={(e) => setSaveDialogName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') savePreset();
                  if (e.key === 'Escape') setIsSaveDialogOpen(false);
                }}
                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100"
              />
              <div className="flex justify-end gap-2 text-xs">
                <button
                  onClick={() => setIsSaveDialogOpen(false)}
                  className="px-4 py-2 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors font-semibold"
                >
                  Cancel
                </button>
                <button
                  onClick={savePreset}
                  disabled={!saveDialogName.trim()}
                  className="px-4 py-2 font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Probe Tooltip */}
        {probeData && (
          <ProbeTooltip probeData={probeData} isSimulating={isSimulating} onClose={() => setProbeData(null)} />
        )}
      </div>

      {/* Bottom Status Bar matching Etch */}
      {/*
        Below `lg` the bar wraps rather than squeezing. Probe mode, duration and
        resolution are what a run is defined by, so none of it is something to
        drop on a narrow screen.
      */}
      <footer className="h-8 shrink-0 w-full bg-white dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800/80 px-4 flex items-center justify-between z-20 text-[11px] text-slate-500 dark:text-slate-400 font-mono select-none transition-colors max-lg:h-auto max-lg:flex-wrap max-lg:justify-start max-lg:px-2 max-lg:py-1 max-lg:gap-x-3 max-lg:gap-y-1">
        {/* Left: Probe Toggle & Circuit Metrics */}
        <div className="flex items-center gap-3 max-lg:shrink-0">
          <button
            onClick={() => { setProbeMode(!probeMode); setProbeData(null); }}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] transition-colors cursor-pointer ${
              probeMode
                ? 'bg-violet-600 border-violet-650 text-white font-semibold shadow-xs'
                : 'bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800'
            }`}
            title="Probe Mode — click a wire to inspect voltage"
          >
            <Crosshair className="w-3.5 h-3.5" />
            <span>Probe</span>
          </button>

          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
            <span>Nodes: {nodes.length}</span>
            <span>·</span>
            <span>Wires: {edges.length}</span>
          </div>


        </div>

        {/* Right: Simulation Parameters (Duration & Resolution) */}
        <div className="flex items-center gap-3 max-lg:shrink-0">
          {/* The mill that cuts the board this schematic becomes. */}
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${
                machineState.connected ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400 dark:bg-slate-600'
              }`}
            />
            <span>Machine:</span>
            <span
              className={
                machineState.connected
                  ? 'text-emerald-600 dark:text-emerald-400 font-bold'
                  : 'text-slate-400'
              }
            >
              {machineState.status}
            </span>
            {/* Next to the status it acts on. A disconnected machine is the
                moment someone wants this button. Volt keeps its machine setup
                inside the PCB export modal, so that is what this opens. */}
            <button
              onClick={() => setIsPcbModalOpen(true)}
              className="p-1 rounded text-amber-600 dark:text-amber-400 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              title="Connect the machine, home it, and set the work origin"
            >
              <Wrench className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="w-px h-3 bg-slate-200 dark:bg-slate-800 max-lg:hidden" />

          {/* Duration Block */}
          <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 ${nodes.some(n => n.type === 'heltec_v4') ? 'opacity-50 cursor-not-allowed' : ''}`}>
            <label htmlFor="bottom-duration" className="text-slate-500 dark:text-slate-400 font-semibold leading-none">
              Duration:
            </label>
            <NumberInput
              id="bottom-duration"
              min={0.1}
              step={0.1}
              value={nodes.some(n => n.type === 'heltec_v4') ? 0.05 : simLength}
              disabled={nodes.some(n => n.type === 'heltec_v4')}
              onChange={v => setSimLength(v)}
                      className={`w-12 text-[11px] leading-none border-none bg-transparent focus:ring-0 text-right font-medium text-slate-900 dark:text-slate-100 p-0 ${nodes.some(n => n.type === 'heltec_v4') ? 'cursor-not-allowed' : ''}`}
              title={nodes.some(n => n.type === 'heltec_v4') ? "Locked to 50ms transient slices in Hardware-in-the-Loop mode." : "Simulation duration in seconds"}
                    />
            <span className="text-slate-500 dark:text-slate-400 leading-none">{nodes.some(n => n.type === 'heltec_v4') ? 's (HIL)' : 's'}</span>
          </div>

          {/* Resolution Block */}
          <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 ${nodes.some(n => n.type === 'heltec_v4') ? 'opacity-50 cursor-not-allowed' : ''}`}>
            <label htmlFor="bottom-res" className="text-slate-500 dark:text-slate-400 font-semibold leading-none">
              Res:
            </label>
            <select
              id="bottom-res"
              value={simResolution}
              disabled={nodes.some(n => n.type === 'heltec_v4')}
              onChange={e => setSimResolution(e.target.value as 'normal' | 'high')}
              className={`bg-transparent border-none text-slate-900 dark:text-slate-100 text-[11px] leading-none focus:ring-0 font-medium cursor-pointer p-0 ${nodes.some(n => n.type === 'heltec_v4') ? 'cursor-not-allowed' : ''}`}
              title={nodes.some(n => n.type === 'heltec_v4') ? "Locked in Hardware-in-the-Loop mode." : "Solver timestep resolution"}
            >
              <option value="normal" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300">Normal</option>
              <option value="high" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300">High</option>
            </select>
          </div>
        </div>
      </footer>
    </div>
  );
}
