// ---------------------------------------------------------------------------
// PCB Copper Geometry Layer
// Polygon union / offset / difference on millimetre coordinates, backed by
// clipper-lib. Clipper works in integers, so everything is scaled to microns
// internally (1 unit = 1um) and scaled back on the way out.
//
// Holes are encoded by ring orientation, the same way Clipper returns them.
// Always pass a complete polygon SET through these helpers (never a single
// ring pulled out of a set) or holes will be lost.
// ---------------------------------------------------------------------------

import ClipperLib from 'clipper-lib';

/** A point in board space, millimetres. */
export interface Pt {
  x: number;
  y: number;
}

/** A polygon ring in board space, millimetres. */
export type Poly = Pt[];

/** Clipper integer units per millimetre. 1000 => 1 micron resolution. */
const SCALE = 1000;

/** Miter limit for offsetting. */
const MITER_LIMIT = 2;

/** Max deviation of an arc approximation, in Clipper units (5um). */
const ARC_TOLERANCE = 0.005 * SCALE;

type IntPt = { X: number; Y: number };

function toInt(poly: Poly): IntPt[] {
  return poly.map(p => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) }));
}

function fromInt(paths: IntPt[][]): Poly[] {
  const out: Poly[] = [];
  for (const path of paths) {
    if (!path || path.length < 3) continue;
    out.push(path.map(p => ({ x: p.X / SCALE, y: p.Y / SCALE })));
  }
  return out;
}

function runBoolean(
  subject: Poly[],
  clip: Poly[],
  clipType: number
): Poly[] {
  const c = new ClipperLib.Clipper();
  c.AddPaths(toInt2(subject), ClipperLib.PolyType.ptSubject, true);
  if (clip.length > 0) {
    c.AddPaths(toInt2(clip), ClipperLib.PolyType.ptClip, true);
  }
  const solution: IntPt[][] = [];
  c.Execute(
    clipType,
    solution,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero
  );
  return fromInt(solution);
}

function toInt2(polys: Poly[]): IntPt[][] {
  return polys.map(toInt);
}

/** Unions a set of polygons into non-overlapping outlines (holes preserved). */
export function unionPolys(polys: Poly[]): Poly[] {
  if (polys.length === 0) return [];
  return runBoolean(polys, [], ClipperLib.ClipType.ctUnion);
}

/** Subtracts `clip` from `subject`. */
export function differencePolys(subject: Poly[], clip: Poly[]): Poly[] {
  if (subject.length === 0) return [];
  if (clip.length === 0) return subject;
  return runBoolean(subject, clip, ClipperLib.ClipType.ctDifference);
}

/** Intersection of two polygon sets. */
export function intersectPolys(a: Poly[], b: Poly[]): Poly[] {
  if (a.length === 0 || b.length === 0) return [];
  return runBoolean(a, b, ClipperLib.ClipType.ctIntersection);
}

/**
 * Grows (positive delta) or shrinks (negative delta) closed polygons by
 * `deltaMm`, with rounded outside corners — what a round cutter physically
 * produces.
 */
export function offsetPolys(polys: Poly[], deltaMm: number): Poly[] {
  if (polys.length === 0) return [];
  if (Math.abs(deltaMm) < 1e-9) return polys;
  const co = new ClipperLib.ClipperOffset(MITER_LIMIT, ARC_TOLERANCE);
  co.AddPaths(
    toInt2(polys),
    ClipperLib.JoinType.jtRound,
    ClipperLib.EndType.etClosedPolygon
  );
  const solution: IntPt[][] = [];
  co.Execute(solution, deltaMm * SCALE);
  return fromInt(solution);
}

/**
 * Converts an open polyline of the given width into closed capsule polygons
 * (rounded ends) — the copper a trace of that width actually occupies.
 */
export function strokeToPoly(points: Pt[], widthMm: number): Poly[] {
  if (points.length < 2 || widthMm <= 0) return [];
  const co = new ClipperLib.ClipperOffset(MITER_LIMIT, ARC_TOLERANCE);
  co.AddPath(
    toInt(points),
    ClipperLib.JoinType.jtRound,
    ClipperLib.EndType.etOpenRound
  );
  const solution: IntPt[][] = [];
  co.Execute(solution, (widthMm / 2) * SCALE);
  return fromInt(solution);
}

/** Axis-aligned rectangle centred on (cx, cy). */
export function rectPoly(cx: number, cy: number, w: number, h: number): Poly {
  const hw = w / 2;
  const hh = h / 2;
  return [
    { x: cx - hw, y: cy - hh },
    { x: cx + hw, y: cy - hh },
    { x: cx + hw, y: cy + hh },
    { x: cx - hw, y: cy + hh },
  ];
}

/** Regular polygon approximation of a circle. */
export function circlePoly(cx: number, cy: number, r: number, segments = 32): Poly {
  const pts: Poly = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

/** Stadium/oval shape, long axis along whichever of w/h is larger. */
export function ovalPoly(cx: number, cy: number, w: number, h: number): Poly {
  const r = Math.min(w, h) / 2;
  const dx = Math.max(0, w / 2 - r);
  const dy = Math.max(0, h / 2 - r);
  if (dx < 1e-9 && dy < 1e-9) return circlePoly(cx, cy, r);
  const caps = strokeToPoly(
    [
      { x: cx - dx, y: cy - dy },
      { x: cx + dx, y: cy + dy },
    ],
    r * 2
  );
  return caps.length > 0 ? caps[0] : rectPoly(cx, cy, w, h);
}

/** Signed area of a ring. Negative for holes (opposite winding). */
export function polyArea(poly: Poly): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/**
 * Net area enclosed by a polygon SET, with holes subtracted.
 * Sums signed ring areas, so a set must be passed in whole.
 */
export function totalArea(polys: Poly[]): number {
  return Math.abs(polys.reduce((sum, p) => sum + polyArea(p), 0));
}

/**
 * True when two polygon sets overlap by more than `toleranceMm2`.
 * Used for design-rule checks (cross-net shorts, footprint collisions).
 */
export function polysOverlap(a: Poly[], b: Poly[], toleranceMm2 = 1e-6): boolean {
  if (a.length === 0 || b.length === 0) return false;
  return totalArea(intersectPolys(a, b)) > toleranceMm2;
}

/** Axis-aligned bounds of a polygon set. */
export function polysBounds(
  polys: Poly[]
): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of polys) {
    for (const p of poly) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return { minX, minY, maxX, maxY };
}

/** True if point is inside the polygon set (holes respected). */
export function pointInPolys(polys: Poly[], pt: Pt): boolean {
  let winding = 0;
  for (const poly of polys) {
    const res = ClipperLib.Clipper.PointInPolygon(
      { X: Math.round(pt.x * SCALE), Y: Math.round(pt.y * SCALE) },
      toInt(poly)
    );
    if (res !== 0) winding += polyArea(poly) >= 0 ? 1 : -1;
  }
  return winding > 0;
}

/** Formats a polygon ring as an SVG path `d` fragment. */
export function polyToSvgPath(poly: Poly): string {
  if (poly.length === 0) return '';
  const head = `M ${poly[0].x.toFixed(3)} ${poly[0].y.toFixed(3)}`;
  const tail = poly
    .slice(1)
    .map(p => `L ${p.x.toFixed(3)} ${p.y.toFixed(3)}`)
    .join(' ');
  return `${head} ${tail} Z`;
}

/**
 * Formats a whole polygon set as one SVG path. Combined with
 * `fill-rule="evenodd"` this renders holes correctly.
 */
export function polysToSvgPath(polys: Poly[]): string {
  return polys.map(polyToSvgPath).join(' ');
}
