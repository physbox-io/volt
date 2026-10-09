import type { Node } from '@xyflow/react';
import type { SpiceResult } from '../types/simulation';
import { findNetGraph } from './netlistResult';
import { shaftNodes } from './transducer';
import { fuseHeatNode, FUSE_DEFAULTS } from './netlist/parts/fuse';
import { numParam } from './netlist/params';

const lastOf = (values: number[] | undefined) => (values && values.length > 0 ? values[values.length - 1] : undefined);

/**
 * What a run says about an electromechanical part, for its symbol: a motor's
 * speed and shaft angle at the end, and whether a fuse went. Null for any
 * other part, or when the run has nothing on it.
 */
export function readElectromech(node: Node, result: SpiceResult): Record<string, unknown> | null {
  if (node.type === 'dcmotor' || node.type === 'stepper') {
    const { speed, position } = shaftNodes(node.id);
    const w = findNetGraph(result, speed);
    const omega = lastOf(w?.voltage_levels);
    if (!w || omega === undefined) return null;
    let angle: number | undefined;
    if (node.type === 'stepper') {
      angle = lastOf(findNetGraph(result, position)?.voltage_levels);
    } else {
      // A DC motor's coupling doesn't depend on angle, so it isn't simulated; sum the speed.
      angle = 0;
      const t = w.timestamps_ms;
      for (let i = 1; i < t.length; i++) angle += 0.5 * (w.voltage_levels[i] + w.voltage_levels[i - 1]) * (t[i] - t[i - 1]) / 1000;
    }
    const deg = angle === undefined ? undefined : ((((angle * 180) / Math.PI) % 360) + 360) % 360;
    return { rpm: (omega * 60) / (2 * Math.PI), angleDeg: deg };
  }
  if (node.type === 'fuse') {
    const heat = lastOf(findNetGraph(result, fuseHeatNode(node.id))?.voltage_levels);
    if (heat === undefined) return null;
    return { blown: heat >= numParam(node.data, 'i2t', FUSE_DEFAULTS.i2t) };
  }
  return null;
}
