import type { CSSProperties } from 'react';
import { labelPlacementFor } from './schematicStyle';

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

