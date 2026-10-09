/**
 * Parts drawn as a labelled box with pins down its sides, described as data.
 *
 * One table instead of a hand-placed branch per part in every geometry
 * function: the symbol (`PinBoxNode`), the handle coordinates and sides edge
 * routing uses, the node's size and its handle list all read from here, so
 * they cannot drift apart. A new part of this kind is an entry.
 *
 * Pins sit on rows `PIN_BOX_TOP + row × PIN_BOX_PITCH` down from the top
 * edge, on the 8px schematic grid.
 */

export const PIN_BOX_TOP = 24;
export const PIN_BOX_PITCH = 16;

export type PinBoxPin = {
  id: string;
  side: 'left' | 'right';
  row: number;
  /** Printed beside the pin, and how the rules check names it. */
  label: string;
};

export type PinBoxPart = {
  /** Caption across the top of the box. */
  title: string;
  width: number;
  height: number;
  pins: PinBoxPin[];
};

const left = (id: string, row: number, label: string): PinBoxPin => ({ id, side: 'left', row, label });
const right = (id: string, row: number, label: string): PinBoxPin => ({ id, side: 'right', row, label });

export const PIN_BOX_PARTS: Record<string, PinBoxPart> = {
  dcmotor: {
    title: 'DC motor',
    width: 64,
    height: 48,
    pins: [left('a', 0, '+'), right('b', 0, '−')],
  },
  stepper: {
    title: 'Stepper',
    width: 80,
    height: 64,
    pins: [left('a1', 0, 'A+'), left('a2', 1, 'A−'), right('b1', 0, 'B+'), right('b2', 1, 'B−')],
  },
  fuse: {
    title: 'Fuse',
    width: 64,
    height: 48,
    pins: [left('in', 0, ''), right('out', 0, '')],
  },
  hbridge: {
    title: 'H-bridge',
    width: 96,
    height: 96,
    pins: [
      left('vm', 0, 'VM'), left('gnd', 1, 'GND'), left('in1', 2, 'IN1'), left('in2', 3, 'IN2'),
      right('out1', 0, 'OUT1'), right('out2', 1, 'OUT2'),
    ],
  },
  meshsignal: {
    title: 'Mesh signal',
    width: 80,
    height: 48,
    pins: [right('out', 0, 'OUT'), right('gnd', 1, 'GND')],
  },
  stepdriver: {
    title: 'Step driver',
    width: 112,
    height: 112,
    pins: [
      left('vm', 0, 'VM'), left('gnd', 1, 'GND'), left('step', 2, 'STEP'), left('dir', 3, 'DIR'), left('en', 4, 'EN'),
      right('a1', 0, '1A'), right('a2', 1, '1B'), right('b1', 2, '2A'), right('b2', 3, '2B'),
    ],
  },
};

export const pinBoxPart = (type: string | undefined): PinBoxPart | undefined =>
  type ? PIN_BOX_PARTS[type] : undefined;

/** A pin's offset from the box's top-left corner. */
export function pinBoxOffset(part: PinBoxPart, pin: PinBoxPin): { x: number; y: number } {
  return { x: pin.side === 'left' ? 0 : part.width, y: PIN_BOX_TOP + pin.row * PIN_BOX_PITCH };
}
