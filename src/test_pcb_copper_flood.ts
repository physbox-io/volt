/**
 * Copper flooding: the isolation job should leave as much copper on the board
 * as the bit's own channel allows, without ever closing that channel.
 *
 * Run with: npx tsx src/test_pcb_copper_flood.ts
 */

import type { Node, Edge } from '@xyflow/react';
import {
  floodCopperByNet,
  generatePcbLayout,
  DEFAULT_PCB_OPTIONS,
} from './utils/pcbExporter';
import {
  offsetPolys,
  polysBounds,
  polysOverlap,
  rectPoly,
  totalArea,
  type Poly,
} from './utils/pcbGeometry';

let fails = 0;
function check(name: string, cond: boolean, detail = '') {
  if (!cond) fails++;
  console.log(`${cond ? '  ok  ' : '!!FAIL'} ${name}${cond ? '' : `  ${detail}`}`);
}

/** True when no point of `a` is within `d` of `b`. */
function gapAtLeast(a: Poly[], b: Poly[], d: number): boolean {
  const half = d / 2 - 0.002; // a shade under, to absorb Clipper's micron grid
  return !polysOverlap(offsetPolys(a, half), offsetPolys(b, half), 1e-6);
}

const CHANNEL = 0.2;
const MARGIN = 0.05;

// --- 1. Two nets share the gap between them -------------------------------
// Traces 0.4mm wide with their centres 2mm apart: 1.6mm of bare laminate that
// a nominal-width isolation job would throw away.
const wide = new Map<string, Poly[]>([
  ['A', [rectPoly(0, 0, 10, 0.4)]],
  ['B', [rectPoly(0, 2, 10, 0.4)]],
]);
const widened = floodCopperByNet(wide, {
  maxFloodMm: 0.6,
  channelMm: CHANNEL,
  channelMarginMm: MARGIN,
});

const aBounds = polysBounds(widened.copper.get('A')!);
const aHeight = aBounds.maxY - aBounds.minY;
check(
  'copper in open laminate takes the whole flood budget',
  Math.abs(aHeight - (0.4 + 0.6 * 2)) < 0.05,
  `${aHeight.toFixed(3)}mm wide, wanted ${(0.4 + 1.2).toFixed(3)}`
);
check('the flood is reported', Math.abs(widened.appliedMm - 0.6) < 1e-6, `${widened.appliedMm}`);
check(
  'the channel between them survives',
  gapAtLeast(widened.copper.get('A')!, widened.copper.get('B')!, CHANNEL + 2 * MARGIN),
  'nets came within a channel of each other'
);

// --- 2. A tight gap is split down the middle ------------------------------
// 0.5mm centre to centre leaves 0.1mm of copper-free laminate: there is only
// room for the channel itself, so neither net may move.
const tight = new Map<string, Poly[]>([
  ['A', [rectPoly(0, 0, 10, 0.2)]],
  ['B', [rectPoly(0, 0.5, 10, 0.2)]],
]);
const split = floodCopperByNet(tight, {
  maxFloodMm: 0.6,
  channelMm: CHANNEL,
  channelMarginMm: MARGIN,
});
check(
  'a gap with no room to spare is left alone',
  Math.abs(polysBounds(split.copper.get('A')!).maxY - 0.1) < 0.02,
  `grew to ${polysBounds(split.copper.get('A')!).maxY.toFixed(3)}`
);
check(
  'nothing is ever taken away',
  totalArea(split.copper.get('A')!) >= totalArea(tight.get('A')!) - 1e-9
);

// Order must not decide who gets the gap: B is the same trace mirrored, so it
// must end up with the same copper A does.
const asym = new Map<string, Poly[]>([
  ['A', [rectPoly(0, 0, 10, 0.2)]],
  ['B', [rectPoly(0, 1.2, 10, 0.2)]],
]);
const shared = floodCopperByNet(asym, {
  maxFloodMm: 2,
  channelMm: CHANNEL,
  channelMarginMm: MARGIN,
});
const areaA = totalArea(shared.copper.get('A')!);
const areaB = totalArea(shared.copper.get('B')!);
check(
  'the gap is split evenly rather than won by whoever is grown first',
  Math.abs(areaA - areaB) / Math.max(areaA, areaB) < 0.02,
  `${areaA.toFixed(3)} vs ${areaB.toFixed(3)}mm2`
);
check(
  'and the channel is still there afterwards',
  gapAtLeast(shared.copper.get('A')!, shared.copper.get('B')!, CHANNEL + 2 * MARGIN)
);

// --- 3. Blockers and bounds -----------------------------------------------
const blocked = floodCopperByNet(
  new Map<string, Poly[]>([['A', [rectPoly(0, 0, 4, 0.4)]]]),
  {
    maxFloodMm: 1.0,
    channelMm: CHANNEL,
    channelMarginMm: MARGIN,
    blockers: [rectPoly(0, 1.2, 1, 1)],       // an unassigned pad above the trace
    bounds: [rectPoly(0, 0, 6, 2.4)],         // and the usable board area
  }
);
check(
  'copper keeps a channel clear of an unassigned pad',
  gapAtLeast(blocked.copper.get('A')!, [rectPoly(0, 1.2, 1, 1)], CHANNEL + 2 * MARGIN)
);
const bb = polysBounds(blocked.copper.get('A')!);
check(
  'copper stays inside the bounds it was given',
  bb.minX >= -3.001 && bb.maxX <= 3.001 && bb.minY >= -1.201 && bb.maxY <= 1.201,
  `${bb.minX.toFixed(3)}..${bb.maxX.toFixed(3)}, ${bb.minY.toFixed(3)}..${bb.maxY.toFixed(3)}`
);

// --- 4. Whole board -------------------------------------------------------
const nodes: Node[] = [
  { id: 'R1', type: 'resistor', position: { x: 0, y: 0 }, data: { label: 'R1' } },
  { id: 'C1', type: 'capacitor', position: { x: 150, y: 90 }, data: { label: 'C1' } },
  { id: 'Q1', type: 'transistor', position: { x: 60, y: 160 }, data: { label: 'Q1' } },
];
const edges: Edge[] = [
  { id: 'e1', source: 'R1', target: 'C1', sourceHandle: 'p2', targetHandle: 'p1' },
  { id: 'e2', source: 'C1', target: 'Q1', sourceHandle: 'p2', targetHandle: 'base' },
];

const plain = generatePcbLayout(nodes, edges, { ...DEFAULT_PCB_OPTIONS, copperFloodMm: 0 });
const fat = generatePcbLayout(nodes, edges, DEFAULT_PCB_OPTIONS);

check('flooding is on by default', (DEFAULT_PCB_OPTIONS.copperFloodMm ?? 0) > 0);
check('a flooded board still routes', fat.completion >= plain.completion, `${fat.completion} vs ${plain.completion}`);
check(
  'flooding introduces no design rule errors',
  fat.violations.filter(v => v.severity === 'error').length ===
    plain.violations.filter(v => v.severity === 'error').length,
  fat.violations.filter(v => v.severity === 'error').map(v => v.message).join(' | ')
);
check('the flood actually happened', fat.copperFloodMm > 0, `${fat.copperFloodMm}`);
check('and is recorded in the program header', fat.gcode.includes('; Copper:'), '');
check('a board with flooding off says nothing about it', !plain.gcode.includes('; Copper:'));

// The isolation ring is what the machine cuts, so it is the ring — not the
// copper — that has to stay on the stock.
const ringPts = fat.isolationPaths.flatMap(p => p.points);
check(
  'every isolation move is still on the board',
  ringPts.every(
    p =>
      p.x >= fat.boardOriginMm - 1e-6 &&
      p.y >= fat.boardOriginMm - 1e-6 &&
      p.x <= fat.boardOriginMm + fat.boardWidthMm + 1e-6 &&
      p.y <= fat.boardOriginMm + fat.boardHeightMm + 1e-6
  ),
  `${ringPts.length} points`
);

console.log(`\n${fails} failure(s)`);
if (fails) throw new Error(`${fails} copper flood test failure(s)`);
