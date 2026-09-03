/**
 * A wire has to end on the pin it is drawn to.
 *
 * The router works on a snapped grid while handles sit wherever the node's
 * layout puts them, so a part moved by one snap step leaves the two a couple of
 * pixels apart on the cross axis. That remainder must be absorbed into a corner,
 * never left as a wire that stops beside the pin instead of on it.
 */
import { describe, it, expect } from 'vitest';
import { routeOrthogonal, ensureTerminals } from '../src/components/AuraEdge';

/** The points of a path, as `M x y L x y …`. */
function pointsOf(path: string): { x: number; y: number }[] {
  const nums = (path.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
  return pts;
}

const route = (sx: number, sy: number, sp: string, tx: number, ty: number, tp: string) =>
  routeOrthogonal({
    sourceX: sx, sourceY: sy, sourcePosition: sp,
    targetX: tx, targetY: ty, targetPosition: tp,
  });

describe('a wire lands on its pin', () => {
  // A handful of cross-axis offsets, including the sub-grid ones a single snap
  // step produces — which is where the wire used to stop short.
  const offsets = [0, 1, 2, 3, 4, 5, 7, 8, 13, 26];

  describe.each(offsets)('with the target %ipx off the source axis', off => {
    it('ends exactly on a horizontal target pin', () => {
      const path = route(200, 160, 'right', 350, 160 + off, 'left');
      if (!path) return; // no route found is a separate failure mode
      const pts = pointsOf(path);
      const end = pts[pts.length - 1];
      expect(end.x, `path: ${path}`).toBeCloseTo(350, 3);
      expect(end.y, `path: ${path}`).toBeCloseTo(160 + off, 3);
    });

    it('ends exactly on a vertical target pin', () => {
      const path = route(160, 200, 'bottom', 160 + off, 350, 'top');
      if (!path) return;
      const pts = pointsOf(path);
      const end = pts[pts.length - 1];
      expect(end.x, `path: ${path}`).toBeCloseTo(160 + off, 3);
      expect(end.y, `path: ${path}`).toBeCloseTo(350, 3);
    });
  });

  it('starts exactly on the source pin', () => {
    for (const off of offsets) {
      const path = route(200, 160, 'right', 350, 160 + off, 'left');
      if (!path) continue;
      const start = pointsOf(path)[0];
      expect(start.x, `offset ${off}`).toBeCloseTo(200, 3);
      expect(start.y, `offset ${off}`).toBeCloseTo(160, 3);
    }
  });

  it('stays orthogonal — no segment runs diagonally', () => {
    for (const off of offsets) {
      const path = route(200, 160, 'right', 350, 160 + off, 'left');
      if (!path) continue;
      const pts = pointsOf(path);
      for (let i = 1; i < pts.length; i++) {
        const dx = Math.abs(pts[i].x - pts[i - 1].x);
        const dy = Math.abs(pts[i].y - pts[i - 1].y);
        expect(dx < 0.01 || dy < 0.01, `offset ${off} has a diagonal: ${path}`).toBe(true);
      }
    }
  });
});

describe('ensureTerminals', () => {
  const points = (p: string) => pointsOf(p);

  it('adds the missing final step when a path stops beside the pin', () => {
    // The reported fault: the run is level with the source and finishes at the
    // target's x, a few pixels below the lead it is drawn to.
    const stopped = 'M 200 160 L 350 160';
    const fixed = ensureTerminals(stopped, 200, 160, 'right', 350, 164, 'left');
    const pts = points(fixed);
    const end = pts[pts.length - 1];
    expect(end).toEqual({ x: 350, y: 164 });
  });

  it('enters a side pin horizontally', () => {
    const fixed = ensureTerminals('M 200 160 L 350 160', 200, 160, 'right', 350, 164, 'left');
    const pts = points(fixed);
    const [a, b] = [pts[pts.length - 2], pts[pts.length - 1]];
    expect(a.y, `final run must be horizontal: ${fixed}`).toBeCloseTo(b.y, 6);
  });

  it('enters a top or bottom pin vertically', () => {
    const fixed = ensureTerminals('M 160 200 L 160 350', 160, 200, 'bottom', 164, 350, 'top');
    const pts = points(fixed);
    const [a, b] = [pts[pts.length - 2], pts[pts.length - 1]];
    expect(a.x, `final run must be vertical: ${fixed}`).toBeCloseTo(b.x, 6);
    expect(pts[pts.length - 1]).toEqual({ x: 164, y: 350 });
  });

  it('fixes the source end the same way', () => {
    const fixed = ensureTerminals('M 200 164 L 350 164', 200, 160, 'right', 350, 164, 'left');
    expect(points(fixed)[0]).toEqual({ x: 200, y: 160 });
  });

  it('leaves an already-correct path alone', () => {
    const good = 'M 200 160 L 275 160 L 275 164 L 350 164';
    expect(ensureTerminals(good, 200, 160, 'right', 350, 164, 'left')).toBe(good);
  });

  it('keeps every segment orthogonal', () => {
    for (const off of [1, 2, 3, 4, 7, 26]) {
      const fixed = ensureTerminals('M 200 160 L 350 160', 200, 160, 'right', 350, 160 + off, 'left');
      const pts = points(fixed);
      for (let i = 1; i < pts.length; i++) {
        const dx = Math.abs(pts[i].x - pts[i - 1].x);
        const dy = Math.abs(pts[i].y - pts[i - 1].y);
        expect(dx < 0.01 || dy < 0.01, `offset ${off}: ${fixed}`).toBe(true);
      }
    }
  });

  it('passes a degenerate path through untouched', () => {
    expect(ensureTerminals('M 10 10', 10, 10, 'right', 10, 10, 'left')).toBe('M 10 10');
  });
});
