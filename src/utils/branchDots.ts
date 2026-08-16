import type { Edge } from '@xyflow/react';

interface Point {
  x: number;
  y: number;
}

const EPS = 0.75;

// Unit axis direction of a (orthogonal) segment, or null for a zero-length one.
function segDir(a: Point, b: Point): Point | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) < EPS && Math.abs(dy) < EPS) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return { x: Math.sign(dx), y: 0 };
  return { x: 0, y: Math.sign(dy) };
}

/**
 * Where two wire polylines that start at the same pin stop sharing geometry.
 *
 * Walks both paths from the shared pin while their runs lie on top of each
 * other, splitting the longer run whenever the other one turns first. Returns
 * the last common point, or null when the paths part ways immediately at the
 * pin (nothing was shared, so there is no branch to mark).
 */
function divergencePoint(a: Point[], b: Point[]): Point | null {
  if (a.length < 2 || b.length < 2) return null;
  // Endpoints registered for the same port can disagree by a couple of px
  // (React Flow's handle center vs the clamped pin) — close enough to walk.
  if (Math.abs(a[0].x - b[0].x) + Math.abs(a[0].y - b[0].y) > 3) return null;

  let cur = a[0];
  let ia = 1;
  let ib = 1;

  while (ia < a.length && ib < b.length) {
    const da = segDir(cur, a[ia]);
    const db = segDir(cur, b[ib]);
    if (!da) { ia++; continue; }
    if (!db) { ib++; continue; }
    if (da.x !== db.x || da.y !== db.y) return cur;

    const lenA = Math.abs(a[ia].x - cur.x) + Math.abs(a[ia].y - cur.y);
    const lenB = Math.abs(b[ib].x - cur.x) + Math.abs(b[ib].y - cur.y);
    if (Math.abs(lenA - lenB) < EPS) {
      cur = a[ia];
      ia++;
      ib++;
    } else if (lenA < lenB) {
      // a turns first; b's segment keeps going from a's corner.
      cur = a[ia];
      ia++;
    } else {
      cur = b[ib];
      ib++;
    }
  }

  // One path ended while still riding the other: it terminates ON the shared
  // run, which is a T as well.
  return cur;
}

/**
 * Junction dots the schematic needs but no node draws.
 *
 * Same-net wires (edges sharing a port) deliberately route along one shared
 * trunk and branch late (see the trunk logic in AuraEdge), so the point where
 * the net visibly forks is wherever two of its wires stop overlapping — not
 * necessarily at any pin. Every pair of same-port paths, oriented to start at
 * the shared pin, gets a dot exactly at that divergence point. When wires
 * part ways right at the pin the divergence IS the pin, so genuine pin
 * fan-outs keep their dot with no special casing — and pins whose wires all
 * leave through one shared trunk correctly get none (the trunk carries them
 * as one visible wire; dotting the pin there reads as noise, e.g. "why does
 * the inductor have dots?").
 */
export function computeBranchDots(
  edges: Edge[],
  paths: Record<string, Point[]>
): Point[] {
  const byPort = new Map<string, Point[][]>();

  for (const e of edges) {
    const pts = paths[e.id];
    if (!pts || pts.length < 2) continue;
    const srcPort = `${e.source}-${e.sourceHandle || 'out'}`;
    const tgtPort = `${e.target}-${e.targetHandle || 'in'}`;
    if (!byPort.has(srcPort)) byPort.set(srcPort, []);
    byPort.get(srcPort)!.push(pts);
    if (!byPort.has(tgtPort)) byPort.set(tgtPort, []);
    byPort.get(tgtPort)!.push([...pts].reverse());
  }

  const dots: Point[] = [];
  const seen = new Set<string>();
  for (const group of byPort.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const p = divergencePoint(group[i], group[j]);
        if (!p) continue;
        const key = `${Math.round(p.x)},${Math.round(p.y)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        dots.push(p);
      }
    }
  }
  return dots;
}
