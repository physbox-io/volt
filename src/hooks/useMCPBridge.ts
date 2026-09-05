/**
 * MCP bridge for Volt.
 */

import { useEffect, useRef } from 'react';
import { getStoredAuthToken } from '../utils/apiClient';
import { getNodesBounds, getViewportForBounds, type Node, type Edge } from '@xyflow/react';
import { toPng } from 'html-to-image';
import { presets as builtinPresets } from '../utils/presets';
import { loadUserPresets, addUserPreset, removeUserPreset, nameToKey, loadMachiningSettings } from '../utils/storage';
import { generatePcbLayout, type PcbOptions } from '../utils/pcbExporter';

interface BridgeProps {
  nodes: Node[];
  edges: Edge[];
  isSimulating: boolean;
  selectedPreset: string;
  probeMode: boolean;
  runSimulation: (nodesOverride?: Node[]) => Promise<any>;
  stopSimulation: () => void;
  resetSimulation: () => void;
  setProbeMode: (v: boolean) => void;
  setNodes: (nodes: Node[] | ((prev: Node[]) => Node[])) => void;
  setEdges: (edges: Edge[] | ((prev: Edge[]) => Edge[])) => void;
  loadPreset?: (name: string) => void;
  onTransactionStart?: () => void;
  onTransactionEnd?: () => void;
}

/**
 * Margin left around the circuit in a screenshot.
 *
 * As a `px` string, not the bare number: React Flow reads a bare number as a
 * FRACTION of the frame, so a plain 48 asks for 4800% padding and fits the whole
 * circuit into a speck in the middle of the image.
 */
const PAD = 48;
const PAD_CSS = `${PAD}px` as const;

/**
 * A circuit written over by the bridge is not the preset that is still selected,
 * so the preset's note card is now describing something that is no longer on the
 * canvas. Drop it — the same thing Mesh does when BUILD_SCENE replaces a scene.
 * A card the agent wrote itself is left alone; only preset cards are stale.
 */
function clearStalePresetCard() {
  const getter = window._circuit_getNoteCards;
  const setter = window._circuit_setNoteCards;
  if (!getter || !setter) return;
  const cards = getter();
  const kept = cards.filter(c => !c.id.startsWith('preset_note_'));
  if (kept.length !== cards.length) setter(kept);
}

/**
 * Paint properties that a wire gets from the stylesheet rather than from its
 * own attributes, stamped onto the element for the duration of a capture.
 *
 * html-to-image inlines the computed style of every HTML element it clones,
 * but an SVG subtree is deep-cloned as-is: its children arrive carrying only
 * their class names, and the stylesheet they were painted by is not part of the
 * cloned document. Wire strokes come from `.react-flow .react-flow__edge-path`
 * in index.css — a rule that needs an ancestor two levels above the captured
 * viewport — so every wire in a screenshot came out with SVG's default `stroke:
 * none`: a picture of the components with no connections between them.
 *
 * Writing the value the element already computes to changes nothing on screen;
 * it just survives the clone. Restored in a `finally` either way.
 */
const CAPTURED_SVG_PAINT = [
  'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap',
  'stroke-linejoin', 'opacity', 'color',
] as const;

function inlineSvgPaint(root: HTMLElement): () => void {
  const touched: { el: SVGElement; prev: string | null }[] = [];
  root.querySelectorAll<SVGElement>('svg *').forEach(el => {
    if (!(el instanceof SVGElement)) return;
    const computed = getComputedStyle(el);
    const prev = el.getAttribute('style');
    let extra = '';
    for (const prop of CAPTURED_SVG_PAINT) {
      const value = computed.getPropertyValue(prop);
      if (value) extra += `${prop}:${value};`;
    }
    if (!extra) return;
    touched.push({ el, prev });
    // Its own inline style stays last, so anything set there still wins.
    el.setAttribute('style', `${extra}${prev ?? ''}`);
  });
  return () => {
    for (const { el, prev } of touched) {
      if (prev === null) el.removeAttribute('style');
      else el.setAttribute('style', prev);
    }
  };
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
        /*
         * The handshake also offers this tab's session, as a fallback
         * credential for the MCP server's cloud tools — the ones that read the
         * run archive over HTTPS rather than driving this tab. It means an
         * agent can answer a question about last month's job with no setup at
         * all, as long as the app is open.
         *
         * The server treats it as a last resort behind PHYSBOX_API_TOKEN and its
         * config file, because this socket has no origin check. It is localhost
         * only, and the server binds loopback.
         */
        ws!.send(JSON.stringify({
          event: 'HELLO',
          app: 'circuit',
          port: location.port,
          token: getStoredAuthToken() ?? undefined,
        }));

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
              runSimulation, stopSimulation, resetSimulation, setProbeMode, setNodes, setEdges,
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

        case 'RESET':
          resetSimulation();
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
          clearStalePresetCard();
          return { ok: true };

        /*
          One component, changed in place.

          The only way to alter a resistor used to be to send every node back
          through SET_NODES, which means reading the whole canvas, editing one
          field and writing it all back — and anything that changed in between
          (a simulation result, a component the user moved) is quietly
          overwritten by the stale copy. This touches the one node.

          `data` is merged rather than replaced: a component's data carries the
          simulation's output alongside its settings, and a caller sending
          `{ label: '10k' }` means to change the label, not to erase the
          waveform sitting next to it.
        */
        case 'UPDATE_COMPONENT': {
          // nodeId first: 'id' is also the request envelope's own key, and a
          // payload that carried one used to overwrite it.
          const id = msg.nodeId || msg.id;
          if (typeof id !== 'string' || !id) return { ok: false, error: 'id is required' };
          const updates = msg.updates;
          if (!updates || typeof updates !== 'object') {
            return { ok: false, error: 'updates must be an object of component fields' };
          }
          const existing = nodes.find(n => n.id === id);
          if (!existing) return { ok: false, error: `No component with id '${id}'` };
          if ('id' in updates) return { ok: false, error: "A component's id cannot be changed" };
          if ('type' in updates && updates.type !== existing.type) {
            return { ok: false, error: "A component's type cannot be changed in place — delete it and add the replacement, so its terminals and data match the new part" };
          }

          const { data: dataUpdates, ...nodeUpdates } = updates as Record<string, unknown>;
          setNodes(nds => nds.map(n =>
            n.id === id
              ? {
                  ...n,
                  ...nodeUpdates,
                  data: dataUpdates && typeof dataUpdates === 'object'
                    ? { ...n.data, ...(dataUpdates as Record<string, unknown>) }
                    : n.data,
                }
              : n
          ));
          return { ok: true, id };
        }

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
            // The board is milled with the trace width and clearance it was
            // routed for, so the CAM settings travel with the circuit — the
            // same as the in-app save. Leaving them off here meant an agent
            // re-saving a board silently dropped how it was set up to cut.
            pcbOptions: loadMachiningSettings(),
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
          clearStalePresetCard();
          if (msg.runSim !== false) {
            const simRes = await runSimulation(msg.nodes);
            return { ok: true, simResult: simRes || { ok: true } };
          }
          return { ok: true };
        }

        case 'GET_NOTE_CARDS': {
          const getter = window._circuit_getNoteCards;
          return { ok: true, noteCards: getter ? getter() : [] };
        }

        case 'SET_NOTE_CARDS': {
          const setter = window._circuit_setNoteCards;
          if (!setter) return { ok: false, error: 'Note card state not available' };
          if (!Array.isArray(msg.noteCards)) return { ok: false, error: 'noteCards must be an array' };
          setter(msg.noteCards);
          return { ok: true };
        }

        /*
          A picture of the schematic.

          This used to make a canvas, fill it with the theme's background colour
          and return that — an agent asking to see the circuit got a blank sheet
          and no indication anything was missing, which is worse than no
          screenshot at all. The nodes are ordinary DOM, so photographing them
          means rasterising that DOM; html-to-image inlines the styles and
          serialises it through an SVG foreignObject.

          The frame is the CIRCUIT, not the viewport: what is panned into view is
          how a person happens to be looking at the canvas, and a screenshot that
          changed with the scroll position would be no use for checking a layout.
          Every component, every time, fitted to the image.
        */
        case 'SCREENSHOT': {
          const viewportEl = document.querySelector('.react-flow__viewport') as HTMLElement | null;
          if (!viewportEl) return { ok: false, error: 'React Flow canvas is not mounted' };
          if (nodes.length === 0) return { ok: false, error: 'The canvas is empty — there is nothing to photograph' };

          try {
            const dark = document.documentElement.classList.contains('dark');
            const bounds = getNodesBounds(nodes);
            // A hard cap keeps a sprawling board from producing a data URL too
            // large to travel back through the bridge.
            const width = Math.round(Math.min(2400, Math.max(320, bounds.width + PAD * 2)));
            const height = Math.round(Math.min(1800, Math.max(240, bounds.height + PAD * 2)));
            const { x, y, zoom } = getViewportForBounds(bounds, width, height, 0.2, 2, PAD_CSS);

            const restorePaint = inlineSvgPaint(viewportEl);
            let dataUrl: string;
            try {
              dataUrl = await toPng(viewportEl, {
                backgroundColor: dark ? '#0f172a' : '#f8fafc',
                width,
                height,
                // The live element keeps its own pan/zoom transform. Overriding it
                // for the capture is what fits the circuit to the frame; the
                // element on screen is untouched.
                style: {
                  width: `${width}px`,
                  height: `${height}px`,
                  transform: `translate(${x}px, ${y}px) scale(${zoom})`,
                },
              });
            } finally {
              restorePaint();
            }
            return { ok: true, dataUrl, width, height };
          } catch (e) {
            return { ok: false, error: String(e) };
          }
        }

        /**
         * The board as the CAM engine sees it, without going through the
         * export dialog. This exists because the only way to answer "why will
         * this net not route" or "which pad is pin 1 actually on" used to be
         * to import the layout code into a script and run it by hand - the
         * board was the one part of Volt an agent could not look at.
         *
         * Geometry is opt-in: pads and traces are the bulky fields and most
         * questions are answered by the placement, the nets and the unrouted
         * list alone.
         */
        case 'GET_PCB_LAYOUT': {
          if (nodes.length === 0) return { ok: false, error: 'The canvas is empty — there is no board to lay out' };
          const overrides = (msg.options ?? {}) as Partial<PcbOptions>;
          const result = generatePcbLayout(nodes, edges, { ...loadMachiningSettings(), ...overrides });
          if (result.error) return { ok: false, error: result.error };

          const wanted = String(msg.component || '').trim();
          const padsOf = (id: string) => result.pads.filter(p => p.componentId === id);

          const out: Record<string, unknown> = {
            ok: true,
            board: {
              widthMm: result.boardWidthMm,
              heightMm: result.boardHeightMm,
              originMm: result.boardOriginMm,
            },
            // The number to read first: 1 means every connection made it.
            completion: result.completion,
            counts: {
              components: result.components.length,
              nets: result.nets.length,
              pads: result.pads.length,
              drills: result.drills.length,
              traces: result.traces.length,
            },
            components: result.components.map(c => ({
              id: c.id,
              name: c.name,
              type: c.type,
              x: c.x,
              y: c.y,
              rotationDeg: c.rotationDeg,
              widthMm: c.widthMm,
              heightMm: c.heightMm,
              packageId: c.footprint.packageId,
              padCount: c.footprint.pads.length,
            })),
            nets: result.nets.map(n => ({
              id: n.id,
              name: n.name,
              isGround: n.isGround,
              ports: n.ports.map(port => port.key),
              traceCount: result.traces.filter(t => t.netId === n.id).length,
            })),
            // Every reason a board is not finished, in the order you want them:
            // what failed to route, what breaks a rule, what was adjusted.
            unrouted: result.unrouted,
            violations: result.violations,
            warnings: result.warnings,
            cycleTimeSec: result.cycleTimeSec,
          };

          if (msg.includePads) {
            out.pads = (wanted ? padsOf(wanted) : result.pads).map(p => ({
              componentId: p.componentId,
              handleId: p.handleId,
              pinNumber: p.pinNumber,
              netId: p.netId,
              x: p.x,
              y: p.y,
            }));
          }
          if (msg.includeTraces) {
            out.traces = result.traces.map(t => ({ netId: t.netId, width: t.width, points: t.points }));
          }
          return out;
        }

        /**
         * A picture of the board, rendered from whichever face was asked for.
         * A single-sided board is milled copper-up and assembled from the other
         * face, so the two views are mirror images and the wrong one will
         * happily look correct.
         */
        case 'GET_PCB_PREVIEW': {
          if (nodes.length === 0) return { ok: false, error: 'The canvas is empty — there is no board to photograph' };
          const view = msg.view === 'component' ? 'component' : 'copper';
          const overrides = (msg.options ?? {}) as Partial<PcbOptions>;
          const result = generatePcbLayout(nodes, edges, { ...loadMachiningSettings(), ...overrides });
          if (result.error) return { ok: false, error: result.error };

          let svg = view === 'component' ? result.svgComponentSide : result.svg;
          if (msg.padNumbers === false) svg = svg.replace(/<g class="pcb-pad-numbers"[\s\S]*?<\/g>\n/, '');

          // The SVG sizes itself to its container, so it has to be given
          // explicit pixels before a canvas will rasterise it at all.
          const pxPerMm = Math.max(2, Math.min(30, Number(msg.pxPerMm) || 12));
          const vw = result.boardWidthMm + result.boardOriginMm * 2;
          const vh = result.boardHeightMm + result.boardOriginMm * 2;
          const width = Math.round(Math.min(2000, vw * pxPerMm));
          const height = Math.round(Math.min(2000, vh * pxPerMm));
          const sized = svg.replace('width="100%" height="100%"', `width="${width}" height="${height}"`);

          try {
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const img = new Image();
              img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                if (!ctx) return reject(new Error('2D canvas is unavailable'));
                ctx.fillStyle = '#0b0f14';
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/png'));
              };
              img.onerror = () => reject(new Error('The board SVG could not be rasterised'));
              img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(sized)))}`;
            });
            return { ok: true, dataUrl, width, height, view, completion: result.completion };
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
