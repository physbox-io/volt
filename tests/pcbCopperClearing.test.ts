/**
 * Copper clearing: the end mill pocketing out the foil isolation leaves behind.
 *
 * Everything here is checked against the G-code, not against the paths the
 * planner returned, because the G-code is what reaches the machine. The two
 * properties that matter are that the end mill never touches copper that has
 * to survive, and that it actually clears what it can reach.
 */
import { describe, it, expect } from 'vitest';
import {
  generatePcbLayout,
  planCopperClearing,
  padPolygon,
  effectivePadMarginMm,
  ISOLATION_STEPOVER,
  DEFAULT_PCB_OPTIONS,
  type PcbLayoutResult,
  type PcbOptions,
} from '../src/utils/pcbExporter';
import { presets } from '../src/utils/presets';
import {
  circlePoly,
  differencePolys,
  intersectPolys,
  offsetPolys,
  rectPoly,
  strokeToPoly,
  totalArea,
  unionPolys,
  type Poly,
  type Pt,
} from '../src/utils/pcbGeometry';

const BASE: PcbOptions = {
  ...DEFAULT_PCB_OPTIONS,
  autoGrowBoard: true,
  routingBudgetMs: 1500,
  rubOutClearing: true,
};

// From a two-part blinker to an MCU board with a module footprint and a dense
// analog section — enough spread to meet narrow gaps, islands and cutouts.
const BOARD_KEYS = [
  'basicBlink',
  'astableMultivibrator',
  'opAmpAmp',
  'mcuBlink',
  'mcuAnalogOut',
  'mcuCleanAudioSampler',
  'heltecCc1101',
].filter(k => presets[k]?.nodes.length);

const CONFIGS: Record<string, Partial<PcbOptions>> = {
  'flooded, mirrored': {},
  'unflooded, 3 passes': { copperFloodMm: 0, isolationPasses: 3 },
  'unmirrored, 3.175 end mill': { mirrorSingleSided: false, profileToolDiaMm: 3.175 },
  'two-layer': { layers: 2 },
};

const layouts = new Map<string, PcbLayoutResult>();
function layout(key: string, config: string): PcbLayoutResult {
  const id = `${key}|${config}`;
  if (!layouts.has(id)) {
    const p = presets[key];
    layouts.set(id, generatePcbLayout(p.nodes as never, p.edges as never, { ...BASE, ...CONFIGS[config] }));
  }
  return layouts.get(id)!;
}

/**
 * The cutter centrelines of one clearing op, read back out of the program.
 * Every G1 counts, ramps included — a conservative reading of "cutting".
 */
function clearingMoves(gcode: string, side: 'Top ' | 'Bottom ' | ''): Pt[][] {
  const lines = gcode.split('\n');
  const start = lines.findIndex(l => new RegExp(`OP \\d+/\\d+: ${side}Copper clearing`).test(l));
  if (start < 0) return [];
  const paths: Pt[][] = [];
  let cur: Pt = { x: 0, y: 0 };
  let open: Pt[] | null = null;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^; OP \d+\/\d+/.test(line)) break;
    if (line.startsWith(';') || !line) continue;
    const [cmd, ...words] = line.split(/\s+/);
    const next = { ...cur };
    for (const w of words) {
      if (w[0] === 'X') next.x = parseFloat(w.slice(1));
      if (w[0] === 'Y') next.y = parseFloat(w.slice(1));
    }
    if (cmd === 'G1') {
      if (!open) {
        open = [cur];
        paths.push(open);
      }
      open.push(next);
    } else if (cmd === 'G0') {
      open = null;
    }
    cur = next;
  }
  return paths;
}

/** Copper that has to survive on one side, in program coordinates, unmirrored. */
function keptCopper(r: PcbLayoutResult, options: PcbOptions, side: 'top' | 'bottom'): Poly[] {
  const map = side === 'top' ? r.copperByNet : r.bottomCopperByNet!;
  const kept: Poly[] = [];
  for (const polys of map.values()) kept.push(...polys);
  const byId = new Map(r.components.map(c => [c.id, c]));
  for (const pad of r.pads) {
    if (side === 'bottom' && !(pad.spec.drillDiameter > 0)) continue;
    const comp = byId.get(pad.componentId);
    if (!comp) continue;
    kept.push(padPolygon(pad, comp.rotationDeg, effectivePadMarginMm(comp.footprint, options.padMarginMm ?? 0)));
  }
  return unionPolys(kept);
}

const sweep = (paths: Pt[][], widthMm: number) =>
  unionPolys(paths.flatMap(p => strokeToPoly(p, widthMm)));

const boardOf = (r: PcbLayoutResult) => [
  rectPoly(
    r.boardOriginMm + r.boardWidthMm / 2,
    r.boardOriginMm + r.boardHeightMm / 2,
    r.boardWidthMm,
    r.boardHeightMm
  ),
];

describe.each(BOARD_KEYS)('%s', key => {
  describe.each(Object.keys(CONFIGS))('%s', config => {
    const options = { ...BASE, ...CONFIGS[config] } as PcbOptions;
    const isTwoLayer = options.layers === 2;
    const D = options.profileToolDiaMm;
    const channel = (r: PcbLayoutResult) =>
      r.effectiveToolDiaMm * (1 + (Math.max(1, Math.min(3, options.isolationPasses)) - 1) * ISOLATION_STEPOVER);

    const sides = isTwoLayer
      ? ([['top', 'Top '], ['bottom', 'Bottom ']] as const)
      : ([['top', '']] as const);

    it.each(sides.map(s => [...s]))('%s: the end mill stays clear of every trace and pad', (side, label) => {
      const r = layout(key, config);
      // A board that fails its rule check is emitted with no motion at all.
      if (r.violations.some(v => v.severity === 'error')) {
        expect(r.gcode).not.toMatch(/^G1 /m);
        return;
      }
      let moves = clearingMoves(r.gcode, label as 'Top ' | 'Bottom ' | '');
      expect(moves.length).toBeGreaterThan(0);
      // The bottom side is cut mirrored about the board's centreline.
      if (side === 'bottom') {
        const xMid = r.boardOriginMm + r.boardWidthMm / 2;
        moves = moves.map(p => p.map(pt => ({ x: 2 * xMid - pt.x, y: pt.y })));
      }
      const swept = sweep(moves, D);
      const copper = keptCopper(r, options, side as 'top' | 'bottom');
      // Held off by half the isolation channel; a hair under it for Clipper's
      // arc tolerance.
      const nicked = intersectPolys(swept, offsetPolys(copper, channel(r) / 2 - 0.01));
      expect(totalArea(nicked)).toBeLessThan(1e-4);

      // Nothing runs off the blank either, beyond the cutter's own edge.
      const outside = differencePolys(swept, offsetPolys(boardOf(r), 0.01));
      expect(totalArea(outside)).toBeLessThan(1e-4);

      // And it clears what it can reach: anything a full diameter from the
      // edge and from copper has nothing stopping the cutter.
      const reachable = differencePolys(
        offsetPolys(boardOf(r), -D),
        offsetPolys(copper, channel(r) / 2 + D)
      );
      const missed = differencePolys(reachable, swept);
      expect(totalArea(missed)).toBeLessThan(0.05);
    });

    it('loads the end mill once on a single-sided board', () => {
      if (isTwoLayer) return;
      const r = layout(key, config);
      if (r.violations.some(v => v.severity === 'error')) return;
      expect(r.gcode.match(/^T99 M6/gm)?.length).toBe(1);
      const clearAt = r.gcode.indexOf('Copper clearing');
      expect(clearAt).toBeGreaterThan(r.gcode.indexOf('drilling'));
      expect(clearAt).toBeLessThan(r.gcode.indexOf('Board edge profile'));
    });
  });
});

describe('planCopperClearing', () => {
  const board = [rectPoly(20, 15, 40, 30)];

  it('clears a bare board edge to edge', () => {
    const plan = planCopperClearing([], board, 1.5, 0.1, 0.2, { x: 0, y: 0 });
    const swept = sweep(plan.paths.map(p => p.points), 1.5);
    // Only the four corners a round cutter cannot reach.
    expect(totalArea(differencePolys(board, swept))).toBeLessThan(4 * 0.75 * 0.75 * (1 - Math.PI / 4) + 0.03);
    // The residue is those same corners, reported rather than hidden.
    expect(totalArea(plan.residue)).toBeLessThan(4 * 0.75 * 0.75 * (1 - Math.PI / 4) + 0.03);
  });

  it('leaves foil in a gap too narrow for the cutter, and reports it', () => {
    // Two pads 1.6mm apart: a 1.5mm end mill held 0.1mm off each cannot fit.
    const copper = [rectPoly(18.2, 15, 2, 6), rectPoly(21.8, 15, 2, 6)];
    const plan = planCopperClearing(copper, board, 1.5, 0.1, 0.2, { x: 0, y: 0 });
    const swept = sweep(plan.paths.map(p => p.points), 1.5);
    expect(totalArea(intersectPolys(swept, offsetPolys(copper, 0.09)))).toBeLessThan(1e-4);
    const gap = [rectPoly(20, 15, 0.5, 4)];
    expect(totalArea(intersectPolys(plan.residue, gap))).toBeCloseTo(2, 1);
  });

  it('cuts round an island of copper, not through it', () => {
    const copper = [circlePoly(20, 15, 3)];
    const plan = planCopperClearing(copper, board, 3.175, 0.15, 0.3, { x: 0, y: 0 });
    const swept = sweep(plan.paths.map(p => p.points), 3.175);
    expect(totalArea(intersectPolys(swept, offsetPolys(copper, 0.14)))).toBeLessThan(1e-4);
    // Nothing left but the board's four corners, which a round cutter misses.
    const corners = 4 * 1.5875 ** 2 * (1 - Math.PI / 4);
    expect(totalArea(plan.residue)).toBeLessThan(corners + 0.1);
  });

  it('returns nothing for a cutter of no size', () => {
    expect(planCopperClearing([], board, 0, 0.1, 0.2, { x: 0, y: 0 }).paths).toEqual([]);
  });
});
