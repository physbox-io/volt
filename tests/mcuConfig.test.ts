import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MCU_CONFIG,
  MCU_PRESETS,
  mcuPackageId,
  validateMcuConfig,
  type McuGeometryConfig,
} from '../src/utils/mcuConfig';

/** Writes a value the type system would refuse, to test that runtime checks catch it. */
const poke = (target: object, key: string, value: unknown) => {
  (target as Record<string, unknown>)[key] = value;
};

const base = (over: Partial<McuGeometryConfig> = {}): McuGeometryConfig => ({
  ...DEFAULT_MCU_CONFIG,
  pins: DEFAULT_MCU_CONFIG.pins.map(p => ({ ...p })),
  ...over,
});

describe('validateMcuConfig', () => {
  it('passes every built-in preset', () => {
    for (const preset of MCU_PRESETS) {
      expect(validateMcuConfig(preset.config).errors, preset.key).toEqual([]);
    }
  });

  it('rejects a part with no pins', () => {
    expect(validateMcuConfig(base({ pins: [] })).errors[0]).toMatch(/non-empty/);
  });

  it('rejects pin ids that collide, including by case', () => {
    const cfg = base();
    cfg.pins[1].id = 'd0';
    expect(validateMcuConfig(cfg).errors.join()).toMatch(/repeats pins\[0\]\.id/);
  });

  it('rejects two pins landing on one pad', () => {
    const cfg = base();
    cfg.pins[1].pinNumber = 1;
    expect(validateMcuConfig(cfg).errors.join()).toMatch(/repeats pins\[0\]\.pinNumber/);
  });

  it('rejects an unknown side or type', () => {
    const cfg = base();
    poke(cfg.pins[0], 'side', 'middle');
    poke(cfg.pins[1], 'type', 'sideways');
    const errors = validateMcuConfig(cfg).errors.join();
    expect(errors).toMatch(/side 'middle'/);
    expect(errors).toMatch(/type 'sideways'/);
  });

  it('requires a row spacing on a dual-row part', () => {
    expect(validateMcuConfig(base({ rowSpacingMm: 0 })).errors.join()).toMatch(/rowSpacingMm is required/);
  });

  it('requires a drill on a through-hole part and warns about one on an SMD part', () => {
    expect(validateMcuConfig(base({ isSmd: false, drillDiaMm: 0 })).errors.join()).toMatch(/drillDiaMm above zero/);
    expect(validateMcuConfig(base({ isSmd: true, drillDiaMm: 0.8 })).warnings.join()).toMatch(/will be drilled/);
  });

  it('rejects a non-positive dimension', () => {
    expect(validateMcuConfig(base({ pitchMm: 0 })).errors.join()).toMatch(/pitchMm must be a positive number/);
  });

  it('warns when pinCount disagrees with the pins it was given', () => {
    expect(validateMcuConfig(base({ pinCount: 99 })).warnings.join()).toMatch(/pins\.length wins/);
  });
});

describe('mcuPackageId', () => {
  it('names the preset a part came from', () => {
    expect(mcuPackageId(base({ presetKey: 'heltec_v4' }))).toBe('MCU-HELTEC_V4');
  });

  it('falls back to a pin count once the part is custom', () => {
    expect(mcuPackageId(base({ presetKey: 'custom' }))).toBe('MCU-CUSTOM-8P');
  });
});
