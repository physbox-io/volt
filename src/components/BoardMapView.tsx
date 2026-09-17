import React, { useMemo } from 'react';
import { getGridStats, interpolateGridZ, type ProbeGrid } from '../utils/meshLeveler';

/**
 * A picture of the probed surface.
 *
 * The mesh was previously only a scattering of dots over the toolpath preview,
 * green for high and amber for low, which answers "was a probe done" and
 * nothing else. The number that decides whether a board can be isolation
 * milled is the *shape* of the warp — where the high corner is, whether it is a
 * bow or a twist, how much of the board sits within the depth the bit is going
 * to cut at. That is a field, so it is drawn as one.
 *
 * Heights are shaded on a diverging scale about zero, because zero is a real
 * landmark here rather than the middle of the range: it is the plane work Z0
 * was set on, and so the plane the commanded depth is exact at. Blue is copper
 * standing above that plane (the cut comes out deep), amber is below it (the
 * cut comes out shallow, and shallow is what leaves traces joined).
 */

/** Below this span the board is flat enough that a colour scale is noise. */
const FLAT_SPAN_MM = 0.01;

/**
 * Subdivisions per mesh cell. The map's own interpolation is bilinear, so this
 * is not inventing detail — it is drawing the surface the leveller actually
 * applies, rather than a flat quad per cell that no cut is ever made against.
 */
const SUBDIVISIONS = 6;

export interface BoardMapViewProps {
  grid: ProbeGrid;
  /** Board outline to draw over the field, in the same mm frame as the grid. */
  board?: { originMm: number; widthMm: number; heightMm: number };
  /**
   * How much depth the job has to spare over the copper. Cells whose warp eats
   * more than this are called out — that is the board the map cannot save.
   */
  depthMarginMm?: number;
  className?: string;
}

/**
 * Diverging blue↔amber, through a neutral at zero. Written out rather than
 * pulled from a scale library: three stops and a lerp, and it has to land on
 * the same neutral in both themes.
 */
function shade(z: number, span: number): string {
  if (span < FLAT_SPAN_MM) return 'rgb(148, 163, 184)';
  const t = Math.max(-1, Math.min(1, z / span));
  // Neutral slate at zero, out to a saturated end at ±span.
  const [nr, ng, nb] = [148, 163, 184];
  const [hr, hg, hb] = t >= 0 ? [56, 189, 248] : [251, 146, 60];
  const k = Math.abs(t);
  const mix = (n: number, h: number) => Math.round(n + (h - n) * k);
  return `rgb(${mix(nr, hr)}, ${mix(ng, hg)}, ${mix(nb, hb)})`;
}

export const BoardMapView: React.FC<BoardMapViewProps> = ({
  grid,
  board,
  depthMarginMm,
  className = '',
}) => {
  const stats = useMemo(() => getGridStats(grid), [grid]);
  // Symmetric about zero, so a colour means the same distance from the cut
  // plane whichever side of it the copper is on.
  const span = Math.max(Math.abs(stats.minZ), Math.abs(stats.maxZ), FLAT_SPAN_MM);

  const width = grid.maxX - grid.minX;
  const height = grid.maxY - grid.minY;

  /**
   * The field, as one filled rectangle per sub-cell. Flat fills rather than an
   * SVG gradient mesh: gradient meshes are not in SVG 1.1, and a few hundred
   * rects render instantly and print correctly.
   */
  const cells = useMemo(() => {
    const nx = (grid.gridX - 1) * SUBDIVISIONS;
    const ny = (grid.gridY - 1) * SUBDIVISIONS;
    const dx = width / nx;
    const dy = height / ny;
    const out: { x: number; y: number; w: number; h: number; fill: string }[] = [];
    for (let r = 0; r < ny; r++) {
      for (let c = 0; c < nx; c++) {
        const x = grid.minX + c * dx;
        const y = grid.minY + r * dy;
        // Sampled at the centre: sampling at a corner shifts the whole field
        // half a sub-cell up and left, which is visible against the outline.
        const z = interpolateGridZ(grid, x + dx / 2, y + dy / 2);
        // Overlapped by a hair so antialiasing does not leave a grid of seams
        // between the fills.
        out.push({ x, y, w: dx * 1.02, h: dy * 1.02, fill: shade(z, span) });
      }
    }
    return out;
  }, [grid, width, height, span]);

  /** Where the warp is deeper than the job has room for. */
  const overBudget =
    depthMarginMm !== undefined && depthMarginMm > 0
      ? grid.points.flat().filter(p => Math.abs(p.z) > depthMarginMm)
      : [];

  // Room for the corner labels, which sit outside the probed rectangle. Sized
  // off the label rather than guessed: five glyphs at the font size below.
  const pad = width * 0.1;

  return (
    <div className={className}>
      <svg
        viewBox={`${grid.minX - pad} ${grid.minY - pad} ${width + pad * 2} ${height + pad * 2}`}
        className="w-full h-auto max-h-[42vh]"
        role="img"
        aria-label={`Probed surface map, ${grid.gridX} by ${grid.gridY} points, ${stats.spanZ.toFixed(3)}mm of warp`}
      >
        {cells.map((cell, i) => (
          <rect key={i} x={cell.x} y={cell.y} width={cell.w} height={cell.h} fill={cell.fill} />
        ))}

        {/* The board, over the field: the map is probed inside the finished
            edge, so the two are not the same rectangle and the difference is
            worth seeing. */}
        {board && (
          <rect
            x={board.originMm}
            y={board.originMm}
            width={board.widthMm}
            height={board.heightMm}
            fill="none"
            stroke="currentColor"
            className="text-slate-900/40 dark:text-white/40"
            strokeWidth={Math.max(0.15, width / 400)}
            strokeDasharray={`${width / 60} ${width / 90}`}
          />
        )}

        {/* The readings themselves. Everything above is interpolation; these
            are the only places the machine actually touched. */}
        {grid.points.map((row, r) =>
          row.map((pt, c) => (
            <g key={`p_${r}_${c}`}>
              <circle
                cx={pt.x}
                cy={pt.y}
                r={Math.max(0.25, width / 150)}
                fill="none"
                stroke="currentColor"
                className="text-slate-900/60 dark:text-white/70"
                strokeWidth={Math.max(0.1, width / 500)}
              />
              <text
                x={pt.x}
                y={pt.y - width / 60}
                textAnchor="middle"
                fontSize={width / 44}
                className="fill-slate-900/70 dark:fill-white/80 font-mono"
              >
                {pt.z >= 0 ? '+' : ''}
                {pt.z.toFixed(2)}
              </text>
            </g>
          ))
        )}

        {/* Ringed, not recoloured: the colour is carrying the height, and a
            second meaning on the same channel would fight it. */}
        {overBudget.map((pt, i) => (
          <circle
            key={`ob_${i}`}
            cx={pt.x}
            cy={pt.y}
            r={width / 55}
            fill="none"
            stroke="#ef4444"
            strokeWidth={Math.max(0.15, width / 350)}
          />
        ))}
      </svg>

      <div className="mt-2 flex items-center justify-between gap-3 text-[10px] text-slate-500 dark:text-slate-400 font-mono">
        <span className="flex items-center gap-1.5">
          <span
            className="h-2 w-16 rounded-sm"
            style={{
              background: `linear-gradient(to right, ${shade(-span, span)}, ${shade(0, span)}, ${shade(span, span)})`,
            }}
          />
          <span className="whitespace-nowrap">
            {stats.minZ.toFixed(3)} … {stats.maxZ.toFixed(3)}mm
          </span>
        </span>
        <span className="whitespace-nowrap">
          {grid.gridX}×{grid.gridY} · {stats.spanZ.toFixed(3)}mm warp
          {grid.verifyDeviationMm !== undefined
            ? ` · ${grid.verifyDeviationMm.toFixed(3)}mm re-probe`
            : ''}
        </span>
      </div>

      {overBudget.length > 0 && (
        <p className="mt-1.5 text-[10px] text-red-600 dark:text-red-400 leading-snug">
          {overBudget.length} probed point{overBudget.length === 1 ? '' : 's'} sit
          {overBudget.length === 1 ? 's' : ''} further from the Z0 plane than the{' '}
          {depthMarginMm!.toFixed(3)}mm this job has spare over the copper. Levelling compensates
          the shape, so the cut still lands — but there is nothing left for probe scatter, and a
          board this far out is usually not clamped flat.
        </p>
      )}
    </div>
  );
};
