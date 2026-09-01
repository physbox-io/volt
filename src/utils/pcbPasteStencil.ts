// ---------------------------------------------------------------------------
// Printable Solder Paste Stencil
//
// A sheet the size of the board with an aperture over every SMD pad. Lay it on
// the copper, squeegee paste across it, lift it off, place the parts, reflow.
//
// Three numbers decide whether a stencil works, and all three fight thickness:
//
//   * Deposit volume is aperture area times thickness. Commercial stencils are
//     0.10-0.15mm; at 0.6mm you lay down four times the paste and every joint
//     bridges. So this part is as thin as FDM can hold — one or two layers.
//   * Area ratio — aperture floor area over aperture wall area — has to clear
//     about 0.66 or the paste stays in the hole instead of on the pad. It is
//     inversely proportional to thickness, which is the same argument again.
//   * An aperture is a hole in a printed wall, so nothing much under a nozzle
//     width comes out the size it was drawn.
//
// Which is why this is honest down to roughly SOIC/1.27mm pitch and no
// further. Finer than that wants a laser-cut foil; the checks below say so
// rather than letting someone reflow a bridged board to find out.
// ---------------------------------------------------------------------------

import {
  differencePolys,
  intersectPolys,
  unionPolys,
  rectPoly,
  polyArea,
  type Poly,
} from './pcbGeometry';
import {
  effectivePadMarginMm,
  padPolygon,
  type PcbLayoutResult,
  type PcbOptions,
} from './pcbExporter';

export interface PasteStencilOptions {
  /**
   * Sheet thickness in mm, which *is* the paste deposit height — the number
   * that decides whether the board reflows or bridges. How many layers that
   * comes out as is the slicer's business.
   */
  thicknessMm: number;
  /**
   * How much smaller than the pad each aperture is cut, per side, in mm.
   *
   * Stencil apertures are reduced, never grown. Paste slumps outward when it
   * is placed and again when it melts, so an aperture the full size of the pad
   * puts solder past the pad edge — which is where bridges start on a
   * hand-squeegeed board. Capped below so a small pad is not shrunk away.
   */
  apertureShrinkMm: number;
  /**
   * Corner brackets that drop over the board edge and hold the sheet in
   * register. 'none' leaves a plain sheet to tape down.
   */
  registration: 'corners' | 'none';
  /** Length of each bracket arm along the board edge, mm. */
  cornerArmMm: number;
  /** How far the bracket wall stands proud of the sheet, mm. */
  cornerHeightMm: number;
  /** Thickness of the bracket wall, mm. */
  wallMm: number;
  /**
   * Clearance between the bracket and the board edge, per side, in mm.
   *
   * Generous on purpose: a milled board comes off the machine with the stubs
   * of its holding tabs still on the edge, and a bracket cut to a nominal fit
   * lands on a stub and holds the whole sheet off the copper.
   */
  fitMm: number;
  /**
   * Height of a scan row, in mm. The solid is decomposed into row-aligned
   * boxes, so this is the stair step on any edge that is not vertical.
   */
  resolutionMm: number;
}

export const DEFAULT_PASTE_STENCIL_OPTIONS: PasteStencilOptions = {
  // As close to a 0.15mm commercial foil as an FDM machine gets while still
  // printing a sheet that survives being peeled off the bed. Scale the part up
  // in the slicer if a thicker deposit is wanted.
  thicknessMm: 0.2,
  apertureShrinkMm: 0.05,
  registration: 'corners',
  cornerArmMm: 6,
  cornerHeightMm: 1.6,
  wallMm: 1.2,
  fitMm: 0.3,
  resolutionMm: 0.08,
};

/**
 * Minimum area ratio — aperture floor area / aperture wall area — for paste to
 * release from the aperture rather than stay in it. IPC-7525's figure.
 */
const MIN_AREA_RATIO = 0.66;

/**
 * Narrowest aperture an FDM machine reproduces at anything like its drawn
 * size. Below roughly a nozzle width the two wall traces either side of the
 * hole merge into one and the aperture closes; 0.5mm is the smallest that
 * survives on the nozzles people actually have fitted.
 */
const MIN_APERTURE_MM = 0.5;

/** An aperture is never shrunk past this fraction of the pad's short side. */
const MAX_SHRINK_FRACTION = 0.15;

export interface PasteStencilResult {
  /** Binary STL, millimetres, Z up. */
  stl: Uint8Array;
  triangleCount: number;
  /** Apertures cut into the sheet. */
  apertureCount: number;
  /** THT pads deliberately left closed. */
  skippedThtPads: number;
  thicknessMm: number;
  /** Sheet outline, larger than the board by the registration brackets. */
  widthMm: number;
  heightMm: number;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Outline
// ---------------------------------------------------------------------------

interface Aperture {
  poly: Poly;
  /** Short side of the pad this came from, mm. Drives the printability check. */
  padShortMm: number;
}

export interface StencilArtwork {
  /** One closed ring per aperture, in board coordinates. */
  apertures: Poly[];
  /** The sheet's outer edge, in board coordinates. */
  outline: Poly;
  /** THT pads deliberately left closed. */
  skippedThtPads: number;
}

/**
 * The stencil as flat geometry: what to cut, and the edge to cut it out of.
 *
 * Shared by the STL and the SVG so a printed stencil and a laser-cut one are
 * the same part. Nothing here is compensated for a tool: these are the
 * apertures as designed, and taking a kerf or a nozzle width off them is the
 * job of whatever machine is going to make it.
 */
export function pasteStencilArtwork(
  result: PcbLayoutResult,
  options: PcbOptions,
  stencilOptions: Partial<PasteStencilOptions> = {}
): StencilArtwork {
  const stencil: PasteStencilOptions = { ...DEFAULT_PASTE_STENCIL_OPTIONS, ...stencilOptions };
  const { list, skippedTht } = apertures(result, options, stencil);
  return {
    apertures: list.map(a => a.poly),
    outline: sheetOutline(result, stencil),
    skippedThtPads: skippedTht,
  };
}

/**
 * One aperture per SMD pad.
 *
 * Through-hole pads get none. Paste in a plated hole does not make a joint —
 * it drops through, and on this board there is no plating to hold it anyway.
 * THT parts on a stencilled board are soldered by hand afterwards.
 */
function apertures(
  result: PcbLayoutResult,
  options: PcbOptions,
  stencil: PasteStencilOptions
): { list: Aperture[]; skippedTht: number } {
  const rotationById = new Map<string, 0 | 90>();
  const footprintById = new Map<string, (typeof result.components)[number]['footprint']>();
  for (const comp of result.components) {
    rotationById.set(comp.id, comp.rotationDeg);
    footprintById.set(comp.id, comp.footprint);
  }

  const padMargin = options.padMarginMm ?? 0;
  const list: Aperture[] = [];
  let skippedTht = 0;

  for (const pad of result.pads) {
    if (pad.spec.drillDiameter > 0) {
      skippedTht++;
      continue;
    }
    const footprint = footprintById.get(pad.componentId);
    // Measured against the copper that actually gets milled, margin included,
    // since that is the pad the paste has to land on.
    const copperMargin = footprint ? effectivePadMarginMm(footprint, padMargin) : 0;
    const shortSide = Math.min(pad.spec.padWidth, pad.spec.padHeight) + copperMargin * 2;
    const shrink = Math.min(stencil.apertureShrinkMm, shortSide * MAX_SHRINK_FRACTION);
    list.push({
      poly: padPolygon(pad, rotationById.get(pad.componentId) ?? 0, copperMargin - shrink),
      padShortMm: shortSide - shrink * 2,
    });
  }

  return { list, skippedTht };
}

/** Outer edge of the sheet: the board plus whatever the brackets need. */
function sheetOutline(result: PcbLayoutResult, stencil: PasteStencilOptions): Poly {
  const pad =
    stencil.registration === 'corners' ? stencil.fitMm + stencil.wallMm : stencil.wallMm;
  const o = result.boardOriginMm;
  return rectPoly(
    o + result.boardWidthMm / 2,
    o + result.boardHeightMm / 2,
    result.boardWidthMm + pad * 2,
    result.boardHeightMm + pad * 2
  );
}

/**
 * The L-shaped walls that hold the sheet in register.
 *
 * Corners, not a full skirt, and not the edge midpoints: the profile pass
 * leaves its holding tabs part way along each edge, so those are the four
 * places on the outline whose size cannot be trusted. The corners come off the
 * machine exact.
 */
function registrationBrackets(
  result: PcbLayoutResult,
  stencil: PasteStencilOptions
): Poly[] {
  if (stencil.registration !== 'corners') return [];

  const o = result.boardOriginMm;
  const w = result.boardWidthMm;
  const h = result.boardHeightMm;
  const inner = rectPoly(
    o + w / 2,
    o + h / 2,
    w + stencil.fitMm * 2,
    h + stencil.fitMm * 2
  );
  const ring = differencePolys([sheetOutline(result, stencil)], [inner]);

  const arm = stencil.cornerArmMm + stencil.wallMm;
  const corners: [number, number][] = [
    [o, o],
    [o + w, o],
    [o, o + h],
    [o + w, o + h],
  ];
  return corners.flatMap(([cx, cy]) =>
    intersectPolys(ring, [rectPoly(cx, cy, arm * 2, arm * 2)])
  );
}

// ---------------------------------------------------------------------------
// Solid
// ---------------------------------------------------------------------------

type Span = { x0: number; x1: number };

/**
 * Horizontal spans covered by `polys` at height `y`.
 *
 * Non-zero winding, matching the fill rule the geometry layer clips with: an
 * outer ring and the hole inside it wind opposite ways, so a crossing count
 * that carries direction is what tells an aperture from the sheet around it.
 */
function spansAt(polys: Poly[], y: number): Span[] {
  const crossings: { x: number; dir: number }[] = [];
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      if (a.y === b.y) continue;
      // Half-open in y, so a vertex exactly on the scan line is counted once.
      if ((a.y <= y) === (b.y <= y)) continue;
      crossings.push({
        x: a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x),
        dir: b.y > a.y ? 1 : -1,
      });
    }
  }
  if (crossings.length < 2) return [];
  crossings.sort((p, q) => p.x - q.x);

  const spans: Span[] = [];
  let winding = 0;
  for (let i = 0; i < crossings.length - 1; i++) {
    winding += crossings[i].dir;
    if (winding === 0) continue;
    const x0 = crossings[i].x;
    const x1 = crossings[i + 1].x;
    if (x1 - x0 < 1e-6) continue;
    // Coalesce spans that meet, so a straight run is one box and not two.
    const last = spans[spans.length - 1];
    if (last && x0 - last.x1 < 1e-6) last.x1 = x1;
    else spans.push({ x0, x1 });
  }
  return spans;
}

function sameSpans(a: Span[], b: Span[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i].x0 - b[i].x0) > 1e-6 || Math.abs(a[i].x1 - b[i].x1) > 1e-6) return false;
  }
  return true;
}

type Vec3 = [number, number, number];
interface Tri {
  a: Vec3;
  b: Vec3;
  c: Vec3;
}

function quad(tris: Tri[], p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3): void {
  tris.push({ a: p0, b: p1, c: p2 }, { a: p0, b: p2, c: p3 });
}

/** A closed axis-aligned box, wound so every face points outward. */
function boxTriangles(
  tris: Tri[],
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number
): void {
  quad(tris, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);   // top
  quad(tris, [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0]);   // bottom
  quad(tris, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);   // -Y
  quad(tris, [x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]);   // +Y
  quad(tris, [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]);   // +X
  quad(tris, [x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]);   // -X
}

/**
 * Extrudes a polygon set between two heights.
 *
 * The solid is emitted as a soup of closed, overlapping boxes rather than one
 * triangulated shell. Slicers union overlapping solids, so the print is
 * identical, and it sidesteps triangulating a rectangle with two hundred holes
 * in it — where one bad ear leaves a leaking mesh that slices into nothing.
 */
function extrudePolys(
  tris: Tri[],
  polys: Poly[],
  z0: number,
  z1: number,
  resolutionMm: number
): void {
  if (polys.length === 0 || z1 - z0 < 1e-9) return;

  let minY = Infinity;
  let maxY = -Infinity;
  for (const poly of polys) {
    for (const p of poly) {
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minY) || maxY - minY < 1e-6) return;

  const rows = Math.max(1, Math.ceil((maxY - minY) / resolutionMm));
  const step = (maxY - minY) / rows;

  // Rows with the same spans are one box: a sheet is mostly straight edges, and
  // emitting a box per scan row there would multiply the file for nothing.
  let pending: Span[] = [];
  let pendingY0 = minY;

  const flush = (y1: number) => {
    for (const span of pending) {
      boxTriangles(tris, span.x0, span.x1, pendingY0, y1, z0, z1);
    }
    pending = [];
  };

  for (let i = 0; i < rows; i++) {
    const y0 = minY + i * step;
    const spans = spansAt(polys, y0 + step / 2);
    if (pending.length > 0 && sameSpans(pending, spans)) continue;
    if (pending.length > 0) flush(y0);
    pending = spans;
    pendingY0 = y0;
  }
  flush(maxY);
}

// ---------------------------------------------------------------------------
// STL
// ---------------------------------------------------------------------------

function normalOf(t: Tri): Vec3 {
  const ux = t.b[0] - t.a[0], uy = t.b[1] - t.a[1], uz = t.b[2] - t.a[2];
  const vx = t.c[0] - t.a[0], vy = t.c[1] - t.a[1], vz = t.c[2] - t.a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz);
  return len > 0 ? [nx / len, ny / len, nz / len] : [0, 0, 0];
}

/** Binary STL. The format carries no units; every slicer reads it as mm. */
export function trianglesToBinaryStl(tris: Tri[], header = 'PhysBox PCB paste stencil'): Uint8Array {
  const buffer = new ArrayBuffer(84 + tris.length * 50);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  const title = header.slice(0, 79);
  for (let i = 0; i < title.length; i++) bytes[i] = title.charCodeAt(i) & 0x7f;
  view.setUint32(80, tris.length, true);

  let offset = 84;
  for (const tri of tris) {
    const n = normalOf(tri);
    view.setFloat32(offset, n[0], true);
    view.setFloat32(offset + 4, n[1], true);
    view.setFloat32(offset + 8, n[2], true);
    const verts = [tri.a, tri.b, tri.c];
    for (let v = 0; v < 3; v++) {
      const base = offset + 12 + v * 12;
      view.setFloat32(base, verts[v][0], true);
      view.setFloat32(base + 4, verts[v][1], true);
      view.setFloat32(base + 8, verts[v][2], true);
    }
    view.setUint16(offset + 48, 0, true);
    offset += 50;
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/** Perimeter of a ring, mm. */
function polyPerimeter(poly: Poly): number {
  let p = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    p += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return p;
}

/**
 * Area ratio: aperture floor over aperture wall.
 *
 * Paste sticks to whichever it sees more of. Below about 0.66 the walls win
 * and the deposit lifts away with the stencil instead of staying on the pad.
 */
export function apertureAreaRatio(poly: Poly, thicknessMm: number): number {
  const perimeter = polyPerimeter(poly);
  if (perimeter <= 0 || thicknessMm <= 0) return Infinity;
  return Math.abs(polyArea(poly)) / (perimeter * thicknessMm);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function generatePasteStencilStl(
  result: PcbLayoutResult,
  options: PcbOptions,
  stencilOptions: Partial<PasteStencilOptions> = {}
): PasteStencilResult {
  const stencil: PasteStencilOptions = { ...DEFAULT_PASTE_STENCIL_OPTIONS, ...stencilOptions };
  const { list, skippedTht } = apertures(result, options, stencil);
  const warnings: string[] = [];

  const outline = sheetOutline(result, stencil);
  const sheet = differencePolys([outline], unionPolys(list.map(a => a.poly)));

  const tris: Tri[] = [];
  extrudePolys(tris, sheet, 0, stencil.thicknessMm, stencil.resolutionMm);
  // Brackets stand on the printed top face, so the finished part is used the
  // other way up: the bed-side face — the flat one — is what meets the copper.
  extrudePolys(
    tris,
    registrationBrackets(result, stencil),
    stencil.thicknessMm,
    stencil.thicknessMm + stencil.cornerHeightMm,
    stencil.resolutionMm
  );

  // --- printability ---------------------------------------------------------
  if (list.length === 0) {
    warnings.push(
      skippedTht > 0
        ? `Every pad on this board is through-hole, so there is nothing to stencil — ` +
          `paste goes in no ${skippedTht === 1 ? 'hole' : 'holes'}. Solder it by hand.`
        : 'No pads on this board, so there is nothing to stencil.'
    );
  }

  const starved = list.filter(
    a => apertureAreaRatio(a.poly, stencil.thicknessMm) < MIN_AREA_RATIO
  ).length;
  if (starved > 0) {
    warnings.push(
      `${starved} of ${list.length} apertures fall below an area ratio of ${MIN_AREA_RATIO} at ` +
        `${stencil.thicknessMm}mm — the paste will stay in the stencil rather than on the pad. ` +
        'Print thinner, or paste those pads by hand.'
    );
  }

  const tooFine = list.filter(a => a.padShortMm < MIN_APERTURE_MM).length;
  if (tooFine > 0) {
    warnings.push(
      `${tooFine} ${tooFine === 1 ? 'aperture is' : 'apertures are'} under ${MIN_APERTURE_MM}mm ` +
        'across — around a nozzle width, where the walls either side of the hole merge and close ' +
        'it. This board wants a laser-cut foil, not a printed stencil.'
    );
  }

  if (skippedTht > 0 && list.length > 0) {
    warnings.push(
      `${skippedTht} through-hole ${skippedTht === 1 ? 'pad is' : 'pads are'} left closed — ` +
        'solder those by hand after reflow.'
    );
  }

  return {
    stl: trianglesToBinaryStl(tris),
    triangleCount: tris.length,
    apertureCount: list.length,
    skippedThtPads: skippedTht,
    thicknessMm: stencil.thicknessMm,
    widthMm: outline[1].x - outline[0].x,
    heightMm: outline[2].y - outline[0].y,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// SVG, for a laser
// ---------------------------------------------------------------------------

/**
 * Stroke colour the SVG is drawn in.
 *
 * One colour, so the apertures and the outline arrive as a single layer — and
 * that is a correctness decision, not a tidiness one. A cutter compensates for
 * its kerf by offsetting to the waste side, and which side that is comes from
 * nesting: an aperture is a hole and has to shrink, the outline is the part's
 * edge and has to grow. Nesting is only visible when they are in the same set.
 * Split across two layers, each is offset alone, and the apertures grow by half
 * a kerf instead of shrinking — the exact error the whole stencil exists to
 * avoid, doubled.
 *
 * It also cuts in the right order for free: Etch orders contours by area,
 * innermost first, so every aperture is cut before the outline that releases
 * the sheet.
 */
export const STENCIL_SVG_COLOR = '#ff0000';

/** Hairline, so the artwork reads as geometry rather than as a wide stroke. */
const SVG_STROKE_MM = 0.05;

function svgPath(poly: Poly, minX: number, maxY: number): string {
  // Board coordinates are Y-up, SVG is Y-down. Negating Y is a change of
  // convention, not a mirror: it renders the same top view. Getting it wrong
  // would flip the stencil, which nothing downstream could detect and which
  // ruins the board it is used on.
  const pt = (p: { x: number; y: number }) =>
    `${(p.x - minX).toFixed(3)} ${(maxY - p.y).toFixed(3)}`;
  return `M${poly.map((p, i) => (i ? 'L' : '') + pt(p)).join('')}Z`;
}

/**
 * The stencil as an SVG, in millimetres, for a laser cutter.
 *
 * Drawn at finished size, with no kerf taken off. A beam removes material
 * either side of the line, so an aperture cut down its own outline comes out
 * oversize — but the kerf belongs to the machine, the material and the focus,
 * none of which are known here, and baking one machine's figure into the file
 * would be silently wrong on every other one and on the printed route too.
 * Compensating is the cutter's job, and Etch does it: it offsets laser cuts by
 * half the kerf set in its status bar.
 */
export function pasteStencilSvg(
  result: PcbLayoutResult,
  options: PcbOptions,
  stencilOptions: Partial<PasteStencilOptions> = {}
): string {
  const art = pasteStencilArtwork(result, options, stencilOptions);
  const xs = art.outline.map(p => p.x);
  const ys = art.outline.map(p => p.y);
  const minX = Math.min(...xs);
  const maxY = Math.max(...ys);
  const w = Math.max(...xs) - minX;
  const h = maxY - Math.min(...ys);

  const f = (n: number) => n.toFixed(3);
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f(w)}mm" height="${f(h)}mm" ` +
      `viewBox="0 0 ${f(w)} ${f(h)}">`,
    `  <desc>Solder paste stencil, ${art.apertures.length} apertures, true size. ` +
      `Drawn at finished size: the cutter offsets for its own kerf.</desc>`,
    `  <g fill="none" stroke="${STENCIL_SVG_COLOR}" stroke-width="${SVG_STROKE_MM}">`,
    // Names the layer on the other side. Without it the importer has only the
    // stroke colour to go on and calls it "Imported #ff0000", which tells an
    // operator nothing about which layer is which.
    `    <title>Solder paste stencil</title>`,
    // The outline first, so a reader sees the sheet before its holes. Order
    // does not decide the cut — the cutter sorts by area, innermost first.
    `    <path d="${svgPath(art.outline, minX, maxY)}"/>`,
    ...art.apertures.map(a => `    <path d="${svgPath(a, minX, maxY)}"/>`),
    `  </g>`,
    `</svg>`,
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Blank shim, for cutting
// ---------------------------------------------------------------------------

export interface PasteShimOptions {
  /**
   * Sheet thickness in mm. One layer: the shim is stock for a laser, and the
   * thinner it is the closer the finished stencil is to a commercial foil.
   */
  thicknessMm: number;
  /**
   * Spare material around the stencil outline, per side, in mm.
   *
   * The laser cuts the outline as well as the apertures, so the blank has to
   * be bigger than the finished part, and something has to hold it flat on the
   * bed. It also answers the obvious worry about printing a sheet one layer
   * thick: a single layer is all first layer, and what a first layer does when
   * it lifts is curl at the edges. Here the edges are sacrificial — the
   * finished stencil is cut out of the middle — so the curl ends up in the
   * offcut rather than under a pad.
   */
  marginMm: number;
}

export const DEFAULT_PASTE_SHIM_OPTIONS: PasteShimOptions = {
  thicknessMm: 0.2,
  marginMm: 5,
};

export interface PasteShimResult {
  stl: Uint8Array;
  triangleCount: number;
  thicknessMm: number;
  widthMm: number;
  heightMm: number;
}

/**
 * A blank sheet to laser the stencil out of.
 *
 * Solves the material problem rather than the geometry one. Cutting a stencil
 * wants thin dark film, and 0.1mm black polyester in small quantities is a
 * nuisance to buy — while a single layer of black filament is a thin dark
 * sheet that anyone with a printer already has. Print this, then cut the
 * apertures and the outline into it.
 *
 * Print it in *black*: a 450nm diode laser is a blue light source, and blue
 * light goes straight through natural and light-coloured plastic without
 * depositing the energy that cuts it.
 */
export function generatePasteShimStl(
  result: PcbLayoutResult,
  shimOptions: Partial<PasteShimOptions> = {},
  stencilOptions: Partial<PasteStencilOptions> = {}
): PasteShimResult {
  const shim: PasteShimOptions = { ...DEFAULT_PASTE_SHIM_OPTIONS, ...shimOptions };
  const stencil: PasteStencilOptions = { ...DEFAULT_PASTE_STENCIL_OPTIONS, ...stencilOptions };

  const outline = sheetOutline(result, stencil);
  const xs = outline.map(p => p.x);
  const ys = outline.map(p => p.y);
  const w = Math.max(...xs) - Math.min(...xs) + shim.marginMm * 2;
  const h = Math.max(...ys) - Math.min(...ys) + shim.marginMm * 2;

  const tris: Tri[] = [];
  // One box, not a scanline: a rectangle has nothing to decompose.
  boxTriangles(tris, 0, w, 0, h, 0, shim.thicknessMm);

  return {
    stl: trianglesToBinaryStl(tris, 'PhysBox PCB stencil shim blank'),
    triangleCount: tris.length,
    thicknessMm: shim.thicknessMm,
    widthMm: w,
    heightMm: h,
  };
}
