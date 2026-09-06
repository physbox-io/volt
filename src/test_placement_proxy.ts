/**
 * Measures how well the placement search's ranking predicts what actually
 * routes.
 *
 * The search ranks candidates in two stages: scorePlacement(), a cheap coarse
 * router that shortlists, and coarseRoutability(), the real router on a
 * one-track grid with a small budget, which orders the shortlist. Only the
 * best few of that order get a full routing pass. This harness is the feedback
 * loop for both — edit either in src/utils/pcbExporter.ts, re-run, and watch
 * the rank correlations.
 *
 * It lays out the same carrier board in several arrangements, routes each one
 * for the truth, ranks each one both ways, and reports how well each ordering
 * agrees with the truth. A ranking worth having puts the arrangements that
 * route at the top of the list.
 *
 * Run with: npx tsx src/test_placement_proxy.ts
 */

import {
  layoutArrangement,
  scorePlacement,
  coarseRoutability,
  DEFAULT_PCB_OPTIONS,
} from './utils/pcbExporter';

// Truth costs a routing pass per arrangement, so this is the whole runtime.
const ROUTING_BUDGET_MS = 4000;

const J2 = ['GND1', 'VIN', 'VE1', 'VE2', 'GPIO_44', 'GPIO_43', 'RST', 'GPIO_0', 'GPIO_36',
  'GPIO_35', 'GPIO_34', 'GPIO_33', 'GPIO_47', 'GPIO_48', 'GPIO_26', 'GPIO_21', 'GPIO_20', 'GPIO_19'];
const J3 = ['GND2', '3V3', '3V3_2', 'GPIO_37', 'GPIO_46', 'GPIO_45', 'GPIO_42', 'GPIO_41', 'GPIO_40',
  'GPIO_39', 'GPIO_38', 'GPIO_1', 'GPIO_2', 'GPIO_3', 'GPIO_4', 'GPIO_5', 'GPIO_6', 'GPIO_7'];

const pins = [
  ...J2.map((id, i) => ({ id, label: id, type: 'io', side: 'left', pinNumber: `J2-${i + 1}` })),
  ...J3.map((id, i) => ({ id, label: id, type: 'io', side: 'right', pinNumber: `J3-${i + 1}` })),
];

/** The TeknoBox carrier: a Heltec V4 module and three connectors. */
function board(
  positions: Record<string, { x: number; y: number }>,
  vertical: Record<string, boolean> = { bo_right: true }
) {
  const orient = (id: string) => (vertical[id] ? { orientation: 'vertical' } : {});
  const nodes = [
    { id: 'heltec1', type: 'mcu', position: positions.heltec1, data: { label: 'Heltec', mcuConfig: {
      presetKey: 'heltec_v4', style: 'header_2x', pinCount: 36, widthMm: 25.5, heightMm: 47.88,
      pitchMm: 2.54, rowSpacingMm: 22.86, isSmd: false, drillDiaMm: 1,
      padWidthMm: 1.8, padHeightMm: 1.8, pins } } },
    { id: 'bo_left', type: 'pinheader', position: positions.bo_left, data: { rows: 1, cols: 5, pitchMm: 2.54, ...orient('bo_left') } },
    { id: 'bo_right', type: 'pinheader', position: positions.bo_right, data: { rows: 1, cols: 4, pitchMm: 2.54, ...orient('bo_right') } },
    { id: 'bme280', type: 'pinheader', position: positions.bme280, data: { rows: 1, cols: 4, pitchMm: 2.54, ...orient('bme280') } },
    { id: 'gnd1', type: 'ground', position: { x: 300, y: 780 }, data: {} },
  ];
  const edges = ([
    ['e1', 'bme280', '3V3', '1'], ['e2', 'bme280', 'GND1', '2'],
    ['e3', 'bme280', 'GPIO_7', '3'], ['e4', 'bme280', 'GPIO_6', '4'],
    ['e5', 'gnd1', 'GND1', 'in'],
    ['e6', 'bo_left', 'GPIO_1', '1'], ['e7', 'bo_left', 'GPIO_2', '2'], ['e8', 'bo_left', 'GPIO_3', '3'],
    ['e9', 'bo_left', 'GPIO_4', '4'], ['e10', 'bo_left', 'GPIO_5', '5'],
    ['e11', 'bo_right', 'VIN', '1'], ['e12', 'bo_right', 'GND2', '2'],
    ['e13', 'bo_right', 'GPIO_33', '3'], ['e14', 'bo_right', 'GPIO_41', '4'],
  ] as [string, string, string, string][]).map(([id, target, sourceHandle, targetHandle]) =>
    ({ id, source: 'heltec1', target, sourceHandle, targetHandle, type: 'smoothstep' }));
  return { nodes, edges };
}

const BASE = {
  heltec1: { x: 300, y: 240 },
  bo_left: { x: 60, y: 300 },
  bo_right: { x: 700, y: 300 },
  bme280: { x: 1000, y: 260 },
};

/**
 * Arrangements to rank. Two are known outcomes and act as anchors: BREAKOUT-R
 * below the module routes completely, to its right leaves GPIO41 unroutable.
 */
const CASES: { name: string; positions: typeof BASE; vertical?: Record<string, boolean> }[] = [
  { name: 'R right (known: does NOT route)', positions: { ...BASE } },
  { name: 'R below (known: ROUTES)', positions: { ...BASE, bo_right: { x: 420, y: 700 } } },
  { name: 'R far below', positions: { ...BASE, bo_right: { x: 420, y: 900 } } },
  { name: 'R below-left', positions: { ...BASE, bo_right: { x: 200, y: 720 } } },
  { name: 'R above', positions: { ...BASE, bo_right: { x: 420, y: 60 } } },
  { name: 'R right, BME low', positions: { ...BASE, bme280: { x: 980, y: 560 } } },
  { name: 'R below, L low', positions: { ...BASE, bo_right: { x: 420, y: 700 }, bo_left: { x: 40, y: 560 } } },
  { name: 'R below, BME above', positions: { ...BASE, bo_right: { x: 420, y: 700 }, bme280: { x: 640, y: 60 } } },
];

// The candidates the search actually feeds the proxy are nothing like the
// hand-built ones above: a random seed for every part, relaxed into a tight
// packing. That is the distribution the earlier proxies misordered by an order
// of magnitude, so it has to be in the set. Deterministic, so runs compare.
let rngState = 0x2f6e2b1;
const rng = () => {
  rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
  return rngState / 0x7fffffff;
};
const RANDOM_CASES = 8;
for (let k = 0; k < RANDOM_CASES; k++) {
  const positions = { ...BASE };
  const vertical: Record<string, boolean> = {};
  for (const id of ['heltec1', 'bo_left', 'bo_right', 'bme280'] as const) {
    positions[id] = { x: Math.round(rng() * 1000), y: Math.round(rng() * 900) };
    if (id !== 'heltec1') vertical[id] = rng() < 0.5;
  }
  CASES.push({ name: `random packing #${k + 1}`, positions, vertical });
}

const opts = { ...DEFAULT_PCB_OPTIONS, autoGrowBoard: true, placementSearch: false, routingBudgetMs: ROUTING_BUDGET_MS };

const COARSE_BUDGET_MS = 300;

// Each arrangement is placed and routed the way the search evaluates a
// candidate - one placement at the tightest spread, scored and routed on that
// same board - rather than through generatePcbLayout, whose three spreads and
// final crop would leave the truth and the proxies looking at different boards.
const rows = CASES.map(c => {
  const b = board(c.positions, c.vertical);
  const r = layoutArrangement(b.nodes as never, b.edges as never, opts);
  const t0 = performance.now();
  const score = scorePlacement(r.components, r.nets, {
    traceWidthMm: opts.traceWidthMm,
    clearanceMm: opts.clearanceMm,
    boardWidthMm: r.boardWidthMm,
    boardHeightMm: r.boardHeightMm,
  });
  const scoreMs = performance.now() - t0;
  const t1 = performance.now();
  const coarse = coarseRoutability(
    r.components, r.boardWidthMm, r.boardHeightMm, r.nets, opts, COARSE_BUDGET_MS
  );
  const coarseMs = performance.now() - t1;
  return { name: c.name, score, scoreMs, coarse, coarseMs, completion: r.completion, unrouted: r.unrouted, overlaps: r.overlaps };
}).filter(r => {
  // The search never scores an arrangement whose courtyards collide.
  if (r.overlaps > 0) console.log(`skipping "${r.name}": ${r.overlaps} overlapping courtyard(s)`);
  return r.overlaps === 0;
});

// Rank correlation between a ranking and true routability. +1 means the
// ranking orders them exactly right, 0 means it carries no information, -1
// means it is exactly backwards — which is roughly where the straight-line
// scores sat.
type Row = (typeof rows)[number];
const tau = (sorted: Row[]) => {
  let concordant = 0, discordant = 0;
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const dc = sorted[i].completion - sorted[j].completion;
      if (dc === 0) continue;
      if (dc > 0) concordant++; else discordant++;
    }
  }
  return concordant + discordant === 0 ? 0 : (concordant - discordant) / (concordant + discordant);
};

const byScore = [...rows].sort((a, b) => a.score - b.score);
const bySearch = [...rows].sort((a, b) =>
  b.coarse.completion - a.coarse.completion ||
  a.coarse.unrouted - b.coarse.unrouted ||
  a.score - b.score
);

console.log('\nRanked as the search ranks them: coarse routing first, cheap score as the');
console.log('tiebreak. A ranking worth having puts completion 1.000 at the top.\n');
console.log('   coarse     score      completion  unrouted  arrangement');
for (const r of bySearch) {
  const flag = r.completion >= 1 ? ' ROUTES ' : '        ';
  console.log(
    `${r.coarse.completion.toFixed(3).padStart(9)}  ${r.score.toFixed(0).padStart(8)}  ` +
    `${r.completion.toFixed(3).padStart(10)}${flag}${String(r.unrouted).padStart(2)}      ${r.name}`
  );
}

const avg = (f: (r: Row) => number) => rows.reduce((s, r) => s + f(r), 0) / rows.length;
console.log(`\nKendall tau vs truth (+1 perfect / 0 useless / -1 inverted):`);
console.log(`  cheap score alone:       ${tau(byScore).toFixed(2)}   (${avg(r => r.scoreMs).toFixed(0)} ms per call)`);
console.log(`  coarse routing + score:  ${tau(bySearch).toFixed(2)}   (${avg(r => r.coarseMs).toFixed(0)} ms per call at a ${COARSE_BUDGET_MS} ms budget)`);
console.log(`routable arrangements: ${rows.filter(r => r.completion >= 1).length} of ${rows.length}`);
const firstRoutable = (sorted: Row[]) => sorted.findIndex(r => r.completion >= 1) + 1;
console.log(`first routable arrangement ranks: ${firstRoutable(byScore)} by score, ${firstRoutable(bySearch)} by the search`);

const best = bySearch[0];
console.log(best.completion >= 1
  ? '\nTop-ranked arrangement routes. The search would have picked a good board.'
  : '\nTop-ranked arrangement does NOT route. The search would have picked a bad board.');
