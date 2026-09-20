/**
 * The CAM tab's setup, carried with the circuit.
 *
 * A saved circuit has carried its {@link PcbOptions} for a while — trace
 * width, clearances, feeds, depths — and that looked like enough. It is not.
 * Those numbers are *derived* from a bit and a laminate, and the isolation
 * depth is re-derived from them every time the panel opens when Auto is on. So
 * a board milled on one machine and opened on another restored the numbers and
 * then immediately recomputed the depth from whatever bit that machine was
 * last set to, with nothing on screen to say it had.
 *
 * Worse, the bit was never stored anywhere at all: the pickers were component
 * state, so even on one machine closing the dialog put the default V-bit back.
 *
 * These tests are the round trip between two machines: set up here, save,
 * arrive on a machine that has never seen any of it, and open.
 */
import { describe, it, expect, beforeEach } from 'vitest';

/*
 * This suite runs in node (see vitest.config.ts). The module under test is
 * localStorage by design, so it is shimmed here rather than moving the whole
 * suite to jsdom for one file — the same approach presetSync.test.ts takes.
 */
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
}
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();

const {
  addCustomTool,
  applyCamSetup,
  loadAutoIsolationDepth,
  loadCamSetup,
  loadCustomTools,
  loadSelectedMaterialId,
  loadSelectedToolIds,
  saveAutoIsolationDepth,
  saveSelectedMaterialId,
  saveSelectedToolId,
  findTool,
  DEFAULT_ISOLATION_TOOL_ID,
  DEFAULT_PROFILE_TOOL_ID,
} = await import('../src/utils/pcbTooling');

/** A machine with nothing set up on it. */
const freshMachine = () => localStorage.clear();

/** The bench this board was actually milled on. */
function setUpTheLaptop() {
  const tools = addCustomTool({
    name: 'Shop 0.2mm 20°',
    type: 'vbit',
    tipDiameterMm: 0.2,
    angleDeg: 20,
    fluteCount: 1,
    recommendedRpm: 14000,
  });
  const mine = tools[tools.length - 1];
  saveSelectedToolId('isolation', mine.id);
  saveSelectedToolId('profile', DEFAULT_PROFILE_TOOL_ID);
  saveSelectedMaterialId('fr1_soft');
  saveAutoIsolationDepth(false);
  return mine;
}

beforeEach(freshMachine);

describe('the setup a board was milled with', () => {
  it('travels to a machine that has never seen the bit', () => {
    const mine = setUpTheLaptop();
    const saved = loadCamSetup();
    expect(saved.isolationToolId).toBe(mine.id);
    expect(saved.materialId).toBe('fr1_soft');
    expect(saved.autoIsolationDepth).toBe(false);
    // The definition travels, not just the id: an id for a bit the other
    // machine has never heard of restores nothing.
    expect(saved.customTools?.map(t => t.id)).toContain(mine.id);

    freshMachine();
    expect(loadSelectedToolIds().isolation).toBe(DEFAULT_ISOLATION_TOOL_ID);

    applyCamSetup(saved);
    expect(loadSelectedToolIds().isolation).toBe(mine.id);
    expect(loadSelectedToolIds().profile).toBe(DEFAULT_PROFILE_TOOL_ID);
    expect(loadSelectedMaterialId()).toBe('fr1_soft');
    expect(loadAutoIsolationDepth()).toBe(false);
    // And the bit itself is in the drawer, with its geometry.
    const arrived = findTool(mine.id);
    expect(arrived?.tipDiameterMm).toBe(0.2);
    expect(arrived?.angleDeg).toBe(20);
  });

  it('adds to the other machine\'s tools rather than replacing them', () => {
    const mine = setUpTheLaptop();
    const saved = loadCamSetup();

    freshMachine();
    addCustomTool({ name: 'Bench 1mm flat', type: 'endmill', tipDiameterMm: 1.0, fluteCount: 2 });
    const before = loadCustomTools().map(t => t.id);

    applyCamSetup(saved);
    const after = loadCustomTools().map(t => t.id);
    // Equipment belongs to the bench it is on. Arriving with a circuit is no
    // reason to take a tool away from it.
    for (const id of before) expect(after).toContain(id);
    expect(after).toContain(mine.id);
  });

  it('carries only the bits it names', () => {
    addCustomTool({ name: 'Unused 2mm', type: 'endmill', tipDiameterMm: 2.0, fluteCount: 2 });
    const setup = loadCamSetup();
    // A preset is a circuit, not a backup of somebody's tool drawer.
    expect(setup.customTools).toEqual([]);
  });

  it('falls back to the default for a bit this machine does not have', () => {
    applyCamSetup({ isolationToolId: 'no_such_bit', profileToolId: 'also_missing' });
    expect(loadSelectedToolIds().isolation).toBe(DEFAULT_ISOLATION_TOOL_ID);
    expect(loadSelectedToolIds().profile).toBe(DEFAULT_PROFILE_TOOL_ID);
  });

  it('ignores a laminate that is not in the catalogue', () => {
    saveSelectedMaterialId('fr1_soft');
    applyCamSetup({ materialId: 'unobtainium' });
    expect(loadSelectedMaterialId()).toBe('fr1_soft');
  });

  it('leaves a machine alone when the circuit carries no setup', () => {
    setUpTheLaptop();
    const before = loadCamSetup();
    applyCamSetup(undefined);
    expect(loadCamSetup()).toEqual(before);
  });

  it('remembers the bit across a close of the dialog', () => {
    // The bug that hid the rest: the pickers were component state, so this
    // was the default again on every open.
    saveSelectedToolId('isolation', 't2_vbit_60');
    expect(loadSelectedToolIds().isolation).toBe(
      findTool('t2_vbit_60') ? 't2_vbit_60' : DEFAULT_ISOLATION_TOOL_ID
    );
  });
});
