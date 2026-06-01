/**
 * MCP bridge for Circuit Expert.
 */

import { useEffect, useRef } from 'react';
import type { Node, Edge } from '@xyflow/react';

interface BridgeProps {
  nodes: Node[];
  edges: Edge[];
  isSimulating: boolean;
  selectedPreset: string;
  probeMode: boolean;
  runSimulation: () => void;
  stopSimulation: () => void;
  setProbeMode: (v: boolean) => void;
  setNodes: (nodes: Node[] | ((prev: Node[]) => Node[])) => void;
  setEdges: (edges: Edge[] | ((prev: Edge[]) => Edge[])) => void;
  loadPreset?: (name: string) => void;
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
      ws = new WebSocket(`ws://${location.host}/mcp?role=browser`);

      ws.onopen = () =>
        ws!.send(JSON.stringify({ event: 'HELLO', app: 'circuit', port: location.port }));

      ws.onmessage = (evt) => {
        let msg: any;
        try { msg = JSON.parse(evt.data); } catch { return; }
        const { cmd, id } = msg;
        if (!cmd) return;

        let result: unknown;
        try { result = handle(cmd, msg); } catch (e) {
          ws?.send(JSON.stringify({ event: 'ERROR', cmd, id, error: String(e) }));
          return;
        }
        Promise.resolve(result)
          .then(data => ws?.send(JSON.stringify({ event: 'RESULT', cmd, id, data })))
          .catch(e  => ws?.send(JSON.stringify({ event: 'ERROR', cmd, id, error: String(e) })));
      };

      ws.onclose = () => { if (!dead) retryTimer = setTimeout(connect, 2000); };
      ws.onerror = () => ws?.close();
    };

    const handle = (cmd: string, msg: any): unknown => {
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
