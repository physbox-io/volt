import type { Node, Edge } from '@xyflow/react';
import { getNodeDimensions, getSchematicPath } from '../components/AuraEdge';

// Two-terminal component types whose orientation can be flipped, and whose
// handle ids get remapped (anode<->cathode, in<->out) when that happens.
// Every part with exactly two leads, plus the potentiometer. The list gates
// the orientation control in the properties panel, so a type missing from it
// could not be rotated from the UI however well its symbol supported it -
// which is why the potentiometer, the sources and the instruments all drew
// themselves correctly when rotated and yet offered no way to do so.
export const ORIENTABLE_NODE_TYPES = [
  // Two-terminal passives and semiconductors.
  'resistor', 'capacitor', 'inductor', 'diode', 'zener', 'led', 'switch', 'ldr',
  // Sources. These default to upright, unlike everything else here.
  'voltage', 'acvoltage', 'currentsource',
  // Instruments: the body stays upright, the leads move.
  'multimeter', 'speaker', 'microphone', 'signalgen',
  // Board-only, but still a two-lead part on the canvas.
  'jumper',
  // Three terminals, but the wiper is the odd one out and rides along.
  'potentiometer',
];

export const ORIENTATION_HANDLE_REMAP: Record<string, string> = {
  anode: 'cathode',
  cathode: 'anode',
  in: 'out',
  out: 'in',
  pos: 'neg',
  neg: 'pos',
  a: 'b',
  b: 'a',
};

/**
 * Types whose two leads are NOT a mirrorable pair, so flipping must leave
 * their edges alone.
 *
 * The instruments have one signal lead and a ground that stays on the bottom
 * edge whichever way the part faces, and the potentiometer's wiper has no
 * opposite number. Remapping by handle id alone would rewrite a speaker's
 * 'in' to an 'out' it does not have, silently disconnecting it.
 */
const FLIP_EXEMPT_TYPES = ['speaker', 'microphone', 'signalgen', 'multimeter', 'potentiometer'];

/** The handle an edge should move to when `nodeType` is mirrored, if any. */
export function remapHandleForFlip(nodeType: string, handleId: string): string | null {
  if (FLIP_EXEMPT_TYPES.includes(nodeType)) return null;
  const next = ORIENTATION_HANDLE_REMAP[handleId];
  return next && next !== handleId ? next : null;
}

import { getEffectiveMcuConfig } from './mcuConfig';
import {
  getPinHeaderGeometry,
  getPinHeaderHandles,
  isPinHeaderVertical,
  pinHeaderPadOffset,
} from '../components/nodes/PinHeaderNode';

export function getHandlesForNode(node: Node): string[] {
  if (node.type === 'timer555') {
    return ['1', '2', '3', '4', '5', '6', '7', '8'];
  }
  if (node.type === 'ground') {
    return ['in'];
  }
  if (node.type === 'voltage' || node.type === 'acvoltage' || node.type === 'currentsource') {
    return ['pos', 'neg'];
  }
  if (node.type === 'junction') {
    return ['in', 'out'];
  }
  if (node.type === 'mcu') {
    return getEffectiveMcuConfig(node.data).pins.map(p => p.id);
  }
  if (node.type === 'pinheader') {
    return getPinHeaderHandles(node.data);
  }
  if (node.type === 'via') {
    return ['1'];
  }
  // Mechanical only: no electrical pins at all.
  if (node.type === 'mountinghole' || node.type === 'cutout') {
    return [];
  }
  if (node.type === 'jumper') {
    return ['a', 'b'];
  }
  if (node.type === 'opamp') {
    return ['in_inv', 'in_non', 'vcc', 'vee', 'out'];
  }
  if (node.type === 'npn' || node.type === 'pnp') {
    return ['c', 'b', 'e'];
  }
  if (node.type === 'nmos' || node.type === 'pmos') {
    return ['d', 'g', 's'];
  }
  if (node.type === 'potentiometer') {
    return ['in', 'out', 'wiper'];
  }
  if (node.type === 'dff') {
    return ['d', 'clk', 'q', 'qbar'];
  }
  if (node.type === 'transformer') {
    return ['p1', 'p2', 's1', 's2'];
  }
  if (node.type === 'sevenseg') {
    return ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'common'];
  }
  if (node.type === 'heltec_v4') {
    return ['3V3', 'GND', 'GPIO_1', 'GPIO_3', 'GPIO_33', 'GPIO_36', 'GPIO_37', 'GPIO_41'];
  }
  if (['and', 'or', 'nand', 'nor', 'xor'].includes(node.type as string)) {
    return ['in1', 'in2', 'out'];
  }
  if (node.type === 'not') {
    return ['in1', 'out'];
  }
  if (node.type === 'led' || node.type === 'diode' || node.type === 'zener') {
    return ['anode', 'cathode'];
  }
  if (node.type === 'scope') {
    return ['ch1', 'ch2', 'gnd'];
  }
  if (node.type === 'multimeter') {
    return ['pos', 'neg'];
  }
  if (node.type === 'signalgen' || node.type === 'microphone') {
    return ['out', 'gnd'];
  }
  if (node.type === 'speaker') {
    return ['in', 'gnd'];
  }
  return ['in', 'out'];
}

export function getHandleCoord(node: any, handleId: string): { x: number; y: number } {
  const orientation = node.data?.orientation || 'horizontal';
  const isLeft = orientation === 'left';
  const isUp = orientation === 'up';
  const isVertical = orientation === 'vertical' || isUp;

  const x = node.position.x;
  const y = node.position.y;
  const w = node.measured?.width || getNodeDimensions(node.type, node.data).width;
  const h = node.measured?.height || getNodeDimensions(node.type, node.data).height;

  // Diode/LED pins are electrically named but sit where in/out sit; without
  // this mapping they fell through to the node-center fallback, which put
  // edge hit-testing (junction drops) and overlap merging off by half a body.
  if (handleId === 'anode') handleId = 'in';
  else if (handleId === 'cathode') handleId = 'out';

  // Instrument cards (sig gen, mic, speaker) hang their ground pin off the
  // bottom edge; 'out'/'in' already resolve to the correct side below.
  if (handleId === 'gnd' && (node.type === 'signalgen' || node.type === 'microphone' || node.type === 'speaker')) {
    return { x: x + w / 2, y: y + h };
  }

  // Header pads sit on a fixed grid, read from PinHeaderNode's own layout so a
  // rotated header's wires land on the pads rather than beside them.
  if (node.type === 'pinheader') {
    const offset = pinHeaderPadOffset(node.data, parseInt(handleId, 10));
    if (offset) return { x: x + offset.dx, y: y + offset.dy };
  }
  if (node.type === 'via') {
    return { x: x + w / 2, y: y + h / 2 };
  }
  if (node.type === 'jumper') {
    const atStart = handleId === 'a';
    if (isVertical) {
      return { x: x + w / 2, y: (atStart !== isUp) ? y : y + h };
    }
    return { x: (atStart !== isLeft) ? x : x + w, y: y + h / 2 };
  }

  if (node.type === 'mcu') {
    const cfg = getEffectiveMcuConfig(node.data);
    const leftPins = cfg.pins.filter(p => p.side === 'left');
    const rightPins = cfg.pins.filter(p => p.side === 'right');
    const topPins = cfg.pins.filter(p => p.side === 'top');
    const bottomPins = cfg.pins.filter(p => p.side === 'bottom');

    const lIdx = leftPins.findIndex(p => p.id === handleId);
    if (lIdx >= 0) {
      const step = (h - 32) / Math.max(1, leftPins.length);
      return { x, y: y + 24 + (lIdx + 0.5) * step };
    }
    const rIdx = rightPins.findIndex(p => p.id === handleId);
    if (rIdx >= 0) {
      const step = (h - 32) / Math.max(1, rightPins.length);
      return { x: x + w, y: y + 24 + (rIdx + 0.5) * step };
    }
    const tIdx = topPins.findIndex(p => p.id === handleId);
    if (tIdx >= 0) {
      const step = (w - 24) / Math.max(1, topPins.length);
      return { x: x + 12 + (tIdx + 0.5) * step, y };
    }
    const bIdx = bottomPins.findIndex(p => p.id === handleId);
    if (bIdx >= 0) {
      const step = (w - 24) / Math.max(1, bottomPins.length);
      return { x: x + 12 + (bIdx + 0.5) * step, y: y + h };
    }
  }

  // OpAmp
  if (node.type === 'opamp') {
    if (handleId === 'in_inv') return { x, y: y + h * 0.3 };
    if (handleId === 'in_non') return { x, y: y + h * 0.7 };
    if (handleId === 'out') return { x: x + w, y: y + h * 0.5 };
    if (handleId === 'vcc') return { x: x + w * 0.5, y };
    if (handleId === 'vee') return { x: x + w * 0.5, y: y + h };
  }

  // BJTs (NPN, PNP)
  if (node.type === 'npn' || node.type === 'pnp') {
    if (handleId === 'c') return { x: x + w * 0.75, y };
    if (handleId === 'b') return { x, y: y + h * 0.5 };
    if (handleId === 'e') return { x: x + w * 0.75, y: y + h };
  }

  // MOSFETs (NMOS, PMOS)
  if (node.type === 'nmos' || node.type === 'pmos') {
    if (handleId === 'd') return { x: x + w * 0.75, y };
    if (handleId === 'g') return { x, y: y + h * 0.5 };
    if (handleId === 's') return { x: x + w * 0.75, y: y + h };
  }

  // Potentiometer
  if (node.type === 'potentiometer') {
    if (isVertical) {
      if (handleId === 'in') return { x: x + w * 0.5, y };
      if (handleId === 'out') return { x: x + w * 0.5, y: y + h };
      if (handleId === 'wiper') return { x, y: y + h * 0.5 };
    } else {
      if (handleId === 'in') return { x, y: y + h * 0.5 };
      if (handleId === 'out') return { x: x + w, y: y + h * 0.5 };
      if (handleId === 'wiper') return { x: x + w * 0.5, y };
    }
  }

  // Logic Gates (AND, OR, NAND, NOR, XOR)
  if (['and', 'or', 'nand', 'nor', 'xor'].includes(node.type)) {
    if (handleId === 'in1') return { x, y: y + h * 0.3 };
    if (handleId === 'in2') return { x, y: y + h * 0.7 };
    if (handleId === 'out') return { x: x + w, y: y + h * 0.5 };
  }
  if (node.type === 'not') {
    if (handleId === 'in1') return { x, y: y + h * 0.5 };
    if (handleId === 'out') return { x: x + w, y: y + h * 0.5 };
  }

  // D Flip-Flop
  if (node.type === 'dff') {
    if (handleId === 'd') return { x, y: y + h * 0.3 };
    if (handleId === 'clk') return { x, y: y + h * 0.7 };
    if (handleId === 'q') return { x: x + w, y: y + h * 0.3 };
    if (handleId === 'qbar') return { x: x + w, y: y + h * 0.7 };
  }

  // Transformer
  if (node.type === 'transformer') {
    if (handleId === 'p1') return { x, y: y + h * 0.25 };
    if (handleId === 'p2') return { x, y: y + h * 0.75 };
    if (handleId === 's1') return { x: x + w, y: y + h * 0.25 };
    if (handleId === 's2') return { x: x + w, y: y + h * 0.75 };
  }

  // 7-Segment Display
  if (node.type === 'sevenseg') {
    const segs = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const sIdx = segs.indexOf(handleId);
    if (sIdx >= 0) return { x, y: y + h * (0.12 + sIdx * 0.12) };
    if (handleId === 'common') return { x: x + w * 0.5, y: y + h };
  }

  // Oscilloscope
  if (node.type === 'scope') {
    if (handleId === 'ch1') return { x, y: y + h * 0.3 };
    if (handleId === 'ch2') return { x, y: y + h * 0.6 };
    if (handleId === 'gnd') return { x, y: y + h * 0.9 };
  }

  // Multimeter. Both probes hang off the bottom by default, like real leads;
  // vertical stacks them so the meter can read across a part drawn on end.
  if (node.type === 'multimeter') {
    if (isVertical) {
      if (handleId === 'pos') return { x: x + w * 0.5, y };
      if (handleId === 'neg') return { x: x + w * 0.5, y: y + h };
    } else {
      if (handleId === 'pos') return { x: x + w * 0.3, y: y + h };
      if (handleId === 'neg') return { x: x + w * 0.7, y: y + h };
    }
  }

  // Heltec V4
  if (node.type === 'heltec_v4') {
    if (handleId === '3V3') return { x, y: y + 36 };
    if (handleId === 'GND') return { x, y: y + 54 };
    if (handleId === 'GPIO_1') return { x, y: y + 74 };
    if (handleId === 'GPIO_3') return { x, y: y + 96 };
    if (handleId === 'GPIO_33') return { x: x + w, y: y + 36 };
    if (handleId === 'GPIO_36') return { x: x + w, y: y + 54 };
    if (handleId === 'GPIO_37') return { x: x + w, y: y + 74 };
    if (handleId === 'GPIO_41') return { x: x + w, y: y + 96 };
  }

  // Pins 1-4 run down the left, 8-5 down the right, on a fixed 16px pitch
  // starting 32px below the node origin. Timer555Node.tsx lays the rows out
  // with explicit heights so these constants stay true.
  if (node.type === 'timer555') {
    const row = parseInt(handleId);
    const PIN_ROW_TOP = 32;
    const PIN_PITCH = 16;
    if (row >= 1 && row <= 4) {
      return { x, y: y + PIN_ROW_TOP + (row - 1) * PIN_PITCH };
    }
    if (row >= 5 && row <= 8) {
      return { x: x + w, y: y + PIN_ROW_TOP + (8 - row) * PIN_PITCH };
    }
  }

  if (node.type === 'ground') {
    return { x: x + w / 2, y };
  }

  if (node.type === 'voltage' || node.type === 'acvoltage' || node.type === 'currentsource') {
    // These default to standing upright - VoltageNode treats only an explicit
    // 'horizontal' as horizontal - so the test is deliberately the other way
    // round from every other part. The coordinates used to be pinned to the
    // top and bottom edges regardless, so a source that was switched to
    // horizontal drew its wires off its top and bottom while its terminals
    // were rendered left and right.
    const laidFlat = node.data?.orientation === 'horizontal' || node.data?.orientation === 'left';
    const swapped = node.data?.orientation === 'left' || node.data?.orientation === 'up';
    if (handleId === 'pos') {
      if (laidFlat) return { x: swapped ? x + w : x, y: y + h / 2 };
      return { x: x + w / 2, y: swapped ? y + h : y };
    }
    if (handleId === 'neg') {
      if (laidFlat) return { x: swapped ? x : x + w, y: y + h / 2 };
      return { x: x + w / 2, y: swapped ? y : y + h };
    }
  }

  if (node.type === 'junction') {
    return { x: x, y: y };
  }

  if (handleId === 'in') {
    if (isVertical) {
      return { x: x + w / 2, y: isUp ? y + h : y };
    } else {
      return { x: isLeft ? x + w : x, y: y + h / 2 };
    }
  }
  if (handleId === 'out') {
    if (isVertical) {
      return { x: x + w / 2, y: isUp ? y : y + h };
    } else {
      return { x: isLeft ? x : x + w, y: y + h / 2 };
    }
  }

  return { x: x + w / 2, y: y + h / 2 };
}

export const getHandlePosition = (node: any, handleId: string): string => {
  if (node.type === 'mcu') {
    const cfg = getEffectiveMcuConfig(node.data);
    const pin = cfg.pins.find(p => p.id === handleId);
    if (pin) return pin.side;
  }
  if (node.type === 'timer555') {
    const pin = parseInt(handleId);
    if (pin >= 1 && pin <= 4) return 'left';
    if (pin >= 5 && pin <= 8) return 'right';
  }
  if (node.type === 'opamp') {
    if (handleId === 'vcc') return 'top';
    if (handleId === 'vee') return 'bottom';
    if (handleId === 'out') return 'right';
    return 'left';
  }
  if (node.type === 'npn' || node.type === 'pnp') {
    if (handleId === 'c') return 'top';
    if (handleId === 'b') return 'left';
    if (handleId === 'e') return 'bottom';
  }
  if (node.type === 'nmos' || node.type === 'pmos') {
    if (handleId === 'd') return 'top';
    if (handleId === 'g') return 'left';
    if (handleId === 's') return 'bottom';
  }
  if (node.type === 'potentiometer') {
    const isVertical = node.data?.orientation === 'vertical';
    if (isVertical) {
      if (handleId === 'in') return 'top';
      if (handleId === 'out') return 'bottom';
      if (handleId === 'wiper') return 'left';
    } else {
      if (handleId === 'in') return 'left';
      if (handleId === 'out') return 'right';
      if (handleId === 'wiper') return 'top';
    }
  }
  if (['and', 'or', 'nand', 'nor', 'xor', 'not'].includes(node.type)) {
    if (handleId === 'out') return 'right';
    return 'left';
  }
  if (node.type === 'dff') {
    if (handleId === 'q' || handleId === 'qbar') return 'right';
    return 'left';
  }
  if (node.type === 'transformer') {
    if (handleId === 's1' || handleId === 's2') return 'right';
    return 'left';
  }
  if (node.type === 'sevenseg') {
    if (handleId === 'common') return 'bottom';
    return 'left';
  }
  if (node.type === 'heltec_v4') {
    if (['GPIO_33', 'GPIO_36', 'GPIO_37', 'GPIO_41'].includes(handleId)) return 'right';
    return 'left';
  }
  if (node.type === 'voltage' || node.type === 'acvoltage' || node.type === 'currentsource') {
    const isHorizontal = node.data?.orientation === 'horizontal';
    if (handleId === 'pos') return isHorizontal ? 'left' : 'top';
    if (handleId === 'neg') return isHorizontal ? 'right' : 'bottom';
  }
  if (node.type === 'ground') {
    return 'top';
  }
  if (node.type === 'junction') {
    return 'left';
  }
  // The header's first row faces out of the near long edge, the rest out of the
  // far one — which pair of edges those are depends on which way it is stood.
  if (node.type === 'pinheader') {
    const { cols } = getPinHeaderGeometry(node.data);
    const pin = parseInt(handleId, 10);
    const firstRow = pin >= 1 && pin <= cols;
    if (isPinHeaderVertical(node.data)) return firstRow ? 'left' : 'right';
    return firstRow ? 'top' : 'bottom';
  }
  if (node.type === 'via') {
    return 'top';
  }
  if (node.type === 'jumper') {
    return handleId === 'a' ? 'left' : 'right';
  }
  if (node.type === 'scope') {
    return 'left';
  }
  if (node.type === 'multimeter') {
    return 'bottom';
  }
  if (node.type === 'multimeter') {
    const meterVertical = node.data?.orientation === 'vertical' || node.data?.orientation === 'up';
    if (handleId === 'pos') return meterVertical ? 'top' : 'bottom';
    if (handleId === 'neg') return 'bottom';
  }
  if (node.type === 'voltage' || node.type === 'acvoltage' || node.type === 'currentsource') {
    // Inverted default, as in getHandleCoord: absent means upright.
    const laidFlat = node.data?.orientation === 'horizontal' || node.data?.orientation === 'left';
    const swapped = node.data?.orientation === 'left' || node.data?.orientation === 'up';
    if (handleId === 'pos') {
      if (laidFlat) return swapped ? 'right' : 'left';
      return swapped ? 'bottom' : 'top';
    }
    if (handleId === 'neg') {
      if (laidFlat) return swapped ? 'left' : 'right';
      return swapped ? 'top' : 'bottom';
    }
  }
  if (node.type === 'jumper') {
    const jVertical = node.data?.orientation === 'vertical' || node.data?.orientation === 'up';
    const jSwapped = node.data?.orientation === 'left' || node.data?.orientation === 'up';
    const atStart = handleId === 'a';
    if (jVertical) return (atStart !== jSwapped) ? 'top' : 'bottom';
    return (atStart !== jSwapped) ? 'left' : 'right';
  }
  if (handleId === 'gnd') {
    return 'bottom';
  }
  // Default components
  const orientation = node.data?.orientation || 'horizontal';
  const isLeft = orientation === 'left';
  const isUp = orientation === 'up';
  const isVertical = orientation === 'vertical' || isUp;
  if (handleId === 'in' || handleId === 'anode') {
    return isVertical ? (isUp ? 'bottom' : 'top') : (isLeft ? 'right' : 'left');
  }
  if (handleId === 'out' || handleId === 'cathode') {
    return isVertical ? (isUp ? 'top' : 'bottom') : (isLeft ? 'left' : 'right');
  }
  return 'right';
};

/**
 * Finds the edge whose rendered schematic path passes within `maxDist` of
 * `point`, excluding edges connected to `excludeNodeId`. Used both for live
 * junction-preview while dragging a connection and for splitting an edge
 * when a junction/ground node is dropped onto it.
 *
 * Prefer passing `renderedPaths` (the EdgePathContext registry) — those are
 * the wires exactly as drawn. The fallback recomputes each path from this
 * file's hand-maintained handle geometry, which only approximates instrument
 * pins (scope/multimeter/MCU handles resolve to the node center), so hits on
 * those wires can land visibly off.
 */
export function findNearestEdgeAtPoint(
  nodes: Node[],
  edges: Edge[],
  point: { x: number; y: number },
  excludeNodeId?: string,
  maxDist = 16,
  renderedPaths?: Record<string, { x: number; y: number }[]>
): { edge: Edge; projectionPoint: { x: number; y: number } } | null {
  const snapX = Math.round(point.x / 8) * 8;
  const snapY = Math.round(point.y / 8) * 8;

  for (const edge of edges) {
    if (excludeNodeId && (edge.source === excludeNodeId || edge.target === excludeNodeId)) {
      continue;
    }

    let points = renderedPaths?.[edge.id];
    if (!points || points.length < 2) {
      const srcNode: any = nodes.find(n => n.id === edge.source);
      const tgtNode: any = nodes.find(n => n.id === edge.target);
      if (!srcNode || !tgtNode) continue;

      const sourceHandle = edge.sourceHandle || 'out';
      const targetHandle = edge.targetHandle || 'in';
      const pSrc = getHandleCoord(srcNode, sourceHandle);
      const pTgt = getHandleCoord(tgtNode, targetHandle);

      const pathD = getSchematicPath({
        sourceX: pSrc.x,
        sourceY: pSrc.y,
        sourcePosition: getHandlePosition(srcNode, sourceHandle),
        targetX: pTgt.x,
        targetY: pTgt.y,
        targetPosition: getHandlePosition(tgtNode, targetHandle),
        nodes,
        sourceId: edge.source,
        targetId: edge.target,
      });

      points = [];
      const matches = pathD.matchAll(/[ML]\s*(-?\d+\.?\d*)\s*(-?\d+\.?\d*)/g);
      for (const match of matches) {
        points.push({ x: parseFloat(match[1]), y: parseFloat(match[2]) });
      }
    }

    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];

      // The projection point snaps to the grid only ALONG the wire; across the
      // wire it must keep the segment's exact coordinate. Wire runs are not
      // guaranteed to lie on the 8px grid (a pin at x=516, say), and snapping
      // the cross-axis used to shift the spliced junction a few px off the
      // wire — the dot floated beside the line and the replacement edges
      // picked up a permanent jog.
      if (Math.abs(p1.y - p2.y) < 1) {
        const minX = Math.min(p1.x, p2.x);
        const maxX = Math.max(p1.x, p2.x);
        if (point.x >= minX - 4 && point.x <= maxX + 4) {
          const dist = Math.abs(point.y - p1.y);
          if (dist < maxDist) {
            const along = Math.min(maxX, Math.max(minX, snapX));
            return { edge, projectionPoint: { x: along, y: p1.y } };
          }
        }
      } else if (Math.abs(p1.x - p2.x) < 1) {
        const minY = Math.min(p1.y, p2.y);
        const maxY = Math.max(p1.y, p2.y);
        if (point.y >= minY - 4 && point.y <= maxY + 4) {
          const dist = Math.abs(point.x - p1.x);
          if (dist < maxDist) {
            const along = Math.min(maxY, Math.max(minY, snapY));
            return { edge, projectionPoint: { x: p1.x, y: along } };
          }
        }
      }
    }
  }

  return null;
}
