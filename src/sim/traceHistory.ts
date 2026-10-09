import type { Node } from '@xyflow/react';
import type { SpiceResult } from '../types/simulation';
import { buildNetlistResultIndex, findNetGraph, type NetlistResultIndex } from '../utils/netlistResult';

type Point = { t: number; v: number };

/**
 * One trace: points appended in time order, and `head`, the first still in
 * the window. Old points are skipped by moving `head` and only compacted away
 * once they are most of the array, so a slice costs its own points rather
 * than a copy of the whole window.
 */
type Trace = { points: Point[]; head: number };

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
  private traces: Record<string, Trace> = {};
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

  /** One slice's waveforms, `sliceMs` long, ending `sliceMs` after the last. Pass `index` if built already. */
  append(nodes: Node[], result: SpiceResult, portToNet: Record<string, string>, sliceMs: number, index?: NetlistResultIndex): void {
    this.endMs += sliceMs;
    const now = this.endMs;
    const cutoff = now - this.windowMs;
    const idx = index ?? buildNetlistResultIndex(result);
    const start = now - sliceMs;
    const add = (key: string, times: number[], value: (i: number) => number) => {
      const trace = (this.traces[key] ??= { points: [], head: 0 });
      for (let i = 0; i < times.length; i++) trace.points.push({ t: start + times[i], v: value(i) });
      while (trace.head < trace.points.length && trace.points[trace.head].t < cutoff) trace.head++;
      if (trace.head > 256 && trace.head * 2 > trace.points.length) {
        trace.points = trace.points.slice(trace.head);
        trace.head = 0;
      }
    };
    for (const n of nodes) {
      if (n.type === 'scope') {
        const gnd = findNetGraph(result, portToNet[`${n.id}-gnd`], idx);
        for (const ch of ['ch1', 'ch2']) {
          const graph = findNetGraph(result, portToNet[`${n.id}-${ch}`], idx);
          if (!graph) continue;
          add(`${n.id}-${ch}`, graph.timestamps_ms, i => graph.voltage_levels[i] - (gnd ? gnd.voltage_levels[i] : 0));
        }
      }
      if (n.type === 'led') {
        const anode = findNetGraph(result, portToNet[`${n.id}-anode`], idx);
        const inside = findNetGraph(result, `int_led_${n.id}`, idx);
        if (anode && inside) add(n.id, anode.timestamps_ms, i => anode.voltage_levels[i] - inside.voltage_levels[i]);
      }
    }
  }

  /** The points of trace `key` in the window, oldest first. */
  private window(key: string): Point[] | undefined {
    const trace = this.traces[key];
    return trace ? trace.points.slice(trace.head) : undefined;
  }

  /** The nodes with every scope and LED showing the window up to now. */
  applyTo(nodes: Node[]): Node[] {
    const cutoff = this.endMs - this.windowMs;
    return nodes.map(n => {
      if (n.type === 'scope') {
        const hist1 = this.window(`${n.id}-ch1`);
        const hist2 = this.window(`${n.id}-ch2`);
        if (!hist1 && !hist2) return n;
        const relative1 = (hist1 || []).map(p => ({ t: p.t - cutoff, v: p.v }));
        const relative2 = (hist2 || []).map(p => ({ t: p.t - cutoff, v: p.v }));
        return { ...n, data: { ...n.data, voltageData: relative1, voltageData1: relative1, voltageData2: relative2 } };
      }
      if (n.type === 'led') {
        const hist = this.window(n.id);
        if (!hist) return n;
        return { ...n, data: { ...n.data, time_points: hist.map(p => p.t - cutoff), current_array: hist.map(p => p.v) } };
      }
      return n;
    });
  }
}
