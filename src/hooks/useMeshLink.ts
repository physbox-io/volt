import { useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { Node, Edge } from '@xyflow/react';
import { MeshLink, jointChannels, type CoSimChannel, type LinkStatus } from '../utils/coSimLink';
import { coSimBindings, coSimStep, initialCoSimState, type CoSimState } from '../sim/coSimStep';
import { TraceHistory } from '../sim/traceHistory';
import { explainSpiceFailure, messagesFromError } from '../utils/simDiagnostics';
import type { SpiceResult } from '../types/simulation';
import type { Advisory } from '../types/advisories';

/** Lock-step slice: short beside a motor's mechanical time constant, long beside a postMessage. */
const SLICE_MS = 5;
/** How often the canvas is redrawn during a linked run, in simulated ms. */
const DRAW_EVERY_MS = 50;
/** No slice of a linked run may take longer than this to solve. */
const SLICE_TIMEOUT_MS = 2_000;

type UseMeshLinkArgs = {
  nodesRef: RefObject<Node[]>;
  edgesRef: RefObject<Edge[]>;
  setNodes: Dispatch<SetStateAction<Node[]>>;
  setRunAdvisories: Dispatch<SetStateAction<Advisory[]>>;
  solve: (netlist: string, timeoutMs: number) => Promise<SpiceResult>;
  /** Called when a linked run ends on its own: Mesh went away, or a slice failed. */
  onRunEnded: () => void;
};

const advise = (setRunAdvisories: Dispatch<SetStateAction<Advisory[]>>, advisory: Advisory | null) =>
  setRunAdvisories(prev => [...prev.filter(a => !a.id.startsWith('mesh:')), ...(advisory ? [advisory] : [])]);

/** What a linked run shows on the parts bound to the scene. */
function readouts(nodes: Node[], state: CoSimState): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  for (const n of nodes) {
    const joint = typeof n.data.shaftJoint === 'string' ? n.data.shaftJoint : '';
    if ((n.type === 'dcmotor' || n.type === 'stepper') && joint) {
      const c = jointChannels(joint);
      const w = state.outputs[c.vel];
      const x = state.outputs[c.pos];
      if (w !== undefined) out.set(n.id, { rpm: (w * 60) / (2 * Math.PI), angleDeg: x === undefined ? undefined : ((((x * 180) / Math.PI) % 360) + 360) % 360 });
    }
    if (n.type === 'meshsignal' && typeof n.data.channel === 'string') {
      out.set(n.id, { signalValue: state.outputs[n.data.channel] ?? 0, latchedHigh: state.latches[n.id] === true });
    }
  }
  return out;
}

/**
 * The link to a Mesh scene, and the run that drives it.
 *
 * `open` (from a click) opens Mesh and handshakes; the catalogue it answers
 * with is what the inspector offers to bind. `start` runs the circuit in
 * 5ms lock-step slices against the scene until `stop`, paced to no faster
 * than real time, drawing the canvas every 50ms of it.
 */
export function useMeshLink({ nodesRef, edgesRef, setNodes, setRunAdvisories, solve, onRunEnded }: UseMeshLinkArgs) {
  const [link] = useState(() => new MeshLink());
  const [status, setStatus] = useState<LinkStatus>('closed');
  const [channels, setChannels] = useState<CoSimChannel[]>([]);
  const [scene, setScene] = useState('');
  const runningRef = useRef(false);
  const onRunEndedRef = useRef(onRunEnded);
  useEffect(() => { onRunEndedRef.current = onRunEnded; }, [onRunEnded]);

  useEffect(() => link.subscribe(() => {
    setStatus(link.status);
    setChannels([...link.channels]);
    setScene(link.scene);
    if (link.status === 'closed' && runningRef.current) {
      runningRef.current = false;
      advise(setRunAdvisories, { id: 'mesh:closed', severity: 'warning', title: 'Mesh unlinked', detail: 'The Mesh window closed or unlinked, so the run stopped.' });
      onRunEndedRef.current();
    }
  }), [link, setRunAdvisories]);
  useEffect(() => () => link.close(), [link]);

  const open = (): boolean => link.open();
  const close = () => link.close();

  /** Whether a run would drive Mesh: linked, and something bound to the scene. */
  const wouldDrive = (nodes: Node[]) => {
    const b = coSimBindings(nodes);
    return link.status === 'linked' && (b.shafts.length > 0 || b.signals.length > 0);
  };

  const loop = async () => {
    let state = initialCoSimState();
    const history = new TraceHistory();
    const wallStart = performance.now();
    let simMs = 0;
    let sinceDraw = 0;
    let warnedUnknown = false;
    advise(setRunAdvisories, null);

    while (runningRef.current) {
      try {
        const out = await coSimStep(
          state,
          { nodes: nodesRef.current, edges: edgesRef.current, sliceMs: SLICE_MS },
          { solve: netlist => solve(netlist, SLICE_TIMEOUT_MS), endpoint: link },
        );
        state = out.state;
        simMs += SLICE_MS;
        sinceDraw += SLICE_MS;
        history.append(out.nodes, out.result, out.portToNet, SLICE_MS);
        if (out.unknown.length > 0 && !warnedUnknown) {
          warnedUnknown = true;
          advise(setRunAdvisories, {
            id: 'mesh:unknown',
            severity: 'warning',
            title: 'Bound to channels the scene does not have',
            detail: `Mesh has no ${out.unknown.join(', ')}. Pick them again in the inspector; they read 0 until then.`,
          });
        }
      } catch (e) {
        if (!runningRef.current) break;
        const explained = explainSpiceFailure(messagesFromError(e));
        advise(setRunAdvisories, { id: 'mesh:failed', severity: 'error', title: `Linked run stopped: ${explained.title}`, detail: explained.detail });
        runningRef.current = false;
        onRunEndedRef.current();
        break;
      }

      if (sinceDraw >= DRAW_EVERY_MS) {
        sinceDraw = 0;
        const shown = readouts(nodesRef.current, state);
        setNodes(nds => history.applyTo(nds).map(n => (shown.has(n.id) ? { ...n, data: { ...n.data, ...shown.get(n.id) } } : n)));
      }

      // Never ahead of real time: a motor that spins up in 0.1s should be seen to.
      const ahead = simMs - (performance.now() - wallStart);
      if (ahead > 1) await new Promise(r => setTimeout(r, ahead));
    }
  };

  /** Starts a linked run. False when there is nothing to drive. */
  const start = (nodes: Node[]): boolean => {
    if (runningRef.current || !wouldDrive(nodes)) return false;
    runningRef.current = true;
    void loop();
    return true;
  };

  const stop = () => {
    runningRef.current = false;
  };

  return { status, channels, scene, open, close, start, stop, runningRef, wouldDrive };
}
