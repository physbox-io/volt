import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { Node, Edge } from '@xyflow/react';
import { HELTEC_V4_GPIO_PINS } from '../components/nodes/partDefaults';
import { HILMemoizer } from '../utils/hilMemoizer';
import { buildNetlistResultIndex, findNetGraph } from '../utils/netlistResult';
import { explainSpiceFailure, messagesFromError } from '../utils/simDiagnostics';
import type { SimState } from '../utils/simState';
import type { SpiceResult } from '../types/simulation';
import type { Advisory } from '../types/advisories';
import { initialSliceState, runSlice, type SliceState } from '../sim/sliceRunner';
import { encodeSpeakerAudio } from '../hil/pinEncoding';
import {
  HeltecLink,
  POLL_TAG,
  STOP_CODE,
  backgroundPollCode,
  bootstrapCode,
  boardUrl,
  buildSliceCommand,
  calibrateReading,
  connectedHeltecPins,
  polledPins,
  type ExecutionMode,
} from '../hil/heltecLink';

/** Simulated time per slice. */
const HIL_SLICE_STEP_MS = 40;
// Target amount of buffered-but-not-yet-dispatched playback time. Depth (not
// per-slice size) is what absorbs a slow SPICE call, so this stays fixed
// regardless of how long any individual compute takes.
const HIL_BUFFER_TARGET_MS = 240;
/** Playback time sent to the board in one command. */
const HIL_BATCH_TARGET_MS = 120;
// A slice still solving after this has long since starved the board's
// lookahead, and the default minute would hold the whole pipeline with it.
// Past it the worker drops the engine and the next slice starts afresh.
const HIL_SLICE_TIMEOUT_MS = 2_000;

const isBoard = (n: Node) => n.type === 'heltec_v4';

type UseHilArgs = {
  nodes: Node[];
  nodesRef: RefObject<Node[]>;
  edgesRef: RefObject<Edge[]>;
  setNodes: Dispatch<SetStateAction<Node[]>>;
  /** The preset on the canvas: one preset's sensor is calibrated. */
  selectedPresetRef: RefObject<string>;
  setInitialConditions: (state: SimState) => void;
  setRunAdvisories: Dispatch<SetStateAction<Advisory[]>>;
  solve: (netlist: string, timeoutMs: number) => Promise<SpiceResult>;
};

/**
 * Hardware in the loop: a Heltec board's inputs drive the simulation, and the
 * simulated outputs drive its pins, in 40ms slices computed ahead of real time.
 *
 * Wires the pure slice step (`runSlice`) to the board (`HeltecLink`) and to
 * the canvas. `start` begins a run, `stop` ends it; `runningRef` says whether
 * one is going, for callers that must leave the circuit alone meanwhile.
 *
 * Everything the socket's callbacks touch is a ref or a state setter, so a
 * callback created in an earlier render still sees the current run.
 */
export function useHil({ nodes, nodesRef, edgesRef, setNodes, selectedPresetRef, setInitialConditions, setRunAdvisories, solve }: UseHilArgs) {
  const linkRef = useRef(new HeltecLink());
  const runningRef = useRef(false);
  // Polling the idle board for its readings. It self-perpetuates through
  // setTimeout, and stopping a run turns it off rather than resuming it.
  const bgPollActiveRef = useRef(true);
  /** The latest reading off each input pin, volts. */
  const valuesRef = useRef<Record<string, number>>({});
  const smoothedValuesRef = useRef<Record<string, number>>({});
  const sliceStateRef = useRef<SliceState>(initialSliceState());
  /** The last second of each scope channel and LED, for the canvas. */
  const historyRef = useRef<Record<string, { t: number; v: number }[]>>({});
  /** Simulated time since the run started, ms. */
  const simulatedMsRef = useRef(0);
  const toppingUpRef = useRef(false);
  const memoizerRef = useRef(new HILMemoizer());
  const connectedPinsCacheRef = useRef<{ edges: Edge[]; nodeId: string; pins: Set<string> } | null>(null);

  // Wiring essentially never changes mid-run, so the slice loop reuses the set
  // until the edges array itself changes.
  const connectedPinsCached = (nodeId: string): Set<string> => {
    const cached = connectedPinsCacheRef.current;
    if (cached && cached.edges === edgesRef.current && cached.nodeId === nodeId) return cached.pins;
    const pins = connectedHeltecPins(nodeId, edgesRef.current);
    connectedPinsCacheRef.current = { edges: edgesRef.current, nodeId, pins };
    return pins;
  };

  const showPinVoltages = () => {
    setNodes(nds => nds.map(n => isBoard(n) ? { ...n, data: { ...n.data, pinVoltages: { ...valuesRef.current } } } : n));
  };

  function runBackgroundPoll() {
    const link = linkRef.current;
    if (!bgPollActiveRef.current || runningRef.current || !link.connected || !link.socket) return;
    const board = nodesRef.current.find(isBoard);
    if (!board) return;
    const pins = (board.data.pins as Record<string, string>) || {};
    try {
      link.sendRepl(backgroundPollCode(pins, connectedHeltecPins(board.id, edgesRef.current)));
    } catch (e) {
      console.error("[HIL] Background poll send failed:", e);
    }
  }

  // Flushes accumulated scope/LED history to React state. Called once per real
  // hil_slice_result (device round trip), not once per computed slice: the
  // lookahead computes several slices back to back, and a re-render for each
  // would come before any of that data had even reached the device.
  const flushDisplay = () => {
    const cutoff = simulatedMsRef.current - 1000;
    setNodes(nds => nds.map(n => {
      if (n.type === 'scope') {
        const hist1 = historyRef.current[`${n.id}-ch1`];
        const hist2 = historyRef.current[`${n.id}-ch2`];
        if (!hist1 && !hist2) return n;
        const relativePoints1 = (hist1 || []).map(p => ({ t: p.t - cutoff, v: p.v }));
        const relativePoints2 = (hist2 || []).map(p => ({ t: p.t - cutoff, v: p.v }));
        return { ...n, data: { ...n.data, voltageData: relativePoints1, voltageData1: relativePoints1, voltageData2: relativePoints2 } };
      }
      if (n.type === 'led') {
        const hist = historyRef.current[n.id];
        if (!hist) return n;
        return { ...n, data: { ...n.data, time_points: hist.map(p => p.t - cutoff), current_array: hist.map(p => p.v) } };
      }
      return n;
    }));
  };

  const runOneSlice = async () => {
    if (!runningRef.current) return;
    const board = nodesRef.current.find(isBoard);
    if (!board) return;
    const link = linkRef.current;

    try {
      const memoizer = memoizerRef.current;
      memoizer.enabled = typeof board.data.hilMemoizationEnabled === 'boolean' ? board.data.hilMemoizationEnabled : true;
      memoizer.inputDP = typeof board.data.hilInputDP === 'number' ? board.data.hilInputDP : 3;
      memoizer.icDP = typeof board.data.hilIcDP === 'number' ? board.data.hilIcDP : 3;
      memoizer.maxConsecutiveHits = typeof board.data.hilMaxConsecutiveHits === 'number' ? board.data.hilMaxConsecutiveHits : 50;
      if (board.data.hilClearCacheRequested) {
        memoizer.clear();
        setNodes(nds => nds.map(n => n.id === board.id ? { ...n, data: { ...n.data, hilClearCacheRequested: undefined } } : n));
      }

      const sliceMs = HIL_SLICE_STEP_MS;
      const slice = await runSlice(
        sliceStateRef.current,
        { nodes: nodesRef.current, edges: edgesRef.current, boardId: board.id, inputs: { ...valuesRef.current }, sliceMs },
        { solve: netlist => solve(netlist, HIL_SLICE_TIMEOUT_MS), memoizer },
      );
      sliceStateRef.current = slice.state;
      const { result, portToNet } = slice;
      const resultIndex = buildNetlistResultIndex(result);

      // Stream simulated speaker audio to the CYD board
      if (link.connected) {
        const speaker = slice.nodes.find(n => n.type === 'speaker' && n.data.outputTarget === 'cyd');
        if (speaker) {
          const samples = encodeSpeakerAudio(
            findNetGraph(result, portToNet[`${speaker.id}-in`], resultIndex),
            findNetGraph(result, portToNet[`${speaker.id}-gnd`], resultIndex),
            sliceMs,
          );
          if (samples) link.sendAudio(samples);
        }
      }

      setInitialConditions(slice.state.sim);
      simulatedMsRef.current += sliceMs;
      const now = simulatedMsRef.current;

      const pins = (board.data.pins as Record<string, string>) || {};
      link.push(buildSliceCommand(pins, slice.outputs, connectedPinsCached(board.id)), sliceMs);

      // Live memoization stats for the properties panel
      const stats = memoizer.getStats();
      setNodes(nds => nds.map(n => n.id === board.id ? { ...n, data: { ...n.data, hilStats: stats } } : n));

      // History every slice, for gap-free traces; drawn by flushDisplay.
      const append = (key: string, points: { t: number; v: number }[]) => {
        historyRef.current[key] = [...(historyRef.current[key] || []), ...points].filter(p => p.t >= now - 1000);
      };
      const at = (t: number) => now - sliceMs + t;
      for (const n of slice.nodes) {
        if (n.type === 'scope') {
          const gndGraph = findNetGraph(result, portToNet[`${n.id}-gnd`], resultIndex);
          for (const ch of ['ch1', 'ch2']) {
            const graph = findNetGraph(result, portToNet[`${n.id}-${ch}`], resultIndex);
            if (!graph) continue;
            append(`${n.id}-${ch}`, graph.timestamps_ms.map((t, idx) => ({
              t: at(t),
              v: graph.voltage_levels[idx] - (gndGraph ? gndGraph.voltage_levels[idx] : 0.0),
            })));
          }
        }
        if (n.type === 'led') {
          const anodeGraph = findNetGraph(result, portToNet[`${n.id}-anode`], resultIndex);
          const intGraph = findNetGraph(result, `int_led_${n.id}`, resultIndex);
          if (anodeGraph && intGraph) {
            append(n.id, anodeGraph.timestamps_ms.map((t, idx) => ({
              t: at(t),
              v: anodeGraph.voltage_levels[idx] - intGraph.voltage_levels[idx],
            })));
          }
        }
      }
      setRunAdvisories(prev => (prev.some(a => a.id === 'hil:failed') ? prev.filter(a => a.id !== 'hil:failed') : prev));
    } catch (e) {
      console.error("[HIL] Simulation slice run failed:", e);
      const messages = messagesFromError(e);
      const explained = messages.some(m => m.includes('TIMED_OUT'))
        ? {
            title: 'A slice did not finish in time',
            detail: `One ${HIL_SLICE_STEP_MS}ms slice was still solving after ${HIL_SLICE_TIMEOUT_MS / 1000}s, too slow to keep the board fed. Switching converters and fast oscillators are the usual cause.`,
          }
        : explainSpiceFailure(messages);
      setRunAdvisories(prev => [
        ...prev.filter(a => a.id !== 'hil:failed'),
        { id: 'hil:failed', severity: 'warning', title: `HIL: ${explained.title}`, detail: explained.detail },
      ]);
    }
  };

  const topUpQueue = async () => {
    if (toppingUpRef.current) return;
    toppingUpRef.current = true;
    try {
      while (runningRef.current && linkRef.current.queuedMs < HIL_BUFFER_TARGET_MS) {
        await runOneSlice();
      }
    } finally {
      toppingUpRef.current = false;
    }
  };

  const startPipeline = async () => {
    const link = linkRef.current;
    if (!link.connected || !link.socket) return;
    link.resetQueue();
    try {
      // Fill the lookahead buffer before sending anything
      await topUpQueue();
      if (link.dispatch(HIL_BATCH_TARGET_MS)) {
        // Keep refilling in the background so the buffer stays topped up
        // once the device starts reporting back slice results
        topUpQueue().catch(err => console.error("[HIL] Queue top-up failed:", err));
      }
    } catch (err) {
      console.error("[HIL] Pipeline start failed:", err);
    }
  };

  /** A slice finished on the board: take its readings and send it the next. */
  const onSliceResult = (node: Node, values: Record<string, number> | null) => {
    const link = linkRef.current;
    if (values) {
      const board = nodesRef.current.find(isBoard) || node;
      const pins = (board.data.pins as Record<string, string>) || {};
      for (const pinId of HELTEC_V4_GPIO_PINS) {
        const raw = values[String(parseInt(pinId.replace('GPIO_', '')))];
        if (raw === undefined) continue;
        let volt = raw;
        if (pins[pinId] === 'analog_in') {
          volt = calibrateReading(pinId, raw / 4095 * 3.3, selectedPresetRef.current);
          // Low-pass filter analog readings before they drive the sim: the VCO's
          // operating point sits close to the transistor's turn-on threshold (needed
          // to get the requested frequency range), which amplifies ordinary ADC/light
          // sensor noise into visible oscillation-frequency jitter. Smoothing the input
          // damps that out while still tracking real light-level changes.
          const prevSmoothed = smoothedValuesRef.current[pinId];
          const alpha = 0.15;
          volt = prevSmoothed === undefined ? volt : alpha * volt + (1 - alpha) * prevSmoothed;
          smoothedValuesRef.current[pinId] = volt;
        }
        valuesRef.current[pinId] = volt;
      }
      showPinVoltages();
    }

    link.waitingForCommand = !link.dispatch(HIL_BATCH_TARGET_MS);

    // Keep the lookahead buffer topped up in the background so a slow
    // SPICE call (e.g. a slice that lands on a switching edge) doesn't
    // starve the device of its next command.
    topUpQueue().catch(err => console.error("[HIL] Queue top-up failed:", err));
    flushDisplay();
  };

  /** A line of REPL output: a background poll's readings, or chatter. */
  const onReplLine = (node: Node, line: string) => {
    if (!line.startsWith(POLL_TAG)) return;
    const dataStr = line.replace(POLL_TAG, '').trim();
    if (dataStr !== 'ok') {
      const board = nodesRef.current.find(isBoard) || node;
      const pins = (board.data.pins as Record<string, string>) || {};
      const inputPins = polledPins(pins, connectedHeltecPins(board.id, edgesRef.current));
      dataStr.split(',').forEach((valStr, idx) => {
        const pinId = inputPins[idx];
        if (pinId) valuesRef.current[pinId] = calibrateReading(pinId, parseFloat(valStr) || 0.0, selectedPresetRef.current);
      });
      showPinVoltages();
    }
    setTimeout(runBackgroundPoll, 250);
  };

  /** Returns false if no connection could even be attempted (e.g. blocked as mixed content). */
  const ensureConnection = (ip: string, node: Node): boolean => {
    const link = linkRef.current;
    if (link.busy) return true;

    const url = boardUrl(ip, typeof window !== 'undefined' && window.location.protocol === 'https:');
    if (!url) {
      console.warn(`[HIL] Refusing to open ws://${ip} from an https page — the browser blocks mixed content. Serve the app over http (or tunnel the board over wss://) to use HIL.`);
      setNodes(nds => nds.map(n => n.id === node.id
        ? { ...n, data: { ...n.data, isConnected: false, hilEnabled: false, hilError: 'Blocked: ws:// cannot be opened from an https page.' } }
        : n));
      return false;
    }

    console.log(`[HIL] Connecting to CYD board at ${url}`);
    // Mark the node as HIL-enabled so the background effect doesn't tear this socket
    // down when the connection was initiated by starting a run rather than by the button.
    setNodes(nds => nds.map(n => n.id === node.id ? { ...n, data: { ...n.data, isConnected: false, hilEnabled: true, hilError: undefined } } : n));

    try {
      link.open(url, {
        onOpen: () => {
          setNodes(nds => nds.map(n => n.id === node.id ? { ...n, data: { ...n.data, isConnected: true } } : n));
          const pins = (node.data.pins as Record<string, string>) || {};
          link.sendRepl(bootstrapCode(pins, connectedHeltecPins(node.id, edgesRef.current), runningRef.current));
          if (runningRef.current) {
            startPipeline();
          } else {
            setTimeout(runBackgroundPoll, 100);
          }
        },
        onSliceResult: values => onSliceResult(node, values),
        onReplLine: line => onReplLine(node, line),
        onClose: () => {
          setNodes(nds => nds.map(n => isBoard(n) ? { ...n, data: { ...n.data, isConnected: false } } : n));
        },
      });
    } catch (err) {
      console.error("[HIL] Failed to open WebSocket:", err);
      return false;
    }
    return true;
  };

  // Background connection to the board on the canvas. Opt-in only: the board
  // is reached over plain ws://, which the browser blocks as mixed content when
  // the app is served over https (and a blocked/failing connection attempt can
  // take WebSerial down with it). Nothing dials out until the user clicks
  // Connect on the node or starts a HIL run.
  const boardNode = nodes.find(isBoard);
  const boardId = boardNode?.id;
  const boardIp = boardNode?.data?.ip;
  const boardEnabled = !!boardNode?.data?.hilEnabled;

  /*
   * The board's session, not React's state.
   *
   * `ensureConnection` is one of a set of mutually recursive closures — it
   * opens the socket, which starts the pipeline, which polls, which reconnects —
   * and it is a fresh function on every render. Listing it as a dependency
   * would hang up on the board and dial it again on every keystroke, which is
   * the opposite of what this effect is for.
   *
   * The `setNodes` in the other branch is the socket telling React it has gone.
   * That is precisely what an effect is meant to do with an external system; it
   * simply happens synchronously, because closing a socket does.
   */
  useEffect(() => {
    const link = linkRef.current;
    if (boardId && boardIp && boardEnabled) {
      if (!link.connected && (!link.socket || link.socket.readyState === WebSocket.CLOSED)) {
        const node = nodes.find(n => n.id === boardId);
        if (node) {
          ensureConnection(boardIp as string, node);
        }
      }
    } else if (!boardEnabled && link.socket) {
      // User turned HIL off (or the node lost its enable flag): tear the socket down.
      runningRef.current = false;
      link.close();
      if (boardId) {
        setNodes(nds => nds.map(n => n.id === boardId ? { ...n, data: { ...n.data, isConnected: false } } : n));
      }
    }
    return () => {
      // Clean up connection if no Heltec V4 node is present on the canvas
      if (!nodes.some(isBoard)) {
        runningRef.current = false;
        link.close();
      }
    };
    // A stable `ensureConnection` means restructuring the driver; see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, boardIp, boardEnabled, nodes]);

  /**
   * Starts a run against `board`. False when the board can't be reached at
   * all, with the reason already shown.
   */
  const start = (board: Node): boolean => {
    const link = linkRef.current;
    runningRef.current = true;
    link.executionMode = (board.data.hilExecutionMode as ExecutionMode) || 'native';
    bgPollActiveRef.current = true;
    simulatedMsRef.current = 0;
    historyRef.current = {};
    smoothedValuesRef.current = {};
    sliceStateRef.current = initialSliceState();
    link.resetRepl();
    link.resetQueue();
    setInitialConditions({});

    const ip = (board.data.ip as string) || '192.168.1.244';
    if (link.connected && link.socket) {
      if (link.isOpen) {
        const pins = (board.data.pins as Record<string, string>) || {};
        link.sendRepl(bootstrapCode(pins, connectedHeltecPins(board.id, edgesRef.current), true, 'starting (existing ws)...'));
      }
      setTimeout(() => {
        if (runningRef.current) startPipeline();
      }, 150);
      return true;
    }
    if (!ensureConnection(ip, board)) {
      // Couldn't even attempt the socket (e.g. ws:// blocked on an https page) —
      // unwind the run instead of leaving it stuck.
      runningRef.current = false;
      bgPollActiveRef.current = false;
      alert(`Can't reach the board at ${ip}: the browser blocks plain ws:// connections from an https page. Run the app over http (or expose the board over wss://) to use hardware-in-the-loop.`);
      return false;
    }
    return true;
  };

  /** Ends a run and puts the board back to idle. Background polling stays off. */
  const stop = () => {
    const link = linkRef.current;
    runningRef.current = false;
    bgPollActiveRef.current = false;
    memoizerRef.current.clear();
    if (link.socket && link.connected) {
      try {
        if (nodesRef.current.some(isBoard)) link.sendRepl(STOP_CODE);
      } catch (e) {
        console.error("[HIL] Failed to send stop state:", e);
      }
    }
    historyRef.current = {};
    smoothedValuesRef.current = {};
    simulatedMsRef.current = 0;
    link.resetQueue();
    sliceStateRef.current = initialSliceState();
  };

  return { runningRef, start, stop };
}
