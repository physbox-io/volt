import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SWITCH_COMMANDS } from '../src/hooks/mcpCommandList';

/**
 * LIST_COMMANDS answers from SWITCH_COMMANDS, a list kept beside the bridge's
 * `switch (cmd)`. Read the switch's case labels out of the source so a command
 * added to one and not the other fails here rather than going unlisted.
 */
function switchCaseLabels(): string[] {
  const src = readFileSync(resolve(__dirname, '../src/hooks/useMCPBridge.ts'), 'utf8');
  const start = src.indexOf('switch (cmd) {');
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf('\n        default:', start);
  expect(end).toBeGreaterThan(start);
  return [...src.slice(start, end).matchAll(/^\s*case '([A-Z0-9_]+)':/gm)].map(m => m[1]);
}

describe('LIST_COMMANDS', () => {
  it('lists exactly the commands the bridge switch answers', () => {
    const labels = switchCaseLabels();
    expect(labels.length).toBeGreaterThan(30);
    expect([...SWITCH_COMMANDS].sort()).toEqual([...new Set(labels)].sort());
  });

  it('has no duplicates and includes itself', () => {
    expect(new Set(SWITCH_COMMANDS).size).toBe(SWITCH_COMMANDS.length);
    expect(SWITCH_COMMANDS).toContain('LIST_COMMANDS');
  });
});
