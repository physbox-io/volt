import { describe, it, expect } from 'vitest';
import { planResume, RESUME_FEED_IN_MM } from '@physbox-io/machining';
import { WebSerialManager, type MachineState } from '../src/utils/webSerialManager';

class TestMachine extends WebSerialManager {
  public sent: string[] = [];
  public probeZ = -10.0;

  public seed(patch: Partial<MachineState>): void {
    this.updateState(patch);
  }

  public triggerAlarm(): void {
    this.onAlarm();
  }

  protected override async sendLine(line: string): Promise<void> {
    this.sent.push(line);
  }

  protected override async sendProgram(lines: string[]): Promise<void> {
    this.sent.push(...lines);
  }

  protected override async awaitStatus(): Promise<void> {
    // no-op in mock
  }

  protected override async awaitWorkOffset(): Promise<{ x: number; y: number; z: number }> {
    return { x: 0, y: 0, z: -10.0 };
  }

  protected override async drain(): Promise<void> {
    // no-op in mock
  }

  protected override async probeDown(): Promise<{ x: number; y: number; z: number }> {
    this.sent.push('PROBE_DOWN');
    return { x: 0, y: 0, z: this.probeZ };
  }

  protected override async probeDownTwice(): Promise<{ x: number; y: number; z: number; scatterMm: number }> {
    this.sent.push('PROBE_DOWN_TWICE');
    return { x: 0, y: 0, z: this.probeZ, scatterMm: 0.005 };
  }

  protected override async retract(mm: number): Promise<void> {
    this.sent.push(`RETRACT_${mm}`);
  }

  protected override async clampedRetractZ(z: number): Promise<number> {
    return z;
  }
}

describe('Audit #2 — Machining 0.10.0 & WebSerial Safety', () => {
  it('uses @physbox-io/machining 0.10.0 resume slow-plunge fallback & RESUME_FEED_IN_MM', () => {
    expect(RESUME_FEED_IN_MM).toBe(1);
    const lines = [
      'G90 G21',
      'T1 M6',
      'M3 S12000',
      'G0 Z2',
      'G0 X5 Y5',
      'G1 X6 Y5 Z-0.1 F120',
      'G1 X15 Y5 F300',
      'G1 X15 Y15 F300',
    ];
    const plan = planResume(lines, 7, { isLaser: false, safeZ: 2 });
    const preamble = plan.preamble.join('\n');
    // 0.10.0 rapids down to Z(-0.1 + 1.0) = Z0.900 and plunges at the derived slow feed (<= 120), not hardcoded F300
    expect(preamble).toContain('G0 Z0.900');
    expect(preamble).toMatch(/G1 Z-0\.100 F(\d+)/);
    const plungeFeed = Number(preamble.match(/G1 Z-0\.100 F(\d+)/)?.[1]);
    expect(plungeFeed).toBeGreaterThan(0);
    expect(plungeFeed).toBeLessThanOrEqual(120);
  });

  it('clears probeCircuitSeen on alarm so operator must re-prove probe circuit', () => {
    const m = new TestMachine();
    m.seed({ connected: true, status: 'IDLE', probeCircuitSeen: true });
    expect(m.getState().probeCircuitSeen).toBe(true);
    m.triggerAlarm();
    expect(m.getState().probeCircuitSeen).toBe(false);
  });

  it('runZeroZ records Z datum for toolsInUse() and increments datumEpoch on fresh Z0', async () => {
    const m = new TestMachine();
    m.seed({ connected: true, status: 'IDLE', probeCircuitSeen: true, probePinActive: false });
    const beforeEpoch = m.getState().datumEpoch ?? 0;
    await m.zeroZOnSurface(0);
    expect(m.getState().datumEpoch).toBe(beforeEpoch + 1);
    expect(m.toolsInUse()).toBeDefined();

    // Map-preserving re-zero (non-zero surfaceOffsetMm) does not bump datumEpoch
    const afterFresh = m.getState().datumEpoch!;
    await m.zeroZOnSurface(0.05);
    expect(m.getState().datumEpoch).toBe(afterFresh);
  });

  it('refuses runZeroZ and probeSurfaceMesh while a job is actively running', async () => {
    const m = new TestMachine();
    m.seed({ connected: true, status: 'RUNNING', probeCircuitSeen: true, probePinActive: false });
    await expect(m.zeroZOnSurface(0)).rejects.toThrow(/Cannot probe Z/);
    await expect(
      m.probeSurfaceMesh({ minX: 0, minY: 0, maxX: 10, maxY: 10, cols: 2, rows: 2 })
    ).rejects.toThrow(/Cannot probe surface/);
  });

  it('probeSurfaceMesh does not double-retract before verification re-probe or emit F on G0', async () => {
    const m = new TestMachine();
    m.seed({
      connected: true,
      status: 'IDLE',
      probeCircuitSeen: true,
      probePinActive: false,
      zeroZSet: true,
      wpos: { x: 0, y: 0, z: 2 },
    });
    const grid = await m.probeSurfaceMesh({
      minX: 0,
      minY: 0,
      maxX: 10,
      maxY: 10,
      cols: 2,
      rows: 2,
      probeDepthMm: 3,
      clearanceMm: 2,
    });
    expect(grid.gridX).toBe(2);
    // No G0 line should carry an F word
    expect(m.sent.some(l => /^G0\b.*\bF\d/.test(l))).toBe(false);
    // Count relative retract lifts: 1 initial + 4 grid points = 5 (NOT 6 from a duplicate retract!)
    const retractCount = m.sent.filter(l => /\bG91\b/.test(l)).length;
    expect(retractCount).toBe(5);
  });
});
