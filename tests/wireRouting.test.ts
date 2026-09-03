/**
 * A wire has to end on the pin it is drawn to.
 *
 * The canvas snaps parts to a 4px grid, and node heights are not all even, so a
 * part nudged one step can leave its pin a few pixels off its neighbour's on the
 * cross axis. The router took a shortcut for that case and drew the run at the
 * *source's* coordinate, finishing beside the target pin rather than on it —
 * which looked like a wire that had come adrift from a resistor, and healed
 * itself if the part was dragged further.
 */
import { describe, it, expect } from 'vitest';
import { getSchematicPath, routeOrthogonal } from '../src/components/AuraEdge';

/** The points of an `M x y L x y …` path. */
function pointsOf(path: string): { x: number; y: number }[] {
  const nums = (path.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
  return pts;
}

/** Two bodies with a pin each, far enough apart for a clear shot. */
function twoNodes(srcY: number, tgtY: number) {
  return [
    { id: 'a', type: 'signalgen', position: { x: 100, y: srcY }, data: {}, measured: { width: 88, height: 58 } },
    { id: 'b', type: 'resistor', position: { x: 300, y: tgtY }, data: {}, measured: { width: 40, height: 24 } },
  ];
}

const horizontalPath = (srcPinY: number, tgtPinY: number) =>
  getSchematicPath({
    sourceX: 188, sourceY: srcPinY, sourcePosition: 'right',
    targetX: 300, targetY: tgtPinY, targetPosition: 'left',
    nodes: twoNodes(srcPinY - 29, tgtPinY - 12), sourceId: 'a', targetId: 'b',
  });

describe('a near-miss straight shot still lands on both pins', () => {
  // 0 is the aligned case; 1-4 is the window a single 4px snap step lands in,
  // and is where the wire used to come adrift.
  it.each([0, 1, 2, 3, 4])('with the pins %ipx apart on the cross axis', off => {
    const path = horizontalPath(165, 165 + off);
    const pts = pointsOf(path);
    expect(pts[0], `path: ${path}`).toEqual({ x: 188, y: 165 });
    expect(pts[pts.length - 1], `path: ${path}`).toEqual({ x: 300, y: 165 + off });
  });

  it('stays orthogonal while doing it', () => {
    for (const off of [0, 1, 2, 3, 4]) {
      const path = horizontalPath(165, 165 + off);
      const pts = pointsOf(path);
      for (let i = 1; i < pts.length; i++) {
        const dx = Math.abs(pts[i].x - pts[i - 1].x);
        const dy = Math.abs(pts[i].y - pts[i - 1].y);
        expect(dx < 0.01 || dy < 0.01, `offset ${off} runs diagonally: ${path}`).toBe(true);
      }
    }
  });

  it('draws a single straight run when the pins really are aligned', () => {
    // No kink where none is needed.
    expect(pointsOf(horizontalPath(165, 165))).toHaveLength(2);
  });

  it('puts the step in open space, not against a symbol', () => {
    const pts = pointsOf(horizontalPath(165, 167));
    const stepX = pts[1].x;
    expect(stepX).toBeGreaterThan(188 + 8);
    expect(stepX).toBeLessThan(300 - 8);
  });
});

describe('routeOrthogonal', () => {
  const route = (sx: number, sy: number, sp: string, tx: number, ty: number, tp: string) =>
    routeOrthogonal({
      sourceX: sx, sourceY: sy, sourcePosition: sp,
      targetX: tx, targetY: ty, targetPosition: tp,
    });

  it.each([0, 1, 2, 3, 4, 5, 7, 8, 13, 26])('lands on the pin %ipx off axis', off => {
    const path = route(200, 160, 'right', 350, 160 + off, 'left');
    if (!path) return;
    const pts = pointsOf(path);
    expect(pts[pts.length - 1].x, `path: ${path}`).toBeCloseTo(350, 3);
    expect(pts[pts.length - 1].y, `path: ${path}`).toBeCloseTo(160 + off, 3);
  });
});
