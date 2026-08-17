/**
 * Exercises the CAM output rules that are easy to get wrong and expensive to
 * discover on the machine: how many drill bits a board demands, and whether an
 * air cut actually runs end to end.
 *
 * Run with: npx tsx src/test_pcb_export.ts
 */

import {
  groupDrillsByBit,
  generateAirCutGcode,
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

console.log(`\n${fails} failure(s)`);
if (fails) throw new Error(`${fails} PCB export test failure(s)`);
