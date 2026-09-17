import React from 'react';
import { AlertTriangle, Check, Compass, RefreshCw } from 'lucide-react';
import { NumberInput } from '@physbox-io/ui';
import { BoardMapView } from './BoardMapView';
import type { ProbeGrid } from '../utils/meshLeveler';

/**
 * Probing the board surface, and the map it produces.
 *
 * This sat in the machine dialog for a while, with the jog keypad and the
 * zeros, on the reasoning that probing is something the machine does. It is
 * not: the mesh is bounded by the board outline — `boardOriginMm` in from work
 * zero on each side, because the stock outside the finished edge is not what
 * gets cut — so the probe cannot be set up without a routed board to bound it,
 * exactly like framing. Both are about this board. They live with it.
 *
 * The map also feeds the isolation depth, which is the other reason to have it
 * here: the measured flatness is what buys back the margin the auto depth
 * spends, and that number is set two panels down on this same tab.
 */

export interface BoardMapPanelProps {
  /** The map as probed, and the same map only if it still covers this board. */
  heightmap: ProbeGrid | null;
  activeHeightmap: ProbeGrid | null;
  heightmapStale: boolean;
  onClearHeightmap: () => void;

  board: { originMm: number; widthMm: number; heightMm: number };
  /** Depth this job has to spare over the copper, for the map to be judged against. */
  depthMarginMm: number;
  /** False while the board is still routing — there is no outline to probe inside. */
  boardReady: boolean;

  suggestedGrid: { cols: number; rows: number };
  probeDepthMm: number;
  onProbeDepthChange: (mm: number) => void;
  /** The bench's retract height. Set in the machine dialog; shown here because
   *  the probe searches downward from it and a search shorter than the retract
   *  can never reach the copper. */
  safeZMm: number;

  probing: boolean;
  probeProgress?: { done: number; total: number };
  machineBusy: boolean;
  onProbeSurface: () => void;
}

const quietButton =
  'py-1.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 ' +
  'disabled:opacity-40 disabled:cursor-not-allowed text-slate-800 dark:text-slate-200 rounded ' +
  'font-semibold text-[11px] flex items-center justify-center gap-1.5 cursor-pointer';

export const BoardMapPanel: React.FC<BoardMapPanelProps> = ({
  heightmap,
  activeHeightmap,
  heightmapStale,
  onClearHeightmap,
  board,
  depthMarginMm,
  boardReady,
  suggestedGrid,
  probeDepthMm,
  onProbeDepthChange,
  safeZMm,
  probing,
  probeProgress,
  machineBusy,
  onProbeSurface,
}) => (
  <div className="p-2.5 rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 space-y-2">
    <div className="flex items-center justify-between">
      <span className="font-semibold text-slate-600 dark:text-slate-300">Board map</span>
      <span className="text-[10px] text-cyan-700 dark:text-cyan-400 font-mono">
        {suggestedGrid.cols}×{suggestedGrid.rows} auto mesh
      </span>
    </div>

    {activeHeightmap ? (
      <>
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-cyan-700 dark:text-cyan-400">
          <Check className="w-3.5 h-3.5 shrink-0" />
          Mapped — levelled against {activeHeightmap.gridX * activeHeightmap.gridY} probed points
        </div>
        <BoardMapView
          grid={activeHeightmap}
          board={board}
          depthMarginMm={depthMarginMm}
          className="pt-1"
        />
      </>
    ) : heightmapStale ? (
      <div className="space-y-2">
        <div className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span>
            The map on file no longer covers this board, so it will not be applied. Re-probe, or
            clear it and cut at the commanded depth.
          </span>
        </div>
        {heightmap && <BoardMapView grid={heightmap} board={board} className="opacity-50" />}
        <button onClick={onClearHeightmap} className={`${quietButton} w-full`}>
          Clear the old map
        </button>
      </div>
    ) : (
      /* Not an error — a board can be cut unlevelled, and the auto isolation
         depth already falls back to its most conservative flatness allowance
         when there is no measurement. It just costs copper, so say so. */
      <div className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-300 leading-snug">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
        <span>
          Not probed. The job will cut at the commanded depth, so the isolation pass has to run deep
          enough to clear the copper on the low spots — which is a wider channel, and less copper,
          everywhere else. Probing takes a few minutes and needs the continuity clip on the bit.
        </span>
      </div>
    )}

    <div className="pt-1">
      <label className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold mb-1 block">
        Probe search depth (mm)
      </label>
      <NumberInput
        step={0.5}
        min={0.5}
        value={probeDepthMm}
        disabled={machineBusy}
        onChange={onProbeDepthChange}
        className="w-full px-2 py-1.5 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200 font-mono text-[11px] disabled:opacity-40"
      />
    </div>

    {/* The probe starts at the retract height, so anything less than that never
        reaches Z0 at all — it alarms out on the first point rather than after a
        slow full-grid pass. */}
    {probeDepthMm <= safeZMm && (
      <div className="text-[10px] text-amber-700 dark:text-amber-400 leading-relaxed">
        Search depth must exceed the {safeZMm}mm retract height set in the machine dialog, or the
        probe stops above the copper and the machine raises ALARM:5.
      </div>
    )}

    <button
      onClick={onProbeSurface}
      disabled={machineBusy || !boardReady}
      title={
        boardReady
          ? `Probe a ${suggestedGrid.cols}×${suggestedGrid.rows} mesh across this board's surface`
          : 'Waiting for the board to finish routing — the mesh is probed inside its outline'
      }
      className={`${quietButton} w-full`}
    >
      {probing ? (
        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
      ) : (
        <Compass className="w-3.5 h-3.5" />
      )}
      {probing
        ? probeProgress
          ? `Probing ${probeProgress.done}/${probeProgress.total}`
          : 'Probing…'
        : activeHeightmap
        ? 'Re-probe surface'
        : 'Probe surface'}
    </button>
  </div>
);
