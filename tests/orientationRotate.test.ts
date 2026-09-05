import { describe, it, expect } from 'vitest';
import {
  ORIENTATION_CYCLE,
  rotateOrientation,
  getHandlePosition,
  getHandleCoord,
  canReverseLeads,
  remapHandleForReverse,
  reverseOrientation,
} from '../src/utils/nodeGeometry';
import { pinHeaderPadOffset } from '../src/components/nodes/PinHeaderNode';

const header = (orientation?: string, rows = 1, cols = 5) => ({
  id: 'h1',
  type: 'pinheader',
  position: { x: 0, y: 0 },
  data: { rows, cols, orientation },
});

describe('rotate 90 right', () => {
  it('walks the four orientations and comes back round', () => {
    let o: string = 'horizontal';
    const seen = [o];
    for (let i = 0; i < 4; i++) seen.push((o = rotateOrientation('resistor', o)));
    expect(seen).toEqual([...ORIENTATION_CYCLE, 'horizontal']);
  });

  it('turns a two-lead part so its terminals follow the body clockwise', () => {
    const sides = ORIENTATION_CYCLE.map(o =>
      getHandlePosition({ type: 'resistor', data: { orientation: o } }, 'in')
    );
    expect(sides).toEqual(['left', 'top', 'right', 'bottom']);
  });

  it('toggles parts drawn in only two poses instead of cycling four', () => {
    expect(rotateOrientation('speaker', 'horizontal')).toBe('vertical');
    expect(rotateOrientation('speaker', 'vertical')).toBe('horizontal');
  });
});

describe('pin header rotation', () => {
  it('faces its pads out of each side in turn', () => {
    const sides = ORIENTATION_CYCLE.map(o => getHandlePosition(header(o), '1'));
    expect(sides).toEqual(['top', 'right', 'bottom', 'left']);
  });

  it('lays a 1xN strip across the canvas flat and down it on end', () => {
    const flat = getHandleCoord(header('horizontal'), '5');
    const onEnd = getHandleCoord(header('vertical'), '5');
    expect(flat.y).toBe(getHandleCoord(header('horizontal'), '1').y);
    expect(onEnd.x).toBe(getHandleCoord(header('vertical'), '1').x);
    expect(flat.x).toBeGreaterThan(getHandleCoord(header('horizontal'), '1').x);
    expect(onEnd.y).toBeGreaterThan(getHandleCoord(header('vertical'), '1').y);
  });

  it('keeps every pad on the grid and distinct through all four turns', () => {
    for (const o of ORIENTATION_CYCLE) {
      const data = header(o, 2, 3).data;
      const seen = new Set<string>();
      for (let pin = 1; pin <= 6; pin++) {
        const { dx, dy } = pinHeaderPadOffset(data, pin)!;
        expect(dx % 8).toBe(4);
        expect(dy % 8).toBe(4);
        seen.add(`${dx},${dy}`);
      }
      expect(seen.size).toBe(6);
    }
  });

  it('turns two rows the same way round as the body', () => {
    // Pin 1 leads its row, and half a turn puts it at the opposite corner.
    const at = (o: string, pin: number) => pinHeaderPadOffset(header(o, 2, 3).data, pin)!;
    expect(at('horizontal', 1)).toEqual({ dx: 12, dy: 12 });
    expect(at('left', 1)).toEqual({ dx: 44, dy: 28 });
    expect(at('vertical', 1)).toEqual({ dx: 28, dy: 12 });
    expect(at('up', 1)).toEqual({ dx: 12, dy: 44 });
  });
});

describe('reverse leads', () => {
  it('turns the body a half turn', () => {
    expect(reverseOrientation('horizontal')).toBe('left');
    expect(reverseOrientation('left')).toBe('horizontal');
    expect(reverseOrientation('vertical')).toBe('up');
    expect(reverseOrientation(undefined)).toBe('left');
  });

  it('leaves each lead where the other one was, so the wires need not move', () => {
    const at = (o: string, h: string) =>
      getHandleCoord({ type: 'led', position: { x: 0, y: 0 }, data: { orientation: o }, measured: { width: 32, height: 32 } }, h);
    expect(at('left', 'cathode')).toEqual(at('horizontal', 'anode'));
    expect(at('left', 'anode')).toEqual(at('horizontal', 'cathode'));
  });

  it('trades the two leads of a polarised part', () => {
    expect(remapHandleForReverse('led', 'anode')).toBe('cathode');
    expect(remapHandleForReverse('voltage', 'pos')).toBe('neg');
  });

  it('will not rewrite a lead that has no opposite number', () => {
    // A speaker's ground stays underneath whichever way the body faces, and
    // 'out' is not a terminal it has at all.
    expect(canReverseLeads('speaker')).toBe(false);
    expect(remapHandleForReverse('speaker', 'in')).toBeNull();
    expect(remapHandleForReverse('potentiometer', 'wiper')).toBeNull();
  });
});
