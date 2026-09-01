/**
 * Checks the printable solder paste stencil: that an aperture sits over every
 * SMD pad and nowhere else, that the numbers which decide whether paste
 * actually releases are enforced, and that the STL is a well-formed binary
 * file a slicer will accept.
 *
 * Run with: npx tsx src/test_paste_stencil.ts
 */

import type { Node, Edge } from '@xyflow/react';
import { generatePcbLayout, effectivePadMarginMm, DEFAULT_PCB_OPTIONS } from './utils/pcbExporter';
import { circlePoly } from './utils/pcbGeometry';
import {
  generatePasteStencilStl,
  generatePasteShimStl,
  pasteStencilArtwork,
  pasteStencilSvg,
  apertureAreaRatio,
  STENCIL_SVG_COLOR,
  DEFAULT_PASTE_STENCIL_OPTIONS,
  DEFAULT_PASTE_SHIM_OPTIONS,
} from './utils/pcbPasteStencil';
import { encodeSvgHandoff } from './utils/etchHandoff';

let fails = 0;
function check(name: string, cond: boolean, detail = '') {
  if (!cond) fails++;
  console.log(`${cond ? '  ok  ' : '!!FAIL'} ${name}${cond ? '' : `  ${detail}`}`);
}

/** Reads a binary STL back into triangles. */
function readStl(stl: Uint8Array) {
  const view = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
  const count = view.getUint32(80, true);
  const tris: { xyz: [number, number, number][]; n: [number, number, number] }[] = [];
  for (let i = 0; i < count; i++) {
    const b = 84 + i * 50;
    tris.push({
      n: [view.getFloat32(b, true), view.getFloat32(b + 4, true), view.getFloat32(b + 8, true)],
      xyz: [0, 1, 2].map(v => [
        view.getFloat32(b + 12 + v * 12, true),
        view.getFloat32(b + 16 + v * 12, true),
        view.getFloat32(b + 20 + v * 12, true),
      ]) as [number, number, number][],
    });
  }
  return { count, tris };
}

// An all-SMD board: chip passives and a SOIC-8, which is about the finest part
// a printed stencil has any business being used on.
const nodes: Node[] = [
  { id: 'R1', type: 'resistor', position: { x: 0, y: 0 }, data: { packageId: '0805' } },
  { id: 'U1', type: 'timer555', position: { x: 300, y: 0 }, data: { packageId: 'SOIC-8' } },
  { id: 'D1', type: 'led', position: { x: 300, y: 200 }, data: { packageId: '0805' } },
];
const edges: Edge[] = [
  { id: 'e1', source: 'R1', target: 'U1', sourceHandle: 'p2', targetHandle: '2' },
  { id: 'e2', source: 'U1', target: 'D1', sourceHandle: '3', targetHandle: 'p1' },
];

const layout = generatePcbLayout(nodes, edges, DEFAULT_PCB_OPTIONS);
check('the fixture lays out', layout.success, layout.error || '');

const smdPads = layout.pads.filter(p => !p.spec.drillDiameter);
check('the fixture is all SMD', smdPads.length === layout.pads.length, `${smdPads.length}/${layout.pads.length}`);

const stencil = generatePasteStencilStl(layout, DEFAULT_PCB_OPTIONS);

// --- 1. The deposit ---------------------------------------------------------
// This is the number that decides whether the board reflows or bridges.
check(
  'the sheet is foil-thin, not a plate',
  stencil.thicknessMm <= 0.25,
  `${stencil.thicknessMm}mm`
);
check('every SMD pad gets an aperture', stencil.apertureCount === smdPads.length, `${stencil.apertureCount}`);
check('a clean board stencils without complaint', stencil.warnings.length === 0, stencil.warnings.join(' | '));

// --- 2. Apertures are where the pads are, and smaller ------------------------
const { tris } = readStl(stencil.stl);
// The sheet's own top face, at z = thickness: any triangle up there is
// material, so a pad centre must not be covered by one.
const topFaceAt = (x: number, y: number) =>
  tris.some(t => {
    if (Math.abs(t.n[2] - 1) > 1e-3) return false;
    if (Math.abs(t.xyz[0][2] - stencil.thicknessMm) > 1e-4) return false;
    const [a, b, c] = t.xyz;
    const s = (p: number[], q: number[]) => (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
    const d1 = s(a, b), d2 = s(b, c), d3 = s(c, a);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  });

const coveredPads = smdPads.filter(p => topFaceAt(p.x, p.y)).length;
check('no pad centre is covered by the sheet', coveredPads === 0, `${coveredPads} covered`);

// Between two pads of the same part there must still be sheet, or the two
// apertures have merged into one and the joint bridges on reflow.
const r1 = layout.components.find(c => c.id === 'R1')!;
check('the web between an 0805’s two pads survives', topFaceAt(r1.x, r1.y), `${r1.x},${r1.y}`);

// The aperture is smaller than the copper it sits over: paste slumps outward
// when it is placed and again when it melts, so an aperture cut to the full pad
// puts solder past the pad edge, which is where bridges start.
const pad = smdPads[0];
const padOwner = layout.components.find(c => c.id === pad.componentId)!;
const copperMargin = effectivePadMarginMm(padOwner.footprint, DEFAULT_PCB_OPTIONS.padMarginMm ?? 0);
// Just inside the milled copper's own edge, on the pad's short axis.
const copperEdge = pad.spec.padWidth / 2 + copperMargin - 0.01;
check(
  'the aperture is reduced against the copper',
  topFaceAt(pad.x + copperEdge, pad.y),
  `no sheet at ${copperEdge.toFixed(3)}mm from the pad centre; the aperture reaches the copper edge`
);
check(
  'but it still exposes most of the pad',
  !topFaceAt(pad.x + pad.spec.padWidth / 2 - 0.1, pad.y),
  'the aperture has been shrunk back off the pad'
);

// --- 3. Registration --------------------------------------------------------
// Brackets stand proud of the sheet, and only at the corners — the profile
// pass leaves tab stubs part way along each edge.
let maxZ = -Infinity;
for (const t of tris) for (const v of t.xyz) maxZ = Math.max(maxZ, v[2]);
check(
  'the corner brackets stand proud of the sheet',
  Math.abs(maxZ - (stencil.thicknessMm + DEFAULT_PASTE_STENCIL_OPTIONS.cornerHeightMm)) < 1e-4,
  `${maxZ}`
);

const o = layout.boardOriginMm;
const midEdge = tris.some(t => t.xyz.some(v =>
  v[2] > stencil.thicknessMm + 1e-4 &&
  Math.abs(v[0] - (o + layout.boardWidthMm / 2)) < 1
));
check('no bracket sits where the holding tabs leave stubs', !midEdge);

check(
  'the sheet overhangs the board so the brackets have something to stand on',
  stencil.widthMm > layout.boardWidthMm,
  `${stencil.widthMm} vs ${layout.boardWidthMm}`
);

// --- 4. The rules that make paste release -----------------------------------
// Area ratio is inversely proportional to thickness, so the same board that
// passes as a foil has to fail as a plate.
const asPlate = generatePasteStencilStl(layout, DEFAULT_PCB_OPTIONS, { thicknessMm: 0.6 });
check(
  'a 0.6mm plate is rejected as a stencil',
  asPlate.warnings.some(w => w.includes('area ratio')),
  asPlate.warnings.join(' | ')
);

const round = circlePoly(0, 0, 0.5);
check(
  'area ratio matches the closed form d/4t for a circle',
  Math.abs(apertureAreaRatio(round, 0.15) - 1.0 / (4 * 0.15)) < 0.01,
  `${apertureAreaRatio(round, 0.15)}`
);

// A fine-pitch part is past what a 0.4mm nozzle can hold.
const qfn = generatePcbLayout(
  [
    { id: 'U2', type: 'opamp', position: { x: 0, y: 0 }, data: { packageId: 'QFN-16' } },
    { id: 'R2', type: 'resistor', position: { x: 200, y: 0 }, data: { packageId: '0805' } },
  ] as Node[],
  [{ id: 'e', source: 'U2', target: 'R2', sourceHandle: 'out', targetHandle: 'p1' }] as Edge[],
  DEFAULT_PCB_OPTIONS
);
check('the QFN fixture is all SMD', qfn.pads.every(p => !p.spec.drillDiameter), `${qfn.pads.filter(p => p.spec.drillDiameter).length} THT`);
const qfnStencil = generatePasteStencilStl(qfn, DEFAULT_PCB_OPTIONS);
check(
  'a QFN is called out as needing a laser-cut foil',
  qfnStencil.warnings.some(w => w.includes('laser-cut')),
  qfnStencil.warnings.join(' | ')
);

// --- 5. Through-hole pads get no paste --------------------------------------
const tht = generatePcbLayout(
  [
    { id: 'R3', type: 'resistor', position: { x: 0, y: 0 }, data: {} },
    { id: 'C3', type: 'capacitor', position: { x: 200, y: 0 }, data: {} },
  ] as Node[],
  [{ id: 'e', source: 'R3', target: 'C3', sourceHandle: 'p2', targetHandle: 'p1' }] as Edge[],
  DEFAULT_PCB_OPTIONS
);
const thtStencil = generatePasteStencilStl(tht, DEFAULT_PCB_OPTIONS);
check('a through-hole pad gets no aperture', thtStencil.apertureCount === 0, `${thtStencil.apertureCount}`);
check('and the board is reported as not worth stencilling', thtStencil.warnings.some(w => w.includes('through-hole')), thtStencil.warnings.join(' | '));

const mixed = generatePasteStencilStl(
  generatePcbLayout(
    [
      { id: 'R4', type: 'resistor', position: { x: 0, y: 0 }, data: { packageId: '0805' } },
      { id: 'C4', type: 'capacitor', position: { x: 200, y: 0 }, data: { packageId: 'RADIAL-5MM' } },
    ] as Node[],
    [{ id: 'e', source: 'R4', target: 'C4', sourceHandle: 'p2', targetHandle: 'p1' }] as Edge[],
    DEFAULT_PCB_OPTIONS
  ),
  DEFAULT_PCB_OPTIONS
);
check('a mixed board stencils the SMD pads only', mixed.apertureCount === 2 && mixed.skippedThtPads === 2,
  `${mixed.apertureCount} apertures, ${mixed.skippedThtPads} skipped`);
check('and says the THT pads are left for hand soldering', mixed.warnings.some(w => w.includes('hand')), mixed.warnings.join(' | '));

// --- 6. The file ------------------------------------------------------------
check('the STL is exactly sized', stencil.stl.length === 84 + stencil.triangleCount * 50, `${stencil.stl.length}`);
check('the header declares the triangle count', readStl(stencil.stl).count === stencil.triangleCount);
check('it prints flat on the bed', tris.every(t => t.xyz.every(v => v[2] >= -1e-6)));
let badNormals = 0;
for (const t of tris) if (Math.abs(Math.hypot(...t.n) - 1) > 1e-3) badNormals++;
check('every facet normal is a unit vector', badNormals === 0, `${badNormals} bad`);

// --- 7. The SVG a laser cuts -------------------------------------------------
const svg = pasteStencilSvg(layout, DEFAULT_PCB_OPTIONS);
const art = pasteStencilArtwork(layout, DEFAULT_PCB_OPTIONS);

check(
  'the SVG is dimensioned in millimetres',
  new RegExp(`width="${stencil.widthMm.toFixed(3)}mm" height="${stencil.heightMm.toFixed(3)}mm"`).test(svg),
  svg.slice(0, 160)
);
check(
  'one path per aperture, plus the outline',
  (svg.match(/<path /g) || []).length === art.apertures.length + 1,
  `${(svg.match(/<path /g) || []).length} paths for ${art.apertures.length} apertures`
);
// One stroke colour, so the apertures and the outline arrive as a single set.
// Split apart, a cutter offsets each alone and grows the apertures by half a
// kerf instead of shrinking them — the error the stencil exists to avoid.
check(
  'the whole stencil is one layer',
  (svg.match(/stroke="#/g) || []).length === 1 && svg.includes(STENCIL_SVG_COLOR),
  svg.slice(0, 200)
);

// Board coordinates are Y-up and SVG is Y-down. Getting the flip wrong mirrors
// the stencil, which nothing downstream can detect and which ruins the board.
const svgApertures = [...svg.matchAll(/<path d="M([\d.]+) ([\d.]+)/g)]
  .slice(1) // the first path is the sheet outline
  .map(m => ({ x: parseFloat(m[1]), y: parseFloat(m[2]) }));
const boardFirsts = art.apertures.map(a => a[0]);
const highestOnBoard = boardFirsts.indexOf(boardFirsts.reduce((a, b) => (b.y > a.y ? b : a)));
const topInSvg = svgApertures.indexOf(svgApertures.reduce((a, b) => (b.y < a.y ? b : a)));
check(
  'the Y axis is flipped, not mirrored',
  highestOnBoard === topInSvg,
  `board-highest aperture #${highestOnBoard}, SVG-topmost #${topInSvg}`
);

// Kerf belongs to the machine that cuts it, not to the artwork: Etch has no
// laser kerf compensation yet, and putting one machine's number in the file
// would be silently wrong on every other one — and on a printed stencil.
const svgWidth = Math.max(...svgApertures.map(p => p.x)) - Math.min(...svgApertures.map(p => p.x));
const artWidth =
  Math.max(...boardFirsts.map(p => p.x)) - Math.min(...boardFirsts.map(p => p.x));
check('apertures are sent at their finished size', Math.abs(svgWidth - artWidth) < 1e-3, `${svgWidth} vs ${artWidth}`);

// --- 8. The trip to Etch ------------------------------------------------------
const fragment = await encodeSvgHandoff(svg, 'PCB paste stencil');
const params = new URLSearchParams(fragment);
check('the fragment declares its format', params.get('v') === '1');
check('the artwork is compressed', params.get('gz') === '1');
// base64url only, so the fragment needs no escaping and survives a copy-paste.
check(
  'the payload is URL-safe',
  /^[A-Za-z0-9_-]+$/.test(params.get('data') || ''),
  (params.get('data') || '').slice(0, 40)
);
// The fragment is never sent to a server, but nginx's 8KB request line is the
// figure worth staying under anyway — it is what a query string would cost.
check(
  'a board this size fits comfortably in a URL',
  fragment.length < 8192,
  `${fragment.length} bytes`
);

const packed = Uint8Array.from(atob((params.get('data') || '').replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const gunzip = new DecompressionStream('gzip');
const writer = gunzip.writable.getWriter();
void writer.write(packed);
void writer.close();
const roundTripped = await new Response(gunzip.readable).text();
check('the artwork survives the round trip byte for byte', roundTripped === svg, `${roundTripped.length} vs ${svg.length} bytes`);

// --- 9. The blank shim --------------------------------------------------------
// Stock, not a part: it comes off the printer blank and only becomes a stencil
// on the laser, so it must have no apertures in it at all.
const shim = generatePasteShimStl(layout);
const shimTris = readStl(shim.stl);
check('the shim is a single box', shimTris.count === 12, `${shimTris.count} triangles`);
check(
  'the shim is one layer thick',
  Math.abs(shim.thicknessMm - DEFAULT_PASTE_SHIM_OPTIONS.thicknessMm) < 1e-9,
  `${shim.thicknessMm}`
);
// Big enough to cut the stencil out of, and to hold down while doing it.
check(
  'the shim clears the stencil by the holding margin',
  Math.abs(shim.widthMm - (stencil.widthMm + DEFAULT_PASTE_SHIM_OPTIONS.marginMm * 2)) < 1e-6 &&
    Math.abs(shim.heightMm - (stencil.heightMm + DEFAULT_PASTE_SHIM_OPTIONS.marginMm * 2)) < 1e-6,
  `shim ${shim.widthMm}x${shim.heightMm} vs stencil ${stencil.widthMm}x${stencil.heightMm}`
);
let shimMinZ = Infinity, shimMaxZ = -Infinity;
for (const t of shimTris.tris) for (const v of t.xyz) {
  shimMinZ = Math.min(shimMinZ, v[2]);
  shimMaxZ = Math.max(shimMaxZ, v[2]);
}
check('and it prints flat', Math.abs(shimMinZ) < 1e-9 && Math.abs(shimMaxZ - shim.thicknessMm) < 1e-6, `${shimMinZ}..${shimMaxZ}`);

console.log(`\n${fails} failure(s)`);
if (fails) throw new Error(`${fails} paste stencil test failure(s)`);
