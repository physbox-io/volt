import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GrblTransport } from '@physbox-io/machining';

/*
 * The machine policy that is Volt's rather than GRBL's.
 *
 * The protocol underneath — the line queue, the coordinate frames, probing,
 * the streaming loop — is tested in @physbox-io/machining against its own fake
 * controller. What is tested here is only what this app adds on top, because
 * that is where the board-specific rules live: whether a Z datum may be
 * trusted, what a bit change demands before the job goes on, and what happens
 * to a remembered origin when the controller comes back up without it.
 *
 * Every one of these is a board that came out wrong before the check existed.
 *
 * The suite runs in node (see vitest.config.ts), so the two browser APIs this
 * module actually uses are stubbed rather than moving everything to jsdom.
 */
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}
const storage = new MemoryStorage();
(globalThis as any).localStorage = storage;

// Telemetry is a network post on every state change and says nothing about the
// rules under test.
vi.mock('../src/utils/apiClient', () => ({
  postMachineTelemetry: vi.fn().mockResolvedValue(undefined),
  machineSocketUrl: vi.fn().mockReturnValue(null),
  submitMachineJob: vi.fn(),
}));
vi.mock('../src/utils/cloudDocuments', () => ({
  cloudAutosave: { getStatus: () => ({ documentId: null, revision: null }) },
}));

const { WebSerialManager } = await import('../src/utils/webSerialManager');

/** A GRBL that answers only when the test says so. */
class FakeController implements GrblTransport {
  readonly label = 'fake';
  written: string[] = [];
  realtime: number[] = [];
  autoAck = true;
  private open = false;
  private dataCb: ((chunk: string) => void) | null = null;
  private acked = 0;

  onData(cb: (chunk: string) => void) {
    this.dataCb = cb;
  }
  onDisconnect() {}
  isOpen() {
    return this.open;
  }
  async connect() {
    this.open = true;
  }
  async disconnect() {
    this.open = false;
  }
  async writeLine(line: string) {
    this.written.push(line);
    if (this.autoAck) {
      this.acked++;
      setTimeout(() => this.say('ok\n'), 0);
    }
  }
  async writeRealtime(byte: number) {
    this.realtime.push(byte);
  }
  say(text: string) {
    this.dataCb?.(text);
  }
  ackAll() {
    const owed = this.written.length - this.acked;
    this.acked = this.written.length;
    if (owed > 0) this.say('ok\n'.repeat(owed));
  }
}

class TestManager extends WebSerialManager {
  constructor(readonly fake: FakeController) {
    super();
  }
  protected createTransport(): GrblTransport {
    return this.fake;
  }
  isSupported(): boolean {
    return true;
  }
}

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/**
 * Drives a Z zeroing to completion, answering both stabs of the probe.
 *
 * Counted from however many probes have already been sent, so this works for a
 * re-zero part way through a job as well as the first one of a session.
 */
async function completeZeroZ(fake: FakeController, contactZ = -5) {
  const probes = () => fake.written.filter(l => l.startsWith('G91 G38.2')).length;
  const before = probes();
  await vi.waitFor(() => expect(probes()).toBe(before + 1));
  fake.say(`[PRB:0.000,0.000,${contactZ.toFixed(3)}:1]\n`);
  await vi.waitFor(() => expect(probes()).toBe(before + 2));
  fake.say(`[PRB:0.000,0.000,${(contactZ - 0.002).toFixed(3)}:1]\n`);
}

let fake: FakeController;
let machine: TestManager;

beforeEach(async () => {
  storage.clear();
  fake = new FakeController();
  machine = new TestManager(fake);
  await machine.connect();
  await tick();
});

describe('the Z datum may not be trusted just because it reads back', () => {
  /*
   * GRBL keeps G54's Z offset in EEPROM across sessions, tools and boards, so a
   * datum that reads back as perfectly valid may belong to a different setup
   * entirely. Connecting does not make it this board's.
   */
  it('refuses a job when Z has not been confirmed this session', async () => {
    fake.say('<Idle|MPos:0,0,0|WCO:0,0,0>\n');
    await expect(machine.startJob('G1 X1 Y1')).rejects.toThrow(/Z zero has not been confirmed/);
  });

  it('accepts a job once Z has been zeroed and the machine confirms it', async () => {
    const zeroing = machine.zeroZOnSurface(0);
    await completeZeroZ(fake);
    await zeroing;
    // The controller reporting work Z at the target is what confirms it — an
    // ok only says the line was received.
    fake.say('<Idle|MPos:0,0,-5|WCO:0,0,-5>\n');
    await tick();

    expect(machine.getState().zeroZConfirmed).toBe(true);
    await expect(machine.startJob('G1 X1 Y1')).resolves.toBeUndefined();
  });

  it('does not treat a sent zero as a confirmed one', async () => {
    void machine.zeroXY();
    await tick();
    // Sent, acked, but the machine has not yet said where it is.
    expect(machine.getState().zeroXYPending).toBe(true);
    expect(machine.getState().zeroXYConfirmed).toBeFalsy();

    fake.say('<Idle|MPos:0,0,0|WCO:0,0,0>\n');
    expect(machine.getState().zeroXYConfirmed).toBe(true);
  });

  /*
   * The confirmation means "the tool is standing at the zero", so any move
   * invalidates it — while leaving the origin itself perfectly good.
   */
  it('drops the confirmation when the machine moves', async () => {
    void machine.zeroXY();
    await tick();
    fake.say('<Idle|MPos:0,0,0|WCO:0,0,0>\n');
    expect(machine.getState().zeroXYConfirmed).toBe(true);

    await machine.jog({ x: 10 });
    expect(machine.getState().zeroXYConfirmed).toBe(false);
  });
});

describe('a bit change invalidates the Z datum', () => {
  async function runToToolChange(program: string) {
    const zeroing = machine.zeroZOnSurface(0);
    await completeZeroZ(fake);
    await zeroing;
    fake.say('<Idle|MPos:0,0,-5|WCO:0,0,-5>\n');
    await tick();
    await machine.startJob(program);
  }

  /*
   * The first `T<n> M6` is not a bit *change* — it is the bit the operator
   * loaded and zeroed during setup. Demanding a re-zero for it would raise the
   * alarm on every single job, and an alarm that is wrong the first time is one
   * the operator learns to click past.
   */
  it('does not demand a re-zero for the tool the job started with', async () => {
    await runToToolChange(['T1 M6', 'G1 X1', 'T2 M6', 'G1 X2'].join('\n'));
    expect(machine.getState().status).toBe('PAUSED_TOOL');
    expect(machine.getState().needsZeroBeforeResume).toBeFalsy();
    await expect(machine.resumeJob()).resolves.toBeUndefined();
  });

  it('demands one at the second tool change, where the length really changed', async () => {
    await runToToolChange(['T1 M6', 'G1 X1', 'T2 M6', 'G1 X2'].join('\n'));
    await machine.resumeJob();

    expect(machine.getState().status).toBe('PAUSED_TOOL');
    expect(machine.getState().needsZeroBeforeResume).toBe(true);
    // Resuming here would cut with a work Z0 that describes the previous bit —
    // a gouge as deep as the two differ in length.
    await expect(machine.resumeJob()).rejects.toThrow(/has not been re-zeroed/);
  });

  /*
   * `zeroZConfirmed` cannot answer "did the operator re-zero?", because any jog
   * clears it — and the pause dialog invites jogging. Completed zeroing
   * operations are counted instead.
   */
  it('lets the job go on once Z has actually been re-zeroed, even after jogging', async () => {
    await runToToolChange(['T1 M6', 'G1 X1', 'T2 M6', 'G1 X2'].join('\n'));
    await machine.resumeJob();

    const rezero = machine.zeroZOnSurface(0);
    await completeZeroZ(fake, -5.2);
    await rezero;
    // Jogging away afterwards does not un-set the origin.
    await machine.jog({ z: 5 });

    await expect(machine.resumeJob()).resolves.toBeUndefined();
    expect(machine.getState().needsZeroBeforeResume).toBe(false);
  });
});

describe('the remembered work origin', () => {
  it('is written down as soon as a zero is confirmed', async () => {
    void machine.zeroXY();
    await tick();
    fake.say('<Idle|MPos:12,34,0|WCO:12,34,0>\n');
    await tick();

    const saved = JSON.parse(storage.getItem('grblWorkOrigin')!);
    expect(saved).toMatchObject({ x: 12, y: 34 });
  });

  /*
   * The whole point of remembering it: a firmware reset or a power cycle
   * between sessions leaves the controller with no offsets, and zeroing is the
   * one piece of setup that cannot be redone from the chair.
   */
  it('is written back when the controller comes up without it', async () => {
    storage.setItem(
      'grblWorkOrigin',
      JSON.stringify({ x: 12, y: 34, z: -5, zTargetMm: 0, savedAt: Date.now() })
    );
    const m = new TestManager(fake);
    await m.connect();
    await tick();

    // The controller reports a zero offset — it has lost the origin.
    fake.say('<Idle|MPos:0,0,0|WCO:0,0,0>\n');
    await vi.waitFor(() => expect(m.getState().zeroRestored).toBe(true));

    // G10 L2 writes the offset in machine coordinates. L20 — what the zeroing
    // buttons use — would re-zero on wherever the tool is parked right now,
    // which is exactly the mistake being avoided.
    expect(fake.written).toContain('G10 L2 P1 X12.000 Y34.000 Z-5.000');
  });

  it('is left alone when the controller already agrees', async () => {
    storage.setItem(
      'grblWorkOrigin',
      JSON.stringify({ x: 12, y: 34, z: -5, savedAt: Date.now() })
    );
    const m = new TestManager(fake);
    await m.connect();
    await tick();
    fake.say('<Idle|MPos:0,0,0|WCO:12,34,-5>\n');
    await tick();

    expect(fake.written.some(l => l.startsWith('G10 L2'))).toBe(false);
    expect(m.getState().zeroRestored).toBeFalsy();
  });

  /*
   * Until a WCO has arrived the offset is unknown rather than zero, and
   * restoring against a guess would move the origin instead of preserving it.
   */
  it('is not restored against a report that never carried an offset', async () => {
    storage.setItem('grblWorkOrigin', JSON.stringify({ x: 12, y: 34, savedAt: Date.now() }));
    const m = new TestManager(fake);
    await m.connect();
    await tick();
    fake.say('<Idle|MPos:0,0,0>\n');
    await tick();

    expect(fake.written.some(l => l.startsWith('G10 L2'))).toBe(false);
  });

  it('is never written back over a zero the operator has just set', async () => {
    storage.setItem('grblWorkOrigin', JSON.stringify({ x: 99, y: 99, savedAt: 1 }));
    const m = new TestManager(fake);
    await m.connect();
    await tick();

    void m.zeroXY();
    await tick();
    fake.say('<Idle|MPos:5,5,0|WCO:5,5,0>\n');
    await tick();
    fake.say('<Idle|MPos:5,5,0|WCO:5,5,0>\n');
    await tick();

    // The operator's answer wins for the rest of the connection.
    expect(fake.written.some(l => l.includes('X99.000'))).toBe(false);
    expect(JSON.parse(storage.getItem('grblWorkOrigin')!)).toMatchObject({ x: 5, y: 5 });
  });

  it('can be forgotten without touching the controller’s own offsets', async () => {
    storage.setItem('grblWorkOrigin', JSON.stringify({ x: 1, y: 2, savedAt: 1 }));
    const m = new TestManager(fake);
    const before = fake.written.length;
    m.forgetSavedZero();

    expect(storage.getItem('grblWorkOrigin')).toBeNull();
    expect(m.getState().savedZero).toBeUndefined();
    expect(fake.written).toHaveLength(before);
  });
});

describe('the surface mesh probe', () => {
  /*
   * Each point probes downward from the retract height, so a search shorter
   * than that retract cannot reach the copper at all. Caught here rather than
   * at the machine, where it surfaces as ALARM:5 on the first point.
   */
  it('refuses a search shallower than the retract it probes from', async () => {
    await expect(
      machine.probeSurfaceMesh({ minX: 0, minY: 0, maxX: 10, maxY: 10, probeDepthMm: 2, clearanceMm: 2 })
    ).rejects.toThrow(/must exceed the retract height/);
  });
});

describe('emergency stop', () => {
  it('soft-resets and then stops the spindle', async () => {
    await machine.eStop();
    expect(fake.realtime).toContain(0x18);
    // The spindle does not stop on its own when the parser restarts.
    expect(fake.written).toContain('M5');
  });
});
