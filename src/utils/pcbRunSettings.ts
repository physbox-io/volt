// ---------------------------------------------------------------------------
// What a milling run is remembered as
//
// The machine layer is handed a string of G-code and cannot reconstruct any of
// this: the laminate, the bits, the feeds they were worked out for. It is
// gathered where the board and the CAM settings are in scope and travels with
// the job, so the archived run says "FR4 Standard (1.6mm, 1oz Cu), 30° V-bit,
// 12000rpm" rather than only how many lines it streamed.
//
// `material` is a plain string on purpose. The run archive has no schema across
// the apps — each writes what it knows — and every reader of it, including the
// job history list and `/api/runs/summary`, looks for that one key by name.
// ---------------------------------------------------------------------------

import { DEFAULT_PCB_OPTIONS, type PcbLayoutResult, type PcbOptions } from './pcbExporter';
import { findMaterial, findTool } from './pcbTooling';

export interface PcbRunContextInput {
  /** A `PCB_MATERIAL_PRESETS` id. An unknown one is recorded as itself. */
  materialId: string;
  /** Whatever the caller has; anything missing falls back to the defaults. */
  options: Partial<PcbOptions>;
  /** The laid-out board, when there is one — a frame pass has one too. */
  result?: PcbLayoutResult;
  /** Tool catalogue ids, when the caller picked from the catalogue. */
  isolationToolId?: string;
  profileToolId?: string;
  /** What this run is, when it is not the whole board: 'frame', say. */
  kind?: string;
}

/**
 * The settings blob posted with the first telemetry frame of a run.
 *
 * Only what somebody would come back to their history *for*: what it was cut
 * from, with what, how hard, and how big it came out. Everything here is either
 * chosen by the operator or derived from that choice — nothing is a restatement
 * of the G-code, which the archive already has.
 */
export function pcbRunSettings(input: PcbRunContextInput): Record<string, unknown> {
  const { materialId, result } = input;
  const options: PcbOptions = { ...DEFAULT_PCB_OPTIONS, ...input.options };
  const material = findMaterial(materialId);
  const isolationTool = input.isolationToolId ? findTool(input.isolationToolId) : undefined;
  const profileTool = input.profileToolId ? findTool(input.profileToolId) : undefined;

  return {
    // The name, not the id: this is read by a human in a list, next to rows
    // from Etch that say "6mm walnut".
    material: material?.name ?? materialId,
    materialId,
    substrate: material?.substratetype ?? null,
    copperThicknessUm: material?.copperThicknessUm ?? null,
    stockThickness: options.boardThicknessMm,
    machine: 'mill',
    layers: result?.layers ?? options.layers ?? 1,
    widthMm: result?.boardWidthMm ?? options.boardWidthMm,
    heightMm: result?.boardHeightMm ?? options.boardHeightMm,
    isolationTool: isolationTool?.name ?? null,
    profileTool: profileTool?.name ?? null,
    isolationPasses: options.isolationPasses,
    isolationDepthZ: options.isolationDepthZ,
    cutFeedrate: options.cutFeedrate,
    plungeFeedrate: options.plungeFeedrate,
    spindleRpm: options.spindleRpm,
    zStepdown: options.zStepdown,
    ...(result
      ? {
          components: result.components.length,
          traces: result.traces.length,
          drills: result.drills.length,
        }
      : {}),
    ...(input.kind ? { kind: input.kind } : {}),
  };
}

/** The job name a run is filed under. A board has no name of its own here. */
export function pcbJobName(documentName: string | null | undefined, kind?: string): string {
  const base = documentName?.trim() || 'Untitled circuit';
  return kind ? `${base} (${kind})` : base;
}
