/**
 * The exporter decisions that move a cutter.
 *
 * These are the ones with a physical consequence when they are wrong: a bit
 * that gouges instead of scoring, a pad grown until it shorts, a dry run that
 * turns out not to be dry, a work origin the machine refuses as out of range.
 */
import { describe, it, expect } from 'vitest';
import {
  vBitWidthAtDepth,
  padReliefPlan,
  ISOLATION_STEPOVER,
  effectivePadMarginMm,
  padPolygon,
  boardOriginOffsetMm,
  generateAirCutGcode,
  generateAirCutPerimeterGcode,
  sortPathsNearestNeighbor,
  groupDrillsByBit,
  generatePcbLayout,
  floodCopperByNet,
  emptyPcbLayout,
  reemitPcbGcode,
  GCODE_ONLY_OPTIONS,
  GCODE_DERIVED_FIELDS,
  DEFAULT_PCB_OPTIONS,
  type DrillPoint,
  type IsolationPath,
  type PcbLayoutResult,
  type PcbOptions,
  type PlacedPad,
} from '../src/utils/pcbExporter';
import { presets } from '../src/utils/presets';
import { generateQuadFamilyFootprint, generateDIPFootprint } from '../src/utils/pcbFootprints';
import {
  circlePoly,
  differencePolys,
  offsetPolys,
  pointInPolys,
  polysBounds,
  polysOverlap,
  rectPoly,
  strokeToPoly,
  unionPolys,
  type Poly,
} from '../src/utils/pcbGeometry';

describe('vBitWidthAtDepth', () => {
  it('returns the tip width at zero depth', () => {
    expect(vBitWidthAtDepth(0.1, 30, 0)).toBeCloseTo(0.1, 9);
  });

  it('widens with the tangent of the half angle', () => {
    // 30 degrees included = 15 degrees each side.
    expect(vBitWidthAtDepth(0.1, 30, 0.5)).toBeCloseTo(0.1 + 2 * 0.5 * Math.tan(Math.PI / 12), 9);
  });

  it('treats depth as a magnitude, so a signed Z gives the same width', () => {
    // Depths are held negative elsewhere in the exporter; the width must not
    // come back narrower than the tip because of the sign.
    expect(vBitWidthAtDepth(0.1, 30, -0.2)).toBeCloseTo(vBitWidthAtDepth(0.1, 30, 0.2), 9);
  });

  it('cuts wider for a blunter bit at the same depth', () => {
    expect(vBitWidthAtDepth(0.1, 60, 0.2)).toBeGreaterThan(vBitWidthAtDepth(0.1, 15, 0.2));
  });
});

describe('effectivePadMarginMm', () => {
  it('passes an ordinary request through on a coarse part', () => {
    const dip = generateDIPFootprint(8);
    // A DIP's 2.54mm pitch leaves gap enough that 0.05mm is under the cap.
    expect(effectivePadMarginMm(dip, 0.05)).toBeCloseTo(0.05, 9);
  });

  it('caps the request on a fine-pitch part so pads cannot be grown into a short', () => {
    const qfn = generateQuadFamilyFootprint('QFN', 32);
    const asked = 0.2;
    const got = effectivePadMarginMm(qfn, asked);
    expect(got).toBeLessThan(asked);
    // At most a fifth of the tightest gap, leaving the bulk of it to mill through.
    expect(got).toBeGreaterThanOrEqual(0);
  });

  it('never grows a pad at all when nothing was asked for', () => {
    const qfn = generateQuadFamilyFootprint('QFN', 32);
    expect(effectivePadMarginMm(qfn, 0)).toBe(0);
    expect(effectivePadMarginMm(qfn, -1)).toBe(0);
  });

  it('is monotonic — asking for more never yields less', () => {
    const qfn = generateQuadFamilyFootprint('QFN', 32);
    const small = effectivePadMarginMm(qfn, 0.02);
    const large = effectivePadMarginMm(qfn, 0.5);
    expect(large).toBeGreaterThanOrEqual(small);
  });
});

describe('padPolygon', () => {
  const pad = (over: Partial<PlacedPad['spec']> = {}): PlacedPad => ({
    componentId: 'u1',
    handleId: 'u1-1',
    pinNumber: 1,
    netId: 'n1',
    x: 0,
    y: 0,
    spec: {
      pinNumber: 1, x: 0, y: 0,
      padWidth: 1.6, padHeight: 1.6, shape: 'rect', drillDiameter: 0.8,
      ...over,
    },
  });

  it('never shrinks the copper below the drill it surrounds', () => {
    // A pad smaller than its own hole is an annulus the drill removes outright,
    // leaving nothing to solder to.
    const tiny = pad({ padWidth: 0.2, padHeight: 0.2, drillDiameter: 1.0 });
    const b = polysBounds([padPolygon(tiny, 0, 0)]);
    expect(b.maxX - b.minX).toBeGreaterThanOrEqual(1.0 - 1e-6);
    expect(b.maxY - b.minY).toBeGreaterThanOrEqual(1.0 - 1e-6);
  });

  it('grows by the margin on every side', () => {
    const p = pad();
    const plain = polysBounds([padPolygon(p, 0, 0)]);
    const grown = polysBounds([padPolygon(p, 0, 0.25)]);
    expect((grown.maxX - grown.minX) - (plain.maxX - plain.minX)).toBeCloseTo(0.5, 6);
  });

  it('swaps width and height at 90 degrees', () => {
    const oblong = pad({ padWidth: 2.0, padHeight: 1.0, shape: 'rect' });
    const a = polysBounds([padPolygon(oblong, 0, 0)]);
    const b = polysBounds([padPolygon(oblong, 90, 0)]);
    expect(a.maxX - a.minX).toBeCloseTo(b.maxY - b.minY, 6);
    expect(a.maxY - a.minY).toBeCloseTo(b.maxX - b.minX, 6);
  });
});

describe('boardOriginOffsetMm', () => {
  it('insets by exactly the profile tool radius', () => {
    // The outline pass runs a radius outside the finished edge; without the
    // inset it is commanded to negative coordinates and a machine with soft
    // limits refuses the job.
    const opts = { ...DEFAULT_PCB_OPTIONS, profileToolDiaMm: 3.175 };
    expect(boardOriginOffsetMm(opts)).toBeCloseTo(3.175 / 2, 9);
  });
});

describe('generateAirCutGcode', () => {
  const program = [
    'G21 G90',
    'T1',
    'M6 T1 ; change to the isolation bit',
    'M3 S12000',
    'G0 Z5.000',
    'G1 Z-0.080 F100',
    'G1 X10.000 Y10.000 F350',
    'M5',
    'M30',
  ].join('\n');

  it('lifts every Z by the offset', () => {
    const air = generateAirCutGcode(program, 20);
    expect(air).toContain('G0 Z25.000');
    expect(air).toContain('G1 Z19.920');
  });

  it('leaves no Z at or below zero anywhere in the program', () => {
    // The whole point: nothing in a dry run may reach the stock.
    const air = generateAirCutGcode(program, 20);
    for (const m of air.matchAll(/\bZ(-?\d+(?:\.\d+)?)/gi)) {
      expect(parseFloat(m[1])).toBeGreaterThan(0);
    }
  });

  it('never starts the spindle', () => {
    const air = generateAirCutGcode(program, 20);
    // A spinning cutter 20mm above the stock is just a hazard.
    for (const line of air.split('\n')) {
      const code = line.indexOf(';') !== -1 ? line.slice(0, line.indexOf(';')) : line;
      expect(/\bM[34]\b/.test(code)).toBe(false);
    }
  });

  it('drops tool changes and stops to comments so the run does not pause', () => {
    const air = generateAirCutGcode(program, 20);
    expect(air).toMatch(/; \[air cut\] tool change skipped/);
    for (const line of air.split('\n')) {
      const code = line.indexOf(';') !== -1 ? line.slice(0, line.indexOf(';')) : line;
      expect(/\bM0?6\b/.test(code)).toBe(false);
    }
  });

  it('announces itself in the first line', () => {
    expect(generateAirCutGcode(program, 20).split('\n')[0]).toContain('AIR CUT');
  });

  it('passes an empty program straight through', () => {
    expect(generateAirCutGcode('', 20)).toBe('');
  });

  it('preserves X and Y untouched', () => {
    const air = generateAirCutGcode(program, 20);
    expect(air).toContain('X10.000 Y10.000');
  });
});

describe('generateAirCutPerimeterGcode', () => {
  const layout = {
    boardOriginMm: 5,
    boardWidthMm: 40,
    boardHeightMm: 30,
    // Only the board rectangle: profileToolpath reads nothing else off the layout.
  } as unknown as PcbLayoutResult;
  const options = { ...DEFAULT_PCB_OPTIONS, safeZ: 2 };

  /** Every absolute Z the program commands while G90 is in force. */
  const absoluteZs = (gcode: string): number[] => {
    let absolute = true;
    const zs: number[] = [];
    for (const line of gcode.split('\n')) {
      const code = line.indexOf(';') !== -1 ? line.slice(0, line.indexOf(';')) : line;
      if (/\bG91\b/.test(code)) absolute = false;
      if (/\bG90\b/.test(code)) absolute = true;
      const z = /\bZ(-?[\d.]+)/.exec(code);
      if (z && absolute) zs.push(parseFloat(z[1]));
    }
    return zs;
  };

  it('flies at safe Z plus the offset when the tool is below it', () => {
    const zs = absoluteZs(generateAirCutPerimeterGcode(layout, options, 20, 0));
    expect(zs.length).toBeGreaterThan(0);
    expect(new Set(zs)).toEqual(new Set([22]));
  });

  it('never commands a Z below where the tool already is', () => {
    // A Z0 left over from a thicker blank puts the tool above the clearance
    // height the offset asks for; dropping to it would drive the bit into the
    // work and then drag it around the outline.
    const gcode = generateAirCutPerimeterGcode(layout, options, 20, 60);
    for (const z of absoluteZs(gcode)) expect(z).toBeGreaterThanOrEqual(60);
  });

  /*
   * The whole promise of the framing lap, and the reason the +10/+20/+50 choice
   * could be taken away: the operator does not have to pick an offset that
   * clears a stale Z0, because no offset can ever put the bit lower than it
   * already is. Swept rather than spot-checked — the clearance is in work
   * coordinates, and every one of these is a Z0 someone could plausibly be
   * carrying over from a previous setup.
   */
  it('never descends, from any starting height', () => {
    for (const startZ of [-50, -12, -1, 0, 0.5, 1.9, 2, 2.1, 21.9, 22, 22.1, 60, 500]) {
      const zs = absoluteZs(generateAirCutPerimeterGcode(layout, options, 20, startZ));
      expect(zs.length).toBeGreaterThan(0);
      for (const z of zs) {
        expect(z, `starting at Z${startZ}`).toBeGreaterThanOrEqual(startZ);
      }
    }
  });

  /*
   * A relative lift is the only move that is safe without knowing where the
   * tool is, so an unknown Z must never produce an absolute one — including
   * the retract between the two laps and the return to the origin.
   */
  it('commands no absolute Z at all when the current Z is unknown', () => {
    const gcode = generateAirCutPerimeterGcode(layout, options, 20, undefined);
    expect(absoluteZs(gcode)).toEqual([]);
    expect(gcode).toMatch(/G91 G0 Z20\.000/);
  });

  it('treats a non-finite current Z as unknown rather than as zero', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      const gcode = generateAirCutPerimeterGcode(layout, options, 20, bad);
      expect(absoluteZs(gcode), `current Z ${bad}`).toEqual([]);
    }
  });

  it('lifts relatively when the current Z is unknown', () => {
    const gcode = generateAirCutPerimeterGcode(layout, options, 20);
    expect(gcode).toMatch(/G91 G0 Z20\.000/);
    expect(absoluteZs(gcode)).toEqual([]);
  });

  it('still cannot start the spindle at any height', () => {
    for (const z of [undefined, 0, 60]) {
      const gcode = generateAirCutPerimeterGcode(layout, options, 20, z);
      for (const line of gcode.split('\n')) {
        const code = line.indexOf(';') !== -1 ? line.slice(0, line.indexOf(';')) : line;
        expect(/\bM[34]\b/.test(code)).toBe(false);
      }
    }
  });
});

describe('sortPathsNearestNeighbor', () => {
  const at = (x: number, y: number): IsolationPath => ({
    netId: `n${x}`, pass: 0, points: [{ x, y }, { x: x + 0.1, y }],
  });

  it('returns a short input unchanged', () => {
    expect(sortPathsNearestNeighbor([])).toHaveLength(0);
    const one = [at(5, 5)];
    expect(sortPathsNearestNeighbor(one)).toBe(one);
  });

  it('keeps every path exactly once', () => {
    const paths = [at(0, 0), at(100, 100), at(1, 0), at(99, 100)];
    const sorted = sortPathsNearestNeighbor(paths);
    expect(sorted).toHaveLength(paths.length);
    expect(new Set(sorted)).toEqual(new Set(paths));
  });

  it('shortens the rapid travel against the worst ordering', () => {
    const paths = [at(0, 0), at(100, 0), at(1, 0), at(99, 0)];
    const travel = (ps: IsolationPath[]) => {
      let d = 0;
      for (let i = 1; i < ps.length; i++) {
        const a = ps[i - 1].points[ps[i - 1].points.length - 1];
        const b = ps[i].points[0];
        d += Math.hypot(b.x - a.x, b.y - a.y);
      }
      return d;
    };
    expect(travel(sortPathsNearestNeighbor(paths))).toBeLessThan(travel(paths));
  });
});

describe('groupDrillsByBit', () => {
  const hole = (d: number, i: number): DrillPoint => ({
    x: i, y: 0, diameter: d, componentId: `c${i}`, pinNumber: 1,
  });

  it('merges near sizes onto one bit, drilled at the largest of them', () => {
    // A lead is never left without a hole it fits through, only a looser one.
    const groups = groupDrillsByBit([hole(0.8, 0), hole(0.9, 1), hole(1.0, 2)], 0.3);
    expect(groups).toHaveLength(1);
    expect(groups[0].holeMm).toBeCloseTo(1.0, 6);
    expect(groups[0].holes).toHaveLength(3);
    expect(groups[0].nominals).toEqual([0.8, 0.9, 1.0]);
  });

  it('never lets a chain of near-neighbours drift beyond the tolerance', () => {
    // Anchored on the smallest member, so 0.8 can never be drilled at 2.0.
    const groups = groupDrillsByBit(
      [hole(0.8, 0), hole(1.0, 1), hole(1.2, 2), hole(1.4, 3), hole(1.6, 4), hole(2.0, 5)],
      0.3
    );
    for (const g of groups) {
      expect(Math.max(...g.nominals) - Math.min(...g.nominals)).toBeLessThanOrEqual(0.3 + 1e-9);
    }
  });

  it('keeps distinct sizes apart at zero tolerance', () => {
    const groups = groupDrillsByBit([hole(0.8, 0), hole(1.2, 1)], 0);
    expect(groups).toHaveLength(2);
  });

  it('loses no hole, whatever the grouping', () => {
    const holes = [hole(0.8, 0), hole(0.9, 1), hole(1.2, 2), hole(3.0, 3)];
    for (const tol of [0, 0.1, 0.3, 1, 5]) {
      const total = groupDrillsByBit(holes, tol).reduce((n, g) => n + g.holes.length, 0);
      expect(total, `tolerance ${tol} drills every hole`).toBe(holes.length);
    }
  });

  it('returns nothing for a board with no holes', () => {
    expect(groupDrillsByBit([], 0.3)).toHaveLength(0);
  });

  it('reports groups in ascending bit size', () => {
    const groups = groupDrillsByBit([hole(3.0, 0), hole(0.8, 1), hole(1.6, 2)], 0.1);
    const sizes = groups.map(g => g.bitMm);
    expect([...sizes].sort((a, b) => a - b)).toEqual(sizes);
  });
});

describe('reusesLayoutAcross — the G-code-only option allowlist', () => {
  /*
   * The layout cache keys on the options that shape the board, and skips the
   * ones that only shape the program emitted from it, so that nudging a
   * feedrate re-emits in milliseconds instead of re-routing for seconds.
   *
   * That is only sound while every entry on the allowlist really does leave
   * the board alone, and "the board" means everything a caller can see: the
   * traces and pads, but also the drill list, the violations, the copper map
   * and the rendered SVGs, any one of which the panel draws or the exporter
   * reads. So the comparison here is the whole result minus the four fields
   * that are derived from the G-code — not a hand-picked subset, which is how
   * an earlier pass at this missed that the SVGs take the options too.
   *
   * A value that fails belongs off the list, not excluded from the test: the
   * cost of being wrong is a stale board streamed to a real machine.
   */
  const board = presets.basicBlink ?? Object.values(presets).find(p => p.nodes.length > 0)!;
  const base: PcbOptions = { ...DEFAULT_PCB_OPTIONS, autoGrowBoard: true };

  /** A value meaningfully different from the default, per option. */
  const nudged: Record<string, unknown> = {
    cutFeedrate: base.cutFeedrate + 137,
    travelFeedrate: base.travelFeedrate + 411,
    plungeFeedrate: base.plungeFeedrate + 53,
    drillFeedrate: base.drillFeedrate + 29,
    spindleRpm: base.spindleRpm + 7000,
    safeZ: base.safeZ + 6.5,
    toolChangeZ: base.toolChangeZ + 11,
    drillDepthZ: base.drillDepthZ - 1.3,
    profileDepthZ: base.profileDepthZ - 0.9,
    zStepdown: 0.17,
    tabCount: (base.tabCount ?? 0) + 5,
    tabWidthMm: (base.tabWidthMm ?? 1) + 2.4,
    tabHeightMm: (base.tabHeightMm ?? 0.5) + 0.35,
    pauseOnToolChange: !base.pauseOnToolChange,
    rampedPlunge: !(base.rampedPlunge ?? true),
    breakThroughMm: (base.breakThroughMm ?? 0.2) + 0.7,
    boardThicknessMm: (base.boardThicknessMm ?? 1.6) + 0.8,
    drillBitOverridesMm: { '0.9': 1.5, '1.0': 1.6 },
    drillConsolidationMm: 0.45,
    airCutZOffset: 37,
  };

  const layoutOf = (opts: PcbOptions) =>
    generatePcbLayout(board.nodes as never, board.edges as never, opts);

  /** Everything a caller can see except what the G-code is derived from. */
  const boardShape = (r: PcbLayoutResult) => {
    const copy: Record<string, unknown> = { ...(r as unknown as Record<string, unknown>) };
    for (const field of GCODE_DERIVED_FIELDS) delete copy[field];
    // Maps do not survive the structural compare; spell them out.
    copy.copperByNet = [...(r.copperByNet ?? new Map())].map(([k, v]) => [k, JSON.stringify(v)]);
    copy.bottomCopperByNet = r.bottomCopperByNet
      ? [...r.bottomCopperByNet].map(([k, v]) => [k, JSON.stringify(v)])
      : undefined;
    return JSON.parse(JSON.stringify(copy));
  };

  const reference = layoutOf(base);

  it('covers every option it claims to, with a value that actually differs', () => {
    for (const key of GCODE_ONLY_OPTIONS) {
      expect(nudged, `no nudge defined for ${key}`).toHaveProperty(key);
      expect(nudged[key], `nudge for ${key} matches the default`).not.toEqual(
        (base as unknown as Record<string, unknown>)[key]
      );
    }
  });

  it.each([...GCODE_ONLY_OPTIONS])('leaves the board untouched: %s', key => {
    const changed = layoutOf({ ...base, [key]: nudged[key] } as PcbOptions);
    expect(boardShape(changed)).toEqual(boardShape(reference));
  });

  it.each([...GCODE_ONLY_OPTIONS])('and re-emitting matches a full re-route: %s', key => {
    const opts = { ...base, [key]: nudged[key] } as PcbOptions;
    const rerouted = layoutOf(opts);
    const reemitted = reemitPcbGcode(reference, opts);
    expect(reemitted.gcode).toBe(rerouted.gcode);
    expect(reemitted.cycleTimeSec).toBe(rerouted.cycleTimeSec);
    expect(reemitted.travelDistanceMm).toBe(rerouted.travelDistanceMm);
    expect(reemitted.cutDistanceMm).toBe(rerouted.cutDistanceMm);
  });

  it('hands back a placeholder result untouched rather than emitting over it', () => {
    const empty = emptyPcbLayout(base, 'No placeable components.');
    expect(reemitPcbGcode(empty, base)).toBe(empty);
  });
});

describe('padReliefPlan', () => {
  const CH = vBitWidthAtDepth(0.1, 30, -0.2);

  it('leaves no relief at all when the copper is not flooded', () => {
    // Without a flood the copper beside a pad is a dead island anyway.
    expect(padReliefPlan(0.5, CH, 0)).toEqual({ clearanceMm: 0, passes: 0 });
  });

  it('cannot make the ring narrower than the channel the bit already cuts', () => {
    const plan = padReliefPlan(0.05, CH, 0.6);
    expect(plan.passes).toBe(0);
    expect(plan.clearanceMm).toBeCloseTo(CH, 9);
  });

  it('rounds a wider request up to what a whole number of passes clears', () => {
    const step = CH * ISOLATION_STEPOVER;
    const plan = padReliefPlan(0.5, CH, 0.6);
    expect(plan.clearanceMm).toBeCloseTo(CH + plan.passes * step, 9);
    // Up, never down: the figure is a minimum, and the point of it is solder
    // not reaching the flood.
    expect(plan.clearanceMm).toBeGreaterThanOrEqual(0.5);
    expect(plan.clearanceMm - step).toBeLessThan(0.5);
  });

  it('bounds the passes a single number in a box can buy', () => {
    expect(padReliefPlan(50, CH, 0.6).passes).toBe(12);
  });
});

describe('a flooded pad keeps its footprint shape', () => {
  /*
   * The flood grows a net's copper outwards up to its budget. Grown from the
   * pad as well as the track, every pad swells into a blob the size of the
   * budget, flattened wherever a neighbour caught it; grown from the track
   * cut off at the pad's rim, the track's rounded end sits on the rim and
   * pokes out sideways as a shoulder. Grown from the track as routed - to the
   * pad centre - the fat track lands on the pad and the pad stays a pad.
   */
  const padR = 0.8;
  const pad = circlePoly(0, 0, padR);
  const track = strokeToPoly([{ x: 0, y: 0 }, { x: 6, y: 0 }], 0.4);
  const flood = 0.6;
  const { copper } = floodCopperByNet(new Map([['n', unionPolys([pad, ...track])]]), {
    maxFloodMm: flood,
    channelMm: 0.2,
    pads: [pad],
    padsByNet: new Map([['n', [pad]]]),
    seedsByNet: new Map([['n', track]]),
  });
  const polys = copper.get('n')!;

  it('floods the track to full width right up to the pad', () => {
    expect(pointInPolys(polys, { x: 3, y: 0.2 + flood - 0.02 })).toBe(true);
    expect(pointInPolys(polys, { x: padR + 0.05, y: 0.2 + flood - 0.05 })).toBe(true);
  });

  it('does not grow the pad on the side away from the track', () => {
    expect(pointInPolys(polys, { x: -padR - 0.05, y: 0 })).toBe(false);
    expect(pointInPolys(polys, { x: 0, y: padR + 0.05 })).toBe(false);
  });

  it('leaves no shoulder where the track meets the pad', () => {
    // Nothing near the pad beyond the pad itself and the fat track.
    const near = offsetPolys([pad], flood);
    const allowed = unionPolys([pad, ...offsetPolys(track, flood)]);
    const extra = differencePolys(
      differencePolys(polys, offsetPolys(allowed, 0.02)),
      differencePolys(polys, near)
    );
    expect(extra.reduce((a, p) => a + p.length, 0)).toBe(0);
  });
});

describe('the bare ring around a pad is milled, not just outlined', () => {
  /*
   * padClearanceMm holds the flood off a pad so solder cannot bridge to it.
   * Holding the flood off is only half the job: the isolation pass cuts a
   * channel at each *edge* of that ring, and unless the middle is cleared too
   * it stays on the blank as a rib of copper a channel's width from the pad —
   * which is the bridge the clearance was meant to prevent, moved outwards.
   * The symptom is a gap that visibly pinches as it reaches a pin, and it got
   * worse the more clearance you asked for.
   */
  const board = presets.basicBlink ?? Object.values(presets).find(p => p.nodes.length > 0)!;
  const options: PcbOptions = { ...DEFAULT_PCB_OPTIONS, autoGrowBoard: true };
  const result = generatePcbLayout(board.nodes as never, board.edges as never, options);

  /** The copper left on the blank once every isolation path has been cut. */
  const milledCopper = () => {
    const cut: Poly[] = [];
    for (const path of result.isolationPaths) {
      cut.push(...strokeToPoly(path.points, result.effectiveToolDiaMm));
    }
    const o = result.boardOriginMm;
    const blank = [
      rectPoly(
        o + result.boardWidthMm / 2,
        o + result.boardHeightMm / 2,
        result.boardWidthMm,
        result.boardHeightMm
      ),
    ];
    return differencePolys(blank, unionPolys(cut));
  };

  /** Copper that survives the mill but belongs to no net — leftover foil. */
  const strayCopper = (milled: Poly[]) => {
    const modelled: Poly[] = [];
    for (const polys of result.copperByNet!.values()) modelled.push(...polys);
    // A hair of tolerance: the pass is offset by exactly a tool radius, so
    // every net's own edge sits on the cut and Clipper rounds it either way.
    return differencePolys(milled, offsetPolys(unionPolys(modelled), 0.02));
  };

  const padPolys = () => {
    const byId = new Map(result.components.map(c => [c.id, c]));
    const margin = Math.max(0, options.padMarginMm ?? 0);
    return result.pads.flatMap(pad => {
      const comp = byId.get(pad.componentId);
      if (!comp) return [];
      return [padPolygon(pad, comp.rotationDeg, effectivePadMarginMm(comp.footprint, margin))];
    });
  };

  it('is wide enough to be worth having', () => {
    expect(result.padReliefMm).toBeGreaterThan(result.effectiveToolDiaMm);
  });

  it('leaves no unattached foil inside the ring around any pad', () => {
    const stray = strayCopper(milledCopper());
    const pads = padPolys();
    expect(pads.length).toBeGreaterThan(0);
    // The outermost pass cuts to exactly the relief, so the foil beyond it
    // shares an edge with the ring; a hair inside that edge is what matters.
    const ringed = pads.filter(pad =>
      polysOverlap(offsetPolys([pad], result.padReliefMm - 0.01), stray, 1e-6)
    );
    expect(ringed, `${ringed.length} of ${pads.length} pads still have foil in their relief`).toEqual([]);
  });
});
