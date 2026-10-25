import type { ProbeGrid } from '@physbox-io/machining';

// ---------------------------------------------------------------------------
// Which part of a job a height map describes
// ---------------------------------------------------------------------------
//
// A probed height map is a measurement of one face of one blank, clamped one
// way. Two things make it stop describing the job: the board on the canvas
// growing past the area that was probed, and the board being turned over. Both
// checks live here so the export dialog and the MCP mill verb make the same
// ones — the MCP path used to make neither.

/**
 * The comment on a double-sided job's flip pause. The exporter writes it and
 * the levelling reads it, so it is one constant rather than two strings that
 * have to be kept in step.
 */
export const BOARD_FLIP_NOTE = 'PAUSE: Flip board horizontally onto registration pins';

/** Whether a G-code line is the double-sided job's flip pause. */
export function isBoardFlipLine(line: string): boolean {
  const semi = line.indexOf(';');
  if (semi < 0) return false;
  return /^\s*M0*0\s*$/i.test(line.slice(0, semi)) && line.slice(semi + 1).includes(BOARD_FLIP_NOTE);
}

/**
 * Splits a program at the board flip: everything cut on the face that was
 * probed, and everything after the board was turned over (flip pause
 * included), or null for a single-sided job.
 */
export function splitAtBoardFlip(gcode: string): { probedFace: string; afterFlip: string | null } {
  const lines = gcode.split('\n');
  const at = lines.findIndex(isBoardFlipLine);
  if (at < 0) return { probedFace: gcode, afterFlip: null };
  return { probedFace: lines.slice(0, at).join('\n'), afterFlip: lines.slice(at).join('\n') };
}

/**
 * How far the board may extend past the probed mesh before the map counts as
 * no longer describing it. Inside this margin the leveller's clamped
 * interpolation carries the edge samples outward, which is a fair reading over
 * a strip this narrow.
 */
export const HEIGHTMAP_EDGE_MARGIN_MM = 1;

/** The board rectangle in work coordinates, from a layout result. */
export interface BoardRect {
  boardOriginMm: number;
  boardWidthMm: number;
  boardHeightMm: number;
}

/**
 * Whether a map still spans the board.
 *
 * Bounds are compared rather than board dimensions because probing itself
 * moves the board: the measured flatness feeds the auto isolation depth, which
 * changes the channel width and so the auto-sized board by a fraction of a mm.
 * That shift leaves the mesh covering the board perfectly well, and an
 * equality test on the size would throw away every map the moment it was made.
 *
 * The board starts at `boardOriginMm`, not at work zero — the profile cutter
 * and, double-sided, the registration pins take the margin in front of it. A
 * check against 0..width would pass a map that missed the far edge by exactly
 * that margin.
 */
export function heightmapCoversBoard(grid: ProbeGrid | null, board: BoardRect): boolean {
  if (!grid) return false;
  const o = board.boardOriginMm;
  return (
    grid.minX <= o + HEIGHTMAP_EDGE_MARGIN_MM &&
    grid.minY <= o + HEIGHTMAP_EDGE_MARGIN_MM &&
    grid.maxX >= o + board.boardWidthMm - HEIGHTMAP_EDGE_MARGIN_MM &&
    grid.maxY >= o + board.boardHeightMm - HEIGHTMAP_EDGE_MARGIN_MM
  );
}

/** The area to probe for a board: the board itself, where it actually sits. */
export function boardProbeBounds(board: BoardRect): { minX: number; minY: number; maxX: number; maxY: number } {
  const o = board.boardOriginMm;
  return { minX: o, minY: o, maxX: o + board.boardWidthMm, maxY: o + board.boardHeightMm };
}
