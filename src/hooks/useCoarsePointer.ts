import { useEffect, useState } from 'react';

/**
 * True when the primary pointer is a fingertip rather than a cursor.
 *
 * Used for the two things a finger genuinely cannot do rather than for layout,
 * which stays a width question (`max-lg:`) so that a narrow desktop window is
 * unaffected:
 *
 *  - HTML5 drag-and-drop does not exist on touch, so the component palette has
 *    to offer tap-to-place instead of drag-to-place.
 *  - Connection handles are revealed on `:hover`, which a finger never fires.
 *
 * `(pointer: coarse)` describes the input device, not the screen: a small
 * desktop window keeps the mouse behaviour, and a tablet keeps the touch
 * behaviour however wide it is held.
 */
export const useCoarsePointer = (): boolean => {
  const [coarse, setCoarse] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
  );

  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)');
    const onChange = () => setCoarse(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return coarse;
};
