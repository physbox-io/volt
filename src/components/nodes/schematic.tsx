import type { CSSProperties, ReactNode } from 'react';
import { Handle, Position } from '@xyflow/react';

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

/**
 * Inline numeric field for editing a device setting directly on the canvas.
 *
 * `nodrag`/`nopan` keep a drag inside the field from panning the canvas or
 * dragging the node out from under the pointer.
 */
export function DeviceField({
  value,
  unit,
  min,
  max,
  step = 1,
  title,
  onCommit,
}: {
  value: number;
  unit: string;
  min?: number;
  max?: number;
  step?: number;
  title?: string;
  onCommit: (next: number) => void;
}) {
  return (
    <label className="nodrag nopan flex items-baseline gap-[1px] cursor-text" title={title}>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onPointerDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          const next = parseFloat(e.target.value);
          if (!Number.isNaN(next)) onCommit(next);
        }}
        className="w-[30px] bg-transparent text-right font-mono text-[8px] leading-none
                   text-slate-700 dark:text-slate-200 border-b border-dotted
                   border-slate-300 dark:border-slate-600 outline-none
                   focus:border-solid focus:border-emerald-500
                   [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
      />
      <span className="font-mono text-[8px] leading-none text-slate-400 dark:text-slate-500">
        {unit}
      </span>
    </label>
  );
}

type Placement = 'below' | 'above' | 'right';

const PLACEMENT: Record<Placement, string> = {
  // Anchored to the node's edge rather than a per-symbol pixel offset, so the
  // gap stays constant no matter how big the symbol is.
  below: 'top-full left-1/2 -translate-x-1/2 mt-[3px] text-center',
  above: 'bottom-full left-1/2 -translate-x-1/2 mb-[3px] text-center',
  right: 'left-full top-1/2 -translate-y-1/2 ml-[5px] text-left',
};

/**
 * Reference designator / value caption for a symbol.
 *
 * Horizontal parts caption below, vertical parts caption to the right — that
 * keeps the caption clear of the leads, which is where the old fixed offsets
 * put it straight on top of the wire.
 */
export function SchematicLabel({
  placement = 'below',
  name,
  value,
  children,
}: {
  placement?: Placement;
  /** Reference designator, e.g. `R1`. */
  name?: ReactNode;
  /** Component value, e.g. `10k`. */
  value?: ReactNode;
  children?: ReactNode;
}) {
  // Beside a part the caption has to stay narrow or it runs into whatever sits
  // in the next column, so designator and value stack. Below a part there is
  // room for one line, which is also the tidier read.
  const stacked = placement === 'right' && name != null && value != null;

  return (
    <div
      className={
        'absolute pointer-events-none select-none whitespace-nowrap font-mono ' +
        'text-[8px] leading-[1.25] tracking-tight font-medium ' +
        'text-slate-500 dark:text-slate-400 ' +
        // Knock the canvas out behind the caption: wires routed past a part used
        // to run straight through its text.
        'bg-[#f8fafc]/85 dark:bg-[#0b0f19]/85 rounded-[2px] px-[2px] ' +
        PLACEMENT[placement]
      }
    >
      {stacked ? (
        <>
          <div>{name}</div>
          <div>{value}</div>
        </>
      ) : (
        children ?? (
          <>
            {name}
            {name != null && value != null ? ' ' : null}
            {value}
          </>
        )
      )}
    </div>
  );
}

/** Placement for a two-terminal part given its `data.orientation`. */
export const labelPlacementFor = (orientation: string | undefined): Placement =>
  orientation === 'vertical' || orientation === 'up' ? 'right' : 'below';


/**
 * `data.orientation`, resolved once.
 *
 * Every two-lead part reads the same four values off it, and they used to be
 * recomputed inline in each symbol — which is why only a handful of parts
 * honoured the field at all, and why the ones that did disagreed about whether
 * 'up' counted as vertical.
 *
 * 'vertical' and 'up' both stand the part on end; 'left' and 'up' additionally
 * mirror it, so its first lead comes out of the far side.
 */
export function resolveOrientation(orientation: unknown) {
  const value = typeof orientation === 'string' ? orientation : 'horizontal';
  const isUp = value === 'up';
  return {
    orientation: value,
    isVertical: value === 'vertical' || isUp,
    isLeft: value === 'left',
    isUp,
    labelPlacement: labelPlacementFor(value),
  };
}

export type LeadOrientation = ReturnType<typeof resolveOrientation>;

/** Where a two-lead part's box sits, in px, for a given orientation. */
export function leadBoxStyle(
  { isVertical }: LeadOrientation,
  width: number,
  height: number,
): CSSProperties {
  return {
    width: isVertical ? height : width,
    height: isVertical ? width : height,
  };
}

/**
 * The four React Flow handles a two-lead part needs: a source and a target on
 * each lead, so a wire can be drawn from either end.
 *
 * Horizontal: first lead left, second right. Vertical: first top, second
 * bottom. 'left'/'up' swap the two ends over.
 */
export function LeadHandles({
  first,
  second,
  orientation,
  className = 'w-2 h-2 bg-emerald-500 !border-0',
}: {
  /** Handle id of the first lead — `in`, `anode`, `pos`, `a`. */
  first: string;
  /** Handle id of the second lead — `out`, `cathode`, `neg`, `b`. */
  second: string;
  orientation: LeadOrientation;
  className?: string;
}) {
  const { isVertical, isLeft, isUp } = orientation;

  const at = (atEnd: boolean) => {
    // atEnd is the far lead: right when horizontal, bottom when vertical,
    // before any mirroring.
    const flipped = isVertical ? isUp : isLeft;
    const far = atEnd !== flipped;
    const position = isVertical
      ? (far ? Position.Bottom : Position.Top)
      : (far ? Position.Right : Position.Left);
    const style: CSSProperties = isVertical
      ? { left: '50%', top: far ? '100%' : '0%' }
      : { top: '50%', left: far ? '100%' : '0%' };
    return { position, style };
  };

  const lead = (id: string, atEnd: boolean) => {
    const { position, style } = at(atEnd);
    return (
      <>
        <Handle type="target" position={position} id={id} className={className} style={style} />
        <Handle type="source" position={position} id={id} className={className} style={style} />
      </>
    );
  };

  return (
    <>
      {lead(first, false)}
      {lead(second, true)}
    </>
  );
}

/**
 * Stands a symbol on end without redrawing it.
 *
 * The parts that already had vertical support carry a second, hand-authored
 * path for it. That does not scale to every two-lead component, and hand
 * copies drift, so everything else keeps its one horizontal drawing and gets
 * rotated a quarter turn inside a box whose sides have been swapped. Only the
 * artwork turns — captions and any interactive chrome stay upright, since they
 * are rendered outside this wrapper.
 */
export function RotatedSymbol({
  orientation,
  width,
  height,
  children,
}: {
  orientation: LeadOrientation;
  width: number;
  height: number;
  children: ReactNode;
}) {
  const { isVertical, isLeft, isUp } = orientation;
  const mirror = isVertical ? isUp : isLeft;

  const transforms = [
    'translate(-50%, -50%)',
    isVertical ? 'rotate(90deg)' : '',
    mirror ? 'scaleX(-1)' : '',
  ].filter(Boolean);

  return (
    <div
      className="absolute"
      style={{
        left: '50%',
        top: '50%',
        width,
        height,
        transform: transforms.join(' '),
      }}
    >
      {children}
    </div>
  );
}
