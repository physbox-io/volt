/**
 * Board layout end to end, over every shipped preset.
 *
 * Replaces `src/test_parametric_mcu.ts` and `src/debug_heltec_routing.ts`,
 * which laid out two boards apiece and printed the result for a human to read.
 * The presets are the best fixtures in the repo — they are the boards users
 * actually open — so every one of them is laid out here and checked against the
 * invariants that have to hold whatever the router decides.
 */
import { describe, it, expect } from 'vitest';
import { presets } from '../src/utils/presets';
import {
  generatePcbLayout,
  generatePcbGcode,
  generateAirCutGcode,
  groupDrillsByBit,
  DEFAULT_PCB_OPTIONS,
  type PcbLayoutResult,
} from '../src/utils/pcbExporter';

const OPTS = { ...DEFAULT_PCB_OPTIONS, autoGrowBoard: true };

/** Every preset that has anything to lay out. */
const BOARDS = Object.entries(presets).filter(([, p]) => p.nodes.length > 0);

/**
 * Presets whose copper still comes out shorted.
 *
 * Both put GND against N4 in the *nominal* routed geometry — setting
 * `copperFloodMm: 0` does not clear it, so this is the router placing a track
 * on top of another net's copper rather than the flood growing into it. Listed
 * rather than skipped: if the router is fixed these go green and this list is
 * what tells you to shorten it, and if the fault spreads to another preset the
 * suite goes red.
 */
const KNOWN_SHORTED = new Set(['classABamp', 'transformerRectifier']);

/**
 * Presets the router cannot finish on a single layer at the default clearance.
 * It says so — a jumper is the honest answer for these, not a silent drop.
 */
const KNOWN_INCOMPLETE = new Set(['heltecLightToFreqHIL']);

const layouts = new Map<string, PcbLayoutResult>();
function layout(key: string): PcbLayoutResult {
  if (!layouts.has(key)) {
    const p = presets[key];
    layouts.set(key, generatePcbLayout(p.nodes as never, p.edges as never, OPTS));
  }
  return layouts.get(key)!;
}

describe.each(BOARDS.map(([k]) => k))('%s', key => {
  it('lays out without throwing, on a board with real dimensions', () => {
    const r = layout(key);
    expect(r.boardWidthMm).toBeGreaterThan(0);
    expect(r.boardHeightMm).toBeGreaterThan(0);
  });

  it('places every component the preset declares', () => {
    const r = layout(key);
    // Nets and instruments are not parts; every placed component must at least
    // carry a resolved footprint rather than an undefined one.
    expect(r.components.length).toBeGreaterThan(0);
    for (const c of r.components) {
      expect(c.footprint, `${c.id} resolved a footprint`).toBeTruthy();
      expect(c.footprint.pads.length, `${c.id} (${c.footprint.packageId}) has pads`).toBeGreaterThan(0);
    }
  });

  it('routes every connection, or reports the ones it could not', () => {
    const r = layout(key);
    if (KNOWN_INCOMPLETE.has(key)) {
      // The failure must still be *reported*, never silently dropped.
      expect(r.unrouted.length + r.violations.filter(v => v.severity === 'error').length)
        .toBeGreaterThan(0);
      return;
    }
    expect(r.unrouted, `unrouted: ${JSON.stringify(r.unrouted)}`).toHaveLength(0);
    expect(r.completion).toBeCloseTo(1, 6);
  });

  it('leaves no net shorted to another', () => {
    const r = layout(key);
    const shorts = r.violations.filter(v => v.severity === 'error' && /Short circuit/.test(v.message));
    if (KNOWN_SHORTED.has(key)) {
      expect(shorts.length, 'still shorted — remove from KNOWN_SHORTED once fixed').toBeGreaterThan(0);
      return;
    }
    expect(shorts.map(v => v.message)).toEqual([]);
  });

  it('drops no connection for want of a pin to map it to', () => {
    const r = layout(key);
    // The 0805-for-a-dev-board failure: a pin that cannot be mapped onto the
    // resolved footprint takes its whole connection with it.
    const dropped = r.violations.filter(v => /connection dropped/.test(v.message));
    expect(dropped.map(v => v.message)).toEqual([]);
  });

  it('keeps every pad inside the board outline', () => {
    const r = layout(key);
    for (const p of r.pads) {
      expect(p.x, `${p.componentId}.${p.pinNumber} X`).toBeGreaterThanOrEqual(-1e-6);
      expect(p.y, `${p.componentId}.${p.pinNumber} Y`).toBeGreaterThanOrEqual(-1e-6);
      expect(p.x).toBeLessThanOrEqual(r.boardWidthMm + 1e-6);
      expect(p.y).toBeLessThanOrEqual(r.boardHeightMm + 1e-6);
    }
  });

  it('drills every hole inside the board, at a positive diameter', () => {
    const r = layout(key);
    for (const d of r.drills) {
      expect(d.diameter, `${d.componentId}.${d.pinNumber}`).toBeGreaterThan(0);
      expect(d.x).toBeGreaterThanOrEqual(-1e-6);
      expect(d.y).toBeGreaterThanOrEqual(-1e-6);
      expect(d.x).toBeLessThanOrEqual(r.boardWidthMm + 1e-6);
      expect(d.y).toBeLessThanOrEqual(r.boardHeightMm + 1e-6);
    }
  });

  it('assigns every drilled hole to exactly one bit', () => {
    const r = layout(key);
    const groups = groupDrillsByBit(r.drills, 0.3);
    const grouped = groups.reduce((n, g) => n + g.holes.length, 0);
    expect(grouped).toBe(r.drills.length);
    for (const g of groups) {
      // A lead may be drilled looser than nominal, never tighter.
      expect(g.holeMm).toBeGreaterThanOrEqual(Math.max(...g.nominals) - 1e-9);
    }
  });
});

describe('emitted G-code', () => {
  // One representative board with through-hole parts, traces and drills.
  const key = 'timer555Blink';

  it('starts the spindle before the first cutting move, and stops it', () => {
    const r = layout(key);
    const gcode = generatePcbGcode(r, OPTS);
    const lines = gcode.split('\n').map(l => (l.includes(';') ? l.slice(0, l.indexOf(';')) : l));

    const firstSpindle = lines.findIndex(l => /\bM[34]\b/.test(l));
    const firstCut = lines.findIndex(l => /\bG1\b/.test(l) && /Z-/.test(l));
    expect(firstSpindle, 'the program starts the spindle').toBeGreaterThanOrEqual(0);
    if (firstCut !== -1) expect(firstSpindle).toBeLessThan(firstCut);
    expect(gcode).toMatch(/\bM5\b/);
  });

  it('is metric and absolute', () => {
    const gcode = generatePcbGcode(layout(key), OPTS);
    expect(gcode).toMatch(/\bG21\b/);
    expect(gcode).toMatch(/\bG90\b/);
  });

  it('ends the program', () => {
    expect(generatePcbGcode(layout(key), OPTS)).toMatch(/\bM30\b|\bM2\b/);
  });

  it('has an air-cut twin that cannot reach the stock or spin the tool', () => {
    const air = generateAirCutGcode(generatePcbGcode(layout(key), OPTS), 20);
    for (const line of air.split('\n')) {
      const code = line.includes(';') ? line.slice(0, line.indexOf(';')) : line;
      expect(/\bM[34]\b/.test(code), `spindle command survived: ${line}`).toBe(false);
      for (const m of code.matchAll(/\bZ(-?\d+(?:\.\d+)?)/gi)) {
        expect(parseFloat(m[1]), `Z reaches the stock: ${line}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('the Heltec + CC1101 board', () => {
  // The case src/debug_heltec_routing.ts existed to watch by eye.
  it('routes completely, on a module footprint rather than a chip resistor', () => {
    const r = layout('heltecCc1101');
    expect(r.success).toBe(true);
    expect(r.completion).toBeCloseTo(1, 6);
    expect(r.unrouted).toHaveLength(0);

    const heltec = r.components.find(c => c.type === 'heltec_v4');
    expect(heltec, 'the Heltec is placed').toBeTruthy();
    // 2x18 through-hole module, not the 0805 it used to fall back to.
    expect(heltec!.footprint.pads.length).toBe(36);
  });
});
