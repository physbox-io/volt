import {
  PCB_TOOL_PRESETS,
  PCB_MATERIAL_PRESETS,
  calculatePcbFeeds,
  vBitWidthAtDepth,
} from './utils/pcbTooling.js';
import {
  generateAirCutGcode,
  sortPathsNearestNeighbor,
  estimatePcbMachiningMetrics,
  DEFAULT_PCB_OPTIONS,
  type IsolationPath,
} from './utils/pcbExporter.js';
import { suggestProbeGrid } from './utils/meshLeveler.js';

function assert(condition: any, message?: string) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

function assertStrictEqual(actual: any, expected: any, message?: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

console.log('--- RUNNING PCB MILLING UPGRADE VERIFICATION TESTS ---');

// 1. Test PCB Tooling & Physics Feeds
const t1Tool = PCB_TOOL_PRESETS.find(t => t.id === 't1_vbit_30')!;
const fr4Mat = PCB_MATERIAL_PRESETS.find(m => m.id === 'fr4_1oz')!;
assert(t1Tool, 'T1 tool preset found');
assert(fr4Mat, 'FR4 material preset found');

const feeds = calculatePcbFeeds(t1Tool, fr4Mat);
assertStrictEqual(feeds.cutFeedrate, 350, 'Cut feedrate calculated correctly');
assertStrictEqual(feeds.plungeFeedrate, 80, 'Plunge feedrate calculated correctly');

const effWidth = vBitWidthAtDepth(0.1, 30, -0.08);
assert(effWidth > 0.1 && effWidth < 0.2, 'V-bit effective cut width calculated');
console.log(`[PASS] PCB Feeds & Tooling Catalog (T1 V-Bit Eff Width: ${effWidth.toFixed(4)}mm)`);

// 2. Test Auto Grid Suggestion
const grid = suggestProbeGrid(60, 40);
assert(grid.cols >= 4 && grid.rows >= 3, 'Probe grid dimensions auto-calculated');
console.log(`[PASS] Auto Probe Grid Suggestion (60x40mm -> ${grid.cols}x${grid.rows} mesh)`);

// 3. Test Path Traversal Optimization (TSP Nearest Neighbor)
const paths: IsolationPath[] = [
  { netId: 'net1', pass: 0, points: [{ x: 50, y: 30 }, { x: 55, y: 30 }] },
  { netId: 'net2', pass: 0, points: [{ x: 2, y: 2 }, { x: 5, y: 2 }] },
  { netId: 'net3', pass: 0, points: [{ x: 6, y: 3 }, { x: 8, y: 3 }] },
];

const sorted = sortPathsNearestNeighbor(paths);
assertStrictEqual(sorted.length, 3, 'Path count preserved');
assertStrictEqual(sorted[0].netId, 'net2', 'Greedy nearest path chosen first');
assertStrictEqual(sorted[1].netId, 'net3', 'Closest consecutive path chosen next');
console.log('[PASS] TSP Nearest-Neighbor Path Sorting');

// 4. Test Air Cut G-code Generator
const mockGcode = `G90 G21
G0 X0 Y0 Z2.000
G1 Z-0.080 F80
G1 X10 Y0 Z-0.080 F300
G0 Z2.000`;

const airCutGcode = generateAirCutGcode(mockGcode, 20);
assert(airCutGcode.includes('AIR CUT DRY RUN PROGRAM (+20mm Z-Offset)'), 'Air Cut header present');
assert(airCutGcode.includes('Z19.920'), 'Z-0.080 shifted by +20mm to Z19.920');
assert(airCutGcode.includes('Z22.000'), 'Z2.000 shifted by +20mm to Z22.000');
console.log('[PASS] Air Cut Dry Run G-code Generator');

// 5. Test Cycle Metrics Estimation
const metrics = estimatePcbMachiningMetrics(mockGcode, DEFAULT_PCB_OPTIONS);
assert(metrics.cutDistanceMm >= 10, 'Cut distance tracked');
assert(metrics.cycleTimeSec >= 0, 'Cycle time estimated');
console.log(`[PASS] Machining Metrics Estimation (${metrics.cutDistanceMm}mm cut, ${metrics.cycleTimeSec}s est runtime)`);

console.log('--- ALL PCB MILLING UPGRADE VERIFICATION TESTS PASSED SUCCESSFULLY ---');
