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
// Reached through unknown because the shim is only the four methods under
// test, not the whole Storage interface.
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = storage;

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

const { WebSerialManager, layerSpindleRestart } = await import('../src/utils/webSerialManager');

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
  /** Answers a `?` poll, when set — see the layer-restart tests. */
  onStatusPoll: (() => string | null) | null = null;
  /** What a soft reset (Ctrl-X) does besides rebooting. */
  onSoftReset: (() => void) | null = null;
  async writeRealtime(byte: number) {
    this.realtime.push(byte);
    if (byte === 0x3f && this.onStatusPoll) {
      const report = this.onStatusPoll();
      if (report) setTimeout(() => this.say(report), 0);
    }
    if (byte === 0x18) {
      // A reset controller has dropped its buffer: nothing outstanding will be
      // answered, and everything after the banner is.
      this.acked = this.written.length;
      this.autoAck = true;
      setTimeout(() => {
        this.onSoftReset?.();
        this.say("Grbl 1.1h ['$' for help]\n");
      }, 0);
    }
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
  readonly fake: FakeController;
  constructor(fake: FakeController) {
    super();
    this.fake = fake;
  }
  protected createTransport(): GrblTransport {
    return this.fake;
  }
  isSupported(): boolean {
    return true;
  }
  shortenHoldTimeout(ms: number) {
    this.restartHoldTimeoutMs = ms;
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

/**
 * The operator touching the bit to the copper: one report with the probe pin
 * asserted, then one with it released.
 */
function proveProbeCircuit(fake: FakeController) {
  fake.say('<Idle|MPos:0,0,0|WCO:0,0,0|Pn:P>\n');
  fake.say('<Idle|MPos:0,0,0|WCO:0,0,0>\n');
}

let fake: FakeController;
let machine: TestManager;

beforeEach(async () => {
  storage.clear();
  fake = new FakeController();
  machine = new TestManager(fake);
  await machine.connect();
  await tick();
  proveProbeCircuit(fake);
});

describe('no probe runs on a circuit nobody has proved', () => {
  /*
   * A probe is a G38.2, which stops when the probe input closes — and only
   * then. The one way it drives the bit through the board is a circuit that
   * never closes, which the controller cannot tell from "not there yet" until
   * the search runs out. So the circuit has to be seen closed, by hand, before
   * the first stab of a connection.
   */
  beforeEach(async () => {
    await machine.disconnect();
    fake = new FakeController();
    machine = new TestManager(fake);
    await machine.connect();
    await tick();
  });

  it('refuses to zero Z until the probe input has been seen closed', async () => {
    fake.say('<Idle|MPos:0,0,0|WCO:0,0,0>\n');
    await expect(machine.zeroZOnSurface(0)).rejects.toThrow(/has not been proved/);
    await expect(machine.zeroZ(12, 0)).rejects.toThrow(/has not been proved/);
    expect(fake.written.some(l => l.includes('G38.2'))).toBe(false);
  });

  it('refuses the mesh probe on the same grounds', async () => {
    await expect(
      machine.probeSurfaceMesh({ minX: 0, minY: 0, maxX: 10, maxY: 10, probeDepthMm: 5, clearanceMm: 2 })
    ).rejects.toThrow(/has not been proved/);
  });

  it('refuses while the input reads closed with nothing touching', async () => {
    fake.say('<Idle|MPos:0,0,0|WCO:0,0,0|Pn:P>\n');
    expect(machine.getState().probeCircuitSeen).toBe(true);
    await expect(machine.zeroZOnSurface(0)).rejects.toThrow(/already reads closed/);
  });

  it('probes once the circuit has closed and opened again', async () => {
    proveProbeCircuit(fake);
    const zeroing = machine.zeroZOnSurface(0);
    await completeZeroZ(fake);
    fake.say('<Idle|MPos:0,0,-5|WCO:0,0,-5>\n');
    await zeroing;
    expect(machine.getState().zeroZSet).toBe(true);
  });

  it('forgets the proof on a fresh connection', async () => {
    proveProbeCircuit(fake);
    expect(machine.getState().probeCircuitSeen).toBe(true);
    await machine.disconnect();
    await machine.connect();
    await tick();
    expect(machine.getState().probeCircuitSeen).toBe(false);
  });
});

describe('how far a probe searches', () => {
  it('zeroes with a short search: the bit is parked close, and an open circuit is a plunge', async () => {
    const zeroing = machine.zeroZOnSurface(0);
    await completeZeroZ(fake);
    fake.say('<Idle|MPos:0,0,-5|WCO:0,0,-5>\n');
    await zeroing;
    expect(fake.written.find(l => l.startsWith('G91 G38.2'))).toBe('G91 G38.2 Z-10.000 F50');
  });

  it('stretches the mesh search to reach copper the tool was parked well above', async () => {
    const zeroing = machine.zeroZOnSurface(0);
    await completeZeroZ(fake);
    fake.say('<Idle|MPos:0,0,-5|WCO:0,0,-5>\n');
    await zeroing;
    // Parked 5mm above the copper after the zero's own retract.
    fake.say('<Idle|MPos:0,0,0|WCO:0,0,-5>\n');
    const probes = () => fake.written.filter(l => l.startsWith('G91 G38.2'));
    const before = probes().length;
    const mesh = machine.probeSurfaceMesh({
      minX: 0, minY: 0, maxX: 10, maxY: 10, cols: 2, rows: 2, probeDepthMm: 3, clearanceMm: 2,
    });
    mesh.catch(() => {});
    // The routine reads the work offset off the status stream before it
    // moves, so keep the reports coming as a polled controller would.
    const poll = setInterval(() => fake.say('<Run|MPos:0,0,0|WCO:0,0,-5>\n'), 5);
    try {
      await vi.waitFor(() => expect(probes().length).toBe(before + 1));
    } finally {
      clearInterval(poll);
    }
    // 5 up + 2 of lift + 1 of margin, rather than the 3 asked for.
    expect(probes()[before]).toBe('G91 G38.2 Z-8.000 F50');
    await machine.disconnect();
  });
});

describe('the Z datum may not be trusted just because it reads back', () => {
  /*
   * GRBL keeps G54's Z offset in EEPROM across sessions, tools and boards, so a
   * datum that reads back as perfectly valid may belong to a different setup
   * entirely. Connecting does not make it this board's.
   */
  it('refuses a job when Z has not been set this session', async () => {
    fake.say('<Idle|MPos:0,0,0|WCO:0,0,0>\n');
    await expect(machine.startJob('G1 X1 Y1')).rejects.toThrow(/Z zero has not been set/);
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

  /*
   * ...but the origin itself is still exactly where it was put, and jogging
   * off it is the next thing anyone does: park on the corner, set XY0, jog
   * over the copper, probe Z0, jog clear, cut. Keying the refusal on the
   * "tool is standing at the zero" flag meant the job was refused for having
   * no Z datum on a machine that had just been zeroed — the error operators
   * were being shown while both zeros were perfectly good.
   */
  it('keeps the datum, and lets the job run, after jogging off the zero', async () => {
    const zeroing = machine.zeroZOnSurface(0);
    await completeZeroZ(fake);
    await zeroing;
    fake.say('<Idle|MPos:0,0,-5|WCO:0,0,-5>\n');
    await tick();

    await machine.jog({ z: 5 });
    expect(machine.getState().zeroZConfirmed).toBe(false);
    expect(machine.getState().zeroZSet).toBe(true);

    await expect(machine.startJob('G1 X1 Y1')).resolves.toBeUndefined();
  });

  it('forgets the datum on a fresh connection, where it may be another machine', async () => {
    const zeroing = machine.zeroZOnSurface(0);
    await completeZeroZ(fake);
    await zeroing;
    fake.say('<Idle|MPos:0,0,-5|WCO:0,0,-5>\n');
    await tick();
    expect(machine.getState().zeroZSet).toBe(true);

    await machine.disconnect();
    await machine.connect();
    expect(machine.getState().zeroZSet).toBeFalsy();
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
    // Resolves once the stream restarts, not when it next stops.
    await machine.resumeJob();
    await vi.waitFor(() => expect(machine.getState().status).toBe('PAUSED_TOOL'));

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
    await vi.waitFor(() => expect(machine.getState().status).toBe('PAUSED_TOOL'));

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
    await m.homeMachine();

    // The controller reports a zero offset — it has lost the origin.
    fake.say('<Idle|MPos:0,0,0|WCO:0,0,0>\n');
    await vi.waitFor(() => expect(m.getState().zeroRestored).toBe(true));

    // G10 L2 writes the offset in machine coordinates. L20 — what the zeroing
    // buttons use — would re-zero on wherever the tool is parked right now,
    // which is exactly the mistake being avoided.
    expect(fake.written).toContain('G10 L2 P1 X12.000 Y34.000 Z-5.000');
  });

  /*
   * The remembered Z was taken with whatever bit was in the collet then. A
   * restore that counted as a Z zero let a job start on it, and the first
   * plunge went as deep as the two bits differ.
   */
  it('restores XY but never counts as a Z zero', async () => {
    storage.setItem('grblWorkOrigin', JSON.stringify({ x: 12, y: 34, z: -5, savedAt: Date.now() }));
    const m = new TestManager(fake);
    await m.connect();
    await tick();
    await m.homeMachine();
    fake.say('<Idle|MPos:0,0,0|WCO:0,0,0>\n');
    await vi.waitFor(() => expect(m.getState().zeroRestored).toBe(true));

    expect(m.getState().zeroXYSet).toBe(true);
    expect(m.getState().zeroZSet).toBeFalsy();
    await expect(m.startJob('G1 X1 Y1')).rejects.toThrow(/Z zero has not been set/);
  });

  /*
   * A non-zero offset that differs from ours is somebody's newer zero — a blank
   * set up from another app — and writing the old one over it moved the job
   * onto the previous board.
   */
  it('leaves a different, real offset alone', async () => {
    storage.setItem('grblWorkOrigin', JSON.stringify({ x: 12, y: 34, z: -5, savedAt: Date.now() }));
    const m = new TestManager(fake);
    await m.connect();
    await tick();
    await m.homeMachine();
    fake.say('<Idle|MPos:0,0,0|WCO:40,50,-7>\n');
    await tick();
    fake.say('<Idle|MPos:0,0,0|WCO:40,50,-7>\n');
    await tick();

    expect(fake.written.some(l => l.startsWith('G10 L2'))).toBe(false);
    expect(m.getState().zeroRestored).toBeFalsy();
  });

  /*
   * G54 is an offset from machine position, and machine position before
   * homing is wherever the gantry stood at power-on.
   */
  it('waits for the machine to home before restoring', async () => {
    storage.setItem('grblWorkOrigin', JSON.stringify({ x: 12, y: 34, savedAt: Date.now() }));
    const m = new TestManager(fake);
    await m.connect();
    await tick();
    fake.say('<Idle|MPos:0,0,0|WCO:0,0,0>\n');
    await tick();
    expect(fake.written.some(l => l.startsWith('G10 L2'))).toBe(false);

    await m.homeMachine();
    fake.say('<Idle|MPos:0,0,0|WCO:0,0,0>\n');
    await vi.waitFor(() => expect(m.getState().zeroRestored).toBe(true));
    expect(fake.written).toContain('G10 L2 P1 X12.000 Y34.000');
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

describe('restarting the current layer', () => {
  /*
   * A restart has to soft-reset the controller to flush its planner, and a
   * reset that lands while the machine is still moving is ALARM:3 with
   * position lost. It used to wait a fixed 600 ms after the hold — a rapid at
   * default acceleration takes longer to stop — and then offered Resume over a
   * machine that no longer knew where it was.
   */
  const program = [
    '; OP 1/2: Isolation',
    'T1 M6',
    'M3 S12000',
    'G1 X1 F100',
    // Longer than GRBL's receive buffer, so the stream is still inside this
    // operation when the restart is asked for.
    ...Array.from({ length: 60 }, (_, i) => `G1 X${(2 + i * 0.01).toFixed(3)} Y1`),
    '; OP 2/2: Profile',
    'T99 M6',
    'M3 S16000',
    'G1 X9',
  ].join('\n');

  let state: string;
  let mpos: string;

  async function startCutting() {
    const zeroing = machine.zeroZOnSurface(0);
    await completeZeroZ(fake);
    await zeroing;
    fake.say('<Idle|MPos:0,0,-5|WCO:0,0,-5>\n');
    await tick();
    state = 'Run';
    mpos = '1,0,-5.1';
    fake.onStatusPoll = () => `<${state}|MPos:${mpos}|WCO:0,0,-5>\n`;
    await machine.startJob(program);
    // Past the setup tool change and cutting, with the controller holding
    // lines it has not answered yet.
    fake.autoAck = false;
    void machine.resumeJob();
    await vi.waitFor(() => expect(fake.written).toContain('G1 X1 F100'));
    expect(machine.getCurrentLayer()?.label).toBe('Isolation');
  }

  it('does not reset until the controller reports the hold complete', async () => {
    await startCutting();
    let polls = 0;
    let stopped = false;
    fake.onStatusPoll = () => {
      polls++;
      // Still decelerating until the test says otherwise.
      return `<${stopped ? 'Hold:0' : 'Hold:1'}|MPos:${mpos}|WCO:0,0,-5>\n`;
    };
    const resets = () => fake.realtime.filter(b => b === 0x18).length;
    const resetsBefore = resets();
    const restart = machine.restartCurrentLayer();
    await vi.waitFor(() => expect(polls).toBeGreaterThanOrEqual(3));
    expect(fake.realtime).toContain(0x21);
    expect(resets()).toBe(resetsBefore);
    fake.onSoftReset = () => {
      fake.onStatusPoll = () => `<Idle|MPos:${mpos}|WCO:0,0,-5>\n`;
    };
    stopped = true;
    await restart;

    expect(resets()).toBe(resetsBefore + 1);
    expect(machine.getState().status).toBe('PAUSED_TOOL');
    expect(machine.isRunning()).toBe(true);
  });

  it('stays in feed hold, unreset, when the machine never reports a standstill', async () => {
    await startCutting();
    machine.shortenHoldTimeout(50);
    fake.onStatusPoll = () => `<Hold:1|MPos:${mpos}|WCO:0,0,-5>\n`;
    const resetsBefore = fake.realtime.filter(b => b === 0x18).length;
    await expect(machine.restartCurrentLayer()).rejects.toThrow(/not reset/);

    expect(fake.realtime.filter(b => b === 0x18).length).toBe(resetsBefore);
    expect(machine.getState().status).toBe('PAUSED_OPERATOR');
    expect(machine.isJobPaused()).toBe(true);
  });

  it('refuses to offer the restart after a coded alarm, and does not unlock it', async () => {
    await startCutting();
    state = 'Hold:0';
    fake.onSoftReset = () => {
      fake.say('ALARM:3\n');
      state = 'Alarm';
    };
    await expect(machine.restartCurrentLayer()).rejects.toThrow(/\$H/);

    expect(fake.written).not.toContain('$X');
    expect(machine.isRunning()).toBe(false);
    expect(machine.getState().status).not.toBe('PAUSED_TOOL');
  });

  it('refuses when machine position moved across the reset', async () => {
    await startCutting();
    state = 'Hold:0';
    fake.onSoftReset = () => {
      state = 'Idle';
      mpos = '1.2,0,-5.1';
    };
    await expect(machine.restartCurrentLayer()).rejects.toThrow(/lost 0\.20mm/);
    expect(machine.isRunning()).toBe(false);
  });

  /*
   * With homing required ($22=1) GRBL boots locked after every reset, the
   * deliberate one included. That lock is not a fault.
   */
  it('clears the homing lockout and carries on', async () => {
    await startCutting();
    state = 'Hold:0';
    fake.onSoftReset = () => {
      state = 'Alarm';
    };
    const written = fake.writeLine.bind(fake);
    fake.writeLine = async (line: string) => {
      if (line === '$X') state = 'Idle';
      return written(line);
    };
    await machine.restartCurrentLayer();

    expect(fake.written).toContain('$X');
    expect(machine.getState().status).toBe('PAUSED_TOOL');
    expect(machine.getState().needsZeroBeforeResume).toBe(true);
  });

  it('rewinds to the layer and stops at its own tool change, not before', async () => {
    await startCutting();
    state = 'Hold:0';
    fake.onSoftReset = () => {
      state = 'Idle';
    };
    await machine.restartCurrentLayer();
    const rezero = machine.zeroZOnSurface(0);
    await completeZeroZ(fake);
    await rezero;

    const before = fake.written.length;
    await machine.resumeJob();
    await vi.waitFor(() => expect(machine.getState().status).toBe('PAUSED_TOOL'));
    // The layer opens with its own M6, which brings the spindle up after the
    // bit change — so nothing spun it up on the way to that prompt.
    expect(fake.written.slice(before).some(l => /^M3/.test(l))).toBe(false);
  });
});

describe('which spindle line a restarted layer replays', () => {
  const lines = ['G0 Z5', 'T1 M6', 'M3 S12000', 'G1 X1', 'M5', 'T99 M6', 'M3 S16000 ; end mill', 'G1 X2', 'G1 X3'];

  it('none, when the layer opens with its own bit change', () => {
    expect(layerSpindleRestart(lines, 1)).toBeNull();
    expect(layerSpindleRestart(lines, 4)).toBeNull();
  });

  it('the speed the bit already in the collet was running at', () => {
    expect(layerSpindleRestart(lines, 8)).toBe('M3 S16000');
  });
});

describe('a height map levels only the face it was probed on', () => {
  /*
   * After the flip the bit is over the other face, re-clamped. A map of the
   * top applied there cut the bottom copper to the top's warp.
   */
  it('warps up to the flip and leaves the bottom face alone', async () => {
    const { gridFromPoints } = await import('@physbox-io/machining');
    const { BOARD_FLIP_NOTE } = await import('../src/utils/boardLevelling');
    const grid = gridFromPoints([
      [{ x: 0, y: 0, z: 0.2 }, { x: 10, y: 0, z: 0.2 }],
      [{ x: 0, y: 10, z: 0.2 }, { x: 10, y: 10, z: 0.2 }],
    ])!;
    const bottom = ['G0 X5 Y5', 'G1 Z-0.100 F100', 'G1 X6 Y5 F300'];
    const program = ['G90', 'G0 X5 Y5', 'G1 Z-0.100 F100', `M0 ; ${BOARD_FLIP_NOTE}`, ...bottom].join('\n');
    const out = machine.applyHeightmapToGcode(program, grid).split('\n');
    const flip = out.findIndex(l => l.includes(BOARD_FLIP_NOTE));
    expect(out.slice(0, flip).join('\n')).toMatch(/Z0\.100/);
    expect(out.slice(flip + 1)).toEqual(bottom);
  });

  it('says when the job has reached the flip, and what speed comes next', async () => {
    const { BOARD_FLIP_NOTE } = await import('../src/utils/boardLevelling');
    const zeroing = machine.zeroZOnSurface(0);
    await completeZeroZ(fake);
    await zeroing;
    fake.say('<Idle|MPos:0,0,-5|WCO:0,0,-5>\n');
    await tick();
    await machine.startJob(
      ['G1 X1 F100', `M0 ; ${BOARD_FLIP_NOTE}`, 'T1 M6', 'M3 S15000', 'G1 X2', 'T99 M6', 'M3 S11000'].join('\n')
    );
    // Stopped at the flip pause: the next cut is on the other face.
    expect(machine.getState().status).toBe('PAUSED_MATERIAL');
    expect(machine.isPastBoardFlip()).toBe(true);
    expect(machine.nextSpindleRpm()).toBe(15000);
  });
});
