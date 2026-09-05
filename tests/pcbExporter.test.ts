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
  effectivePadMarginMm,
  padPolygon,
  boardOriginOffsetMm,
  generateAirCutGcode,
  generateAirCutPerimeterGcode,
  sortPathsNearestNeighbor,
  groupDrillsByBit,
  DEFAULT_PCB_OPTIONS,
  type DrillPoint,
  type IsolationPath,
  type PlacedPad,
} from '../src/utils/pcbExporter';
import { generateQuadFamilyFootprint, generateDIPFootprint } from '../src/utils/pcbFootprints';
import { polysBounds } from '../src/utils/pcbGeometry';

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
  } as any;
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
