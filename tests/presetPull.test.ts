import { describe, it, expect, vi } from 'vitest';

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
}
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();

const api = vi.hoisted(() => ({
  fetchCloudPresets: vi.fn(),
  fetchCloudParameters: vi.fn(),
  syncCloudParameters: vi.fn(),
  syncCloudPreset: vi.fn(),
  deleteCloudPreset: vi.fn().mockResolvedValue(true),
}));
vi.mock('../src/utils/apiClient', () => api);

import { pullCloudPresets, removeCloudPreset } from '../src/utils/cloudSync';

describe('pulling a name the server holds twice', () => {
  it('reads the latest save, for its data and its id', async () => {
    const older = { name: 'Board', nodes: [], edges: [], savedAt: 1000 };
    const newer = { name: 'Board', nodes: [], edges: [], savedAt: 2000 };
    api.fetchCloudPresets.mockResolvedValue([
      { id: 'pst_new', name: 'Board', data: newer },
      { id: 'pst_old', name: 'Board', data: older },
    ]);

    const pulled = await pullCloudPresets();
    await removeCloudPreset('Board');

    expect(pulled.Board).toBe(newer);
    expect(api.deleteCloudPreset).toHaveBeenCalledWith('pst_new');
  });
});
