/**
 * Exporter decisions that met real material: pins the profile cut through, a
 * flip the pins let go the wrong way, every bit run at the V-bit's speed, a
 * height map of one face cut into the other, and a frame that neither flew at
 * the job's height nor went round the holes it was meant to check.
 */
import { describe, it, expect } from 'vitest';
import {
  generatePcbLayout,
  reemitPcbGcode,
  generateAirCutPerimeterGcode,
  registrationPinOffsetMm,
  boardOriginOffsetMm,
  toolSpindle,
  catalogueRpm,
  MIN_RPM_CEILING_FROM_30,
  DEFAULT_PCB_OPTIONS,
  type PcbLayoutResult,
  type PcbOptions,
} from '../src/utils/pcbExporter';
import {
  splitAtBoardFlip,
  isBoardFlipLine,
  heightmapCoversBoard,
  boardProbeBounds,
  BOARD_FLIP_NOTE,
} from '../src/utils/boardLevelling';
import { bottomIsolationDepthMm, findMaterial, findTool } from '../src/utils/pcbTooling';
import { presets } from '../src/utils/presets';
import type { ProbeGrid } from '@physbox-io/machining';

const board = presets.basicBlink ?? Object.values(presets).find(p => p.nodes.length > 0)!;
const TWO_LAYER: PcbOptions = {
  ...DEFAULT_PCB_OPTIONS,
  autoGrowBoard: true,
  routingBudgetMs: 1500,
  layers: 2,
  profileToolDiaMm: 3.175,
  pauseOnToolChange: true,
};

let cached: PcbLayoutResult | null = null;
function twoLayer(): PcbLayoutResult {
  cached ??= generatePcbLayout(board.nodes as never, board.edges as never, TWO_LAYER);
  return cached;
}
const pins = () => twoLayer().drills.filter(d => d.isRegistration);

describe('registration pins', () => {
  /*
   * The profile runs last with the pins still in, its tool centre a radius
   * outside the edge — so the cutter reaches a whole diameter out. At a fixed
   * 3 mm, a 3.175 mm end mill ran straight through both pin holes.
   */
  it('sit clear of the profile cutter, whatever its size', () => {
    const r = twoLayer();
    const cutterReach = TWO_LAYER.profileToolDiaMm;
    for (const p of pins()) {
      const outside = p.x < r.boardOriginMm
        ? r.boardOriginMm - p.x
        : p.x - (r.boardOriginMm + r.boardWidthMm);
      expect(outside - p.diameter / 2).toBeGreaterThan(cutterReach + 0.5);
    }
    expect(registrationPinOffsetMm({ profileToolDiaMm: 1.5 })).toBe(3);
    expect(registrationPinOffsetMm({ profileToolDiaMm: 3.175 })).toBeGreaterThan(3.175 + 0.4);
  });

  it('still land on the blank, inside the margin the origin leaves', () => {
    const r = twoLayer();
    expect(r.boardOriginMm).toBeCloseTo(boardOriginOffsetMm(TWO_LAYER), 6);
    for (const p of pins()) expect(p.x - p.diameter / 2).toBeGreaterThan(0.5);
  });

  /*
   * Both pins on the Y centreline made them symmetric about it too, so a
   * front-to-back flip seated as snugly as the intended one and the bottom
   * copper came out mirrored in Y.
   */
  it('seat only the left-to-right flip', () => {
    const r = twoLayer();
    const [a, b] = pins();
    const xMid = r.boardOriginMm + r.boardWidthMm / 2;
    const yMid = r.boardOriginMm + r.boardHeightMm / 2;
    expect(a.y).toBeCloseTo(b.y, 6);
    expect(a.x + b.x).toBeCloseTo(2 * xMid, 6);
    // The front-to-back flip moves both holes off their pins.
    expect(Math.abs(2 * yMid - a.y - a.y)).toBeGreaterThan(a.diameter * 4);
  });
});

describe('each bit at its own spindle speed', () => {
  const spindleAfter = (gcode: string, toolWord: RegExp): number | null => {
    const lines = gcode.split('\n');
    const at = lines.findIndex(l => toolWord.test(l));
    if (at < 0) return null;
    for (let i = at; i < lines.length; i++) {
      const m = /^M3 S(\d+)/.exec(lines[i]);
      if (m) return parseInt(m[1], 10);
    }
    return null;
  };

  it("spins the end mill and the drills at their own catalogue speeds, not the V-bit's", () => {
    const gcode = reemitPcbGcode(twoLayer(), { ...TWO_LAYER, spindleRpm: 15000 }).gcode;
    expect(spindleAfter(gcode, /^T1 M6/)).toBe(15000);
    expect(spindleAfter(gcode, /^T99 M6/)).toBe(catalogueRpm('profile', 3.175));
    const drill = /^T(\d+) M6 ; Tool \d+: ([\d.]+)mm drill/m.exec(gcode);
    expect(drill).not.toBeNull();
    expect(spindleAfter(gcode, new RegExp(`^T${drill![1]} M6`))).toBe(catalogueRpm('drill', parseFloat(drill![2])));
  });

  it('caps a speed to the controller and slows the feed with it', () => {
    const fast = reemitPcbGcode(twoLayer(), { ...TWO_LAYER, spindleRpm: 15000 }).gcode;
    const capped = reemitPcbGcode(twoLayer(), {
      ...TWO_LAYER,
      spindleRpm: 15000,
      spindleLimitsRpm: { maxRpm: 10000 },
    }).gcode;
    expect(spindleAfter(capped, /^T1 M6/)).toBe(10000);
    const firstCutFeed = (g: string) => {
      const lines = g.split('\n');
      const start = lines.findIndex(l => /^T1 M6/.test(l));
      for (let i = start; i < lines.length; i++) {
        const m = /^G1 X[\d.-]+ Y[\d.-]+ F(\d+)/.exec(lines[i]);
        if (m) return parseInt(m[1], 10);
      }
      return NaN;
    };
    expect(firstCutFeed(capped)).toBe(Math.round(firstCutFeed(fast) * (10000 / 15000)));
  });

  it("treats GRBL's stock $30=1000 as a PWM scale, not a speed limit", () => {
    expect(toolSpindle(12000, { maxRpm: 1000, minRpm: 0 })).toEqual({ rpm: 12000, feedScale: 1 });
    expect(toolSpindle(12000, { maxRpm: 24000, minRpm: 14000 })).toEqual({ rpm: 14000, feedScale: 14000 / 12000 });
    expect(toolSpindle(12000, undefined)).toEqual({ rpm: 12000, feedScale: 1 });
  });

  // Etch draws the same line (MIN_RPM_CEILING_FROM_30 in its feeds), so one
  // controller gets one reading whichever app drives it. A diode-built board
  // left at $30=2000 is a PWM scale too; read as a limit it would slow every
  // feed sixfold for a spindle that turns at full speed.
  it('reads a $30 below 3000 as a PWM scale and from 3000 up as a speed limit', () => {
    expect(MIN_RPM_CEILING_FROM_30).toBe(3000);
    expect(toolSpindle(12000, { maxRpm: 2000, minRpm: 500 })).toEqual({ rpm: 12000, feedScale: 1 });
    expect(toolSpindle(12000, { maxRpm: 2999 })).toEqual({ rpm: 12000, feedScale: 1 });
    expect(toolSpindle(12000, { maxRpm: 3000 })).toEqual({ rpm: 3000, feedScale: 3000 / 12000 });
    // A scale-reading $30 puts $31 on the same scale: neither is an RPM.
    expect(toolSpindle(1000, { maxRpm: 255, minRpm: 2000 })).toEqual({ rpm: 1000, feedScale: 1 });
  });
});

describe('the height map describes one face', () => {
  it('marks the flip so the levelling can stop there', () => {
    const gcode = twoLayer().gcode;
    const { probedFace, afterFlip } = splitAtBoardFlip(gcode);
    expect(afterFlip).not.toBeNull();
    expect(isBoardFlipLine(afterFlip!.split('\n')[0])).toBe(true);
    expect(probedFace).not.toContain(BOARD_FLIP_NOTE);
    expect(probedFace).toContain('Top Isolation');
    expect(afterFlip).toContain('Bottom Isolation');
  });

  it('leaves a single-sided job whole', () => {
    expect(splitAtBoardFlip('G1 X1\nM0 ; change sheet\nG1 X2').afterFlip).toBeNull();
  });

  /*
   * The bottom runs unlevelled, so a top depth shaved on the strength of the
   * map would leave the bottom's high spots uncut.
   */
  it('cuts the bottom at its own, unlevelled depth', () => {
    const gcode = reemitPcbGcode(twoLayer(), { ...TWO_LAYER, isolationDepthZ: -0.09, bottomIsolationDepthZ: -0.125 }).gcode;
    const { probedFace, afterFlip } = splitAtBoardFlip(gcode);
    expect(probedFace).toMatch(/Z-0\.090/);
    expect(probedFace).not.toMatch(/Z-0\.125/);
    expect(afterFlip).toMatch(/Z-0\.125/);
    expect(afterFlip).not.toMatch(/ Z-0\.090 /);
  });

  it('takes the deeper of the top depth and the no-map depth for the bottom', () => {
    const tool = findTool('t1_vbit_30')!;
    const material = findMaterial('fr4_1oz')!;
    expect(bottomIsolationDepthMm(-0.05, tool, material)).toBeLessThan(-0.05);
    expect(bottomIsolationDepthMm(-0.5, tool, material)).toBe(-0.5);
  });

  /*
   * The board starts boardOriginMm in from work zero. Probing 0..width covered
   * the margin and missed the far edge by exactly that much.
   */
  it('probes and checks coverage where the board actually is', () => {
    const rect = { boardOriginMm: 8, boardWidthMm: 40, boardHeightMm: 30 };
    expect(boardProbeBounds(rect)).toEqual({ minX: 8, minY: 8, maxX: 48, maxY: 38 });
    const grid = (minX: number, maxX: number, minY: number, maxY: number) =>
      ({ minX, maxX, minY, maxY }) as unknown as ProbeGrid;
    expect(heightmapCoversBoard(grid(8, 48, 8, 38), rect)).toBe(true);
    expect(heightmapCoversBoard(grid(0, 40, 0, 30), rect)).toBe(false);
    expect(heightmapCoversBoard(null, rect)).toBe(false);
  });
});

describe('the framing lap', () => {
  it('goes round every cut in the job, registration holes included', () => {
    const r = twoLayer();
    const lap = generateAirCutPerimeterGcode(r, TWO_LAYER, 0);
    const xy = (g: string) =>
      g
        .split('\n')
        .map(l => [/X(-?[\d.]+)/.exec(l.split(';')[0]), /Y(-?[\d.]+)/.exec(l.split(';')[0])])
        .filter(([x, y]) => x && y)
        .map(([x, y]) => ({ x: parseFloat(x![1]), y: parseFloat(y![1]) }))
        .filter(p => !(p.x === 0 && p.y === 0));
    const box = xy(lap);
    const minX = Math.min(...box.map(p => p.x));
    const maxX = Math.max(...box.map(p => p.x));
    for (const p of pins()) {
      expect(p.x - p.diameter / 2).toBeGreaterThanOrEqual(minX - 1e-3);
      expect(p.x + p.diameter / 2).toBeLessThanOrEqual(maxX + 1e-3);
    }
    for (const p of xy(r.gcode)) {
      expect(p.x).toBeGreaterThanOrEqual(minX - 1e-3);
      expect(p.x).toBeLessThanOrEqual(maxX + 1e-3);
    }
  });

  it("flies at the job's own highest Z", () => {
    const lap = generateAirCutPerimeterGcode(twoLayer(), TWO_LAYER, 0);
    const zs = lap.split('\n').map(l => /^G0 Z([\d.]+)/.exec(l)).filter(Boolean).map(m => parseFloat(m![1]));
    expect(new Set(zs)).toEqual(new Set([TWO_LAYER.toolChangeZ]));
  });
});
