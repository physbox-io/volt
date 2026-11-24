import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PCB_OPTIONS,
  estimatePcbMachiningMetrics,
  generatePcbGcode,
  groupDrillsByBit,
  padPolygon,
  type PcbLayoutResult,
  type PcbOptions,
  type PlacedPad,
} from '../src/utils/pcbExporter';
import { generateGerberFiles } from '../src/utils/gerberExporter';
import { generatePasteStencilStl } from '../src/utils/pcbPasteStencil';
import {
  calculatePcbFeeds,
  PCB_MATERIAL_PRESETS,
  PCB_TOOL_PRESETS,
  pcbToolFromRack,
  vBitWidthAtDepth,
} from '../src/utils/pcbTooling';
import {
  generateHeaderFootprint,
  parsePackageId,
  resolveFootprint,
} from '../src/utils/pcbFootprints';
import { resolveHandleToPin } from '../src/utils/pcbNets';
import { polysBounds, polyArea, rectPoly } from '../src/utils/pcbGeometry';
import { unjoinedNets } from '../src/utils/pcbNudge';
import type { LayoutCore } from '../src/utils/pcbExporter';

function makeMinimalResult(overrides: Partial<PcbLayoutResult> = {}): PcbLayoutResult {
  const outer = rectPoly(15, 10, 10, 10);
  return {
    success: true,
    boardWidthMm: 30,
    boardHeightMm: 20,
    boardOriginMm: 1,
    components: [],
    pads: [],
    nets: [],
    traces: [],
    isolationPaths: [
      {
        netId: 'N1',
        points: [
          { x: 5, y: 5 },
          { x: 15, y: 5 },
          { x: 15, y: 15 },
          { x: 5, y: 15 },
          { x: 5, y: 5 },
        ],
      },
    ],
    drills: [],
    cutouts: [],
    unrouted: [],
    violations: [],
    warnings: [],
    completion: 1,
    effectiveToolDiaMm: 0.2,
    copperFloodMm: 0,
    padReliefMm: 0,
    cycleTimeSec: 0,
    travelDistanceMm: 0,
    cutDistanceMm: 0,
    svg: '',
    svgComponentSide: '',
    gcode: '',
    copperByNet: new Map([['N1', [outer]]]),
    layers: 1,
    ...overrides,
  };
}

describe('PCB Audit Fixes — CAM, G-code & Gerber', () => {
  it('ramped plunge closes the initial ramp span on closed isolation loops (no uncut bridge)', () => {
    const opts: PcbOptions = { ...DEFAULT_PCB_OPTIONS, rampedPlunge: true, safeZ: 2.0, isolationDepthZ: -0.15 };
    const gcode = generatePcbGcode(makeMinimalResult(), opts);
    const lines = gcode.split('\n');
    // Rapids down to 0.2mm before ramping so it does not spend 90% of the ramp in air
    expect(lines.some(l => l.trim() === 'G0 Z0.200')).toBe(true);
    // After returning to p0 (5, 5), continues cutting to ramp end (6.2, 5) at full depth
    const backToStartIdx = lines.findIndex(l => l.includes('G1 X5.000 Y5.000'));
    expect(backToStartIdx).toBeGreaterThan(-1);
    expect(lines[backToStartIdx + 1]).toContain('G1 X6.200 Y5.000');
  });

  it('helical hole interpolation guards 0.01 < diff <= 0.02 and retracts between concentric rings', () => {
    const opts: PcbOptions = {
      ...DEFAULT_PCB_OPTIONS,
      drillBitOverridesMm: { '0.82': 0.8, '3.2': 0.8 },
    };
    const res = makeMinimalResult({
      drills: [
        { x: 10, y: 10, diameter: 0.82, componentId: 'R1', pinNumber: '1' },
        { x: 20, y: 10, diameter: 3.2, componentId: 'MH1', pinNumber: '1' },
      ],
    });
    const gcode = generatePcbGcode(res, opts);
    // 0.82 with 0.80 bit (diff === 0.02) must not throw and should peck drill
    expect(gcode).toContain('0.82mm');
    // 3.2mm with 0.8mm bit has multiple concentric rings; must retract to safeZ between rings
    const mhIdx = gcode.indexOf('; MH1 pin 1');
    const mhSection = gcode.slice(mhIdx, gcode.indexOf('; ====', mhIdx));
    const safeZRetracts = mhSection.split('\n').filter(l => l.trim() === `G0 Z${opts.safeZ.toFixed(3)}`);
    expect(safeZRetracts.length).toBeGreaterThanOrEqual(3);
  });

  it('profile holding tabs add endmill diameter to tool-centreline span and do not plunge at corners', () => {
    const opts: PcbOptions = {
      ...DEFAULT_PCB_OPTIONS,
      profileToolDiaMm: 3.175,
      tabCount: 2,
      tabWidthMm: 3.0,
      tabHeightMm: 0.5,
      boardThicknessMm: 1.6,
      profileDepthZ: -1.9,
      zStepdown: 2.0,
    };
    const res = makeMinimalResult({ boardWidthMm: 20, boardHeightMm: 20, boardOriginMm: 2 });
    const gcode = generatePcbGcode(res, opts);
    const tabZ = (-1.6 + 0.5).toFixed(3);
    expect(gcode).toContain(`G1 Z${tabZ}`);
    // Tool-centreline span should be 3.0 + 3.175 = 6.175mm (so physical tab is 3.0mm, not -0.175mm)
    // On a 20x20 board with r=1.5875, side length is 23.175, total perimeter is 92.7mm.
    // With 2 tabs at 25% and 75% of perimeter (exactly on corners!), the tab spans across the corner
    // without plunging to -1.900 at the corner itself.
    const profileStart = gcode.indexOf('(with holding tabs)');
    const profileLines = gcode.slice(profileStart).split('\n');
    const zMoves = profileLines.filter(l => /^G1 Z-/.test(l.trim()));
    // Initial plunge + lift/drop for 2 tabs = 5 Z moves total (no extra corner plunges!)
    expect(zMoves.length).toBe(5);
  });

  it('groupDrillsByBit keeps 2-layer registration pins isolated from drillConsolidationMm', () => {
    const groups = groupDrillsByBit(
      [
        { x: 2, y: 2, diameter: 0.8, componentId: 'REG', pinNumber: '1', isRegistration: true },
        { x: 10, y: 10, diameter: 1.0, componentId: 'R1', pinNumber: '1' },
      ],
      0.3
    );
    expect(groups.length).toBe(2);
    const regGroup = groups.find(g => g.holes.some(h => h.isRegistration));
    expect(regGroup?.holeMm).toBe(0.8);
    expect(regGroup?.bitMm).toBe(0.8);
  });

  it('toolChange parks at max(safeZ, toolChangeZ) when safeZ exceeds toolChangeZ', () => {
    const opts: PcbOptions = {
      ...DEFAULT_PCB_OPTIONS,
      safeZ: 12,
      toolChangeZ: 8,
      pauseOnToolChange: true,
    };
    const gcode = generatePcbGcode(makeMinimalResult(), opts);
    expect(gcode).toContain('G0 Z12.000 ; Park clear for the bit change');
    expect(gcode).not.toContain('G0 Z8.000 ; Park clear');
  });

  it('estimatePcbMachiningMetrics handles X0/Y0/Z0 moves and ignores comments', () => {
    const gcode = [
      'G0 X10 Y10 Z2 ; X999 Y999 F1',
      'G1 Z0 F100 (Z-500)',
      'G1 X0 Y0 F100',
    ].join('\n');
    const m = estimatePcbMachiningMetrics(gcode, DEFAULT_PCB_OPTIONS);
    expect(m.cutDistanceMm).toBeCloseTo(2 + Math.hypot(10, 10), 1);
  });

  it('Gerber export emits G01*, keyhole-merges holes, excludes registration pins, emits FILE_FORMAT & F_Mask', () => {
    const outer = rectPoly(15, 10, 12, 12);
    const hole = rectPoly(15, 10, 4, 4).reverse(); // CW hole
    const res = makeMinimalResult({
      mirrored: true,
      copperByNet: new Map([['N1', [outer, hole]]]),
      pads: [
        {
          componentId: 'R1',
          handleId: 'a',
          pinNumber: '1',
          netId: 'N1',
          x: 6,
          y: 10,
          spec: { pinNumber: '1', x: 0, y: 0, padWidth: 1.6, padHeight: 1.2, shape: 'rect', drillDiameter: 0 },
        },
      ],
      drills: [
        { x: 2, y: 2, diameter: 0.8, componentId: 'REG', pinNumber: '1', isRegistration: true },
        { x: 10, y: 10, diameter: 1.0, componentId: 'R1', pinNumber: '1' },
      ],
      cutouts: [{ componentId: 'C1', shape: 'circle', x: 15, y: 10, widthMm: 6, heightMm: 6 }],
    });
    const files = generateGerberFiles(res);
    expect(files['board-F_Cu.gtl']).toContain('G01*');
    // Outer + hole merged into ONE G36*..G37* region, not two dark regions
    expect((files['board-F_Cu.gtl'].match(/G36\*/g) ?? []).length).toBe(1);
    expect(files['board-F_Mask.gts']).toBeDefined();
    expect(files['board.drl']).toContain(';FILE_FORMAT=3:4');
    // Registration pin excluded, only 1 drill hit
    expect(files['board.drl']).not.toContain('T02');
    // Circular cutout stroked on Edge_Cuts
    expect((files['board-Edge_Cuts.gko'].match(/D02\*/g) ?? []).length).toBe(2);
  });
});

describe('PCB Audit Fixes — Tooling & Paste Stencil', () => {
  it('vBitWidthAtDepth clamps invalid angles and calculatePcbFeeds caps zStepdown at maxStepdownMm', () => {
    expect(vBitWidthAtDepth(0.2, 0, -0.1)).toBe(0.2);
    expect(Number.isFinite(vBitWidthAtDepth(0.2, 180, -0.1))).toBe(true);

    const endmill = PCB_TOOL_PRESETS.find(t => t.role === 'profile')!;
    const fr1 = PCB_MATERIAL_PRESETS.find(m => m.feedMultiplier > 1)!;
    const feeds = calculatePcbFeeds(endmill, fr1);
    expect(feeds.zStepdown).toBeLessThanOrEqual(endmill.maxStepdownMm);
  });

  it('pcbToolFromRack honors rpm, maxStepdownMm and maxPlungeRate on catalogue-matched tools', () => {
    const preset = pcbToolFromRack({
      uid: 'r1',
      toolNumber: 1,
      name: '30deg V-bit slow',
      shape: 'vbit',
      diameterMm: 0.1,
      tipAngleDeg: 30,
      flutes: 1,
      rpm: 6000,
      maxStepdownMm: 0.05,
      maxPlungeRate: 25,
      available: true,
    });
    expect(preset.recommendedRpm).toBe(6000);
    expect(preset.maxStepdownMm).toBe(0.05);
    expect(preset.recommendedPlungeFeed).toBeLessThanOrEqual(25);
  });

  it('padPolygon allows negative margin for paste stencil aperture shrinking', () => {
    const pad: PlacedPad = {
      componentId: 'U1',
      handleId: '1',
      pinNumber: '1',
      netId: 'N1',
      x: 10,
      y: 10,
      spec: { pinNumber: '1', x: 0, y: 0, padWidth: 1.0, padHeight: 0.5, shape: 'rect', drillDiameter: 0 },
    };
    const nominal = polyArea(padPolygon(pad, 0, 0));
    const shrunk = polyArea(padPolygon(pad, 0, -0.05));
    expect(shrunk).toBeLessThan(nominal);
  });

  it('generatePasteStencilStl clamps degenerate resolutionMm without hanging', () => {
    const res = makeMinimalResult({
      pads: [
        {
          componentId: 'R1',
          handleId: 'a',
          pinNumber: '1',
          netId: 'N1',
          x: 8,
          y: 10,
          spec: { pinNumber: '1', x: 0, y: 0, padWidth: 1.2, padHeight: 1.0, shape: 'rect', drillDiameter: 0 },
        },
      ],
    });
    const out = generatePasteStencilStl(res, DEFAULT_PCB_OPTIONS, { resolutionMm: 0, thicknessMm: 0 });
    expect(out.triangleCount).toBeGreaterThan(0);
    expect(out.thicknessMm).toBeGreaterThanOrEqual(0.05);
  });
});

describe('PCB Audit Fixes — Footprints, Nets, Nudger & Geometry', () => {
  it('HELTEC-V4 right column numbers top-to-bottom (pin 19 at top-right) and maps all 36 pins', () => {
    const fp = resolveFootprint('HELTEC-V4', 'heltec_v4');
    const pin1 = fp.pads.find(p => String(p.pinNumber) === '1')!;
    const pin19 = fp.pads.find(p => String(p.pinNumber) === '19')!;
    const pin36 = fp.pads.find(p => String(p.pinNumber) === '36')!;
    expect(pin19.y).toBeCloseTo(pin1.y, 4);
    expect(pin19.y).toBeGreaterThan(pin36.y);

    // Pins that were previously missing from HANDLE_PIN_OVERRIDE
    expect(resolveHandleToPin('heltec_v4', 'GPIO_4', fp)).toBeDefined();
    expect(resolveHandleToPin('heltec_v4', 'GPIO_21', fp)).toBeDefined();
    expect(resolveHandleToPin('heltec_v4', 'RST', fp)).toBeDefined();
  });

  it('parsePackageId handles SOIC-16W and SOIC16W, and HEADER-1x08-P1.27 does not short pads', () => {
    const soic1 = parsePackageId('SOIC-16W');
    const soic2 = parsePackageId('SOIC16W');
    expect(soic1?.pads.length).toBe(16);
    expect(soic2?.pads.length).toBe(16);

    const fineHeader = generateHeaderFootprint(8, 1.27);
    expect(fineHeader.pads[0].padWidth).toBeLessThan(1.27);
  });

  it('resolveFootprint flags unknown explicit packageId on known component types and honors MCU parametric packages', () => {
    const bad = resolveFootprint('TOTALLY-UNKNOWN-99', 'resistor');
    expect(bad.isFallback).toBe(true);

    const mcuTqfp = resolveFootprint('TQFP-32', 'mcu');
    expect(mcuTqfp.pads.length).toBe(32);
  });

  it('polysBounds returns finite zeros on empty input', () => {
    expect(polysBounds([])).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });

  it('unjoinedNets respects copper layers (top vs bottom traces crossing without a via are NOT joined)', () => {
    const fp = resolveFootprint('0805', 'resistor');
    const core: LayoutCore = {
      boardWidthMm: 30,
      boardHeightMm: 20,
      boardOriginMm: 1,
      placed: [
        { id: 'R1', name: 'R1', type: 'resistor', x: 5, y: 10, widthMm: 3, heightMm: 2, rotationDeg: 0, footprint: fp },
        { id: 'R2', name: 'R2', type: 'resistor', x: 25, y: 10, widthMm: 3, heightMm: 2, rotationDeg: 0, footprint: fp },
      ],
      pads: [
        { componentId: 'R1', handleId: 'a', pinNumber: '1', netId: 'N1', x: 5, y: 10, spec: fp.pads[0] },
        { componentId: 'R2', handleId: 'a', pinNumber: '1', netId: 'N1', x: 25, y: 10, spec: fp.pads[0] },
      ],
      nets: [],
      traces: [
        { netId: 'N1', points: [{ x: 5, y: 10 }, { x: 15, y: 10 }], width: 0.6, layer: 'top' },
        { netId: 'N1', points: [{ x: 15, y: 10 }, { x: 25, y: 10 }], width: 0.6, layer: 'bottom' },
      ],
      vias: [],
      cutouts: [],
      unrouted: [],
      warnings: [],
      completion: 1,
    };
    expect(unjoinedNets(core, DEFAULT_PCB_OPTIONS)).toContain('N1');
  });
});
