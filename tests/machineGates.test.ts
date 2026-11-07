import { describe, expect, it } from 'vitest';
import { jobInProgress, stopControl } from '../src/utils/machineGates';
import { webSerialManager, type ProbeGrid } from '../src/utils/webSerialManager';

const idle = { connected: true, status: 'IDLE', grblState: 'Idle', spindleSpeed: 0 } as const;

describe('stopControl', () => {
  it('offers nothing with no machine, or one at rest', () => {
    expect(stopControl({ ...idle, connected: false, status: 'RUNNING' })).toBeNull();
    expect(stopControl(idle)).toBeNull();
  });

  it("is the job's stop through every stage of a job", () => {
    for (const status of ['RUNNING', 'PAUSED_TOOL', 'PAUSED_MATERIAL', 'PAUSED_OPERATOR'] as const) {
      expect(stopControl({ ...idle, status })).toBe('job');
      expect(jobInProgress({ status })).toBe(true);
    }
  });

  it("is the machine's stop for motion with no job, and a spindle left on", () => {
    for (const grblState of ['Run', 'Jog', 'Home', 'Hold:1', 'Door:0']) {
      expect(stopControl({ ...idle, grblState })).toBe('machine');
    }
    expect(stopControl({ ...idle, spindleSpeed: 12000 })).toBe('machine');
  });
});

describe('surfaceOffsetHere', () => {
  const tilted = {
    gridX: 2,
    gridY: 2,
    minX: 0,
    maxX: 10,
    minY: 0,
    maxY: 10,
    points: [
      [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0.2 }],
      [{ x: 0, y: 10, z: 0 }, { x: 10, y: 10, z: 0.2 }],
    ],
  } as unknown as ProbeGrid;

  it('reads the job map under the bit, with no dialog involved', () => {
    const wpos = webSerialManager.getState().wpos;
    Object.assign(wpos, { x: 5, y: 5 });
    webSerialManager.setJobHeightmap(tilted);
    expect(webSerialManager.surfaceOffsetHere()).toBeCloseTo(0.1);
    webSerialManager.setJobHeightmap(null);
    expect(webSerialManager.surfaceOffsetHere()).toBe(0);
  });
});
