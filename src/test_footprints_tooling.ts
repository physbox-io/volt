/**
 * Verification for the expanded footprint library and tool catalogue.
 *
 * Run with:  npx tsx src/test_footprints_tooling.ts
 */
import {
  resolveFootprint,
  parsePackageId,
  generateDIPFootprint,
  generateDualRowFootprint,
  generateQuadFamilyFootprint,
  generateDualSmdFootprint,
  footprintFromParams,
  DIP_ROW_SPACING,
  type ComponentFootprint,
} from './utils/pcbFootprints.js';
import {
  PCB_TOOL_PRESETS,
  PCB_MATERIAL_PRESETS,
  calculatePcbFeeds,
  createCustomTool,
  minIsolationChannelMm,
  minPadGapMm,
  checkMillability,
  feedFromChipload,
} from './utils/pcbTooling.js';

let failures = 0;
function ok(cond: any, msg: string) {
  if (cond) {
    console.log(`  ok   ${msg}`);
  } else {
    console.log(`  FAIL ${msg}`);
    failures++;
  }
}
function near(a: number, b: number, tol: number, msg: string) {
  ok(Math.abs(a - b) <= tol, `${msg} (got ${a.toFixed(4)}, want ~${b})`);
}
function xs(fp: ComponentFootprint) {
  return [...new Set(fp.pads.map(p => +p.x.toFixed(3)))].sort((a, b) => a - b);
}

console.log('\n--- DIP width is parametric ---');
{
  const atmega = generateDIPFootprint(28);
  ok(atmega.pads.length === 28, 'DIP-28 has 28 pads');
  near(xs(atmega)[1] - xs(atmega)[0], DIP_ROW_SPACING.narrow, 1e-6,
    'DIP-28 defaults to 0.3" narrow rows (ATmega328P, not the old 0.6" guess)');

  const wide = generateDIPFootprint(28, { rowSpacing: 'wide' });
  near(xs(wide)[1] - xs(wide)[0], DIP_ROW_SPACING.wide, 1e-6, 'DIP-28-W honours the wide override');

  const dip40 = generateDIPFootprint(40);
  near(xs(dip40)[1] - xs(dip40)[0], DIP_ROW_SPACING.wide, 1e-6, 'DIP-40 still defaults to 0.6"');

  const odd = generateDIPFootprint(15);
  ok(odd.pads.length === 16, 'an odd pin count rounds up to a whole dual row');

  const custom = generateDIPFootprint(8, { rowSpacing: 9.0, pitchMm: 1.778, drillDiaMm: 0.6 });
  near(xs(custom)[1] - xs(custom)[0], 9.0, 1e-6, 'arbitrary row spacing is respected');
  near(Math.abs(custom.pads[0].y - custom.pads[1].y), 1.778, 1e-6, 'arbitrary pitch is respected');
  ok(custom.pads.every(p => p.drillDiameter === 0.6), 'arbitrary drill size is respected');
}

console.log('\n--- Package id parsing ---');
{
  const cases: [string, number, string][] = [
    ['QFN-32', 32, 'QFN-32'],
    ['QFN-48', 48, 'QFN-48'],
    ['TQFP-44', 44, 'TQFP-44'],
    ['LQFP-64', 64, 'LQFP-64'],
    ['DFN-8', 8, 'DFN-8'],
    ['TSSOP-20', 20, 'TSSOP-20'],
    ['SSOP-16', 16, 'SSOP-16'],
    ['MSOP-8', 8, 'MSOP-8'],
    ['SOIC-16', 16, 'SOIC-16'],
    ['DIP-28', 28, 'DIP-28'],
  ];
  for (const [id, pins, label] of cases) {
    const fp = parsePackageId(id);
    ok(!!fp && fp.pads.filter(p => p.role !== 'thermal').length === pins,
      `${label} parses to ${pins} signal pads`);
  }

  ok(parsePackageId('0603')?.pads.length === 2, '0603 chip passive parses');
  ok(parsePackageId('SOD-123')?.pads.length === 2, 'SOD-123 parses despite its internal dash');
  ok(parsePackageId('SOT-23-5')?.pads.length === 5, 'SOT-23-5 parses despite its internal dashes');
  ok(parsePackageId('SOT-223')?.pads.length === 4, 'SOT-223 parses with its tab pad');
  ok(parsePackageId('WHAT-IS-THIS') === null, 'an unknown id returns null rather than a wrong guess');
}

console.log('\n--- Package id modifiers ---');
{
  const narrow = parsePackageId('SOIC-16')!;
  const wide = parsePackageId('SOIC-16-W')!;
  ok(xs(wide)[1] - xs(wide)[0] > xs(narrow)[1] - xs(narrow)[0], 'SOIC-16-W is wider than SOIC-16');

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

  const mod = parsePackageId('MODULE-2x20-P2.54-R17.78-B21x51')!;
  ok(mod.pads.length === 40, 'MODULE-2x20 yields 40 pads');
  near(xs(mod)[1] - xs(mod)[0], 17.78, 1e-6, 'module row spacing token (Pico geometry)');
  near(mod.widthMm, 21, 0.01, 'module body width token');
  near(mod.heightMm, 51, 0.01, 'module body height token');

  const asym = parsePackageId('MODULE-18+12-R22.86')!;
  ok(asym.pads.length === 30, 'a module can carry different pin counts per side');
  const left = asym.pads.filter(p => p.x < 0);
  ok(left.length === 18, 'the left header keeps its own pin count');

  // 4 pins per side at the default 2.54mm pitch: the unshifted top pad is at
  // 3 * 2.54 / 2 = 3.81mm.
  const staggered = parsePackageId('MODULE-2x4-OL1.27-OR_1.27')!;
  const l = staggered.pads.filter(p => p.x < 0).map(p => p.y);
  const r = staggered.pads.filter(p => p.x > 0).map(p => p.y);
  near(Math.max(...l), 3.81 + 1.27, 1e-6, 'a positive left offset shifts that row up');
  near(Math.max(...r), 3.81 - 1.27, 1e-6, 'the `_` prefix parses as a negative offset');
}

console.log('\n--- Quad geometry ---');
{
  const qfn = generateQuadFamilyFootprint('QFN', 32);
  const signal = qfn.pads.filter(p => p.role !== 'thermal');
  ok(signal.length === 32, 'QFN-32 has 32 signal pads');
  ok(qfn.pads.some(p => p.role === 'thermal'), 'QFN-32 gets an exposed thermal pad');
  ok(signal.every(p => p.drillDiameter === 0), 'quad pads are surface mount');

  // Counter-clockwise from the top of the left edge.
  const p1 = signal[0];
  const p9 = signal[8];
  const p17 = signal[16];
  const p25 = signal[24];
  ok(p1.x < 0 && p1.y > 0, 'pin 1 sits at the top of the left edge');
  ok(p9.y < 0 && Math.abs(p9.y) > Math.abs(p9.x), 'pin 9 is on the bottom edge');
  ok(p17.x > 0, 'pin 17 is on the right edge');
  ok(p25.y > 0 && Math.abs(p25.y) > Math.abs(p25.x), 'pin 25 is on the top edge');

  const noThermal = generateQuadFamilyFootprint('QFN', 32, { thermalPadMm: 0 });
  ok(!noThermal.pads.some(p => p.role === 'thermal'), 'the thermal pad can be suppressed');

  const tqfp = generateQuadFamilyFootprint('TQFP', 44);
  ok(tqfp.pads.length === 44, 'TQFP-44 has no thermal pad by default');
  const qfnSpan = Math.max(...qfn.pads.map(p => Math.abs(p.x)));
  ok(tqfp.widthMm > qfnSpan, 'gull-wing leads reach outside the body, unlike a leadless part');
}

console.log('\n--- Free-form module parameters ---');
{
  // A module that is nothing like a DIP: 24+8 pins, 1.27mm pitch on a 31mm body.
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

  const quad = footprintFromParams({ family: 'quad', pinCount: 20, pitchMm: 0.4, thermalPadMm: 2.2 });
  ok(quad.pads.filter(p => p.role === 'thermal').length === 1, 'a custom quad can carry a thermal pad');

  // The courtyard must always contain the copper, or the placer overlaps parts.
  const tight = generateDualRowFootprint({
    leftCount: 4, rightCount: 4, pitchMm: 2.54, rowSpacingMm: 20,
    padWidthMm: 2, padHeightMm: 2, drillDiaMm: 1, bodyWidthMm: 5, bodyHeightMm: 2,
  });
  ok(tight.widthMm >= 22, 'an understated body width is grown to contain the pads');
  ok(tight.heightMm >= 2.54 * 3 + 2, 'an understated body height is grown to contain the pads');
}

console.log('\n--- resolveFootprint routing and the unknown-package fallback ---');
{
  ok(resolveFootprint('QFN-32', 'ic', 32).pads.length === 33, 'resolveFootprint reaches the QFN parser');
  ok(resolveFootprint('TSSOP-20', 'ic', 20).pads.length === 20, 'resolveFootprint reaches the TSSOP parser');

  const bogus = resolveFootprint('BGA-256', 'ic', 256);
  ok(bogus.isFallback === true, 'an unknown package is flagged as a fallback');
  ok(bogus.requestedPackageId === 'BGA-256', 'the fallback records what was actually asked for');
  ok(/unknown package/i.test(bogus.name), 'the fallback names itself as a substitution');

  const params = resolveFootprint('DIP-8', 'ic', 8, {
    footprintParams: { family: 'dual', leftCount: 3, rightCount: 3, rowSpacingMm: 12 },
  });
  ok(params.pads.length === 6, 'footprintParams override the packageId');

  // Regression: existing boards must resolve exactly as before.
  ok(resolveFootprint('0805', 'resistor').pads.length === 2, '0805 still resolves');
  ok(resolveFootprint(undefined, 'resistor').packageId === 'AXIAL-0.3', 'type defaults still work');
  ok(resolveFootprint('HEADER-1x08', 'mcu').pads.length === 8, '1x8 headers still resolve');
  ok(resolveFootprint('HEADER-2x04', 'pinheader', 8, { rows: 2, cols: 4 }).pads.length === 8,
    '2x4 dupont headers still resolve');
  ok(resolveFootprint('DIP-8', 'timer555', 8).pads.length === 8, 'DIP-8 still resolves');
}

console.log('\n--- Tool catalogue ---');
{
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
  ok(PCB_TOOL_PRESETS.filter(t => t.role === 'drill').length >= 5, 'more than two drill sizes');
  ok(PCB_TOOL_PRESETS.some(t => t.role === 'drill' && t.tipDiameterMm < 0.8), 'a sub-0.8mm drill exists');
  ok(PCB_TOOL_PRESETS.some(t => t.role === 'profile' && t.tipDiameterMm >= 3), 'a 3mm+ endmill exists');
  ok(PCB_TOOL_PRESETS.some(t => t.type === 'ballnose'), 'a ball-nose tool exists');
  ok(PCB_TOOL_PRESETS.some(t => t.type === 'engraver'), 'a flat engraver exists');
}

console.log('\n--- Feeds and flutes ---');
{
  const tool = PCB_TOOL_PRESETS.find(t => t.id === 't1_vbit_30')!;
  const fr4 = PCB_MATERIAL_PRESETS.find(m => m.id === 'fr4_1oz')!;
  const base = calculatePcbFeeds(tool, fr4);
  ok(base.cutFeedrate === 350, 'existing preset feeds are unchanged');

  const doubled = calculatePcbFeeds(tool, fr4, 2);
  ok(doubled.cutFeedrate === 700, 'twice the flutes wants twice the feed for the same chipload');

  near(feedFromChipload(0.03, 2, 12000), 720, 0.5, 'chipload x teeth x rpm');

  const custom = createCustomTool({ name: 'My 10deg bit', type: 'vbit', tipDiameterMm: 0.1, angleDeg: 10, fluteCount: 1, recommendedRpm: 18000 });
  ok(custom.isCustom === true, 'a custom tool is flagged');
  ok(custom.role === 'isolation', 'a V-bit defaults to the isolation role');
  ok(custom.recommendedCutFeed > 0, 'a custom tool derives a feedrate');
  ok(custom.recommendedPlungeFeed < custom.recommendedCutFeed, 'plunge is slower than cutting');

  const customDrill = createCustomTool({ name: '0.4mm drill', type: 'drill', tipDiameterMm: 0.4 });
  ok(customDrill.role === 'drill' && customDrill.toolNumber === 2, 'a drill defaults to the drill role');
  ok(customDrill.recommendedPlungeFeed === customDrill.recommendedCutFeed, 'a drill plunges at its cutting feed');
}

console.log('\n--- Millability ---');
{
  const v30 = PCB_TOOL_PRESETS.find(t => t.id === 't1_vbit_30')!;
  const v45 = PCB_TOOL_PRESETS.find(t => t.id === 't3_vbit_45')!;
  const v15 = PCB_TOOL_PRESETS.find(t => t.id === 't2b_vbit_15')!;
  const engraver = PCB_TOOL_PRESETS.find(t => t.id === 't3c_engraver_08')!;

  near(minIsolationChannelMm(v30, -0.08), 0.1 + 2 * 0.08 * Math.tan(Math.PI / 12), 1e-6,
    'a V-bit widens with depth');
  ok(minIsolationChannelMm(v15, -0.05) < minIsolationChannelMm(v30, -0.05),
    'the 15-degree bit cuts a narrower channel than the 30-degree one');
  ok(minIsolationChannelMm(engraver, -0.05) === minIsolationChannelMm(engraver, -0.3),
    'a straight-walled engraver cuts the same width at any depth');

  const qfn = generateQuadFamilyFootprint('QFN', 32);
  const gap = minPadGapMm(qfn.pads);
  ok(gap > 0 && gap < 0.3, `0.5mm-pitch QFN pads leave a sub-0.3mm gap (${gap.toFixed(3)}mm)`);

  const coarse = checkMillability(qfn.pads, v45, -0.1);
  ok(!coarse.ok, 'the 45-degree bit at its normal depth cannot isolate a 0.5mm-pitch QFN');
  ok(coarse.messages.some(m => /shallower than|too wide/.test(m)), 'the report says what to do about it');

  const sharp = checkMillability(qfn.pads, v15, -0.05);
  ok(sharp.ok, 'the 15-degree ultra-fine bit at 0.05mm depth can isolate it');

  const dip = generateDIPFootprint(8);
  ok(checkMillability(dip.pads, v30, -0.08).ok, 'a DIP-8 is millable with the standard bit');

  const soic = generateDualSmdFootprint('SOIC', 8);
  ok(checkMillability(soic.pads, v30, -0.08).ok, 'SOIC-8 is millable with the standard bit');
}

console.log(`\n${failures} failure(s)\n`);
if (failures > 0) {
  // Non-zero exit for CI without pulling @types/node into the app tsconfig.
  throw new Error(`${failures} footprint/tooling assertion(s) failed`);
}
