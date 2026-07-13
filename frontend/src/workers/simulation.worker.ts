/// <reference lib="webworker" />
import { Simulation } from 'eecircuit-engine';

let engine: Simulation | null = null;

self.onmessage = async (evt: MessageEvent) => {
  const { type, id, netlist } = evt.data;
  
  if (type === 'INIT') {
    try {
      if (!engine) {
        engine = new Simulation();
        await engine.start();
      }
    } catch (err: any) {
      console.error("[SimulationWorker] error preloading simulation engine:", err);
    }
  } else if (type === 'RUN') {
    try {
      if (!engine) {
        engine = new Simulation();
        await engine.start();
      }
      engine.setNetList(netlist);
      const result = await engine.runSim();
      self.postMessage({ type: 'RESULT', id, result, ok: true });
    } catch (err: any) {
      console.error("[SimulationWorker] error running simulation:", err);
      self.postMessage({ type: 'RESULT', id, ok: false, error: err.message || String(err) });
    }
  }
};
