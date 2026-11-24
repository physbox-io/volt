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
    let hasWatched = false;
    for (const n of nodes) {
      if (n.type === 'scope' || n.type === 'led') {
        hasWatched = true;
        break;
      }
    }
    if (!hasWatched) {
      if (Object.keys(this.traces).length > 0) this.traces = {};
      return;
    }

    const now = this.endMs;
    const cutoff = now - this.windowMs;
    const idx = index ?? buildNetlistResultIndex(result);
    const start = now - sliceMs;
    const activeKeys = new Set<string>();
    const add = (key: string, times: number[], value: (i: number) => number) => {
      activeKeys.add(key);
      const trace = (this.traces[key] ??= { points: [], head: 0 });
      const lastT = trace.points.length > 0 ? trace.points[trace.points.length - 1].t : -Infinity;
      const startIdx = times.length > 0 && start + times[0] <= lastT ? 1 : 0;
      for (let i = startIdx; i < times.length; i++) trace.points.push({ t: start + times[i], v: value(i) });
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
    // Evict orphaned traces for scopes/LEDs removed or disconnected mid-run.
    for (const key of Object.keys(this.traces)) {
      if (!activeKeys.has(key)) delete this.traces[key];
    }
  }

  /** The nodes with every scope and LED showing the window up to now. */
  applyTo(nodes: Node[]): Node[] {
    const cutoff = this.endMs - this.windowMs;
    const relativePoints = (key: string): Point[] | undefined => {
      const trace = this.traces[key];
      if (!trace) return undefined;
      const len = trace.points.length - trace.head;
      const out = new Array<Point>(len);
      for (let i = 0; i < len; i++) {
        const p = trace.points[trace.head + i];
        out[i] = { t: p.t - cutoff, v: p.v };
      }
      return out;
    };
    return nodes.map(n => {
      if (n.type === 'scope') {
        const relative1 = relativePoints(`${n.id}-ch1`);
        const relative2 = relativePoints(`${n.id}-ch2`);
        if (!relative1 && !relative2) return n;
        const ch1 = relative1 ?? [];
        const ch2 = relative2 ?? [];
        return { ...n, data: { ...n.data, voltageData: ch1, voltageData1: ch1, voltageData2: ch2 } };
      }
      if (n.type === 'led') {
        const trace = this.traces[n.id];
        if (!trace) return n;
        const len = trace.points.length - trace.head;
        const time_points = new Array<number>(len);
        const current_array = new Array<number>(len);
        for (let i = 0; i < len; i++) {
          const p = trace.points[trace.head + i];
          time_points[i] = p.t - cutoff;
          current_array[i] = p.v;
        }
        return { ...n, data: { ...n.data, time_points, current_array } };
      }
      return n;
    });
  }
}
