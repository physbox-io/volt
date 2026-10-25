import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GrblTransport } from '@physbox-io/machining';

/*
 * What the run archive hears when a job ends badly.
 *
 * A hard limit browns out the controller and it drops off USB. Before, the
 * app's telemetry went quiet the moment the machine read as disconnected, so
 * the run was left "running" until the server gave up on it.
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
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();

const posted = vi.fn().mockResolvedValue([]);
vi.mock('../src/utils/apiClient', () => ({
  postMachineTelemetry: (...args: unknown[]) => posted(...args),
  machineSocketUrl: vi.fn().mockReturnValue(null),
  submitMachineJob: vi.fn(),
}));
vi.mock('../src/utils/cloudDocuments', () => ({
  cloudAutosave: { getStatus: () => ({ documentId: null, revision: null }) },
}));

const { WebSerialManager } = await import('../src/utils/webSerialManager');

class FakeController implements GrblTransport {
  readonly label = 'fake';
  written: string[] = [];
  private open = false;
  private dataCb: ((chunk: string) => void) | null = null;
  private disconnectCb: ((err?: Error) => void) | null = null;
  silent = false;

  onData(cb: (chunk: string) => void) {
    this.dataCb = cb;
  }
  onDisconnect(cb: (err?: Error) => void) {
    this.disconnectCb = cb;
  }
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
    if (!this.silent) setTimeout(() => this.say('ok\n'), 0);
  }
  async writeRealtime() {}
  say(text: string) {
    this.dataCb?.(text);
  }
  drop(err: Error) {
    this.open = false;
    this.disconnectCb?.(err);
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
  /** Volt's own datum gate, as a completed touch-off leaves it. */
  zeroed() {
    this.updateState({ zeroZSet: true });
  }
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

let fake: FakeController;
let machine: TestManager;

beforeEach(async () => {
  posted.mockClear();
  fake = new FakeController();
  machine = new TestManager(fake);
  await machine.connect();
  await tick();
  machine.zeroed();
});

describe('a job cut short by the controller dropping off', () => {
  it('closes its run with an error saying so, at the line it reached', async () => {
    fake.silent = true;
    void machine.startJob(['G90 G21', 'G0 Z1', 'G1 Z-0.1 F100', 'G1 X10', 'G0 Z1'].join('\n'), {
      name: 'isolation',
    });
    await vi.waitFor(() => expect(fake.written.length).toBeGreaterThan(0));

    fake.drop(new Error('The device has been lost.'));
    await vi.waitFor(() => {
      const last = posted.mock.calls.at(-1)?.[1];
      expect(last?.status).toBe('error');
      expect(last?.lastError).toMatch(/Lost the connection to the controller at line \d+/);
      expect(last?.jobName).toBe('isolation');
    });
  });
});

describe('a job that would run off the end of an axis', () => {
  it('is refused before anything moves, with the reason', async () => {
    fake.say('$20=0\n$23=3\n$27=1\n$130=180\n$131=100\n$132=45\n');
    fake.say('<Home|MPos:0,0,0>\n<Idle|MPos:0,0,0|WCO:0,0,0>\n');
    fake.say('<Idle|MPos:150,10,-20|WCO:150,10,-20>\n');
    fake.written = [];

    await expect(
      machine.startJob(['G90 G21', 'G0 Z1', 'G0 X60 Y10', 'G1 Z-0.1 F100', 'G1 X70', 'G0 Z1'].join('\n'))
    ).rejects.toThrow(/past the \+X end of the machine's travel/);
    expect(fake.written.filter((l) => /^G[0-3]\b/.test(l))).toEqual([]);
  });
});
