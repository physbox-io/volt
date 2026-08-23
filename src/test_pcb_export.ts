/**
 * Exercises the CAM output rules that are easy to get wrong and expensive to
 * discover on the machine: how many drill bits a board demands, and whether an
 * air cut actually runs end to end.
 *
 * Run with: npx tsx src/test_pcb_export.ts
 */

import type { Node, Edge } from '@xyflow/react';
import {
  groupDrillsByBit,
  generateAirCutGcode,
  generatePcbLayout,
  DEFAULT_PCB_OPTIONS,
  type DrillPoint,
} from './utils/pcbExporter';

let fails = 0;
function check(name: string, cond: boolean, detail = '') {
  if (!cond) fails++;
  console.log(`${cond ? '  ok  ' : '!!FAIL'} ${name}${cond ? '' : `  ${detail}`}`);
}

const holes = (diameter: number, n: number): DrillPoint[] =>
  Array.from({ length: n }, (_, i) => ({
    x: i,
    y: 0,
    diameter,
    componentId: 'c',
    pinNumber: '1',
  }));

// --- 1. Drill bit consolidation -------------------------------------------
// A simple astable board: resistors and LEDs at 0.8, a diode at 0.9, TO-92
// transistors and electrolytics at 1.0. Strictly grouped that is three drill
// changes for holes a single bit would make.
const astable = [...holes(0.8, 8), ...holes(0.9, 2), ...holes(1.0, 6)];

const strict = groupDrillsByBit(astable, 0);
check('no merging keeps every nominal size', strict.length === 3, `${strict.length} groups`);

const merged = groupDrillsByBit(astable, DEFAULT_PCB_OPTIONS.drillConsolidationMm ?? 0);
check('default tolerance collapses an astable to one bit', merged.length === 1, `${merged.length} groups`);
check('every hole survives the merge', merged[0]?.holes.length === 16, `${merged[0]?.holes.length}`);
// Drilling at the largest of the group means a lead always fits; drilling at
// the smallest would leave 1.0mm leads facing a 0.8mm hole.
check('merged bit is the largest in its group', merged[0]?.bitMm === 1.0, `${merged[0]?.bitMm}`);
check('merge is reported', (merged[0]?.nominals || []).join(',') === '0.8,0.9,1', `${merged[0]?.nominals}`);

// Grouping is anchored on the smallest member, so a run of near-neighbours
// cannot chain-drift a small hole up to a much larger bit.
const chain = [0.8, 1.0, 1.2, 1.4, 1.6].flatMap(d => holes(d, 1));
const chained = groupDrillsByBit(chain, 0.3);
check('a chain of near sizes does not drift', chained.length === 3, chained.map(g => g.bitMm).join(', '));
for (const g of chained) {
  const span = g.bitMm - g.nominals[0];
  check(`group at ${g.bitMm}mm stays within tolerance`, span <= 0.3 + 1e-9, `span ${span}`);
}

// --- 2. Air cut runs to the end -------------------------------------------
// The board profile is the LAST operation, behind every drill change. Leaving
// the M6 pauses in meant a dry run stopped several times before it ever traced
// the outline — the one pass most worth previewing.
const program = [
  'G90 G21',
  'T1 M6 ; Tool 1: V-bit',
  'M3 S12000 ; Spindle on',
  'G1 Z-0.160 F100',
  'T2 M6 ; Tool 2: 1mm drill',
  'M0 ; swap material',
  '; OP 3/3: Board edge profile',
  'T99 M6 ; Tool 99: end mill',
  'G1 X10.000 Y0.000 F300',
  'G1 Z-1.600 F100',
  'M5 ; Spindle off',
  'M30 ; End',
].join('\n');

const air = generateAirCutGcode(program, 20);
const active = air.split('\n').filter(l => l.trim() && !l.trim().startsWith(';'));

check('no tool change survives an air cut', !active.some(l => /\bM0?6\b/.test(l)), active.join(' | '));
check('no unconditional stop survives', !active.some(l => /\bM0{1,2}\b/.test(l)), active.join(' | '));
check('spindle is never started', !active.some(l => /\bM[34]\b/.test(l)), active.join(' | '));
check('the profile pass is still reached', active.some(l => l.includes('X10.000')), active.join(' | '));
check('M30 still ends the program', active.some(l => /\bM30\b/.test(l)), active.join(' | '));

// Z is lifted clear, and every cut move ends up above the stock.
const zs = active
  .flatMap(l => [...l.matchAll(/Z(-?\d+(?:\.\d+)?)/g)].map(m => parseFloat(m[1])));
check('every Z is lifted above the stock', zs.length > 0 && zs.every(z => z > 0), zs.join(', '));

// --- 3. Defaults ----------------------------------------------------------
check('isolation depth default is 0.16mm', DEFAULT_PCB_OPTIONS.isolationDepthZ === -0.16, `${DEFAULT_PCB_OPTIONS.isolationDepthZ}`);
check('pads carry a margin by default', (DEFAULT_PCB_OPTIONS.padMarginMm ?? 0) > 0, `${DEFAULT_PCB_OPTIONS.padMarginMm}`);

// --- 4. Bits the user actually owns ---------------------------------------
// A drawer with one bit in it still has to cut every hole on the board: a
// bigger bit drills oversize, a smaller one gets spiralled out to size.
const mixed = [...holes(0.8, 3), ...holes(1.5, 2)];

const oversize = groupDrillsByBit(mixed, 0, { '0.8': 1.0, '1.5': 1.5 });
check(
  'a bigger bit is loaded and the hole diameter is remembered',
  oversize[0].bitMm === 1.0 && oversize[0].holeMm === 0.8,
  JSON.stringify(oversize.map(g => [g.bitMm, g.holeMm]))
);

const onlySmall = groupDrillsByBit(mixed, 0, { '0.8': 0.5, '1.5': 0.5 });
check('one owned bit serves every hole size', onlySmall.every(g => g.bitMm === 0.5), JSON.stringify(onlySmall.map(g => g.bitMm)));
check('but each finished size stays its own group', onlySmall.length === 2, `${onlySmall.length}`);
check('no hole is lost to the override', onlySmall.reduce((n, g) => n + g.holes.length, 0) === mixed.length);
check(
  'groups sharing a bit are adjacent so it is loaded once',
  onlySmall.map(g => g.bitMm).join() === [...onlySmall].sort((a, b) => a.bitMm - b.bitMm).map(g => g.bitMm).join()
);

// --- 5. Whole-board geometry ----------------------------------------------
const nodes: Node[] = [
  { id: 'R1', type: 'resistor', position: { x: 0, y: 0 }, data: { label: 'R1' } },
  { id: 'C1', type: 'capacitor', position: { x: 150, y: 90 }, data: { label: 'C1' } },
];
const edges: Edge[] = [
  { id: 'e1', source: 'R1', target: 'C1', sourceHandle: 'p2', targetHandle: 'p1' },
];

/** Extent of every commanded coordinate in a program, comments excluded. */
function programExtent(gcode: string) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const raw of gcode.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith(';')) continue;
    const mx = /(?:^|\s)X(-?\d+(?:\.\d+)?)/.exec(line);
    const my = /(?:^|\s)Y(-?\d+(?:\.\d+)?)/.exec(line);
    if (mx) { minX = Math.min(minX, +mx[1]); maxX = Math.max(maxX, +mx[1]); }
    if (my) { minY = Math.min(minY, +my[1]); maxY = Math.max(maxY, +my[1]); }
  }
  return { minX, minY, maxX, maxY };
}

const auto = generatePcbLayout(nodes, edges, DEFAULT_PCB_OPTIONS);
const autoExtent = programExtent(auto.gcode);

check(
  'the board crops down to the copper rather than the placement estimate',
  auto.boardWidthMm < 40 && auto.boardHeightMm < 40,
  `${auto.boardWidthMm} x ${auto.boardHeightMm}`
);
check(
  'every part is inside the cropped board',
  auto.components.every(c =>
    c.x - c.widthMm / 2 >= auto.boardOriginMm &&
    c.y - c.heightMm / 2 >= auto.boardOriginMm &&
    c.x + c.widthMm / 2 <= auto.boardOriginMm + auto.boardWidthMm &&
    c.y + c.heightMm / 2 <= auto.boardOriginMm + auto.boardHeightMm
  )
);
check(
  'nothing is commanded to a negative coordinate',
  autoExtent.minX >= 0 && autoExtent.minY >= 0,
  `X${autoExtent.minX} Y${autoExtent.minY}`
);
check(
  'the outline pass starts on X0 Y0',
  autoExtent.minX === 0 && autoExtent.minY === 0,
  `X${autoExtent.minX} Y${autoExtent.minY}`
);
check(
  'and ends a tool diameter past the far corner',
  Math.abs(autoExtent.maxX - (auto.boardWidthMm + auto.boardOriginMm * 2)) < 1e-6,
  `${autoExtent.maxX} vs ${auto.boardWidthMm + auto.boardOriginMm * 2}`
);

const fixed = generatePcbLayout(nodes, edges, {
  ...DEFAULT_PCB_OPTIONS,
  autoGrowBoard: false,
  boardWidthMm: 60,
  boardHeightMm: 45,
});
const fixedExtent = programExtent(fixed.gcode);
check('a fixed board keeps its exact size', fixed.boardWidthMm === 60 && fixed.boardHeightMm === 45);
check(
  'a fixed board is clear of the origin too',
  fixedExtent.minX === 0 && fixedExtent.minY === 0,
  `X${fixedExtent.minX} Y${fixedExtent.minY}`
);

const floored = generatePcbLayout(nodes, edges, {
  ...DEFAULT_PCB_OPTIONS,
  boardWidthMm: 90,
  boardHeightMm: 70,
});
check('the requested size is still a floor when auto-sizing', floored.boardWidthMm === 90 && floored.boardHeightMm === 70, `${floored.boardWidthMm} x ${floored.boardHeightMm}`);

// --- 6. Holes milled out with an undersized bit ----------------------------
const smallBit = 0.5;
const needed = groupDrillsByBit(auto.drills, DEFAULT_PCB_OPTIONS.drillConsolidationMm ?? 0);
const overrides: Record<string, number> = {};
for (const g of needed) overrides[String(g.holeMm)] = smallBit;
const milled = generatePcbLayout(nodes, edges, { ...DEFAULT_PCB_OPTIONS, drillBitOverridesMm: overrides });

const op2 = milled.gcode
  .split('\n')
  .slice(
    milled.gcode.split('\n').findIndex(l => l.includes('OP 2/3')),
    milled.gcode.split('\n').findIndex(l => l.includes('OP 3/3'))
  );

check('the undersized bit is announced as interpolated', op2.some(l => /interpolated with a 0.5mm bit/.test(l)), op2.filter(l => l.startsWith('; ---')).join(' | '));
check('it is the only bit loaded', op2.filter(l => /M6/.test(l)).length === 1, `${op2.filter(l => /M6/.test(l)).length}`);
check('no arc is emitted, so the height map still applies', !/\bG0*[23]\b/.test(milled.gcode));

// The tool centre must sweep a circle of (hole - bit) / 2, and must pass within
// a bit radius of the centre or a slug is left standing.
const centres = milled.drills.map(d => ({ x: d.x, y: d.y, dia: d.diameter }));
let cx = 0, cy = 0, cz = 0, deepest = 0, nearest = Infinity, furthest = -Infinity;
for (const line of op2) {
  if (!line || line.startsWith(';')) continue;
  const mx = /X(-?\d+(?:\.\d+)?)/.exec(line);
  const my = /Y(-?\d+(?:\.\d+)?)/.exec(line);
  const mz = /Z(-?\d+(?:\.\d+)?)/.exec(line);
  if (mx) cx = +mx[1];
  if (my) cy = +my[1];
  if (mz) cz = +mz[1];
  if (!/^G1/.test(line)) continue;
  deepest = Math.min(deepest, cz);
  const r = Math.min(...centres.map(h => Math.hypot(cx - h.x, cy - h.y)));
  nearest = Math.min(nearest, r);
  furthest = Math.max(furthest, r);
}
// Nominal sizes are merged onto one bit, so the finished hole is the largest
// in its group, not whichever nominal a given pad carried.
const wantR = (Math.max(...needed.map(g => g.holeMm)) - smallBit) / 2;
check('the helix reaches full drill depth', Math.abs(deepest - DEFAULT_PCB_OPTIONS.drillDepthZ) < 1e-6, `${deepest}`);
check('the finished hole comes out at its nominal size', Math.abs(furthest - wantR) < 0.02, `${furthest} vs ${wantR}`);
check('the cutter overlaps the centre, so no slug is left', nearest <= smallBit / 2 + 1e-6, `${nearest} > ${smallBit / 2}`);

console.log(`\n${fails} failure(s)`);
if (fails) throw new Error(`${fails} PCB export test failure(s)`);
