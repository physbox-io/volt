/**
 * The polygon kernel every copper operation is built on.
 *
 * Isolation milling, pad growth, flood fill and the paste stencil all reduce to
 * these calls, so an error here is silent and reaches the board.
 */
import { describe, it, expect } from 'vitest';
import {
  unionPolys,
  differencePolys,
  intersectPolys,
  offsetPolys,
  strokeToPoly,
  rectPoly,
  circlePoly,
  ovalPoly,
  polyArea,
  totalArea,
  polysOverlap,
  polysBounds,
  pointInPolys,
  polyToSvgPath,
  polysToSvgPath,
} from '../src/utils/pcbGeometry';

describe('primitive builders', () => {
  it('builds a rectangle of exactly the requested size, centred', () => {
    const r = rectPoly(0, 0, 4, 2);
    expect(Math.abs(polyArea(r))).toBeCloseTo(8, 6);
    const b = polysBounds([r]);
    expect(b).toEqual({ minX: -2, minY: -1, maxX: 2, maxY: 1 });
  });

  it('approximates a circle from the inside, converging as segments rise', () => {
    // A regular polygon inscribed in the circle always under-reports the area;
    // what matters is that it converges rather than overshooting, or pads come
    // out larger than the drill they surround.
    const coarse = Math.abs(polyArea(circlePoly(0, 0, 1, 8)));
    const fine = Math.abs(polyArea(circlePoly(0, 0, 1, 256)));
    expect(coarse).toBeLessThan(fine);
    expect(fine).toBeLessThanOrEqual(Math.PI + 1e-9);
    expect(fine).toBeCloseTo(Math.PI, 3);
  });

  it('centres an oval on the point it is given', () => {
    const o = ovalPoly(5, -3, 4, 2);
    const b = polysBounds([o]);
    expect((b.minX + b.maxX) / 2).toBeCloseTo(5, 6);
    expect((b.minY + b.maxY) / 2).toBeCloseTo(-3, 6);
    expect(b.maxX - b.minX).toBeCloseTo(4, 6);
    expect(b.maxY - b.minY).toBeCloseTo(2, 6);
  });
});

describe('boolean operations', () => {
  it('unions two overlapping squares into one region of the merged area', () => {
    const a = rectPoly(0, 0, 2, 2);
    const b = rectPoly(1, 0, 2, 2);
    const u = unionPolys([a, b]);
    // 4 + 4 less the 1x2 overlap.
    expect(totalArea(u)).toBeCloseTo(6, 4);
  });

  it('subtracts a hole and keeps the ring area', () => {
    const outer = rectPoly(0, 0, 10, 10);
    const hole = rectPoly(0, 0, 4, 4);
    const ring = differencePolys([outer], [hole]);
    expect(totalArea(ring)).toBeCloseTo(100 - 16, 4);
  });

  it('intersects to the shared region only', () => {
    const a = rectPoly(0, 0, 2, 2);
    const b = rectPoly(1, 0, 2, 2);
    expect(totalArea(intersectPolys([a], [b]))).toBeCloseTo(2, 4);
  });

  it('reports disjoint shapes as not intersecting', () => {
    const a = rectPoly(0, 0, 2, 2);
    const far = rectPoly(50, 50, 2, 2);
    expect(totalArea(intersectPolys([a], [far]))).toBeCloseTo(0, 6);
  });
});

describe('offsetPolys', () => {
  it('grows and shrinks by the requested amount', () => {
    const sq = rectPoly(0, 0, 10, 10);
    const grown = polysBounds(offsetPolys([sq], 1));
    expect(grown.maxX - grown.minX).toBeGreaterThan(11.5);
    expect(grown.maxX - grown.minX).toBeLessThanOrEqual(12.001);

    const shrunk = polysBounds(offsetPolys([sq], -1));
    expect(shrunk.maxX - shrunk.minX).toBeCloseTo(8, 1);
  });

  it('erases a shape shrunk by more than its own half-width', () => {
    // The isolation planner relies on this: an island narrower than the tool
    // must disappear rather than come back as an inside-out polygon.
    const thin = rectPoly(0, 0, 1, 1);
    expect(offsetPolys([thin], -2)).toHaveLength(0);
  });
});

describe('polysOverlap', () => {
  it('is the cross-net short test, and ignores a shared edge', () => {
    const a = rectPoly(0, 0, 2, 2);
    const b = rectPoly(1, 0, 2, 2);
    expect(polysOverlap([a], [b])).toBe(true);

    // Abutting exactly: touching, not shorted.
    const touching = rectPoly(2, 0, 2, 2);
    expect(polysOverlap([a], [touching])).toBe(false);
  });

  it('is false against an empty set', () => {
    expect(polysOverlap([], [rectPoly(0, 0, 1, 1)])).toBe(false);
    expect(polysOverlap([rectPoly(0, 0, 1, 1)], [])).toBe(false);
  });
});

describe('strokeToPoly', () => {
  it('turns a trace centreline into copper at least as wide as requested', () => {
    const poly = strokeToPoly([{ x: 0, y: 0 }, { x: 10, y: 0 }], 0.4);
    const b = polysBounds(poly);
    expect(b.maxY - b.minY).toBeGreaterThanOrEqual(0.4 - 1e-6);
    // The run itself, plus the end caps.
    expect(b.maxX - b.minX).toBeGreaterThanOrEqual(10 - 1e-6);
    expect(totalArea(poly)).toBeGreaterThan(10 * 0.4 * 0.9);
  });
});

describe('pointInPolys', () => {
  it('separates inside from outside', () => {
    const sq = [rectPoly(0, 0, 10, 10)];
    expect(pointInPolys(sq, { x: 0, y: 0 })).toBe(true);
    expect(pointInPolys(sq, { x: 20, y: 0 })).toBe(false);
  });

  it('reports a point in a hole as outside the copper', () => {
    const ring = differencePolys([rectPoly(0, 0, 10, 10)], [rectPoly(0, 0, 4, 4)]);
    expect(pointInPolys(ring, { x: 0, y: 0 })).toBe(false);
    expect(pointInPolys(ring, { x: 4, y: 0 })).toBe(true);
  });
});

describe('SVG emission', () => {
  it('emits a closed path per ring', () => {
    const d = polyToSvgPath(rectPoly(0, 0, 2, 2));
    expect(d.startsWith('M')).toBe(true);
    expect(d.trimEnd().endsWith('Z')).toBe(true);
  });

  it('concatenates a set into one path with a subpath each', () => {
    const d = polysToSvgPath([rectPoly(0, 0, 2, 2), rectPoly(10, 0, 2, 2)]);
    expect((d.match(/M/g) || []).length).toBe(2);
    expect((d.match(/Z/g) || []).length).toBe(2);
  });

  it('emits nothing for an empty set', () => {
    expect(polysToSvgPath([])).toBe('');
  });
});
