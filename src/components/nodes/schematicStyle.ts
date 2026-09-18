/**
 * Shared visual language for the schematic canvas.
 *
 * Symbols used to each pick their own stroke weights, ink colours and label
 * offsets, so a drawing read as a pile of unrelated icons. Everything on the
 * canvas now draws at one of three weights, one ink colour and one label
 * placement.
 *
 * Stroke weights are in *screen pixels*. A symbol whose viewBox is not 1:1 with
 * its rendered box scales them: `strokeWidth = weight * viewBoxUnits / boxPx`,
 * e.g. a 100-unit viewBox drawn at 80px passes 1.75 to draw STROKE.line.
 *
 * The rest of the shared vocabulary — ink colours, the selection glow, the
 * symbol caption and the device card — lives below.
 */
export const STROKE = {
  /** Leads, wires and symbol outlines. Matches the wire weight in index.css. */
  line: 1.4,
  /** Emphasis marks: capacitor plates, cathode bars, transistor gate/base bars. */
  bold: 2.4,
  /** Interior glyphs: polarity signs, arrowheads, hatching. */
  hair: 1,
} as const;

/**
 * Symbol ink, applied as `text-*` (for `currentColor`), `stroke-*` or `fill-*`:
 *   slate-700 on light, slate-200 on dark.
 * Selected symbols stroke `#3b82f6` and carry
 * `drop-shadow-[0_0_3px_rgba(59,130,246,0.65)]` — one glow, not three.
 */

/**
 * Chrome for instrument/device nodes — mic, speaker, signal generator and the
 * like. They each used to invent their own body: gray-100 vs blue-100 bodies,
 * `border-2` in three colours, shadow-sm/md/lg, p-1/p-2/p-3. On a canvas of
 * 1.4px slate symbols that reads as clutter, so they now share one card.
 */
export const DEVICE_CARD =
  'rounded-md border border-slate-300 dark:border-slate-600 ' +
  'bg-white dark:bg-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.06)]';

/** The card chrome's border width, in px. */
export const CARD_BORDER_PX = 1;

/**
 * Vertical offset for a pin row, measured from the card's *outer* edge.
 *
 * An absolutely positioned handle is placed against its container's padding
 * box, so the card's border shifts every row inward by that much. Left
 * uncorrected a row asked for at 48px renders at 49 — a pixel off the 4px snap
 * grid, and a pin off the grid can never be met by a neighbour's however either
 * part is dragged. Callers give the offset they mean; the border is taken off
 * here, in one place.
 */
export const pinRow = (fromOuterEdgePx: number) => `${fromOuterEdgePx - CARD_BORDER_PX}px`;

/** Same chrome for devices drawn as dark instrument bodies (scope, 555, meter). */
export const DEVICE_CARD_DARK =
  'rounded-md border border-slate-700 bg-slate-800 ' +
  'shadow-[0_1px_3px_rgba(15,23,42,0.25)]';

/** Caption inside a device card. */
export const DEVICE_TITLE =
  'text-[8px] font-mono font-semibold uppercase tracking-wide leading-none ' +
  'text-slate-500 dark:text-slate-400';

/** Recessed "screen" area inside a device card, for waveforms and readouts. */
export const DEVICE_SCREEN =
  'rounded-sm border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950';

export type Placement = 'below' | 'above' | 'right';

export const PLACEMENT: Record<Placement, string> = {
  // Anchored to the node's edge rather than a per-symbol pixel offset, so the
  // gap stays constant no matter how big the symbol is.
  below: 'top-full left-1/2 -translate-x-1/2 mt-[3px] text-center',
  above: 'bottom-full left-1/2 -translate-x-1/2 mb-[3px] text-center',
  right: 'left-full top-1/2 -translate-y-1/2 ml-[5px] text-left',
};


/** Placement for a two-terminal part given its `data.orientation`. */
export const labelPlacementFor = (orientation: string | undefined): Placement =>
  orientation === 'vertical' || orientation === 'up' ? 'right' : 'below';
