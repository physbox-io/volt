/**
 * What a milling run is filed under in the archive.
 *
 * The job history list reads one key — `material` — out of a settings blob that
 * has no schema across the apps, and shows nothing when it is absent. These
 * pin the shape it actually gets, including the two paths that had no dialog to
 * ask: an agent milling through MCP, and a frame pass.
 */
import { describe, it, expect } from 'vitest';
import { pcbJobName, pcbRunSettings } from '../src/utils/pcbRunSettings';
import { DEFAULT_PCB_OPTIONS } from '../src/utils/pcbExporter';
import { PCB_MATERIAL_PRESETS, DEFAULT_MATERIAL_ID } from '../src/utils/pcbTooling';

describe('pcbRunSettings', () => {
  it('records the material by the name a person would read', () => {
    const s = pcbRunSettings({ materialId: DEFAULT_MATERIAL_ID, options: DEFAULT_PCB_OPTIONS });
    const preset = PCB_MATERIAL_PRESETS.find(m => m.id === DEFAULT_MATERIAL_ID)!;
    expect(s.material).toBe(preset.name);
    expect(s.materialId).toBe(DEFAULT_MATERIAL_ID);
    expect(s.substrate).toBe('FR4');
    expect(s.copperThicknessUm).toBe(preset.copperThicknessUm);
  });

  it('every catalogue material yields a non-empty material string', () => {
    for (const mat of PCB_MATERIAL_PRESETS) {
      const s = pcbRunSettings({ materialId: mat.id, options: DEFAULT_PCB_OPTIONS });
      expect(typeof s.material).toBe('string');
      expect((s.material as string).length).toBeGreaterThan(0);
    }
  });

  it('keeps an unrecognised id rather than dropping the field', () => {
    const s = pcbRunSettings({ materialId: 'ceramic_something', options: DEFAULT_PCB_OPTIONS });
    expect(s.material).toBe('ceramic_something');
    expect(s.substrate).toBeNull();
  });

  it('fills the feeds in from the defaults when the caller has a partial', () => {
    const s = pcbRunSettings({ materialId: DEFAULT_MATERIAL_ID, options: { spindleRpm: 9000 } });
    expect(s.spindleRpm).toBe(9000);
    expect(s.cutFeedrate).toBe(DEFAULT_PCB_OPTIONS.cutFeedrate);
    expect(s.stockThickness).toBe(DEFAULT_PCB_OPTIONS.boardThicknessMm);
  });

  it('names the tools it was given, and says nothing when it was given none', () => {
    const withTools = pcbRunSettings({
      materialId: DEFAULT_MATERIAL_ID,
      options: DEFAULT_PCB_OPTIONS,
      isolationToolId: 't1_vbit_30',
    });
    expect(withTools.isolationTool).toMatch(/V-Bit/i);
    expect(withTools.profileTool).toBeNull();
  });

  it('marks a frame pass as one, so it does not read as a milled board', () => {
    const s = pcbRunSettings({ materialId: DEFAULT_MATERIAL_ID, options: DEFAULT_PCB_OPTIONS, kind: 'frame' });
    expect(s.kind).toBe('frame');
  });
});

describe('pcbJobName', () => {
  it('falls back rather than filing a run under an empty name', () => {
    expect(pcbJobName(null)).toBe('Untitled circuit');
    expect(pcbJobName('   ')).toBe('Untitled circuit');
  });

  it('distinguishes a frame from the board it frames', () => {
    expect(pcbJobName('555 blinker')).toBe('555 blinker');
    expect(pcbJobName('555 blinker', 'frame')).toBe('555 blinker (frame)');
  });
});
