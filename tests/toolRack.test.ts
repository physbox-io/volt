/**
 * The shared tool rack, as the CAM tab reads it.
 *
 * Volt used to keep its own drawer — a catalogue plus custom bits in this
 * browser — while Etch and Mesh kept theirs. The rack is now the one list, and
 * these tests are the seams: a rack tool becoming a PCB tool with the right
 * numbers, a selection made before the rack still meaning the same bit, and
 * the old custom bits moving in without the move clobbering the account.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
}
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();

// Pushes to the account are the store's business; what is under test is what
// reaches it, so the network call is a spy.
const pushed: unknown[] = [];
vi.mock('../src/utils/apiClient', () => ({
  syncCloudParameters: vi.fn(async (_app: string, params: Record<string, unknown>) => {
    pushed.push(params);
    return true;
  }),
}));

const {
  PCB_TOOL_PRESETS,
  canonicalToolId,
  createCustomTool,
  findTool,
  pcbToolFromRack,
  rackAdditionsFor,
  readToolRack,
  retireRackTool,
  settleToolRack,
  addCustomTool,
  toolChoices,
  toolRackStore,
  DEFAULT_ISOLATION_TOOL_ID,
  DEFAULT_PROFILE_TOOL_ID,
} = await import('../src/utils/pcbTooling');
const { TOOL_RACK_PARAMETER, TOOL_RACK_STORAGE_KEY, defaultToolRack } = await import('@physbox-io/machining');
type RackTool = import('@physbox-io/machining').RackTool;

const LEGACY_KEY = 'circuit.pcb.customTools.v1';

const rackTool = (over: Partial<RackTool>): RackTool => ({
  uid: 'u',
  toolNumber: 50,
  name: 'test bit',
  shape: 'flat',
  diameterMm: 1,
  available: true,
  ...over,
});

beforeEach(() => {
  localStorage.clear();
  pushed.length = 0;
  toolRackStore.reload();
});

describe('a rack tool as a PCB tool', () => {
  it('takes the PCB numbers from the catalogue bit it matches', () => {
    const v30 = PCB_TOOL_PRESETS.find(t => t.id === 't1_vbit_30')!;
    const tool = pcbToolFromRack(
      rackTool({ uid: 'mine-30', toolNumber: 4, name: 'Blue 30°', shape: 'vbit', diameterMm: 0.1, tipAngleDeg: 30, flutes: 1 })
    );
    expect(tool.id).toBe('mine-30');
    expect(tool.name).toBe('Blue 30°');
    expect(tool.catalogueId).toBe('t1_vbit_30');
    expect(tool.role).toBe('isolation');
    expect(tool.recommendedDepthMm).toBe(v30.recommendedDepthMm);
    expect(tool.recommendedCutFeed).toBe(v30.recommendedCutFeed);
    expect(tool.recommendedRpm).toBe(v30.recommendedRpm);
    expect(tool.rackToolNumber).toBe(4);
  });

  it('scales the catalogue feed for a different flute count, at the same bite', () => {
    const v60 = PCB_TOOL_PRESETS.find(t => t.id === 't3b_vbit_60')!;
    const tool = pcbToolFromRack(rackTool({ shape: 'vbit', diameterMm: 0.2, tipAngleDeg: 60, flutes: 2 }));
    expect(tool.catalogueId).toBe('t3b_vbit_60');
    expect(tool.recommendedCutFeed).toBe(v60.recommendedCutFeed * 2);
  });

  it('does not match a V-bit of the same tip but another angle', () => {
    const tool = pcbToolFromRack(rackTool({ shape: 'vbit', diameterMm: 0.1, tipAngleDeg: 10, flutes: 1, rpm: 18000 }));
    expect(tool.catalogueId).toBeUndefined();
    // Derived the way a custom bit always was: chipload x flutes x rpm.
    const expected = createCustomTool({ name: 'x', type: 'vbit', tipDiameterMm: 0.1, angleDeg: 10, fluteCount: 1, recommendedRpm: 18000 });
    expect(tool.recommendedCutFeed).toBe(expected.recommendedCutFeed);
    expect(tool.recommendedRpm).toBe(18000);
    expect(tool.angleDeg).toBe(10);
  });

  it('caps a derived plunge at the owner\'s own plunge limit', () => {
    const tool = pcbToolFromRack(rackTool({ shape: 'drill', diameterMm: 0.45, flutes: 2, rpm: 15000, maxPlungeRate: 40 }));
    expect(tool.role).toBe('drill');
    expect(tool.recommendedPlungeFeed).toBeLessThanOrEqual(40);
  });

  it('files shapes on the pickers the CAM tab expects', () => {
    expect(pcbToolFromRack(rackTool({ shape: 'flat', diameterMm: 1.5 })).role).toBe('profile');
    expect(pcbToolFromRack(rackTool({ shape: 'drill', diameterMm: 0.8 })).role).toBe('drill');
    expect(pcbToolFromRack(rackTool({ shape: 'vbit', diameterMm: 0.1, tipAngleDeg: 30 })).role).toBe('isolation');
    // An engraver is a flat in the rack; the tag keeps it on isolation.
    const engraver = pcbToolFromRack(rackTool({ shape: 'flat', diameterMm: 0.8, bestFor: ['isolation'] }));
    expect(engraver.role).toBe('isolation');
    expect(engraver.catalogueId).toBe('t3c_engraver_08');
  });
});

describe('the pickers', () => {
  it('offer available rack tools only, in T-number order', () => {
    const rack = defaultToolRack();
    rack.tools.find(t => t.uid === 'vbit-20')!.available = false;
    const ids = toolChoices(rack, 'isolation').map(c => c.tool.id);
    expect(ids).toEqual(['vbit-60', 'vbit-30']);
    expect(toolChoices(rack, 'drill').map(c => c.tool.tipDiameterMm)).toEqual([0.8, 1.0]);
    expect(toolChoices(rack, 'profile').every(c => c.tool.role === 'profile')).toBe(true);
  });

  it('show a catalogue selection as the rack bit it is, not twice', () => {
    const rack = defaultToolRack();
    expect(canonicalToolId(rack, 'isolation', DEFAULT_ISOLATION_TOOL_ID)).toBe('vbit-30');
    expect(canonicalToolId(rack, 'profile', DEFAULT_PROFILE_TOOL_ID)).toBe('flat-1500');
    const choices = toolChoices(rack, 'isolation', DEFAULT_ISOLATION_TOOL_ID);
    expect(choices.filter(c => c.tool.catalogueId === 't1_vbit_30')).toHaveLength(1);
  });

  it('keep a retired selection on the list, saying so', () => {
    const rack = defaultToolRack();
    rack.tools.find(t => t.uid === 'vbit-30')!.available = false;
    const choices = toolChoices(rack, 'isolation', 'vbit-30');
    const kept = choices.find(c => c.tool.id === 'vbit-30');
    expect(kept?.label).toMatch(/retired/);
    expect(kept?.tool.recommendedDepthMm).toBe(-0.08);
  });

  it('keep a catalogue bit the rack does not hold, saying so', () => {
    const choices = toolChoices(defaultToolRack(), 'isolation', 't2b_vbit_15');
    expect(choices.find(c => c.tool.id === 't2b_vbit_15')?.label).toMatch(/not in your rack/);
  });
});

describe('custom bits and the rack', () => {
  it('a bit added in the CAM tab goes into the rack with the next T number', () => {
    const before = readToolRack();
    const top = Math.max(...before.tools.map(t => t.toolNumber));
    const tools = addCustomTool({ name: 'Shop 0.2mm 20°', type: 'vbit', tipDiameterMm: 0.2, angleDeg: 20, fluteCount: 1 });
    const mine = tools[tools.length - 1];
    const entry = readToolRack().tools.find(t => t.uid === mine.id)!;
    expect(entry.toolNumber).toBe(top + 1);
    expect(entry.shape).toBe('vbit');
    expect(pushed.some(p => (p as Record<string, unknown>)[TOOL_RACK_PARAMETER])).toBe(true);
  });

  it('two bits of the same size do not share an identity', () => {
    const a = addCustomTool({ name: 'A', type: 'endmill', tipDiameterMm: 1.2, fluteCount: 2 });
    const b = addCustomTool({ name: 'B', type: 'endmill', tipDiameterMm: 1.2, fluteCount: 2 });
    expect(a[a.length - 1].id).not.toBe(b[b.length - 1].id);
  });

  it('retiring keeps the bit resolvable', () => {
    retireRackTool('vbit-30');
    expect(readToolRack().tools.find(t => t.uid === 'vbit-30')?.available).toBe(false);
    expect(findTool('vbit-30')?.retired).toBe(true);
  });

  it('rackAdditionsFor numbers past the highest and skips what is there', () => {
    const rack = defaultToolRack();
    const added = rackAdditionsFor(rack, [
      createCustomTool({ name: 'x', type: 'drill', tipDiameterMm: 0.45 }, 'custom_a'),
      createCustomTool({ name: 'y', type: 'drill', tipDiameterMm: 0.55 }, 'vbit-30'),
    ]);
    expect(added.map(t => t.uid)).toEqual(['custom_a']);
    expect(added[0].toolNumber).toBe(Math.max(...rack.tools.map(t => t.toolNumber)) + 1);
  });
});

describe('moving the old custom bits in', () => {
  const legacy = () =>
    localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify([createCustomTool({ name: 'Old 10°', type: 'vbit', tipDiameterMm: 0.1, angleDeg: 10 }, 'custom_old')])
    );

  it('keeps the old id, so a selection naming it still resolves', () => {
    legacy();
    const rack = readToolRack();
    expect(rack.tools.some(t => t.uid === 'custom_old')).toBe(true);
    expect(findTool('custom_old')?.angleDeg).toBe(10);
  });

  it('does not stamp the starting rack before the account has been heard from', () => {
    legacy();
    readToolRack();
    // Stamped, the starting rack plus one bit would beat the rack the owner
    // built in Etch on the next sign-in.
    expect(readToolRack().savedAt).toBe(0);
    expect(pushed).toHaveLength(0);
    expect(localStorage.getItem(LEGACY_KEY)).not.toBeNull();
  });

  it('joins the account\'s rack when that one wins, then finishes', () => {
    legacy();
    readToolRack();
    const remote = { tools: [rackTool({ uid: 'etch-1', toolNumber: 1, shape: 'flat', diameterMm: 3.175 })], savedAt: 1000 };
    expect(settleToolRack(remote)).toBe(true);
    const rack = readToolRack();
    expect(rack.tools.map(t => t.uid)).toEqual(['etch-1', 'custom_old']);
    expect(rack.tools.find(t => t.uid === 'custom_old')!.toolNumber).toBe(2);
    expect(rack.savedAt).toBeGreaterThan(1000);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(pushed.length).toBeGreaterThan(0);
  });

  it('seeds an account that has no rack yet', () => {
    legacy();
    expect(settleToolRack(undefined)).toBe(false);
    expect(readToolRack().savedAt).toBeGreaterThan(0);
    expect(readToolRack().tools.some(t => t.uid === 'custom_old')).toBe(true);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('moves straight in when this browser already has a real rack', () => {
    toolRackStore.set(defaultToolRack().tools);
    pushed.length = 0;
    legacy();
    readToolRack();
    expect(readToolRack().tools.some(t => t.uid === 'custom_old')).toBe(true);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(pushed).toHaveLength(1);
  });

  it('happens once', () => {
    toolRackStore.set(defaultToolRack().tools);
    legacy();
    readToolRack();
    const count = readToolRack().tools.length;
    readToolRack();
    expect(readToolRack().tools.length).toBe(count);
    expect(JSON.parse(localStorage.getItem(TOOL_RACK_STORAGE_KEY)!).tools).toHaveLength(count);
  });
});
