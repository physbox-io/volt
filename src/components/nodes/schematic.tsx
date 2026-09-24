import React, { useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Handle, Position } from '@xyflow/react';
import { parseEngValue, formatEngValue } from '../../utils/engValue';
import { PLACEMENT, type Placement } from './schematicStyle';
import type { LeadOrientation } from './orientation';

/**
 * The symbols themselves. The shared tokens they draw with live in
 * `schematicStyle.ts` and the orientation helpers in `orientation.ts`: a file
 * that exports both components and constants loses React Fast Refresh, which
 * on this canvas means every edit resets the simulation.
 */

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
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(String(value));
  const [seen, setSeen] = useState(value);

  // Follow the value while the box is idle, but never overwrite a part-typed
  // number: clearing the field and retyping "0", "0.", "0.0", "0.05" has to
  // survive, so nothing is echoed back until the edit ends.
  /*
   * `Object.is`, not `!==`. A NaN value — which is what a cleared field in the
   * properties panel used to store — is never equal to itself, so `!==` stayed
   * true on every render and this state update re-rendered for ever. React
   * stopped it with "Too many re-renders", which is to say the whole app died
   * on a backspace.
   */
  if (!editing && !Object.is(value, seen)) {
    setSeen(value);
    setText(Number.isFinite(value) ? String(value) : '');
  }

  const clamp = (n: number) => {
    if (min !== undefined && n < min) return min;
    if (max !== undefined && n > max) return max;
    return n;
  };

  /** Decimal places implied by `step`, so scrubbing cannot accrue float noise. */
  const places = (() => {
    const s = String(step);
    const dot = s.indexOf('.');
    return dot === -1 ? 0 : s.length - dot - 1;
  })();

  /*
   * Drag the number to change it.
   *
   * The increment scales with how fast the pointer is moving, so the same
   * gesture covers both ends of a range: easing across gives single steps for
   * dialling in a value, and a quick sweep runs through orders of magnitude
   * without asking anyone to drag a thousand pixels. Speed is measured per
   * move event and smoothed, because a raw px/ms reading from one event is
   * jumpy enough to feel random.
   *
   * Shift and Alt are the usual fine/coarse modifiers.
   */
  /*
   * `cur` is the value being dragged, held here rather than read back from the
   * prop on each move. Pointer events arrive faster than React commits, so
   * consecutive moves would otherwise all compute from the same stale value and
   * every increment but the last would be thrown away — which is what made a
   * scrub stutter and lag behind the mouse.
   */
  const drag = useRef<{ x: number; t: number; cur: number; boost: number; moved: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (editing) return;               // typing wins over scrubbing
    if (e.button !== 0 || !Number.isFinite(value)) return;
    e.stopPropagation();
    /*
     * Without this the browser starts its own text-selection drag on the input,
     * which takes the pointer, shows a caret and swallows the gesture — the
     * field looked draggable and did nothing. Suppressing the default also
     * suppresses focus, which is why a click that does not travel focuses the
     * field by hand in endDrag.
     */
    e.preventDefault();
    drag.current = { x: e.clientX, t: e.timeStamp, cur: value, boost: 1, moved: 0 };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dt = Math.max(1, e.timeStamp - d.t);
    d.x = e.clientX;
    d.t = e.timeStamp;
    d.moved += Math.abs(dx);

    // px/ms, smoothed. 1 px/ms is a brisk sweep; below that it stays near 1.
    const speed = Math.abs(dx) / dt;
    d.boost = d.boost * 0.7 + (1 + Math.min(speed * 12, 40)) * 0.3;

    const mod = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
    // A step every 4px at rest, accelerating with the sweep.
    const raw = d.cur + (dx / 4) * step * d.boost * mod;
    // Snapped to the step, so the number reads as a setting and not as float
    // noise, while `cur` keeps the unsnapped position so slow drags still creep.
    d.cur = clamp(raw);
    const next = clamp(Number((Math.round(d.cur / step) * step).toFixed(places + 2)));
    if (next !== value) onCommit(next);
  };

  const endDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (d && d.moved <= 3) {
      // A click, not a drag: hand it to the keyboard.
      (e.currentTarget as HTMLInputElement).focus();
      (e.currentTarget as HTMLInputElement).select();
    }
  };

  return (
    <label
      className={`nodrag nopan flex items-baseline gap-[1px] ${editing ? 'cursor-text' : 'cursor-ew-resize'}`}
      title={title ? `${title} — drag to change, or click to type` : 'Drag to change, or click to type'}
    >
      <input
        type="text"
        inputMode="decimal"
        value={editing ? text : Number.isFinite(value) ? String(value) : ''}
        min={min}
        max={max}
        step={step}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onFocus={() => {
          setEditing(true);
          setText(String(value));
        }}
        onChange={(e) => {
          setText(e.target.value);
          const next = parseFloat(e.target.value);
          if (Number.isNaN(next)) return;
          if (min !== undefined && next < min) return;
          if (max !== undefined && next > max) return;
          onCommit(next);
        }}
        onBlur={() => {
          setEditing(false);
          setSeen(value);
          setText(String(value));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const mod = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
            const delta = (e.key === 'ArrowUp' ? 1 : -1) * step * mod;
            const next = clamp(Number((value + delta).toFixed(places + 2)));
            setText(String(next));
            onCommit(next);
          }
        }}
        className={`w-[30px] bg-transparent text-right font-mono text-[8px] leading-none
                   text-slate-700 dark:text-slate-200 border-b border-dotted
                   border-slate-300 dark:border-slate-600 outline-none
                   focus:border-solid focus:border-emerald-500
                   ${editing ? '' : 'cursor-ew-resize select-none'}
                   [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none`}
      />
      <span className="font-mono text-[8px] leading-none text-slate-400 dark:text-slate-500">
        {unit}
      </span>
    </label>
  );
}

/**
 * A component value on the canvas — "4.7k", "100n" — that can be dragged.
 *
 * Component values are multiplicative, not additive: the useful neighbours of
 * 10k are 9k and 11k, and the useful neighbours of 100n are 90n and 110n. So a
 * drag scales the value by a proportion rather than adding a fixed step, which
 * makes one gesture cover picofarads to farads without changing units by hand.
 * Speed still scales it, so easing across nudges and a sweep crosses decades.
 *
 * A label the parser cannot read is left exactly as typed — someone who wrote
 * "R_load" meant it, and a scrub must not turn it into a number.
 */
export function EngField({
  value,
  onCommit,
  title,
  unit = '',
}: {
  /** The label as written, e.g. "4.7k". */
  value: string;
  onCommit: (next: string) => void;
  title?: string;
  /**
   * Unit written after a dragged value, e.g. "V". Sources read as "5V", and a
   * scrub that left "5.2" would be the one bare number on the schematic.
   */
  unit?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);

  if (!editing && !Object.is(value, seen)) {
    setSeen(value);
    setText(value);
  }

  // `cur` carries the dragged value between moves; see DeviceField above for
  // why reading it back from the prop drops increments.
  const drag = useRef<{ x: number; t: number; cur: number; boost: number; moved: number } | null>(null);
  const numeric = parseEngValue(value);

  const onPointerDown = (e: React.PointerEvent) => {
    if (editing || e.button !== 0 || numeric === null) return;
    e.stopPropagation();
    // See DeviceField: the native caret drag would otherwise eat the gesture.
    e.preventDefault();
    drag.current = { x: e.clientX, t: e.timeStamp, cur: numeric, boost: 1, moved: 0 };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (!Number.isFinite(d.cur) || d.cur === 0) return;
    const dx = e.clientX - d.x;
    const dt = Math.max(1, e.timeStamp - d.t);
    d.x = e.clientX;
    d.t = e.timeStamp;
    d.moved += Math.abs(dx);

    const speed = Math.abs(dx) / dt;
    d.boost = d.boost * 0.7 + (1 + Math.min(speed * 8, 25)) * 0.3;
    const mod = e.shiftKey ? 4 : e.altKey ? 0.25 : 1;
    // ~0.8% per pixel at rest: a decade is a comfortable sweep, not a marathon.
    d.cur *= Math.pow(1.008, dx * d.boost * mod);
    if (!Number.isFinite(d.cur) || d.cur <= 0) return;
    const written = formatEngValue(d.cur) + unit;
    if (written !== value) onCommit(written);
  };

  const endDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (d && d.moved <= 3) {
      (e.currentTarget as HTMLInputElement).focus();
      (e.currentTarget as HTMLInputElement).select();
    }
  };

  return (
    <input
      type="text"
      value={editing ? text : value}
      title={title ?? (numeric === null ? 'Click to type' : 'Drag to change, or click to type')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onFocus={() => { setEditing(true); setText(value); }}
      // A click already selects the whole value; a double-click would otherwise
      // take it back to the one word under the pointer, which splits "4.7k".
      onDoubleClick={(e) => e.currentTarget.select()}
      onChange={(e) => { setText(e.target.value); onCommit(e.target.value); }}
      onBlur={() => { setEditing(false); setSeen(value); setText(value); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
        if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && numeric !== null) {
          e.preventDefault();
          const mod = e.shiftKey ? 4 : e.altKey ? 0.25 : 1;
          const f = Math.pow(1.1, (e.key === 'ArrowUp' ? 1 : -1) * mod);
          onCommit(formatEngValue(numeric * f) + unit);
        }
      }}
      // pointer-events-auto: the caption this sits in is pointer-events-none so
      // it never blocks a wire, and the field inherited that — it drew as an
      // input and could not be clicked.
      className={`nodrag nopan pointer-events-auto w-[38px] bg-transparent text-center font-mono text-[9px] leading-none
                 text-slate-600 dark:text-slate-300 border-b border-dotted border-transparent
                 hover:border-slate-300 dark:hover:border-slate-600 outline-none
                 focus:border-solid focus:border-emerald-500
                 ${editing ? 'cursor-text' : 'cursor-ew-resize select-none'}`}
    />
  );
}

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
