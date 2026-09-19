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
import { routeBoard, type RoutePin, type RouteObstacle } from '../src/utils/pcbRouter';
import {
  generatePcbLayout,
  scorePlacement,
  generatePcbGcode,
  generateAirCutGcode,
  groupDrillsByBit,
  DEFAULT_PCB_OPTIONS,
  type PcbLayoutResult,
  layoutArrangement,
  coarseRoutability,
} from '../src/utils/pcbExporter';

const OPTS = { ...DEFAULT_PCB_OPTIONS, autoGrowBoard: true };

/** Every preset that has anything to lay out. */
const BOARDS = Object.entries(presets).filter(([, p]) => p.nodes.length > 0);

/**
 * Presets whose copper comes out shorted.
 *
 * Empty, and meant to stay that way. Two presets used to sit here with GND
 * against N4; the cause was a footprint whose declared courtyard was smaller
 * than its own pads, so the placer left a full gap between two parts while
 * their copper overlapped. See the courtyard test in footprintsAndTooling.
 */
const KNOWN_SHORTED = new Set<string>([]);

/**
 * Presets the router cannot finish on a single layer at the default clearance.
 * It says so — a jumper is the honest answer for these, not a silent drop.
 *
 * Empty since the placement search landed. `heltecLightToFreqHIL` sat here for
 * as long as placement was "normalise the schematic and de-overlap it": there
 * was a routable arrangement all along, and nothing ever looked for it.
 */
const KNOWN_INCOMPLETE = new Set<string>([]);

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

describe('the board preview', () => {
  const hasCircle = (svg: string, x: number, y: number) =>
    svg.includes(`<circle cx="${x.toFixed(3)}" cy="${y.toFixed(3)}"`);

  it('draws the copper view with machine +Y up the screen', () => {
    const r = layout('heltecCc1101');
    const vh = r.boardHeightMm + r.boardOriginMm * 2;
    const far = r.drills.reduce((a, b) => (b.y > a.y ? b : a));
    const near = r.drills.reduce((a, b) => (b.y < a.y ? b : a));

    // Emitting program coordinates straight into the viewBox reflected the
    // whole picture, so the preview disagreed with the board on the bed. The
    // hole furthest from the operator must draw above the nearest one.
    expect(hasCircle(r.svg, far.x, vh - far.y), 'far hole is transformed').toBe(true);
    expect(hasCircle(r.svg, near.x, vh - near.y), 'near hole is transformed').toBe(true);
    expect(vh - far.y).toBeLessThan(vh - near.y);
  });

  it('mirrors X but not Y for the component side', () => {
    const r = layout('heltecCc1101');
    const vw = r.boardWidthMm + r.boardOriginMm * 2;
    const vh = r.boardHeightMm + r.boardOriginMm * 2;
    const d = r.drills.reduce((a, b) => (b.x > a.x ? b : a));
    expect(hasCircle(r.svgComponentSide, vw - d.x, vh - d.y)).toBe(true);
  });

  it('labels every pad with its pin number, in a group the viewer can hide', () => {
    const r = layout('heltecCc1101');
    const group = r.svg.match(/<g class="pcb-pad-numbers"[\s\S]*?<\/g>/)?.[0];
    expect(group, 'pad numbers are grouped').toBeTruthy();
    expect((group!.match(/<text /g) || []).length).toBe(r.pads.length);
    // The number that would have caught the reversed Heltec row.
    expect(group).toContain('>19<');
  });
});

describe('isolating unused pins', () => {
  // An isolation-milled board keeps every scrap of copper the toolpath does not
  // encircle. A hole drilled for an unconnected pin therefore goes through that
  // leftover foil, and the pin poking out the far side makes an intermittent
  // connection to whatever the foil touches - in practice the ground pour.
  const board = (isolateUnusedPads: boolean) =>
    generatePcbLayout(
      presets.heltecCc1101.nodes as never,
      presets.heltecCc1101.edges as never,
      { ...OPTS, isolateUnusedPads }
    );

  it('rings every pad that carries no net, and only those', () => {
    const r = board(true);
    const unconnected = r.pads.filter(p => !p.netId);
    expect(unconnected.length).toBeGreaterThan(0);

    const ringed = new Set(
      r.isolationPaths.filter(p => p.netId.startsWith('unused:')).map(p => p.netId)
    );
    expect(ringed.size).toBe(unconnected.length);
    for (const pad of unconnected) {
      expect(ringed.has(`unused:${pad.componentId}-${pad.pinNumber}`)).toBe(true);
    }
  });

  it('cuts no such rings when switched off', () => {
    const r = board(false);
    expect(r.isolationPaths.some(p => p.netId.startsWith('unused:'))).toBe(false);
  });

  it('leaves the islands isolated rather than shorted to a net', () => {
    const r = board(true);
    const shorts = r.violations.filter(
      v => v.severity === 'error' && v.message.startsWith('Short circuit')
    );
    expect(shorts).toEqual([]);
  });
});

describe('non-copper links between pads', () => {
  // What a wire jumper is, as far as the router is concerned: two pads that
  // count as connected without a trace between them. Tested directly, because
  // the jumper search on top of it is expensive and heuristic, and a failure
  // there should not be confusable with a failure here.
  const barrier = (): RouteObstacle[] =>
    Array.from({ length: 21 }, (_, i) => ({ x: 20, y: i, radiusMm: 1.2 }));

  const pins: RoutePin[] = [
    { netId: 'N1', key: 'a-1', componentId: 'a', x: 5, y: 10, padRadiusMm: 0.9 },
    { netId: 'N1', key: 'b-1', componentId: 'b', x: 35, y: 10, padRadiusMm: 0.9 },
  ];

  const opts = {
    boardWidthMm: 40,
    boardHeightMm: 20,
    gridMm: 0.5,
    traceWidthMm: 0.4,
    clearanceMm: 0.4,
    edgeClearanceMm: 1,
    bendPenalty: 1.5,
    budgetMs: 2000,
    obstacles: barrier(),
  };

  it('cannot route through a solid barrier', () => {
    const r = routeBoard(pins, opts);
    expect(r.unrouted).toHaveLength(1);
    expect(r.completion).toBeLessThan(1);
  });

  it('needs no trace at all once the pair is linked', () => {
    const r = routeBoard(pins, { ...opts, linkedPairs: [['a-1', 'b-1']] });
    expect(r.unrouted).toHaveLength(0);
    expect(r.completion).toBe(1);
    // The wire does the work, so no copper is planned for it.
    expect(r.traces).toHaveLength(0);
  });
});

describe('the placement search', () => {
  const p = presets.heltecLightToFreqHIL;
  const run = (placementSearch: boolean) =>
    generatePcbLayout(p.nodes as never, p.edges as never, { ...OPTS, placementSearch });

  it("finds a routable arrangement where the schematic's own is not", () => {
    // Placement used to be the schematic normalised into the board and then
    // de-overlapped, with connectivity never consulted — so whether a
    // single-layer board routed came down to how the schematic happened to be
    // drawn. This preset was unroutable for exactly that long.
    expect(run(false).completion).toBeLessThan(1);
    expect(run(true).completion).toBe(1);
  });
});

describe('the placement search, on arrangements of known routability', () => {
  // Two arrangements of the same carrier board, measured by actually routing
  // them: BREAKOUT-R below the Heltec routes completely, to its right leaves
  // GPIO41 unroutable. The search's two ranking stages have to agree. For a
  // long time nothing did — scored on straight pad-to-pad lines the unroutable
  // one won by an order of magnitude, because a compact placement has short
  // lines that seldom cross while the real router needs long detours around
  // pad rows that do.
  const J2 = ['GND1', 'VIN', 'VE1', 'VE2', 'GPIO_44', 'GPIO_43', 'RST', 'GPIO_0', 'GPIO_36',
    'GPIO_35', 'GPIO_34', 'GPIO_33', 'GPIO_47', 'GPIO_48', 'GPIO_26', 'GPIO_21', 'GPIO_20', 'GPIO_19'];
  const J3 = ['GND2', '3V3', '3V3_2', 'GPIO_37', 'GPIO_46', 'GPIO_45', 'GPIO_42', 'GPIO_41', 'GPIO_40',
    'GPIO_39', 'GPIO_38', 'GPIO_1', 'GPIO_2', 'GPIO_3', 'GPIO_4', 'GPIO_5', 'GPIO_6', 'GPIO_7'];
  const pins = [
    ...J2.map((id, i) => ({ id, label: id, type: 'io', side: 'left', pinNumber: `J2-${i + 1}` })),
    ...J3.map((id, i) => ({ id, label: id, type: 'io', side: 'right', pinNumber: `J3-${i + 1}` })),
  ];

  const board = (boRightAt: { x: number; y: number }) => ({
    nodes: [
      { id: 'heltec1', type: 'mcu', position: { x: 300, y: 240 }, data: { label: 'Heltec', mcuConfig: {
        presetKey: 'heltec_v4', style: 'header_2x', pinCount: 36, widthMm: 25.5, heightMm: 47.88,
        pitchMm: 2.54, rowSpacingMm: 22.86, isSmd: false, drillDiaMm: 1,
        padWidthMm: 1.8, padHeightMm: 1.8, pins } } },
      { id: 'bo_left', type: 'pinheader', position: { x: 60, y: 300 }, data: { rows: 1, cols: 5, pitchMm: 2.54 } },
      { id: 'bo_right', type: 'pinheader', position: boRightAt, data: { rows: 1, cols: 4, pitchMm: 2.54, orientation: 'vertical' } },
      { id: 'bme280', type: 'pinheader', position: { x: 1000, y: 260 }, data: { rows: 1, cols: 4, pitchMm: 2.54 } },
      { id: 'gnd1', type: 'ground', position: { x: 300, y: 780 }, data: {} },
    ],
    edges: ([
      ['e1', 'bme280', '3V3', '1'], ['e2', 'bme280', 'GND1', '2'],
      ['e3', 'bme280', 'GPIO_7', '3'], ['e4', 'bme280', 'GPIO_6', '4'],
      ['e5', 'gnd1', 'GND1', 'in'],
      ['e6', 'bo_left', 'GPIO_1', '1'], ['e7', 'bo_left', 'GPIO_2', '2'], ['e8', 'bo_left', 'GPIO_3', '3'],
      ['e9', 'bo_left', 'GPIO_4', '4'], ['e10', 'bo_left', 'GPIO_5', '5'],
      ['e11', 'bo_right', 'VIN', '1'], ['e12', 'bo_right', 'GND2', '2'],
      ['e13', 'bo_right', 'GPIO_33', '3'], ['e14', 'bo_right', 'GPIO_41', '4'],
    ] as [string, string, string, string][]).map(([id, target, sourceHandle, targetHandle]) =>
      ({ id, source: 'heltec1', target, sourceHandle, targetHandle, type: 'smoothstep' })),
  });

  const BELOW = { x: 420, y: 700 };
  const RIGHT = { x: 700, y: 300 };

  // The board the search sees: placed as a candidate would be, at the tightest
  // spread that fits, before any crop. A token routing budget is enough to get
  // the arrangement out — these assert the ranking stages, not the route.
  const arrangement = (boRightAt: { x: number; y: number }) => {
    const b = board(boRightAt);
    return layoutArrangement(b.nodes as never, b.edges as never, { ...OPTS, routingBudgetMs: 50 });
  };
  const scoreOf = (boRightAt: { x: number; y: number }) => {
    const r = arrangement(boRightAt);
    return scorePlacement(r.components, r.nets, {
      ...OPTS,
      boardWidthMm: r.boardWidthMm,
      boardHeightMm: r.boardHeightMm,
    });
  };
  const coarseOf = (boRightAt: { x: number; y: number }) => {
    const r = arrangement(boRightAt);
    // A generous budget: the pass stops as soon as the board routes, and the
    // point is what it finds, not how fast the machine running the tests is.
    return coarseRoutability(r.components, r.boardWidthMm, r.boardHeightMm, r.nets, OPTS, 3000);
  };

  it('is not thrown away as an overlap before it is scored', () => {
    // The seed board is sized from the parts, and at the tightest spread it
    // cannot hold the connector on the far side of the module. Every candidate
    // that put it there was discarded as overlapping — the arrangement the
    // search exists to find, never once scored — until candidates were allowed
    // the wider spreads the main attempts already use.
    expect(arrangement(BELOW).overlaps).toBe(0);
  });

  it('scores the arrangement that actually routes better', () => {
    expect(scoreOf(BELOW)).toBeLessThan(scoreOf(RIGHT));
  });

  it('routes the arrangement that actually routes, coarsely, and not the other', () => {
    expect(coarseOf(BELOW).completion).toBe(1);
    expect(coarseOf(RIGHT).completion).toBeLessThan(1);
  });

  it('finds an arrangement that routes, from the one that does not', () => {
    // The TeknoBox carrier as drawn: 7 of 108 hand-tried arrangements routed,
    // and the schematic's own is not one of them.
    const b = board(RIGHT);
    const r = generatePcbLayout(b.nodes as never, b.edges as never,
      { ...OPTS, placementSearch: true, routingBudgetMs: 3000 });
    expect(r.completion).toBe(1);
    expect(r.warnings.some(w => /overlap/i.test(w))).toBe(false);
  });
});

/**
 * The mirror that makes a single-sided board assemble the right way round.
 *
 * The mill works copper-up, but a through-hole part is inserted from the bare
 * face and soldered to the copper, so the face the parts land on is the mirror
 * of the face that was cut. Cutting the layout as drawn seats every part
 * handed, and the part cannot be turned over to compensate: a module has a
 * fixed handedness, and rotating it 180 degrees reverses the pin order within
 * each row instead. On a Heltec carrier that reads as the wrong row of GPIOs
 * reaching the breakout header.
 *
 * What is pinned here is that the mirror is a *pure reflection*. It moves every
 * feature to 2*mid - x and changes nothing else — a board whose mirror also
 * moved a net, a clearance or a route would be a different board, and the whole
 * point is that it is the same board, handed. It is applied to the layout
 * rather than to the emitted program precisely so that the previews, the
 * toolpath preview and the Gerber package inherit it; the last case here is
 * what would have caught doing it in the G-code alone.
 */
describe('single-sided assembly mirror', () => {
  const MIRROR_SAMPLE = BOARDS
    .map(([key, preset]) => ({
      key,
      preset,
      plain: generatePcbLayout(preset.nodes, preset.edges, {
        ...OPTS, layers: 1, mirrorSingleSided: false,
      }),
    }))
    .filter(b => b.plain.success && b.plain.pads.length >= 4)
    .slice(0, 6);

  it('has boards to check', () => {
    expect(MIRROR_SAMPLE.length).toBeGreaterThan(0);
  });

  for (const { key, preset, plain } of MIRROR_SAMPLE) {
    it(`${key}: reflects every feature and disturbs nothing else`, () => {
      const mirrored = generatePcbLayout(preset.nodes, preset.edges, {
        ...OPTS, layers: 1, mirrorSingleSided: true,
      });
      const mid = plain.boardOriginMm + plain.boardWidthMm / 2;
      const rx = (x: number) => 2 * mid - x;

      expect(mirrored.boardWidthMm).toBe(plain.boardWidthMm);
      expect(mirrored.boardHeightMm).toBe(plain.boardHeightMm);
      expect(mirrored.completion).toBe(plain.completion);
      expect(mirrored.violations.length).toBe(plain.violations.length);
      expect(mirrored.pads.length).toBe(plain.pads.length);
      expect(mirrored.drills.length).toBe(plain.drills.length);

      // A pad keeps its net, its pin and its Y, and lands at the reflected X.
      // Net identity is the assertion that matters: a mirror that renamed or
      // re-paired a net would be a rewiring wearing a reflection's clothes.
      plain.pads.forEach((pad, i) => {
        const m = mirrored.pads[i];
        expect(m.netId).toBe(pad.netId);
        expect(m.componentId).toBe(pad.componentId);
        expect(m.handleId).toBe(pad.handleId);
        expect(m.y).toBeCloseTo(pad.y, 6);
        expect(m.x).toBeCloseTo(rx(pad.x), 6);
      });

      plain.drills.forEach((d, i) => {
        expect(mirrored.drills[i].diameter).toBeCloseTo(d.diameter, 6);
        expect(mirrored.drills[i].y).toBeCloseTo(d.y, 6);
        expect(mirrored.drills[i].x).toBeCloseTo(rx(d.x), 6);
      });

      // Shared objects: topTraces/bottomTraces are filtered views over the same
      // TraceSegment instances as traces, and isolationPaths and
      // topIsolationPaths are the same array. Walking each field in turn would
      // reflect those twice and put them back where they started.
      plain.traces.forEach((t, i) => {
        t.points.forEach((pt, j) => {
          expect(mirrored.traces[i].points[j].x).toBeCloseTo(rx(pt.x), 6);
        });
      });
      plain.isolationPaths.forEach((path, i) => {
        path.points.forEach((pt, j) => {
          expect(mirrored.isolationPaths[i].points[j].x).toBeCloseTo(rx(pt.x), 6);
        });
      });
    });
  }

  it('leaves a two-layer board alone — its parts sit on the copper cut first', () => {
    const { preset } = MIRROR_SAMPLE[0];
    const off = generatePcbLayout(preset.nodes, preset.edges, {
      ...OPTS, layers: 2, mirrorSingleSided: false,
    });
    const on = generatePcbLayout(preset.nodes, preset.edges, {
      ...OPTS, layers: 2, mirrorSingleSided: true,
    });
    expect(on.pads.map(p => p.x)).toEqual(off.pads.map(p => p.x));
  });

  it('mirrors by default, because that is how these boards are built', () => {
    expect(DEFAULT_PCB_OPTIONS.mirrorSingleSided).toBe(true);
    const { preset } = MIRROR_SAMPLE[0];
    const dflt = generatePcbLayout(preset.nodes, preset.edges, { ...OPTS, layers: 1 });
    const explicit = generatePcbLayout(preset.nodes, preset.edges, {
      ...OPTS, layers: 1, mirrorSingleSided: true,
    });
    expect(dflt.pads.map(p => p.x)).toEqual(explicit.pads.map(p => p.x));
  });

  it('drills the program where the mirrored pads are, not where the layout drew them', () => {
    const { preset, plain } = MIRROR_SAMPLE[0];
    const mirrored = generatePcbLayout(preset.nodes, preset.edges, {
      ...OPTS, layers: 1, mirrorSingleSided: true,
    });
    const gcode = generatePcbGcode(mirrored, { ...OPTS, layers: 1, mirrorSingleSided: true });
    const mid = plain.boardOriginMm + plain.boardWidthMm / 2;

    // A hole off the centreline, so the mirrored and unmirrored X differ enough
    // to tell apart at the 3dp the emitter writes.
    const hole = plain.drills.find(d => Math.abs(d.x - mid) > 1);
    expect(hole).toBeDefined();
    expect(gcode).toContain(`X${(2 * mid - hole!.x).toFixed(3)}`);
  });
});

/**
 * The warning that carries the mirror to someone who did not read the docs.
 *
 * Turning the mirror off is a real choice - it is right if the parts are being
 * seated on the copper face - but on a board with legs through it, it is nearly
 * always a mistake that stays invisible until the parts are in and the pins are
 * in the wrong holes. The layout says so itself, so the export panel and every
 * MCP caller get it without going looking.
 */
describe('mirror-off warning', () => {
  const withPads = BOARDS
    .map(([key, preset]) => ({ key, preset }))
    .find(({ preset }) => {
      const r = generatePcbLayout(preset.nodes, preset.edges, { ...OPTS, layers: 1 });
      return r.success && r.drills.some(d => !d.isVia && !d.isRegistration);
    });

  it('warns when a through-hole board is cut unmirrored', () => {
    expect(withPads).toBeDefined();
    const r = generatePcbLayout(withPads!.preset.nodes, withPads!.preset.edges, {
      ...OPTS, layers: 1, mirrorSingleSided: false,
    });
    const warning = r.warnings.find(w => w.startsWith('Mirror is off'));
    expect(warning).toBeDefined();
    expect(warning).toMatch(/seat MIRRORED/);
  });

  it('stays quiet on a board that is mirrored', () => {
    const r = generatePcbLayout(withPads!.preset.nodes, withPads!.preset.edges, {
      ...OPTS, layers: 1, mirrorSingleSided: true,
    });
    expect(r.warnings.some(w => w.startsWith('Mirror is off'))).toBe(false);
  });

  it('stays quiet on a two-layer board, which is never mirrored', () => {
    const r = generatePcbLayout(withPads!.preset.nodes, withPads!.preset.edges, {
      ...OPTS, layers: 2, mirrorSingleSided: false,
    });
    expect(r.warnings.some(w => w.startsWith('Mirror is off'))).toBe(false);
  });
});
