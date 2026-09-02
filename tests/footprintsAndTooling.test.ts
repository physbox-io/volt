/**
 * The footprint library and the tool catalogue.
 *
 * Converted from `src/test_footprints_tooling.ts`, which ran these same
 * assertions under a hand-rolled `ok()` harness and had to be invoked by hand
 * with `npx tsx`. Nothing about the checks changed — only what runs them.
 */
import { describe, it, expect } from 'vitest';
import {
  STANDARD_FOOTPRINTS,
  packageOptionsForType,
  supportsPackageSelection,
  resolveFootprint,
  parsePackageId,
  generateDIPFootprint,
  generateDualRowFootprint,
  generateQuadFamilyFootprint,
  generateDualSmdFootprint,
  footprintFromParams,
  DIP_ROW_SPACING,
  type ComponentFootprint,
} from '../src/utils/pcbFootprints';
import {
  PCB_TOOL_PRESETS,
  PCB_MATERIAL_PRESETS,
  calculatePcbFeeds,
  createCustomTool,
  minIsolationChannelMm,
  minPadGapMm,
  checkMillability,
  feedFromChipload,
} from '../src/utils/pcbTooling';

/** Asserts a condition, carrying the original message through to the report. */
function ok(cond: unknown, msg: string) {
  expect(cond, msg).toBeTruthy();
}

/** Asserts `a` is within `tol` of `b`. */
function near(a: number, b: number, tol: number, msg: string) {
  expect(Math.abs(a - b) <= tol, `${msg} (got ${a.toFixed(4)}, want ~${b})`).toBe(true);
}

/** The distinct pad X coordinates of a footprint, ascending. */
function xs(fp: ComponentFootprint) {
  return [...new Set(fp.pads.map(p => +p.x.toFixed(3)))].sort((a, b) => a - b);
}

describe('DIP width is parametric', () => {
  it('defaults each pin count to the row spacing that part actually ships in', () => {
    const atmega = generateDIPFootprint(28);
    ok(atmega.pads.length === 28, 'DIP-28 has 28 pads');
    near(xs(atmega)[1] - xs(atmega)[0], DIP_ROW_SPACING.narrow, 1e-6,
      'DIP-28 defaults to 0.3" narrow rows (ATmega328P, not the old 0.6" guess)');

    const wide = generateDIPFootprint(28, { rowSpacing: 'wide' });
    near(xs(wide)[1] - xs(wide)[0], DIP_ROW_SPACING.wide, 1e-6, 'DIP-28-W honours the wide override');

    const dip40 = generateDIPFootprint(40);
    near(xs(dip40)[1] - xs(dip40)[0], DIP_ROW_SPACING.wide, 1e-6, 'DIP-40 still defaults to 0.6"');
  });

  it('rounds an odd pin count up to a whole dual row', () => {
    const odd = generateDIPFootprint(15);
    ok(odd.pads.length === 16, 'an odd pin count rounds up to a whole dual row');
  });

  it('respects arbitrary spacing, pitch and drill', () => {
    const custom = generateDIPFootprint(8, { rowSpacing: 9.0, pitchMm: 1.778, drillDiaMm: 0.6 });
    near(xs(custom)[1] - xs(custom)[0], 9.0, 1e-6, 'arbitrary row spacing is respected');
    near(Math.abs(custom.pads[0].y - custom.pads[1].y), 1.778, 1e-6, 'arbitrary pitch is respected');
    ok(custom.pads.every(p => p.drillDiameter === 0.6), 'arbitrary drill size is respected');
  });
});

describe('package id parsing', () => {
  it.each([
    ['QFN-32', 32],
    ['QFN-48', 48],
    ['TQFP-44', 44],
    ['LQFP-64', 64],
    ['DFN-8', 8],
    ['TSSOP-20', 20],
    ['SSOP-16', 16],
    ['MSOP-8', 8],
    ['SOIC-16', 16],
    ['DIP-28', 28],
  ] as const)('%s parses to %i signal pads', (id, pins) => {
    const fp = parsePackageId(id);
    ok(!!fp && fp.pads.filter(p => p.role !== 'thermal').length === pins,
      `${id} parses to ${pins} signal pads`);
  });

  it('parses ids whose own names contain dashes', () => {
    ok(parsePackageId('0603')?.pads.length === 2, '0603 chip passive parses');
    ok(parsePackageId('SOD-123')?.pads.length === 2, 'SOD-123 parses despite its internal dash');
    ok(parsePackageId('SOT-23-5')?.pads.length === 5, 'SOT-23-5 parses despite its internal dashes');
    ok(parsePackageId('SOT-223')?.pads.length === 4, 'SOT-223 parses with its tab pad');
  });

  it('returns null for an unknown id rather than guessing', () => {
    ok(parsePackageId('WHAT-IS-THIS') === null, 'an unknown id returns null rather than a wrong guess');
  });
});

describe('package id modifiers', () => {
  it('widens SOIC on the -W suffix', () => {
    const narrow = parsePackageId('SOIC-16')!;
    const wide = parsePackageId('SOIC-16-W')!;
    ok(xs(wide)[1] - xs(wide)[0] > xs(narrow)[1] - xs(narrow)[0], 'SOIC-16-W is wider than SOIC-16');
  });

  it('drives pitch and body overrides all the way to the pads', () => {
    const pitched = parsePackageId('QFN-32-P0.65-B7x7')!;
    const leftEdgeX = Math.min(...pitched.pads.map(p => p.x));
    const ys = pitched.pads.filter(p => p.x === leftEdgeX).map(p => p.y).sort((a, b) => a - b);
    near(Math.abs(ys[1] - ys[0]), 0.65, 1e-6, 'QFN pitch override reaches the pads');
    // Leadless lands protrude 0.2mm past the body for a solder fillet, so a 7mm
    // body courtyards at 7.4mm.
    near(pitched.widthMm, 7.4, 0.01, 'QFN body override reaches the courtyard');
    near(Math.abs(leftEdgeX) + pitched.pads.find(p => p.x === leftEdgeX)!.padWidth / 2, 3.7, 0.01,
      'the outer copper edge sits 0.2mm outside the 7mm body');

    const dipMod = parsePackageId('DIP-28-P2.54-R7.62')!;
    near(xs(dipMod)[1] - xs(dipMod)[0], 7.62, 1e-6, 'explicit row spacing token on a DIP');
  });

  it('builds a module from its tokens', () => {
    const mod = parsePackageId('MODULE-2x20-P2.54-R17.78-B21x51')!;
    ok(mod.pads.length === 40, 'MODULE-2x20 yields 40 pads');
    near(xs(mod)[1] - xs(mod)[0], 17.78, 1e-6, 'module row spacing token (Pico geometry)');
    near(mod.widthMm, 21, 0.01, 'module body width token');
    near(mod.heightMm, 51, 0.01, 'module body height token');
  });

  it('allows a different pin count per side', () => {
    const asym = parsePackageId('MODULE-18+12-R22.86')!;
    ok(asym.pads.length === 30, 'a module can carry different pin counts per side');
    const left = asym.pads.filter(p => p.x < 0);
    ok(left.length === 18, 'the left header keeps its own pin count');
  });

  it('reads a row offset, and the `_` prefix as its negative', () => {
    // 4 pins per side at the default 2.54mm pitch: the unshifted top pad is at
    // 3 * 2.54 / 2 = 3.81mm.
    const staggered = parsePackageId('MODULE-2x4-OL1.27-OR_1.27')!;
    const l = staggered.pads.filter(p => p.x < 0).map(p => p.y);
    const r = staggered.pads.filter(p => p.x > 0).map(p => p.y);
    near(Math.max(...l), 3.81 + 1.27, 1e-6, 'a positive left offset shifts that row up');
    near(Math.max(...r), 3.81 - 1.27, 1e-6, 'the `_` prefix parses as a negative offset');
  });
});

describe('quad geometry', () => {
  it('numbers pins counter-clockwise from the top of the left edge', () => {
    const qfn = generateQuadFamilyFootprint('QFN', 32);
    const signal = qfn.pads.filter(p => p.role !== 'thermal');
    ok(signal.length === 32, 'QFN-32 has 32 signal pads');
    ok(qfn.pads.some(p => p.role === 'thermal'), 'QFN-32 gets an exposed thermal pad');
    ok(signal.every(p => p.drillDiameter === 0), 'quad pads are surface mount');

    const p1 = signal[0];
    const p9 = signal[8];
    const p17 = signal[16];
    const p25 = signal[24];
    ok(p1.x < 0 && p1.y > 0, 'pin 1 sits at the top of the left edge');
    ok(p9.y < 0 && Math.abs(p9.y) > Math.abs(p9.x), 'pin 9 is on the bottom edge');
    ok(p17.x > 0, 'pin 17 is on the right edge');
    ok(p25.y > 0 && Math.abs(p25.y) > Math.abs(p25.x), 'pin 25 is on the top edge');
  });

  it('can suppress the thermal pad', () => {
    const noThermal = generateQuadFamilyFootprint('QFN', 32, { thermalPadMm: 0 });
    ok(!noThermal.pads.some(p => p.role === 'thermal'), 'the thermal pad can be suppressed');
  });

  it('lets gull-wing leads reach outside the body', () => {
    const qfn = generateQuadFamilyFootprint('QFN', 32);
    const tqfp = generateQuadFamilyFootprint('TQFP', 44);
    ok(tqfp.pads.length === 44, 'TQFP-44 has no thermal pad by default');
    const qfnSpan = Math.max(...qfn.pads.map(p => Math.abs(p.x)));
    ok(tqfp.widthMm > qfnSpan, 'gull-wing leads reach outside the body, unlike a leadless part');
  });
});

describe('free-form module parameters', () => {
  it('survives a module that is nothing like a DIP', () => {
    // 24+8 pins, 1.27mm pitch on a 31mm body.
    const fp = footprintFromParams({
      family: 'dual',
      leftCount: 24,
      rightCount: 8,
      pitchMm: 1.27,
      rowSpacingMm: 31.0,
      padWidthMm: 1.4,
      padHeightMm: 1.0,
      drillDiaMm: 0.7,
      bodyWidthMm: 34,
      bodyHeightMm: 40,
      leftOffsetMm: 2.5,
    });
    ok(fp.pads.length === 32, 'asymmetric pin counts survive');
    near(xs(fp)[1] - xs(fp)[0], 31.0, 1e-6, 'arbitrary row spacing survives');
    near(fp.widthMm, 34, 0.01, 'body width is the courtyard when it exceeds the copper');
    ok(fp.pads.every(p => p.drillDiameter === 0.7), 'arbitrary drill survives');
  });

  it('carries a thermal pad on a custom quad', () => {
    const quad = footprintFromParams({ family: 'quad', pinCount: 20, pitchMm: 0.4, thermalPadMm: 2.2 });
    ok(quad.pads.filter(p => p.role === 'thermal').length === 1, 'a custom quad can carry a thermal pad');
  });

  it('grows an understated body so the courtyard always contains the copper', () => {
    // Or the placer overlaps parts.
    const tight = generateDualRowFootprint({
      leftCount: 4, rightCount: 4, pitchMm: 2.54, rowSpacingMm: 20,
      padWidthMm: 2, padHeightMm: 2, drillDiaMm: 1, bodyWidthMm: 5, bodyHeightMm: 2,
    });
    ok(tight.widthMm >= 22, 'an understated body width is grown to contain the pads');
    ok(tight.heightMm >= 2.54 * 3 + 2, 'an understated body height is grown to contain the pads');
  });
});

describe('resolveFootprint routing and the unknown-package fallback', () => {
  it('reaches each family parser', () => {
    ok(resolveFootprint('QFN-32', 'ic', 32).pads.length === 33, 'resolveFootprint reaches the QFN parser');
    ok(resolveFootprint('TSSOP-20', 'ic', 20).pads.length === 20, 'resolveFootprint reaches the TSSOP parser');
  });

  it('flags an unknown package rather than silently substituting', () => {
    const bogus = resolveFootprint('BGA-256', 'ic', 256);
    ok(bogus.isFallback === true, 'an unknown package is flagged as a fallback');
    ok(bogus.requestedPackageId === 'BGA-256', 'the fallback records what was actually asked for');
    ok(/unknown package/i.test(bogus.name), 'the fallback names itself as a substitution');
  });

  it('lets explicit params override the package id', () => {
    const params = resolveFootprint('DIP-8', 'ic', 8, {
      footprintParams: { family: 'dual', leftCount: 3, rightCount: 3, rowSpacingMm: 12 },
    });
    ok(params.pads.length === 6, 'footprintParams override the packageId');
  });

  it('still resolves everything existing boards were laid out with', () => {
    ok(resolveFootprint('0805', 'resistor').pads.length === 2, '0805 still resolves');
    ok(resolveFootprint(undefined, 'resistor').packageId === 'AXIAL-0.3', 'type defaults still work');
    ok(resolveFootprint('HEADER-1x08', 'mcu').pads.length === 8, '1x8 headers still resolve');
    ok(resolveFootprint('HEADER-2x04', 'pinheader', 8, { rows: 2, cols: 4 }).pads.length === 8,
      '2x4 dupont headers still resolve');
    ok(resolveFootprint('DIP-8', 'timer555', 8).pads.length === 8, 'DIP-8 still resolves');
  });
});

describe('tool catalogue', () => {
  it('agrees with the slot numbers the exporter assigns', () => {
    const ids = PCB_TOOL_PRESETS.map(t => t.id);
    ok(new Set(ids).size === ids.length, 'tool ids are unique');
    ok(PCB_TOOL_PRESETS.every(t => t.fluteCount >= 1), 'every tool declares a flute count');
    ok(
      PCB_TOOL_PRESETS.every(t =>
        t.role === 'isolation' ? t.toolNumber === 1 : t.role === 'drill' ? t.toolNumber === 2 : t.toolNumber === 99
      ),
      'catalogue slot numbers agree with the role the exporter assigns'
    );
    ok(
      PCB_TOOL_PRESETS.every(t => !/^T\d+:/.test(t.name)),
      'no tool name claims a T-number the exporter does not actually emit'
    );
  });

  it('covers the sizes a real job needs', () => {
    ok(PCB_TOOL_PRESETS.filter(t => t.role === 'drill').length >= 5, 'more than two drill sizes');
    ok(PCB_TOOL_PRESETS.some(t => t.role === 'drill' && t.tipDiameterMm < 0.8), 'a sub-0.8mm drill exists');
    ok(PCB_TOOL_PRESETS.some(t => t.role === 'profile' && t.tipDiameterMm >= 3), 'a 3mm+ endmill exists');
    ok(PCB_TOOL_PRESETS.some(t => t.type === 'ballnose'), 'a ball-nose tool exists');
    ok(PCB_TOOL_PRESETS.some(t => t.type === 'engraver'), 'a flat engraver exists');
  });
});

describe('feeds and flutes', () => {
  it('scales feed with flute count at a fixed chipload', () => {
    const tool = PCB_TOOL_PRESETS.find(t => t.id === 't1_vbit_30')!;
    const fr4 = PCB_MATERIAL_PRESETS.find(m => m.id === 'fr4_1oz')!;
    const base = calculatePcbFeeds(tool, fr4);
    ok(base.cutFeedrate === 350, 'existing preset feeds are unchanged');

    const doubled = calculatePcbFeeds(tool, fr4, 2);
    ok(doubled.cutFeedrate === 700, 'twice the flutes wants twice the feed for the same chipload');

    near(feedFromChipload(0.03, 2, 12000), 720, 0.5, 'chipload x teeth x rpm');
  });

  it('derives a sane feed for a custom tool', () => {
    const custom = createCustomTool({ name: 'My 10deg bit', type: 'vbit', tipDiameterMm: 0.1, angleDeg: 10, fluteCount: 1, recommendedRpm: 18000 });
    ok(custom.isCustom === true, 'a custom tool is flagged');
    ok(custom.role === 'isolation', 'a V-bit defaults to the isolation role');
    ok(custom.recommendedCutFeed > 0, 'a custom tool derives a feedrate');
    ok(custom.recommendedPlungeFeed < custom.recommendedCutFeed, 'plunge is slower than cutting');

    const customDrill = createCustomTool({ name: '0.4mm drill', type: 'drill', tipDiameterMm: 0.4 });
    ok(customDrill.role === 'drill' && customDrill.toolNumber === 2, 'a drill defaults to the drill role');
    ok(customDrill.recommendedPlungeFeed === customDrill.recommendedCutFeed, 'a drill plunges at its cutting feed');
  });
});

describe('millability', () => {
  const v30 = PCB_TOOL_PRESETS.find(t => t.id === 't1_vbit_30')!;
  const v45 = PCB_TOOL_PRESETS.find(t => t.id === 't3_vbit_45')!;
  const v15 = PCB_TOOL_PRESETS.find(t => t.id === 't2b_vbit_15')!;
  const engraver = PCB_TOOL_PRESETS.find(t => t.id === 't3c_engraver_08')!;

  it('widens a V-bit channel with depth, but not a straight-walled one', () => {
    near(minIsolationChannelMm(v30, -0.08), 0.1 + 2 * 0.08 * Math.tan(Math.PI / 12), 1e-6,
      'a V-bit widens with depth');
    ok(minIsolationChannelMm(v15, -0.05) < minIsolationChannelMm(v30, -0.05),
      'the 15-degree bit cuts a narrower channel than the 30-degree one');
    ok(minIsolationChannelMm(engraver, -0.05) === minIsolationChannelMm(engraver, -0.3),
      'a straight-walled engraver cuts the same width at any depth');
  });

  it('refuses a bit that cannot fit between fine-pitch pads, and says what to do', () => {
    const qfn = generateQuadFamilyFootprint('QFN', 32);
    const gap = minPadGapMm(qfn.pads);
    ok(gap > 0 && gap < 0.3, `0.5mm-pitch QFN pads leave a sub-0.3mm gap (${gap.toFixed(3)}mm)`);

    const coarse = checkMillability(qfn.pads, v45, -0.1);
    ok(!coarse.ok, 'the 45-degree bit at its normal depth cannot isolate a 0.5mm-pitch QFN');
    ok(coarse.messages.some(m => /shallower than|too wide/.test(m)), 'the report says what to do about it');

    const sharp = checkMillability(qfn.pads, v15, -0.05);
    ok(sharp.ok, 'the 15-degree ultra-fine bit at 0.05mm depth can isolate it');
  });

  it('passes the ordinary packages with the standard bit', () => {
    const dip = generateDIPFootprint(8);
    ok(checkMillability(dip.pads, v30, -0.08).ok, 'a DIP-8 is millable with the standard bit');

    const soic = generateDualSmdFootprint('SOIC', 8);
    ok(checkMillability(soic.pads, v30, -0.08).ok, 'SOIC-8 is millable with the standard bit');
  });
});

describe('packages offered per component type', () => {
  const idsFor = (type: string, current?: string) =>
    packageOptionsForType(type, current).flatMap(g => g.options.map(o => o.id));

  it('does not offer a part a body it could never have', () => {
    // The bug this table exists for: a DIP-16 offered for a two-lead part.
    const led = idsFor('led');
    ok(!led.includes('DIP-16'), 'an LED is not offered a DIP-16');
    ok(!led.some(id => id.startsWith('QFN-')), 'an LED is not offered a QFN');
    ok(led.includes('LED-5MM') && led.includes('0805'), 'an LED still gets its THT and SMD sizes');

    const resistor = idsFor('resistor');
    ok(resistor.includes('AXIAL-0.3') && resistor.includes('0603'), 'a resistor gets axial and chip sizes');
    ok(!resistor.includes('SOT-23'), 'a resistor is not offered a transistor package');

    const bjt = idsFor('npn');
    ok(bjt.includes('TO-92') && bjt.includes('SOT-23'), 'a BJT gets THT and SMD transistor bodies');
    ok(!bjt.includes('AXIAL-0.3'), 'a BJT is not offered an axial body');

    ok(idsFor('timer555').every(id => /^(DIP|SOIC|TSSOP|MSOP|DFN)-8$/.test(id)), 'a 555 is only offered 8-pin bodies');
  });

  it.each([
    ['resistor', 'AXIAL-0.3'], ['capacitor', 'RADIAL-5MM'], ['led', 'LED-5MM'],
    ['diode', 'AXIAL-0.3'], ['npn', 'TO-92'], ['nmos', 'TO-220'], ['switch', 'TACT-4PIN'],
    ['potentiometer', 'POT-3PIN'], ['transformer', 'TRANSFORMER-4P'], ['opamp', 'DIP-8'],
    ['timer555', 'DIP-8'], ['dff', 'DIP-14'], ['sevenseg', 'DIP-10'], ['voltage', 'TERMINAL-2P'],
    ['heltec_v4', 'HELTEC-V4'],
  ] as const)('%s is still offered its default %s', (type, expected) => {
    // Every default has to survive the filter, or opening the panel silently
    // re-selects a different footprint than the one the board was laid out with.
    ok(idsFor(type).includes(expected), `${type} is still offered its default ${expected}`);
  });

  it('keeps an unusual package that a saved board already set', () => {
    ok(idsFor('led', 'DIP-16').includes('DIP-16'), 'a package already set on the part is kept in the list');
  });

  it('hides nothing from a type with no table', () => {
    ok(idsFor('mcu').length > 60, 'an MCU still gets the whole catalogue');
  });

  it('offers no package where there is nothing to choose', () => {
    ok(!supportsPackageSelection('via'), 'a via has no package to choose');
    ok(!supportsPackageSelection('cutout'), 'a cutout has no package to choose');
    ok(supportsPackageSelection('resistor'), 'a resistor does');
  });
});

describe('every footprint courtyard contains its own copper', () => {
  /*
   * The courtyard is what the placer separates parts by, so a footprint that
   * declares a body smaller than its pads lets a neighbour's pad land on top of
   * this one's while the placer believes there is a full gap between them. Seven
   * of the hand-written entries used to do exactly that — the figure was the
   * plastic package rather than the land pattern — and it surfaced as a short in
   * the design rule check on two shipped presets rather than as a placement
   * fault where it belonged.
   */
  it.each(Object.keys(STANDARD_FOOTPRINTS))('%s', id => {
    const fp = STANDARD_FOOTPRINTS[id];
    let halfW = 0;
    let halfH = 0;
    for (const pad of fp.pads) {
      halfW = Math.max(halfW, Math.abs(pad.x) + Math.max(pad.padWidth, pad.drillDiameter || 0) / 2);
      halfH = Math.max(halfH, Math.abs(pad.y) + Math.max(pad.padHeight, pad.drillDiameter || 0) / 2);
    }
    expect(fp.widthMm, `${id} courtyard width must cover ${(halfW * 2).toFixed(2)}mm of copper`)
      .toBeGreaterThanOrEqual(halfW * 2 - 1e-9);
    expect(fp.heightMm, `${id} courtyard height must cover ${(halfH * 2).toFixed(2)}mm of copper`)
      .toBeGreaterThanOrEqual(halfH * 2 - 1e-9);
  });
});
