import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { playbackTicker } from '../src/utils/playbackTicker';
import { TraceHistory } from '../src/sim/traceHistory';
import { HILMemoizer } from '../src/utils/hilMemoizer';
import type { SpiceResult } from '../src/types/simulation';
import type { Node } from '@xyflow/react';

describe('Performance Audit — Bundle, Workers & Viewport', () => {
  afterEach(() => {
    playbackTicker.stop();
    vi.restoreAllMocks();
  });

  it('perf/bundle: heavy modals and MCP bridge are lazy-loaded and vite.config defines vendor chunks', () => {
    const appSrc = readFileSync(resolve(__dirname, '../src/App.tsx'), 'utf8');
    expect(appSrc).toContain("lazy(() =>\n  import('./components/ExportPcbModal')");
    expect(appSrc).toContain("lazy(() => import('./components/McpBridgeMount'))");
    expect(appSrc).not.toMatch(/^import\s+\{[^}]*ExportPcbModal[^}]*\}\s+from/m);
    expect(appSrc).not.toMatch(/^import\s+\{[^}]*useMCPBridge[^}]*\}\s+from/m);

    const captureSrc = readFileSync(resolve(__dirname, '../src/utils/canvasCapture.ts'), 'utf8');
    expect(captureSrc).not.toMatch(/^import\s+.*from\s+['"]html-to-image['"]/m);
    expect(captureSrc).toContain("import('html-to-image')");

    const viteSrc = readFileSync(resolve(__dirname, '../vite.config.ts'), 'utf8');
    expect(viteSrc).toContain("format: 'es'");
    expect(viteSrc).toContain("name: 'vendor-xyflow'");
  });

  it('perf/workers: playbackTicker does not schedule rAF when there are zero listeners', () => {
    const raf = vi.fn(() => 42);
    const caf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('cancelAnimationFrame', caf);

    playbackTicker.start(1000);
    expect(raf).not.toHaveBeenCalled();

    const unsub = playbackTicker.subscribe(() => {});
    expect(raf).toHaveBeenCalledTimes(1);

    unsub();
    expect(caf).toHaveBeenCalledWith(42);
  });

  it('perf/workers: TraceHistory skips indexing when no scope/LED nodes exist and evicts orphaned traces', () => {
    const history = new TraceHistory(500);
    const result: SpiceResult = {
      header: 'test',
      numVariables: 2,
      numPoints: 2,
      dataType: 'real',
      variableNames: ['time', 'v(n1)'],
      data: [
        { name: 'time', type: 'time', values: [0, 0.01] },
        { name: 'v(n1)', type: 'voltage', values: [0, 5] },
      ],
    };
    const scopeNode: Node = { id: 'scope1', type: 'scope', position: { x: 0, y: 0 }, data: {} };
    history.append([scopeNode], result, { 'scope1-ch1': 'n1' }, 10);
    expect(history.applyTo([scopeNode])[0].data.voltageData1).toHaveLength(2);

    // Removing the scope evicts its orphaned trace buffer
    history.append([], result, {}, 10);
    expect(history.applyTo([scopeNode])[0].data.voltageData1).toBeUndefined();
  });

  it('perf/workers: HILMemoizer defaults to bounded <=256 entries and refreshes LRU on overwrite', () => {
    const memo = new HILMemoizer();
    expect(memo.maxEntries).toBeLessThanOrEqual(256);

    const small = new HILMemoizer({ maxEntries: 2 });
    const dummy = {
      result: { header: '', numVariables: 0, numPoints: 0, dataType: 'real' as const, variableNames: [], data: [] },
      index: { timestamps_ms: [], indexByName: new Map() },
      portToNet: {},
      outputs: {},
      nextICs: {},
      halfPeriods: {},
    };
    small.set({ a: 1 }, {}, 10, 0.1, dummy);
    small.set({ a: 2 }, {}, 10, 0.1, dummy);
    // Overwriting a=1 should refresh its recency so a=2 gets evicted next
    small.set({ a: 1 }, {}, 10, 0.1, dummy);
    small.set({ a: 3 }, {}, 10, 0.1, dummy);

    expect(small.get({ a: 1 }, {}, 10, 0.1)).not.toBeNull();
    expect(small.get({ a: 2 }, {}, 10, 0.1)).toBeNull();
  });
});
