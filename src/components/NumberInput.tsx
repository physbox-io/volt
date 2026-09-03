import React, { useState } from 'react';

/**
 * Numeric field that lets you type.
 *
 * Clamping on every keystroke means the box can never hold a value on its way to
 * a good one: emptying it snaps back to a default, and typing "150" into a field
 * with a minimum of 50 goes through "1", which becomes "1000" before the "5" is
 * even typed. So the box keeps whatever text is in it, and the value only leaves
 * here when it is a number in range. Blur settles it — an empty or out-of-range
 * box shows the value that is actually in force, which is the one that was there
 * before the edit started.
 *
 * Styling comes from the caller's `className`, so the export modals keep their
 * own accent colours.
 */
type NumberInputBase = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'min' | 'max' | 'type'
> & {
  min?: number;
  max?: number;
  integer?: boolean;
};

/**
 * The blank-means-derived variant.
 *
 * A field whose value the app can work out for itself should not arrive
 * pre-filled with that value, because a number sitting in a box reads as a
 * decision someone made and invites being nudged. Left empty it shows the
 * derived figure as a placeholder and keeps tracking it as the inputs change;
 * typed into, it becomes an override and stops.
 */
export function NumberInput(
  props: NumberInputBase & {
    allowEmpty: true;
    value: number | null;
    onChange: (v: number | null) => void;
  }
): React.ReactElement;
export function NumberInput(
  props: NumberInputBase & {
    allowEmpty?: false;
    value: number;
    onChange: (v: number) => void;
  }
): React.ReactElement;
export function NumberInput({
  value, onChange, min, max, integer, allowEmpty, ...rest
}: NumberInputBase & {
  value: number | null;
  onChange: (v: never) => void;
  allowEmpty?: boolean;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  const [editing, setEditing] = useState(false);
  const [seen, setSeen] = useState<number | null>(value);

  // Follow the value while the box is not being typed into, so a change made
  // elsewhere (the max S-value clamping the power, say) still shows up.
  /*
   * `Object.is`, not `!==`. A NaN — which is what an unguarded `parseFloat` on
   * a cleared box stores — is never equal to itself, so this condition stayed
   * true on every render and the update below looped until React gave up with
   * "Too many re-renders", taking the app with it.
   */
  if (!editing && !Object.is(value, seen)) {
    setSeen(value);
    setText(value === null || !Number.isFinite(value) ? '' : String(value));
  }

  const parse = (raw: string): number | null => {
    const n = integer ? parseInt(raw, 10) : parseFloat(raw);
    if (!Number.isFinite(n)) return null;
    if (min !== undefined && n < min) return null;
    if (max !== undefined && n > max) return null;
    return n;
  };

  return (
    <input
      {...rest}
      type="number"
      min={min}
      max={max}
      value={text}
      onFocus={() => setEditing(true)}
      onChange={(e) => {
        setText(e.target.value);
        // Emptying a derivable field is a real edit — it hands the value back
        // to whatever derives it — rather than a half-typed number to ignore.
        if (allowEmpty && e.target.value.trim() === '') {
          (onChange as (v: number | null) => void)(null);
          return;
        }
        const n = parse(e.target.value);
        if (n !== null) (onChange as (v: number) => void)(n);
      }}
      onBlur={() => {
        setEditing(false);
        setSeen(value);
        setText(value === null ? '' : String(value));
      }}
    />
  );
}
