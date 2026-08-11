import {
  gridFromPoints,
  normalizeGrid,
  interpolateGridZ,
  getGridStats,
  warpGcode,
  findUnwarpableCommands,
  type ProbePoint,
} from './utils/meshLeveler';

let fails = 0;
function check(name: string, cond: boolean, detail = '') {
  if (!cond) fails++;
  console.log(`${cond ? '  ok  ' : '!!FAIL'} ${name}${cond ? '' : `  ${detail}`}`);
}
function near(a: number, b: number, tol = 1e-6) {
  return Math.abs(a - b) < tol;
}

/** Builds a 3x3 mesh over 0..W / 0..H from a height function. */
function mesh(w: number, h: number, fn: (x: number, y: number) => number): ProbePoint[][] {
  const pts: ProbePoint[][] = [];
  for (let r = 0; r < 3; r++) {
    const row: ProbePoint[] = [];
    for (let c = 0; c < 3; c++) {
      const x = (w / 2) * c;
      const y = (h / 2) * r;
      row.push({ x, y, z: fn(x, y) });
    }
    pts.push(row);
  }
  return pts;
}

// --- 1. A tilted board, probed in machine coords with a large offset --------
// Simulates GRBL reporting [PRB:] in machine space: every reading is shifted
// by -12mm. Normalizing against the origin must cancel that completely.
const tilt = gridFromPoints(mesh(60, 40, (x) => -12 + 0.01 * x))!;
const norm = normalizeGrid(tilt);

check('normalize zeroes the origin corner', near(interpolateGridZ(norm, 0, 0), 0));
check('normalize keeps the tilt', near(interpolateGridZ(norm, 60, 0), 0.6), `${interpolateGridZ(norm, 60, 0)}`);
check('normalize is frame-independent', near(getGridStats(norm).spanZ, getGridStats(tilt).spanZ));

// --- 2. Bilinear interpolation ---------------------------------------------
const bowl = gridFromPoints(mesh(60, 40, (x, y) => (x === 30 && y === 20 ? -0.2 : 0)))!;
check('interpolates the centre dip', near(interpolateGridZ(bowl, 30, 20), -0.2));
check('interpolates midway', near(interpolateGridZ(bowl, 15, 20), -0.1));
check('clamps outside bounds', near(interpolateGridZ(bowl, 999, 999), 0));

// --- 3. Warping ------------------------------------------------------------
const plane = gridFromPoints(mesh(60, 40, (x) => 0.01 * x))!;

const warped = warpGcode('G90 G21\nG0 Z2.000\nG0 X0.000 Y0.000\nG1 Z-0.080 F100\nG1 X60.000 Y0.000 F300', plane, 10);
const wl = warped.split('\n');

check('passes modal lines through', wl[0] === 'G90 G21', wl[0]);
check('compensates the plunge at x=0', wl[3] === 'G1 Z-0.080 F100', wl[3]);
check('subdivides the long cut', wl.length === 5 + 5, `${wl.length}`);
check('last segment reaches the far corner', wl[wl.length - 1] === 'G1 X60.000 Y0.000 Z0.520', wl[wl.length - 1]);
check('feedrate only on first segment', wl[4].endsWith('F300') && !wl[5].includes('F'), `${wl[4]} / ${wl[5]}`);

// A flat (all-zero) grid must be a no-op in Z.
const flat = gridFromPoints(mesh(60, 40, () => 0))!;
const flatWarp = warpGcode('G1 X60.000 Y0.000 Z-0.080 F300', flat, 1000);
check('flat grid leaves depth alone', flatWarp === 'G1 X60.000 Y0.000 Z-0.080 F300', flatWarp);

// Inline comments and compact/zero-padded words must survive.
const compact = warpGcode('G01X60Y0Z-0.08 ; cut', plane, 1000);
check('handles G01 and unspaced words', compact === 'G1 X60.000 Y0.000 Z0.520 ; cut', compact);

// Relative moves pass through untouched but keep position tracking honest.
const rel = warpGcode('G90 G21\nG0 X30 Y20\nG91\nG1 X30\nG90\nG1 Z-0.080', plane, 1000);
const rl = rel.split('\n');
check('relative move untouched', rl[3] === 'G1 X30', rl[3]);
check('tracks position across relative moves', rl[5] === 'G1 Z0.520', rl[5]);
check('reports unwarpable motion', findUnwarpableCommands(rel).includes('G91 relative move'));
check('reports arcs', findUnwarpableCommands('G2 X10 Y10 I5 J0').includes('G2 arc'));
check('clean gcode reports nothing', findUnwarpableCommands('G1 X10 Y10 Z-0.08').length === 0);

// --- 4. Degenerate input ---------------------------------------------------
check('rejects a 1-row mesh', gridFromPoints([[{ x: 0, y: 0, z: 0 }]]) === null);
check('warp with no grid is a no-op', warpGcode('G1 X10', null as any) === 'G1 X10');

console.log(`\n${fails} failure(s)`);
if (fails) throw new Error(`${fails} mesh leveler test failure(s)`);
