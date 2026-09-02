/**
 * The solder paste stencil.
 *
 * The area ratio decides whether paste stays on the pad or lifts away with the
 * stencil, and the STL is a byte format a slicer either reads or does not.
 */
import { describe, it, expect } from 'vitest';
import {
  apertureAreaRatio,
  trianglesToBinaryStl,
  STENCIL_SVG_COLOR,
  DEFAULT_PASTE_STENCIL_OPTIONS,
  DEFAULT_PASTE_SHIM_OPTIONS,
} from '../src/utils/pcbPasteStencil';
import { rectPoly, circlePoly } from '../src/utils/pcbGeometry';

describe('apertureAreaRatio', () => {
  it('is side over four thicknesses for a square aperture', () => {
    // area / (perimeter * t) = s^2 / (4s*t) = s / 4t
    expect(apertureAreaRatio(rectPoly(0, 0, 1, 1), 0.1)).toBeCloseTo(1 / 0.4, 6);
  });

  it('is diameter over four thicknesses for a round one', () => {
    // area / (perimeter * t) = (pi d^2/4) / (pi d t) = d / 4t
    expect(apertureAreaRatio(circlePoly(0, 0, 0.5, 512), 0.1)).toBeCloseTo(1 / 0.4, 3);
  });

  it('falls as the stencil gets thicker', () => {
    const ap = rectPoly(0, 0, 0.5, 0.5);
    expect(apertureAreaRatio(ap, 0.2)).toBeLessThan(apertureAreaRatio(ap, 0.1));
  });

  it('puts a small aperture on a thick stencil below the 0.66 release threshold', () => {
    // Below about 0.66 the walls hold more paste than the floor and the deposit
    // lifts away with the stencil.
    const tiny = rectPoly(0, 0, 0.25, 0.25);
    expect(apertureAreaRatio(tiny, 0.15)).toBeLessThan(0.66);
    // The same aperture on foil thin enough releases.
    expect(apertureAreaRatio(tiny, 0.05)).toBeGreaterThan(0.66);
  });

  it('is unaffected by where the aperture sits on the board', () => {
    expect(apertureAreaRatio(rectPoly(0, 0, 1, 1), 0.1))
      .toBeCloseTo(apertureAreaRatio(rectPoly(37, -12, 1, 1), 0.1), 9);
  });

  it('reports a degenerate aperture as unconstrained rather than dividing by zero', () => {
    expect(apertureAreaRatio(rectPoly(0, 0, 1, 1), 0)).toBe(Infinity);
    expect(apertureAreaRatio([], 0.1)).toBe(Infinity);
  });
});

describe('trianglesToBinaryStl', () => {
  // A single unit triangle in the XY plane, wound counter-clockwise.
  const tri = { a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0] } as never;

  it('writes the 84-byte header plus 50 bytes a triangle', () => {
    expect(trianglesToBinaryStl([tri]).byteLength).toBe(84 + 50);
    expect(trianglesToBinaryStl([tri, tri, tri]).byteLength).toBe(84 + 150);
  });

  it('stores the triangle count little-endian at offset 80', () => {
    const bytes = trianglesToBinaryStl([tri, tri]);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(80, true)).toBe(2);
  });

  it('emits a valid empty solid for no triangles', () => {
    const bytes = trianglesToBinaryStl([]);
    expect(bytes.byteLength).toBe(84);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(80, true)).toBe(0);
  });

  it('writes a unit normal and the three vertices as given', () => {
    const bytes = trianglesToBinaryStl([tri]);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const n = [view.getFloat32(84, true), view.getFloat32(88, true), view.getFloat32(92, true)];
    expect(Math.hypot(...n)).toBeCloseTo(1, 5);
    // Counter-clockwise in XY faces +Z.
    expect(n[2]).toBeCloseTo(1, 5);

    expect(view.getFloat32(96, true)).toBeCloseTo(0, 6);
    expect(view.getFloat32(108, true)).toBeCloseTo(1, 6);   // b.x
    expect(view.getFloat32(124, true)).toBeCloseTo(1, 6);   // c.y
  });

  it('zeroes the attribute byte count, which some slicers reject if set', () => {
    const bytes = trianglesToBinaryStl([tri]);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint16(84 + 48, true)).toBe(0);
  });

  it('truncates an overlong header instead of overrunning into the count', () => {
    const bytes = trianglesToBinaryStl([tri], 'x'.repeat(300));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(80, true)).toBe(1);
    // Byte 79 is the last header byte; 80 onward is the count.
    expect(bytes[79]).toBe(0);
  });

  it('keeps the header to 7-bit ASCII', () => {
    const bytes = trianglesToBinaryStl([tri], 'café ✓');
    for (let i = 0; i < 80; i++) expect(bytes[i]).toBeLessThanOrEqual(0x7f);
  });

  it('degenerates to a zero normal rather than NaN', () => {
    // Three collinear points have no plane; NaN in an STL crashes slicers.
    const flat = { a: [0, 0, 0], b: [1, 0, 0], c: [2, 0, 0] } as never;
    const bytes = trianglesToBinaryStl([flat]);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (const off of [84, 88, 92]) expect(Number.isNaN(view.getFloat32(off, true))).toBe(false);
  });
});

describe('defaults', () => {
  it('cuts the stencil artwork in a colour a laser cutter reads as a cut', () => {
    expect(STENCIL_SVG_COLOR).toBe('#ff0000');
  });

  it('ships a stencil thickness that releases an ordinary chip pad', () => {
    const t = (DEFAULT_PASTE_STENCIL_OPTIONS as { thicknessMm: number }).thicknessMm;
    expect(t).toBeGreaterThan(0);
    // An 0603 pad is about 1.0 x 0.9mm; it must clear 0.66 at the default.
    expect(apertureAreaRatio(rectPoly(0, 0, 1.0, 0.9), t)).toBeGreaterThan(0.66);
  });

  it('gives the shim a margin, so it is not cut to the same size as the board', () => {
    const m = (DEFAULT_PASTE_SHIM_OPTIONS as { marginMm?: number }).marginMm;
    if (m !== undefined) expect(m).toBeGreaterThan(0);
  });
});
