/**
 * Auto grid mesh levelling.
 *
 * Now `@physbox-io/machining`, shared with Etch and Mesh — all three had their
 * own copy of the same bilinear interpolation and G-code warper. Re-exported
 * under the old path so the modules that use it keep their imports.
 */
export {
  createEmptyGrid,
  findUnwarpableCommands,
  getGridStats,
  gridFromPoints,
  gridOffPlaneMm,
  interpolateGridZ,
  normalizeGrid,
  suggestProbeGrid,
  warpGcode,
  type GridStats,
  type ProbeGrid,
  type ProbePoint,
  type WarpOptions,
} from '@physbox-io/machining';
