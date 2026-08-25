/**
 * Auto Grid Mesh Leveling Engine for PCB Milling
 *
 * Provides bilinear heightmap interpolation and dynamic G-code trajectory
 * warping to compensate for warped FR4 copper-clad boards during PCB milling.
 */

export interface ProbePoint {
  x: number;
  y: number;
  z: number; // Measured Z offset (mm) relative to reference Z0
}

export interface ProbeGrid {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  gridX: number; // Number of sample points along X axis (>= 2)
  gridY: number; // Number of sample points along Y axis (>= 2)
  /** 2D array of probed points: points[row_y][col_x] */
  points: ProbePoint[][];
  /**
   * How far a re-probe of the first point landed from its recorded height, in
   * mm — the machine's own repeatability, measured on this setup rather than
   * assumed.
   *
   * It is the number the isolation depth budget actually needs. Probe trigger
   * scatter, backlash, a frame that shifted mid-probe and lost steps all show
   * up here, and none of them are visible in the map itself: the map is one
   * reading per point with nothing to compare against. Undefined when the
   * verification pass did not run.
   */
  verifyDeviationMm?: number;
}

export interface GridStats {
  minZ: number;
  maxZ: number;
  spanZ: number;
  avgZ: number;
}

/**
 * Creates an initial unprobed grid spanning the given bounds with zeroed Z offsets.
 */
export function createEmptyGrid(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  gridX: number = 3,
  gridY: number = 3
): ProbeGrid {
  const gx = Math.max(2, Math.round(gridX));
  const gy = Math.max(2, Math.round(gridY));

  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;

  const stepX = gx > 1 ? width / (gx - 1) : 0;
  const stepY = gy > 1 ? height / (gy - 1) : 0;

  const points: ProbePoint[][] = [];

  for (let row = 0; row < gy; row++) {
    const rowPoints: ProbePoint[] = [];
    const y = bounds.minY + row * stepY;

    for (let col = 0; col < gx; col++) {
      const x = bounds.minX + col * stepX;
      rowPoints.push({ x, y, z: 0 });
    }
    points.push(rowPoints);
  }

  return {
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY,
    gridX: gx,
    gridY: gy,
    points,
  };
}

/**
 * Auto-suggests optimal probe grid matrix dimensions (cols, rows) for a PCB board
 * size, holding spacing approximately equal across X and Y axes.
 */
export function suggestProbeGrid(
  widthMm: number,
  heightMm: number,
  base = 4,
  max = 8
): { cols: number; rows: number } {
  const clamp = (n: number) => Math.max(2, Math.min(max, Math.round(n)));
  const shorter = Math.min(widthMm, heightMm);
  if (shorter <= 1e-3) return { cols: clamp(base), rows: clamp(base) };

  const spacing = shorter / (clamp(base) - 1);
  return {
    cols: clamp(widthMm / spacing + 1),
    rows: clamp(heightMm / spacing + 1),
  };
}

/**
 * Computes min, max, span, and average Z values across the grid.
 */
export function getGridStats(grid: ProbeGrid): GridStats {
  let minZ = Infinity;
  let maxZ = -Infinity;
  let sumZ = 0;
  let count = 0;

  for (let r = 0; r < grid.gridY; r++) {
    for (let c = 0; c < grid.gridX; c++) {
      const z = grid.points[r][c].z;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
      sumZ += z;
      count++;
    }
  }

  if (count === 0) {
    return { minZ: 0, maxZ: 0, spanZ: 0, avgZ: 0 };
  }

  return {
    minZ,
    maxZ,
    spanZ: maxZ - minZ,
    avgZ: sumZ / count,
  };
}

/**
 * Wraps a probed row/column matrix as a ProbeGrid, deriving the bounds from the
 * corner points. Returns null for anything too small to interpolate across.
 */
export function gridFromPoints(points: ProbePoint[][]): ProbeGrid | null {
  const rows = points?.length ?? 0;
  const cols = rows > 0 ? points[0].length : 0;
  if (rows < 2 || cols < 2) return null;

  return {
    minX: points[0][0].x,
    minY: points[0][0].y,
    maxX: points[0][cols - 1].x,
    maxY: points[rows - 1][0].y,
    gridX: cols,
    gridY: rows,
    points,
  };
}

/**
 * Re-references every probed Z against the height at (refX, refY), so the grid
 * holds *offsets from the work Z0 plane* rather than raw probe readings.
 *
 * warpGcode adds these values to commanded Z, so an unreferenced grid would
 * shift the whole job by whatever absolute height the probe reported. The
 * reference defaults to the grid origin, which is where the operator zeroed Z.
 *
 * This also makes the probe's own coordinate frame irrelevant: GRBL reports
 * [PRB:] in machine coordinates, but the differences are identical in machine
 * and work space, so subtracting the reference cancels the work offset.
 */
export function normalizeGrid(
  grid: ProbeGrid,
  refX: number = grid.minX,
  refY: number = grid.minY
): ProbeGrid {
  const refZ = interpolateGridZ(grid, refX, refY);
  if (refZ === 0) return grid;

  return {
    ...grid,
    points: grid.points.map(row => row.map(p => ({ ...p, z: p.z - refZ }))),
  };
}

/**
 * How far the whole probed surface sits clear of the work Z0 plane, beyond the
 * board's own measured warp. Zero for a map that is properly referenced.
 *
 * Zeroing on the copper puts Z0 *inside* the surface the map spans, so a good
 * map's range straddles zero. A map that is the right shape but sits bodily
 * above or below zero is referenced to a different plane than the one the job
 * will be cut against — and since warpGcode adds the map to every commanded Z,
 * that body offset lifts or drops the entire job while the map still looks
 * perfectly reasonable. It is the difference between a trace that isolates and
 * one the bit never reaches.
 *
 * A map is allowed to clear zero by its own span — Z0 may have been set just
 * outside the mesh, on a corner that really is the high or low point — so what
 * is returned is the excess beyond that, which callers compare against probe
 * repeatability rather than against warp.
 */
export function gridOffPlaneMm(grid: ProbeGrid): number {
  const { minZ, maxZ, spanZ } = getGridStats(grid);
  const clearance = Math.max(0, minZ, -maxZ);
  return Math.max(0, clearance - spanZ);
}

/**
 * Evaluates bilinear heightmap Z-offset at coordinates (x, y).
 * Clamps to grid boundaries if (x,y) lies outside grid bounds.
 */
export function interpolateGridZ(grid: ProbeGrid, x: number, y: number): number {
  if (!grid || !grid.points || grid.gridX < 2 || grid.gridY < 2) return 0;

  const clampedX = Math.max(grid.minX, Math.min(grid.maxX, x));
  const clampedY = Math.max(grid.minY, Math.min(grid.maxY, y));

  const width = grid.maxX - grid.minX;
  const height = grid.maxY - grid.minY;

  if (width <= 1e-6 || height <= 1e-6) {
    return grid.points[0][0].z;
  }

  const normX = ((clampedX - grid.minX) / width) * (grid.gridX - 1);
  const normY = ((clampedY - grid.minY) / height) * (grid.gridY - 1);

  const col0 = Math.min(Math.floor(normX), grid.gridX - 2);
  const row0 = Math.min(Math.floor(normY), grid.gridY - 2);

  const col1 = col0 + 1;
  const row1 = row0 + 1;

  const tx = normX - col0;
  const ty = normY - row0;

  const z00 = grid.points[row0][col0].z;
  const z10 = grid.points[row0][col1].z;
  const z01 = grid.points[row1][col0].z;
  const z11 = grid.points[row1][col1].z;

  const top = z00 * (1 - tx) + z10 * tx;
  const bottom = z01 * (1 - tx) + z11 * tx;

  return top * (1 - ty) + bottom * ty;
}

function f(num: number): string {
  return num.toFixed(3);
}

/** Splits a line into its code and trailing comment (`;` or `(...)`). */
function splitComment(line: string): { code: string; comment: string } {
  const semi = line.indexOf(';');
  const paren = line.indexOf('(');
  const at =
    semi < 0 ? paren : paren < 0 ? semi : Math.min(semi, paren);
  if (at < 0) return { code: line, comment: '' };
  return { code: line.slice(0, at).trimEnd(), comment: ' ' + line.slice(at) };
}

/** Reads a word's numeric argument, e.g. "X-12.5" -> -12.5. NaN if unparseable. */
function wordValue(part: string): number {
  return parseFloat(part.slice(1));
}

/**
 * Finds motion this warper cannot compensate: arcs (G2/G3), canned cycles, and
 * moves issued in relative mode. Callers should surface these to the operator
 * rather than silently streaming uncompensated depths.
 */
export function findUnwarpableCommands(gcode: string): string[] {
  const found = new Set<string>();
  let absoluteMode = true;

  for (const rawLine of gcode.split('\n')) {
    const { code } = splitComment(rawLine.trim());
    if (!code) continue;

    const words = code.toUpperCase().split(/\s+/);
    for (const w of words) {
      const m = /^G0*(\d+)$/.exec(w);
      if (!m) continue;
      const n = parseInt(m[1], 10);
      if (n === 90) absoluteMode = true;
      if (n === 91) absoluteMode = false;
      if (n === 2 || n === 3) found.add(`G${n} arc`);
      if (n >= 81 && n <= 89) found.add(`G${n} canned cycle`);
    }
    if (!absoluteMode && /(^|\s)G0*[01](\s|$)/.test(code.toUpperCase())) {
      found.add('G91 relative move');
    }
  }

  return [...found];
}

/**
 * Warps G-code by subdividing linear moves and applying heightmap compensation
 * (Z_actual = Z_commanded + Z_offset(x, y)).
 *
 * The grid must hold offsets relative to the work Z0 plane — see normalizeGrid.
 * Motion listed by findUnwarpableCommands passes through untouched, though
 * position tracking stays correct across it.
 */
export function warpGcode(
  gcode: string,
  grid: ProbeGrid,
  maxSegmentLenMm = 1.0
): string {
  if (!gcode || !grid) return gcode;

  const lines = gcode.split('\n');
  const result: string[] = [];

  let curX = 0;
  let curY = 0;
  let curZ = 0;
  let absoluteMode = true;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const rawLine = lines[lineIdx];
    const { code, comment } = splitComment(rawLine.trim());

    if (!code) {
      result.push(rawLine);
      continue;
    }

    // Split "G1X10Y10" style words as well as space-separated ones, so a
    // hand-edited or third-party file is not silently passed through uncut.
    const parts = (code.toUpperCase().match(/[A-Z][^A-Z]*/g) ?? []).map(p => p.trim());

    for (const p of parts) {
      if (p === 'G90') absoluteMode = true;
      if (p === 'G91') absoluteMode = false;
    }

    const cmd = parts.length > 0 ? parts[0].replace(/^G0+(\d)/, 'G$1') : '';
    const isLinear = cmd === 'G0' || cmd === 'G1';

    if (!isLinear) {
      result.push(rawLine);
      continue;
    }

    let targetX = curX;
    let targetY = curY;
    let targetZ = curZ;
    let hasX = false;
    let hasY = false;
    let hasZ = false;
    let feedrateStr = '';

    for (let i = 1; i < parts.length; i++) {
      const p = parts[i];
      const v = wordValue(p);
      if (Number.isNaN(v) && p[0] !== 'F') continue;

      if (p.startsWith('X')) {
        targetX = absoluteMode ? v : curX + v;
        hasX = true;
      } else if (p.startsWith('Y')) {
        targetY = absoluteMode ? v : curY + v;
        hasY = true;
      } else if (p.startsWith('Z')) {
        targetZ = absoluteMode ? v : curZ + v;
        hasZ = true;
      } else if (p.startsWith('F')) {
        feedrateStr = ` ${p}`;
      }
    }

    // Relative moves are tracked but not rewritten — emitting a warped
    // incremental Z would compound the offset on every subsequent move.
    if (!absoluteMode) {
      result.push(rawLine);
      curX = targetX;
      curY = targetY;
      curZ = targetZ;
      continue;
    }

    const distXY = Math.hypot(targetX - curX, targetY - curY);

    if (cmd === 'G1' && distXY > maxSegmentLenMm && (hasX || hasY)) {
      const steps = Math.ceil(distXY / maxSegmentLenMm);

      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const px = curX + (targetX - curX) * t;
        const py = curY + (targetY - curY) * t;
        const pzNominal = curZ + (targetZ - curZ) * t;

        const zOffset = interpolateGridZ(grid, px, py);
        const pzWarped = pzNominal + zOffset;

        const fParam = s === 1 ? feedrateStr : '';
        const tail = s === steps ? comment : '';
        result.push(`G1 X${f(px)} Y${f(py)} Z${f(pzWarped)}${fParam}${tail}`);
      }
    } else {
      const zOffset = interpolateGridZ(grid, targetX, targetY);
      const warpedZ = targetZ + zOffset;

      let newLine = cmd;
      if (hasX) newLine += ` X${f(targetX)}`;
      if (hasY) newLine += ` Y${f(targetY)}`;
      if (hasZ || hasX || hasY) newLine += ` Z${f(warpedZ)}`;
      newLine += feedrateStr + comment;

      result.push(newLine);
    }

    curX = targetX;
    curY = targetY;
    curZ = targetZ;
  }

  return result.join('\n');
}
