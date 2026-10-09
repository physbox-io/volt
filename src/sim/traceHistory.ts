import type { Node } from '@xyflow/react';
import type { SpiceResult } from '../types/simulation';
import { buildNetlistResultIndex, findNetGraph } from '../utils/netlistResult';

type Point = { t: number; v: number };

/**
 * The last second of every scope channel and LED across a sliced run, for
 * the canvas.
 *
 * A sliced run (HIL, or a circuit driving Mesh) solves many short slices, and
 * re-rendering the canvas for each would cost more than solving them. So each
 * slice is appended here as it lands, and `applyTo` draws them all at once, at
 * whatever cadence the caller chooses.
 */
export class TraceHistory {
  private traces: Record<string, Point[]> = {};
  /** Simulated time at the end of the last slice appended, ms. */
  endMs = 0;

  readonly windowMs: number;

  constructor(windowMs = 1000) {
    this.windowMs = windowMs;
  }

  clear(): void {
    this.traces = {};
    this.endMs = 0;
  }

  /** One slice's waveforms, `sliceMs` long, ending `sliceMs` after the last. */
  append(nodes: Node[], result: SpiceResult, portToNet: Record<string, string>, sliceMs: number): void {
    this.endMs += sliceMs;
    const now = this.endMs;
    const index = buildNetlistResultIndex(result);
    const at = (t: number) => now - sliceMs + t;
    const add = (key: string, points: Point[]) => {
      this.traces[key] = [...(this.traces[key] || []), ...points].filter(p => p.t >= now - this.windowMs);
    };
    for (const n of nodes) {
      if (n.type === 'scope') {
        const gnd = findNetGraph(result, portToNet[`${n.id}-gnd`], index);
        for (const ch of ['ch1', 'ch2']) {
          const graph = findNetGraph(result, portToNet[`${n.id}-${ch}`], index);
          if (!graph) continue;
          add(`${n.id}-${ch}`, graph.timestamps_ms.map((t, i) => ({ t: at(t), v: graph.voltage_levels[i] - (gnd ? gnd.voltage_levels[i] : 0) })));
        }
      }
      if (n.type === 'led') {
        const anode = findNetGraph(result, portToNet[`${n.id}-anode`], index);
        const inside = findNetGraph(result, `int_led_${n.id}`, index);
        if (anode && inside) {
          add(n.id, anode.timestamps_ms.map((t, i) => ({ t: at(t), v: anode.voltage_levels[i] - inside.voltage_levels[i] })));
        }
      }
    }
  }

  /** The nodes with every scope and LED showing the window up to now. */
  applyTo(nodes: Node[]): Node[] {
    const cutoff = this.endMs - this.windowMs;
    return nodes.map(n => {
      if (n.type === 'scope') {
        const hist1 = this.traces[`${n.id}-ch1`];
        const hist2 = this.traces[`${n.id}-ch2`];
        if (!hist1 && !hist2) return n;
        const relative1 = (hist1 || []).map(p => ({ t: p.t - cutoff, v: p.v }));
        const relative2 = (hist2 || []).map(p => ({ t: p.t - cutoff, v: p.v }));
        return { ...n, data: { ...n.data, voltageData: relative1, voltageData1: relative1, voltageData2: relative2 } };
      }
      if (n.type === 'led') {
        const hist = this.traces[n.id];
        if (!hist) return n;
        return { ...n, data: { ...n.data, time_points: hist.map(p => p.t - cutoff), current_array: hist.map(p => p.v) } };
      }
      return n;
    });
  }
}
