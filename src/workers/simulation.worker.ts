/// <reference lib="webworker" />
import { Simulation } from 'eecircuit-engine';

let engine: Simulation | null = null;

/**
 * What the page sends in. Written down here rather than read off `evt.data`
 * as-is, because a worker's message is a call with no compiler checking across
 * it: the page that posts and this file agree on the field names by hand, and a
 * RUN that arrived with no netlist would re-run the previous one in silence.
 */
type SimRequest =
  | { type: 'INIT' }
  | { type: 'RUN'; id: number | string; netlist: string };

self.onmessage = async (evt: MessageEvent<SimRequest>) => {
  const req = evt.data;

  if (req.type === 'INIT') {
    try {
      if (!engine) {
        engine = new Simulation();
        await engine.start();
      }
    } catch (err) {
      console.error("[SimulationWorker] error preloading simulation engine:", err);
    }
  } else if (req.type === 'RUN') {
    const { id, netlist } = req;
    try {
      if (!engine) {
        engine = new Simulation();
        await engine.start();
      }
      engine.setNetList(netlist);
      const result = await engine.runSim();
      self.postMessage({ type: 'RESULT', id, result, ok: true });
    } catch (err) {
      console.error("[SimulationWorker] error running simulation:", err);
      // Read off the value rather than narrowed to `Error`: the SPICE WASM
      // module rejects with bare objects carrying a message as well as with
      // real Errors, and both used to reach the page as the message.
      const message = (err as { message?: string })?.message;
      self.postMessage({ type: 'RESULT', id, ok: false, error: message || String(err) });
    }
  }
};
