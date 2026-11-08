// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/*
 * A paused job must never be lost behind a closed dialog. Hide a tool change,
 * let another window come and go, and the status bar has to offer an obvious
 * way back to the dialog — with the re-zero and Resume in it — without the job
 * having been touched by any of it.
 */

type Listener = (s: Record<string, unknown>) => void;
const listeners = new Set<Listener>();
let state: Record<string, unknown> = {};
const base = {
  connected: true, status: 'PAUSED_TOOL', currentLine: 990, totalLines: 3000, progressPercent: 33,
  wpos: { x: 1, y: 2, z: 3 }, mpos: { x: 0, y: 0, z: 0 }, pauseMessage: 'Fit T2: 0.8 mm drill',
  needsZeroBeforeResume: true, probePinActive: false, probeCircuitSeen: true,
};
const machine = {
  getState: () => state,
  addListener: (l: Listener) => { listeners.add(l); return () => listeners.delete(l); },
  resumeJob: vi.fn().mockResolvedValue(undefined),
  cancelJob: vi.fn(), pauseJob: vi.fn(), eStop: vi.fn(), clearLastError: vi.fn(),
  jog: vi.fn(), jogCancel: vi.fn(), nextSpindleRpm: () => 12000, surfaceOffsetHere: () => 0,
  zeroZ: vi.fn().mockResolvedValue(undefined), zeroZOnSurface: vi.fn().mockResolvedValue(undefined),
};
vi.mock('../src/utils/webSerialManager', () => ({ webSerialManager: machine }));

const { JobInterruptions } = await import('../src/components/JobInterruptions');
const { MachineStatusBar } = await import('../src/components/MachineStatusBar');
const { jobPause } = await import('../src/utils/jobPause');

let root: Root;
let host: HTMLDivElement;
const set = (patch: Record<string, unknown>) => {
  state = { ...state, ...patch };
  act(() => listeners.forEach((l) => l(state)));
};
const button = (text: string | RegExp) =>
  Array.from(document.querySelectorAll('button')).find((b) =>
    typeof text === 'string' ? b.textContent?.includes(text) : text.test(b.textContent ?? ''),
  ) as HTMLButtonElement | undefined;
const dialog = () => document.querySelector('[role="dialog"]');
const click = (b: HTMLButtonElement | undefined) => {
  expect(b).toBeTruthy();
  act(() => b!.click());
};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  jobPause.show();
  state = { ...base };
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root.render(
      <>
        <MachineStatusBar onOpenMachine={() => {}} />
        <JobInterruptions />
      </>,
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('getting back to a hidden tool change', () => {
  it('hides, and comes back from the status bar with the re-zero and Resume', () => {
    expect(dialog()?.textContent).toContain('Tool change');
    click(button('Hide'));
    expect(dialog()).toBeNull();
    expect(machine.resumeJob).not.toHaveBeenCalled();
    expect(machine.cancelJob).not.toHaveBeenCalled();

    // Status reports keep arriving while it is hidden; it stays hidden.
    set({ wpos: { x: 5, y: 2, z: 3 } });
    expect(dialog()).toBeNull();

    click(button('Tool change: zero Z'));
    expect(dialog()?.textContent).toContain('Zero Z on the new bit');
    expect(button('On the copper') ?? button(/Probe Z zero/)).toBeTruthy();
    expect(button('Resume job')!.disabled).toBe(true);

    set({ needsZeroBeforeResume: false });
    click(button('Resume job'));
    expect(machine.resumeJob).toHaveBeenCalled();
  });

  it('opens the next tool change by itself', () => {
    click(button('Hide'));
    set({ currentLine: 2100, pauseMessage: 'Fit T3: 1 mm end mill' });
    expect(dialog()?.textContent).toContain('Fit T3');
  });

  it('does the same for a feed hold, which the planner draining does not reopen', () => {
    set({ status: 'PAUSED_OPERATOR', pauseMessage: undefined, needsZeroBeforeResume: false });
    expect(dialog()?.textContent).toContain('Paused');
    click(button('Hide'));
    set({ currentLine: 993 });
    expect(dialog()).toBeNull();
    click(button('Paused: resume'));
    click(button('Resume job'));
    expect(machine.resumeJob).toHaveBeenCalled();
  });
});
