import { describe, it, expect } from 'vitest';
import type { Node } from '@xyflow/react';
import { PIN_BOX_PARTS } from '../src/components/nodes/pinBoxParts';
import { getHandleCoord, getHandlePosition, getHandlesForNode } from '../src/utils/nodeGeometry';
import { getNodeDimensions } from '../src/utils/edgeRouting';
import { defaultPackageForType, packageOptionsForType, parsePackageId } from '../src/utils/pcbFootprints';
import { resolveHandleToPin } from '../src/utils/pcbNets';
import { dcPathGroups, pinLabel } from '../src/utils/erc';
import { partEmitters } from '../src/utils/netlist/partEmitters';
import { nodeRegistry } from '../src/components/nodes/registry';
import { getNodeDefaultName } from '../src/utils/nodeNaming';

/**
 * The electromechanical parts as the canvas and the board see them: every
 * pin on the 8px grid where the symbol draws it, every pin reaching the
 * netlist, and every pin landing on its own pad.
 */

const at = (type: string, x = 160, y = 96): Node => ({ id: `${type}1`, type, position: { x, y }, data: {} });

describe.each(Object.keys(PIN_BOX_PARTS))('%s', type => {
  const part = PIN_BOX_PARTS[type];

  it('is a box whose height keeps its pins on the grid', () => {
    expect(getNodeDimensions(type, {})).toEqual({ width: part.width, height: part.height });
    expect(part.height % 16).toBe(0);
  });

  it('puts each pin on the grid, on its side, inside the box', () => {
    const node = at(type);
    expect(getHandlesForNode(node)).toEqual(part.pins.map(p => p.id));
    for (const pin of part.pins) {
      const c = getHandleCoord(node, pin.id);
      expect(c.x % 8, pin.id).toBe(0);
      expect(c.y % 8, pin.id).toBe(0);
      expect(c.y).toBeLessThan(node.position.y + part.height);
      expect(c.x).toBe(node.position.x + (pin.side === 'left' ? 0 : part.width));
      expect(getHandlePosition(node, pin.id)).toBe(pin.side);
    }
    const coords = part.pins.map(p => JSON.stringify(getHandleCoord(node, p.id)));
    expect(new Set(coords).size).toBe(coords.length);
  });

  it('simulates, and has a panel and a designator', () => {
    expect(partEmitters[type]).toBeDefined();
    expect(nodeRegistry[type]?.Properties).toBeDefined();
    expect(getNodeDefaultName(`${type}1`, type)).toMatch(/^(M|U|F)/);
  });

  it('lands each pin on a pad of its own, in every package offered', () => {
    const packages = packageOptionsForType(type).flatMap(g => g.options.map(o => o.id));
    expect(packages).toContain(defaultPackageForType(type));
    for (const pkg of packages) {
      const fp = parsePackageId(pkg, part.pins.length);
      expect(fp, pkg).not.toBeNull();
      const pads = part.pins.map(p => resolveHandleToPin(type, p.id, fp!)?.padIndex);
      expect(pads.every(p => p !== undefined), `${pkg}: ${pads}`).toBe(true);
      expect(new Set(pads).size, pkg).toBe(pads.length);
    }
  });

  it('names its pins the way its symbol does, and gives the rules check a DC path', () => {
    for (const pin of part.pins) if (pin.label) expect(pinLabel(type, pin.id)).toBe(`${pin.label} pin`);
    const grouped = dcPathGroups(type, {}, part.pins.map(p => p.id)).flat();
    expect(grouped.length).toBeGreaterThan(0);
  });
});

describe('the step driver on its carrier', () => {
  it('follows the Pololu pinout', () => {
    const fp = parsePackageId(defaultPackageForType('stepdriver')!, 9)!;
    expect(fp.pads).toHaveLength(16);
    const pin = (h: string) => String(resolveHandleToPin('stepdriver', h, fp)!.pinNumber);
    expect([pin('en'), pin('step'), pin('dir')]).toEqual(['1', '7', '8']);
    expect([pin('vm'), pin('gnd'), pin('b2'), pin('b1'), pin('a1'), pin('a2')]).toEqual(['16', '15', '14', '13', '12', '11']);
  });
});
