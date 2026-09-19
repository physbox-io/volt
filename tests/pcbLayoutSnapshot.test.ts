/**
 * Saving a routed board, and rebuilding it somewhere else.
 *
 * The promise this file exists to hold is exact equality. A layout laid out on
 * one machine and restored on another is not "close enough" or "usually the
 * same" — it has to be the same board, down to the order of the toolpaths and
 * the text of the G-code, because the whole point is to mill it. So every
 * preset is laid out, snapshotted, restored, and compared field for field,
 * including the copper polygons and both SVG previews.
 *
 * The reason that is not a tautology: restoring does not copy the result. It
 * replays the arithmetic half of the pipeline — flood, isolation, drills,
 * previews, program — over the placement and routes the snapshot carries. Only
 * the search is skipped. If any of that arithmetic were quietly dependent on
 * something the snapshot does not hold, this is where it would show.
 */
import { describe, it, expect } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import { presets } from '../src/utils/presets';
import {
  generatePcbLayout,
  restorePcbLayout,
  layoutBoardKey,
  SNAPSHOT_VERSION,
  DEFAULT_PCB_OPTIONS,
  type PcbLayoutResult,
  type PcbOptions,
} from '../src/utils/pcbExporter';

// A short budget deliberately: this suite is about whether a decided board
// survives a round trip, not about how well it routes. Every board here is
// decided, routed or not, and a partly routed one is the more interesting
// case — it is exactly the board a slower machine must not be allowed to
// re-search into something worse.
const OPTS: PcbOptions = { ...DEFAULT_PCB_OPTIONS, autoGrowBoard: true, routingBudgetMs: 1500 };

const BOARDS = Object.entries(presets).filter(([, p]) => p.nodes.length > 0);

/**
 * Laid out once per preset, on first use.
 *
 * Lazily, because a `describe` body runs during collection whether or not its
 * tests are selected: routing every preset up front made `-t` filtering cost
 * the same as running the lot, which is the opposite of what a filter is for.
 */
const routedBoards = new Map<string, PcbLayoutResult>();
function routed(key: string, preset: { nodes: Node[]; edges: Edge[] }): PcbLayoutResult {
  const hit = routedBoards.get(key);
  if (hit) return hit;
  const result = generatePcbLayout(preset.nodes, preset.edges, OPTS);
  routedBoards.set(key, result);
  return result;
}

/**
 * A result as plain data, for comparison.
 *
 * Maps do not survive a structural equality check the way objects do, and the
 * snapshot field is excluded because it *contains* the arrays being compared —
 * including it would make the test pass by recursing into the same objects
 * twice rather than by checking anything.
 */
function comparable(result: PcbLayoutResult) {
  const { snapshot: _snapshot, copperByNet, bottomCopperByNet, ...rest } = result;
  return {
    ...rest,
    copperByNet: [...copperByNet.entries()],
    bottomCopperByNet: bottomCopperByNet ? [...bottomCopperByNet.entries()] : null,
  };
}

describe.each(BOARDS)('%s', (key, preset) => {
  it('carries a snapshot of the board it decided', () => {
    const board = routed(key, preset);
    expect(board.snapshot).toBeDefined();
    expect(board.snapshot!.version).toBe(SNAPSHOT_VERSION);
    expect(board.snapshot!.boardKey).toBe(layoutBoardKey(preset.nodes, preset.edges, OPTS));
    expect(board.snapshot!.core.placed.length).toBeGreaterThan(0);
  });

  it('restores to the same board, to the last decimal of the program', () => {
    const board = routed(key, preset);
    const restored = restorePcbLayout(board.snapshot, preset.nodes, preset.edges, OPTS);
    expect(restored).not.toBeNull();
    expect(comparable(restored!)).toEqual(comparable(board));
  });

  /*
   * What actually travels is JSON, in a preset or a cloud document — not the
   * live object. A Map, an undefined or a class instance anywhere in the core
   * would survive the check above and be lost in transit, so the round trip is
   * made the hard way here.
   */
  it('survives being written out and read back as JSON', () => {
    const board = routed(key, preset);
    const wire = JSON.parse(JSON.stringify(board.snapshot));
    const restored = restorePcbLayout(wire, preset.nodes, preset.edges, OPTS);
    expect(restored).not.toBeNull();
    expect(comparable(restored!)).toEqual(comparable(board));
  });

  it('is a fraction of the size of the board it rebuilds', () => {
    const board = routed(key, preset);
    const snapshotBytes = JSON.stringify(board.snapshot).length;
    const resultBytes = JSON.stringify({
      ...board,
      copperByNet: [...board.copperByNet.entries()],
      snapshot: undefined,
    }).length;
    expect(snapshotBytes).toBeLessThan(resultBytes / 2);
    // Presets share one localStorage entry, and a browser gives that origin a
    // few megabytes in total. A board that cost more than this to keep would
    // be one that quietly evicted the circuits around it.
    expect(snapshotBytes).toBeLessThan(200 * 1024);
  });
});

/**
 * The guard, which is the part that keeps this safe rather than merely fast.
 *
 * A snapshot is milled. So the only acceptable failure mode is refusing to
 * restore: every case below has to come back null and send the caller to the
 * router, and none of them may come back with a board.
 */
describe('a snapshot is only ever replayed onto the board it came from', () => {
  const preset = presets.basicBlink ?? BOARDS[0][1];
  const snapshotOf = () => routed('guard', preset).snapshot!;

  it('refuses a circuit with a component added', () => {
    const nodes = [
      ...preset.nodes,
      { id: 'extra_r', type: 'resistor', position: { x: 400, y: 400 }, data: { resistance: 1000 } },
    ];
    expect(restorePcbLayout(snapshotOf(), nodes as typeof preset.nodes, preset.edges, OPTS)).toBeNull();
  });

  it('refuses a circuit with a component removed', () => {
    const nodes = preset.nodes.slice(0, -1);
    expect(restorePcbLayout(snapshotOf(), nodes, preset.edges, OPTS)).toBeNull();
  });

  it('refuses a circuit rewired', () => {
    const edges = preset.edges.slice(0, -1);
    expect(restorePcbLayout(snapshotOf(), preset.nodes, edges, OPTS)).toBeNull();
  });

  it('refuses a component whose value changed', () => {
    const nodes = preset.nodes.map((n, i) =>
      i === 0 ? { ...n, data: { ...n.data, resistance: 4321 } } : n
    );
    expect(restorePcbLayout(snapshotOf(), nodes, preset.edges, OPTS)).toBeNull();
  });

  /*
   * Each of these moves copper. A board routed for 0.4mm traces is not the
   * board you get at 0.8mm, and the mirror decides which way round every part
   * seats — restoring across any of them would mill the wrong thing.
   */
  it.each([
    ['traceWidthMm', { traceWidthMm: (OPTS.traceWidthMm ?? 0.4) * 2 }],
    ['clearanceMm', { clearanceMm: (OPTS.clearanceMm ?? 0.4) * 2 }],
    ['layers', { layers: 2 as const }],
    ['mirrorSingleSided', { mirrorSingleSided: false }],
    ['padMarginMm', { padMarginMm: (OPTS.padMarginMm ?? 0) + 0.15 }],
    ['copperFloodMm', { copperFloodMm: (OPTS.copperFloodMm ?? 0) + 0.5 }],
    ['isolationDepthZ', { isolationDepthZ: OPTS.isolationDepthZ - 0.05 }],
    ['autoGrowBoard', { autoGrowBoard: false }],
  ])('refuses a change to %s', (_label, override) => {
    const opts = { ...OPTS, ...override };
    expect(restorePcbLayout(snapshotOf(), preset.nodes, preset.edges, opts)).toBeNull();
  });

  it('refuses a snapshot written by a different version of this code', () => {
    expect(
      restorePcbLayout(
        { ...snapshotOf(), version: SNAPSHOT_VERSION + 1 },
        preset.nodes,
        preset.edges,
        OPTS
      )
    ).toBeNull();
  });

  it('refuses nothing at all, rather than throwing', () => {
    expect(restorePcbLayout(undefined, preset.nodes, preset.edges, OPTS)).toBeNull();
    expect(restorePcbLayout(null, preset.nodes, preset.edges, OPTS)).toBeNull();
  });
});

/**
 * The other half of the bargain. A saved board is saved so it can be milled
 * later — under the feeds, depths and tabs of whatever machine is milling it,
 * which are not the ones it happened to be routed under. Those options may
 * never invalidate a snapshot, and must reach the program.
 */
describe('a restored board is milled with today’s machine settings', () => {
  const preset = presets.basicBlink ?? BOARDS[0][1];

  it('re-emits the program rather than replaying the stored one', () => {
    const board = routed('settings', preset);
    const faster: PcbOptions = { ...OPTS, cutFeedrate: OPTS.cutFeedrate + 137, spindleRpm: OPTS.spindleRpm + 5000 };
    const restored = restorePcbLayout(board.snapshot, preset.nodes, preset.edges, faster);
    expect(restored).not.toBeNull();
    expect(restored!.gcode).not.toBe(board.gcode);
    expect(restored!.gcode).toContain(`F${faster.cutFeedrate}`);
    expect(restored!.gcode).toContain(`S${faster.spindleRpm}`);
    // The board itself is untouched by any of that.
    expect(restored!.pads.map(p => [p.x, p.y])).toEqual(board.pads.map(p => [p.x, p.y]));
    expect(restored!.isolationPaths.length).toBe(board.isolationPaths.length);
  });

  it('keys the board the same way whatever the router was given to think about', () => {
    expect(layoutBoardKey(preset.nodes, preset.edges, { ...OPTS, routingBudgetMs: 120000 })).toBe(
      layoutBoardKey(preset.nodes, preset.edges, { ...OPTS, routingBudgetMs: 500 })
    );
  });

  /*
   * The fingerprint has to see through the things React Flow hangs off a node
   * while the app is running — selection, drag state, injected callbacks —
   * because a key that changed when a node was clicked would throw away the
   * saved layout for no reason at all.
   */
  it('ignores what the editor hangs off a node', () => {
    const base = layoutBoardKey(preset.nodes, preset.edges, OPTS);
    const fiddled = preset.nodes.map(n => ({
      ...n,
      selected: true,
      dragging: true,
      data: { ...n.data, onChange: () => {} },
    }));
    expect(layoutBoardKey(fiddled, preset.edges, OPTS)).toBe(base);
  });
});
