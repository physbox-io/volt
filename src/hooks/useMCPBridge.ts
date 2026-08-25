/**
 * MCP bridge for Volt.
 */

import { useEffect, useRef } from 'react';
import type { Node, Edge } from '@xyflow/react';
import { presets as builtinPresets } from '../utils/presets';
import { loadUserPresets, addUserPreset, removeUserPreset, nameToKey } from '../utils/storage';

interface BridgeProps {
  nodes: Node[];
  edges: Edge[];
  isSimulating: boolean;
  selectedPreset: string;
  probeMode: boolean;
  runSimulation: (nodesOverride?: Node[]) => Promise<any>;
  stopSimulation: () => void;
  setProbeMode: (v: boolean) => void;
  setNodes: (nodes: Node[] | ((prev: Node[]) => Node[])) => void;
  setEdges: (edges: Edge[] | ((prev: Edge[]) => Edge[])) => void;
  loadPreset?: (name: string) => void;
  onTransactionStart?: () => void;
  onTransactionEnd?: () => void;
}

function getSpeakerAudio(
  voltageData: { t: number; v: number }[],
  sampleRate: number,
  acCouple: boolean,
  normalize: boolean,
  voltageScale: number
): number[] {
  if (!voltageData || voltageData.length === 0) return [];
  const durationSec = voltageData[voltageData.length - 1].t / 1000;
  const frameCount = Math.max(1, Math.floor(sampleRate * durationSec));
  const rawSamples = new Float32Array(frameCount);

  let dataIdx = 0;
  for (let i = 0; i < frameCount; i++) {
    const t_ms = (i / sampleRate) * 1000;
    while (dataIdx < voltageData.length - 2 && voltageData[dataIdx + 1].t < t_ms) {
      dataIdx++;
    }
    const p0 = voltageData[Math.max(0, dataIdx - 1)];
    const p1 = voltageData[dataIdx];
    const p2 = voltageData[Math.min(voltageData.length - 1, dataIdx + 1)];
    const p3 = voltageData[Math.min(voltageData.length - 1, dataIdx + 2)];

    let v = p1.v;
    if (p2.t > p1.t) {
      const t = Math.max(0, Math.min(1, (t_ms - p1.t) / (p2.t - p1.t)));
      const t2 = t * t;
      const t3 = t2 * t;
      const m1 = (p2.v - p0.v) / (p2.t - p0.t || 1);
      const m2 = (p3.v - p1.v) / (p3.t - p1.t || 1);
      const dt = p2.t - p1.t;
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;
      v = h00 * p1.v + h10 * dt * m1 + h01 * p2.v + h11 * dt * m2;
    }
    rawSamples[i] = v;
  }

  let dcOffset = 0;
  if (acCouple) {
    let sum = 0;
    for (let i = 0; i < frameCount; i++) sum += rawSamples[i];
    dcOffset = sum / frameCount;
  }

  let scale = 1.0 / (voltageScale || 5.0);
  if (normalize) {
    let peak = 0;
    for (let i = 0; i < frameCount; i++) {
      const ac = Math.abs(rawSamples[i] - dcOffset);
      if (ac > peak) peak = ac;
    }
    scale = peak > 0.001 ? 0.8 / peak : scale;
  }

  const values: number[] = [];
  for (let i = 0; i < frameCount; i++) {
    const v = (rawSamples[i] - dcOffset) * scale;
    values.push(Math.max(-1, Math.min(1, v)));
  }
  return values;
}

export function useMCPBridge(props: BridgeProps) {
  const p = useRef(props);
  useEffect(() => { p.current = props; });

  useEffect(() => {
    let ws: WebSocket | null = null;
    let dead = false;
    let retryTimer: ReturnType<typeof setTimeout>;

    const connect = () => {
      if (dead) return;
      const params = new URLSearchParams(location.search);
      const wsPort = params.get('mcpPort') || '3142';
      ws = new WebSocket(`ws://localhost:${wsPort}`);

      ws.onopen = () =>
        ws!.send(JSON.stringify({ event: 'HELLO', app: 'circuit', port: location.port }));

      ws.onmessage = (evt) => {
        let msg: any;
        try { msg = JSON.parse(evt.data); } catch { return; }
        const { cmd, id } = msg;
        if (!cmd) return;

        p.current.onTransactionStart?.();

        let result: unknown;
        try { result = handle(cmd, msg); } catch (e) {
          ws?.send(JSON.stringify({ event: 'ERROR', cmd, id, error: String(e) }));
          p.current.onTransactionEnd?.();
          return;
        }
        Promise.resolve(result)
          .then(data => ws?.send(JSON.stringify({ event: 'RESULT', cmd, id, data })))
          .catch(e  => ws?.send(JSON.stringify({ event: 'ERROR', cmd, id, error: String(e) })))
          .finally(() => {
            p.current.onTransactionEnd?.();
          });
      };

      ws.onclose = () => { if (!dead) retryTimer = setTimeout(connect, 2000); };
      ws.onerror = () => ws?.close();
    };

    const handle = async (cmd: string, msg: any): Promise<unknown> => {
      const { nodes, edges, isSimulating, selectedPreset, probeMode,
              runSimulation, stopSimulation, setProbeMode, setNodes, setEdges,
              loadPreset } = p.current;

      switch (cmd) {
        case 'GET_STATE':
          return { nodes, edges, isSimulating, selectedPreset, probeMode };

        case 'GET_COMPONENTS':
          return nodes.map(n => ({
            id: n.id, type: n.type, position: n.position,
            data: { ...n.data, onPositionChange: undefined, onResize: undefined },
          }));

        case 'GET_EDGES':
          return edges;

        case 'RUN_SIM': {
          const simRes = await runSimulation();
          return simRes || { ok: true };
        }

        case 'STOP_SIM':
          stopSimulation();
          return { ok: true };

        case 'GET_WAVEFORMS':
        case 'GET_HISTORY': {
          const nodeWaveforms = nodes.map(n => ({
            id: n.id,
            type: n.type,
            label: n.data?.label,
            voltage: n.data?.voltage,
            voltageData: n.data?.voltageData || n.data?.voltageData1 || n.data?.voltageData2,
            current_array: n.data?.current_array,
            time_points: n.data?.time_points || n.data?.timePoints,
            segmentVoltages: n.data?.segmentVoltages,
            segmentVoltageArrays: n.data?.segmentVoltageArrays,
            logs: n.data?.logs
          }));
          const edgeWaveforms = edges.map(e => ({
            id: e.id,
            source: e.source,
            target: e.target,
            current_array: e.data?.current_array,
            time_points: e.data?.time_points
          }));
          return {
            nodes: nodeWaveforms,
            edges: edgeWaveforms
          };
        }

        case 'TOGGLE_PROBE':
          setProbeMode(!probeMode);
          return { ok: true, probeMode: !probeMode };

        case 'SET_NODES':
          if (!Array.isArray(msg.nodes)) return { ok: false, error: 'nodes must be array' };
          setNodes(msg.nodes);
          return { ok: true };

        case 'SET_EDGES':
          if (!Array.isArray(msg.edges)) return { ok: false, error: 'edges must be array' };
          setEdges(msg.edges);
          return { ok: true };

        case 'UPLOAD_AUDIO': {
          const { nodeId, values, pwlData, sampleRate } = msg;
          if (!nodeId) return { ok: false, error: 'nodeId is required' };
          let finalPwl = pwlData;
          if (values && Array.isArray(values)) {
            const sr = sampleRate || 8000;
            finalPwl = values.map((v: number, i: number) => ({ t: i / sr, v }));
          }
          if (!finalPwl || !Array.isArray(finalPwl)) {
            return { ok: false, error: 'Either values or pwlData array must be provided' };
          }
          setNodes((nds) => nds.map(n =>
            n.id === nodeId
              ? { ...n, data: { ...n.data, pwlData: finalPwl } }
              : n
          ));
          return { ok: true };
        }

        case 'GET_SPEAKER_AUDIO': {
          const { nodeId, sampleRate, acCouple, normalize, voltageScale } = msg;
          if (!nodeId) return { ok: false, error: 'nodeId is required' };
          const node = nodes.find(n => n.id === nodeId);
          if (!node) return { ok: false, error: `Node ${nodeId} not found` };
          if (node.type !== 'speaker') return { ok: false, error: `Node ${nodeId} is not a speaker` };

          const voltageData = (node.data?.voltageData as { t: number; v: number }[]) || [];
          const sr = sampleRate || 8000;
          const isAc = acCouple !== undefined ? !!acCouple : !!node.data?.acCouple;
          const isNorm = normalize !== undefined ? !!normalize : !!node.data?.normalize;
          const vs = voltageScale !== undefined ? Number(voltageScale) : Number(node.data?.voltageScale ?? 5.0);

          const values = getSpeakerAudio(voltageData, sr, isAc, isNorm, vs);
          return {
            nodeId,
            sampleRate: sr,
            duration: voltageData.length > 0 ? (voltageData[voltageData.length - 1].t / 1000) : 0,
            values,
            voltageData
          };
        }

        case 'VALIDATE_CIRCUIT': {
          const targetNodes = Array.isArray(msg.nodes) ? msg.nodes : nodes;
          const targetEdges = Array.isArray(msg.edges) ? msg.edges : edges;
          const errors: string[] = [];
          const warnings: string[] = [];

          const hasGround = targetNodes.some((n: any) => n.type === 'ground');
          if (!hasGround) {
            warnings.push('No Ground (GND) reference node found. SPICE simulations require at least one ground connection to prevent floating net errors.');
          }

          const nodeMap = new Map<string, any>(targetNodes.map((n: any) => [n.id, n]));

          targetEdges.forEach((e: any) => {
            if (!nodeMap.has(e.source)) {
              errors.push(`Edge ${e.id} references missing source node: ${e.source}`);
            }
            if (!nodeMap.has(e.target)) {
              errors.push(`Edge ${e.id} references missing target node: ${e.target}`);
            }
          });

          return {
            ok: errors.length === 0,
            hasGround,
            errors,
            warnings,
            connectedEdgeCount: targetEdges.length,
            nodeCount: targetNodes.length,
          };
        }

        case 'LIST_PRESETS': {
          const userPresets = loadUserPresets();
          const allKeys = Array.from(new Set([...Object.keys(builtinPresets), ...Object.keys(userPresets)]));
          return allKeys;
        }

        case 'SAVE_PRESET': {
          const name = String(msg.name || '').trim();
          if (!name) return { ok: false, error: 'Missing name parameter' };
          const key = msg.key || nameToKey(name);
          const presetObj = {
            name,
            nodes,
            edges,
            recommendedSimLength: msg.recommendedSimLength,
            noteCard: msg.noteCard,
          };
          addUserPreset(key, presetObj);
          return { ok: true, name, key };
        }

        case 'DELETE_PRESET': {
          const key = String(msg.key || '').trim();
          if (!key) return { ok: false, error: 'Missing key parameter' };
          removeUserPreset(key);
          return { ok: true, key };
        }

        case 'GET_SUMMARY': {
          const nodeSummaries = nodes.map(n => ({
            id: n.id,
            type: n.type,
            position: n.position,
            label: n.data?.label,
            value: n.data?.value,
          }));
          return {
            nodes: nodeSummaries,
            edges: edges.map(e => ({ id: e.id, source: e.source, target: e.target, label: e.label }))
          };
        }

        case 'SET_CIRCUIT': {
          if (!Array.isArray(msg.nodes) || !Array.isArray(msg.edges)) {
            return { ok: false, error: 'nodes and edges must both be arrays' };
          }
          setNodes(msg.nodes);
          setEdges(msg.edges);
          if (msg.runSim !== false) {
            const simRes = await runSimulation(msg.nodes);
            return { ok: true, simResult: simRes || { ok: true } };
          }
          return { ok: true };
        }

        case 'SCREENSHOT': {
          const flowEl = document.querySelector('.react-flow') as HTMLElement;
          if (!flowEl) return { ok: false, error: 'React Flow element container not found' };
          try {
            const width = flowEl.clientWidth || 800;
            const height = flowEl.clientHeight || 600;
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.fillStyle = document.documentElement.classList.contains('dark') ? '#0f172a' : '#f8fafc';
              ctx.fillRect(0, 0, width, height);
            }
            // Create data URL representation
            const dataUrl = canvas.toDataURL('image/png');
            return { ok: true, dataUrl, width, height };
          } catch (e) {
            return { ok: false, error: String(e) };
          }
        }

        case 'LOAD_PRESET': {
          const name = String(msg.preset || '');
          if (loadPreset) { loadPreset(name); return { ok: true, preset: name }; }
          return { ok: false, error: 'loadPreset not available' };
        }

        default:
          return { error: `Unknown command: ${cmd}` };
      }
    };

    connect();
    return () => {
      dead = true;
      clearTimeout(retryTimer);
      ws?.close();
    };
  }, []);
}
