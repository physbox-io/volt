/**
 * Exercises the WebSerial transport against a simulated GRBL controller.
 *
 * The thing being verified is flow control: GRBL silently discards anything
 * that overflows its 128-byte receive buffer, and a dropped retract mid-probe
 * drags the bit across the board. The fake controller below asserts that its
 * buffer never overflows, and that probe results come from [PRB:] reports
 * rather than from stale status polls.
 */

let fails = 0;
function check(name: string, cond: boolean, detail = '') {
  if (!cond) fails++;
  console.log(`${cond ? '  ok  ' : '!!FAIL'} ${name}${cond ? '' : `  ${detail}`}`);
}

const GRBL_BUFFER = 128;

interface FakeGrblOptions {
  /** Height of the simulated (warped) copper surface at a given XY, in mm. */
  surface?: (x: number, y: number) => number;
  /** Make probes miss the surface entirely. */
  probeMisses?: boolean;
  /** Reject this command with error:1 when seen. */
  errorOn?: string;
}

class FakeGrbl {
  public maxBufferSeen = 0;
  public overflowed = false;
  public received: string[] = [];
  public statusPolls = 0;

  private occupied = 0;
  private pending: string[] = [];
  private partial = '';
  private controller!: ReadableStreamDefaultController<Uint8Array>;
  private x = 0;
  private y = 0;
  private draining = false;

  public readable: ReadableStream<Uint8Array>;
  public writable: WritableStream<Uint8Array>;

  private opts: FakeGrblOptions;

  constructor(opts: FakeGrblOptions = {}) {
    this.opts = opts;
    this.readable = new ReadableStream<Uint8Array>({
      start: c => {
        this.controller = c;
      },
    });

    this.writable = new WritableStream<Uint8Array>({
      write: chunk => this.onBytes(new TextDecoder().decode(chunk)),
    });
  }

  private reply(text: string) {
    this.controller.enqueue(new TextEncoder().encode(text + '\r\n'));
  }

  private onBytes(text: string) {
    for (const ch of text) {
      // '?' is a realtime command: it bypasses the buffer entirely.
      if (ch === '?') {
        this.statusPolls++;
        this.reply(`<Idle|MPos:${this.x.toFixed(3)},${this.y.toFixed(3)},5.000|WPos:${this.x.toFixed(3)},${this.y.toFixed(3)},5.000>`);
        continue;
      }
      if (ch === '\x18') {
        this.occupied = 0;
        this.pending = [];
        this.partial = '';
        this.reply('Grbl 1.1f [\'$\' for help]');
        continue;
      }

      this.occupied++;
      this.maxBufferSeen = Math.max(this.maxBufferSeen, this.occupied);
      if (this.occupied > GRBL_BUFFER) this.overflowed = true;

      if (ch === '\n') {
        this.pending.push(this.partial.trim());
        this.partial = '';
        this.drain();
      } else {
        this.partial += ch;
      }
    }
  }

  /** Executes queued lines one at a time, freeing buffer space as it goes. */
  private async drain() {
    if (this.draining) return;
    this.draining = true;

    while (this.pending.length > 0) {
      const line = this.pending.shift()!;
      await new Promise(r => setTimeout(r, 1));

      this.received.push(line);
      this.occupied -= line.length + 1;

      for (const m of line.matchAll(/([XY])(-?[\d.]+)/g)) {
        if (m[1] === 'X') this.x = parseFloat(m[2]);
        if (m[1] === 'Y') this.y = parseFloat(m[2]);
      }

      if (this.opts.errorOn && line.includes(this.opts.errorOn)) {
        this.reply('error:1');
        continue;
      }

      // `G38.2` is a word on the line, not necessarily the first one — a probe
      // is issued as `G91 G38.2 Z-… F…` so the depth is a real travel distance.
      if (line.includes('G38.2')) {
        if (this.opts.probeMisses) {
          this.reply('[PRB:0.000,0.000,0.000:0]');
          this.reply('ok');
          continue;
        }
        const z = (this.opts.surface ?? (() => 0))(this.x, this.y);
        // Machine coordinates, offset from work space — as real GRBL reports.
        this.reply(`[PRB:${this.x.toFixed(3)},${this.y.toFixed(3)},${(z - 40).toFixed(3)}:1]`);
      }

      this.reply('ok');
    }

    this.draining = false;
  }
}

// --- Install a fake navigator.serial before importing the manager -----------
let fake: FakeGrbl;
function installFake(opts: FakeGrblOptions = {}) {
  fake = new FakeGrbl(opts);
  (globalThis as any).navigator = {
    serial: {
      requestPort: async () => ({
        open: async () => {},
        close: async () => {},
        readable: fake.readable,
        writable: fake.writable,
      }),
    },
  };
  return fake;
}

installFake();

const { webSerialManager } = await import('./utils/webSerialManager');
const { getGridStats } = await import('./utils/meshLeveler');

async function reconnect(opts: FakeGrblOptions = {}) {
  await webSerialManager.disconnect();
  installFake(opts);
  await webSerialManager.connect();
}

// --- 1. Streaming a long job never overflows the controller ----------------
await webSerialManager.connect();
check('connects', webSerialManager.getState().connected);

const longJob = ['G90 G21', ...Array.from({ length: 400 }, (_, i) => `G1 X${(i * 0.1).toFixed(3)} Y10.000 Z-0.080 F300`), 'M5'].join('\n');
await webSerialManager.startJob(longJob);

check('job completes', webSerialManager.getState().status === 'IDLE');
check('progress reaches 100%', webSerialManager.getState().progressPercent === 100);
check('no buffer overflow', !fake.overflowed, `peak ${fake.maxBufferSeen} bytes`);
check('kept the buffer usefully full', fake.maxBufferSeen > 60, `peak ${fake.maxBufferSeen} bytes`);
check('every line arrived', fake.received.filter(l => l.startsWith('G1')).length === 400, `${fake.received.filter(l => l.startsWith('G1')).length}`);

// --- 2. Mesh probing reads real [PRB:] values ------------------------------
// A board tilted 0.01mm/mm in X and dished 0.05mm in the middle of Y.
await reconnect({ surface: (x, y) => 0.01 * x - (y > 5 && y < 35 ? 0.05 : 0) });

const grid = await webSerialManager.probeSurfaceMesh({
  minX: 0, minY: 0, maxX: 60, maxY: 40, cols: 4, rows: 4,
});

const zs = grid.points.flat().map(p => p.z);
check('probed 16 points', zs.length === 16);
check('probe values are distinct', new Set(zs.map(z => z.toFixed(3))).size > 1, `${new Set(zs.map(z => z.toFixed(3))).size} distinct`);
check('origin corner is the reference', Math.abs(grid.points[0][0].z) < 1e-9, `${grid.points[0][0].z}`);
check('machine-coord offset cancelled', Math.abs(getGridStats(grid).spanZ - 0.65) < 1e-6, `span ${getGridStats(grid).spanZ}`);
check('far corner picks up the tilt', Math.abs(grid.points[0][3].z - 0.6) < 1e-6, `${grid.points[0][3].z}`);
check('probe never overflowed', !fake.overflowed);

const probeLines = fake.received.filter(l => l.includes('G38.2'));
check('one probe per point', probeLines.length === 16, `${probeLines.length}`);

// The probe depth is a search *distance*, so it has to go out in relative mode.
// Sent absolute, `G38.2 Z-3` means "descend to work Z = -3" — from a clearance
// height of +2 that is a 5 mm move at best, and with work Z0 unset it is a few
// tenths of a millimetre followed by ALARM:5.
check(
  'probes relative, not absolute',
  probeLines.every(l => /(^|\s)G91(\s|$)/.test(l)),
  probeLines[0]
);
// ...and absolute mode is restored, or every following move is a relative one.
for (const [i, line] of fake.received.entries()) {
  if (!line.includes('G38.2')) continue;
  const restored = fake.received.slice(i + 1, i + 3).some(l => /(^|\s)G90(\s|$)/.test(l));
  check(`G90 restored after probe ${i}`, restored, fake.received.slice(i, i + 3).join(' | '));
  break;
}
const retracts = fake.received.filter(l => /^G0 Z/.test(l));
check('retracts between points', retracts.length >= 16, `${retracts.length}`);

// Every probe must be preceded by a retract, or the bit drags across copper.
let dragged = false;
for (let i = 1; i < fake.received.length; i++) {
  if (/^G0 X/.test(fake.received[i]) && !/^G0 Z/.test(fake.received[i - 1])) dragged = true;
}
check('never travels without retracting first', !dragged);

// --- 2b. Zeroing on a touch plate retracts UP, not into the plate ---------
// `G10 L20 P1 Z12` makes the contact point work Z 12, so an absolute retract
// to anything below 12 drives the tool down through the plate. This drilled a
// hole in a real touch plate, so it is pinned here.
await reconnect();
await webSerialManager.zeroZ(12);

const offsetIdx = fake.received.findIndex(l => /^G10 L20 P1 Z12/.test(l));
check('plate offset is applied', offsetIdx >= 0, fake.received.join(' | '));

const afterOffset = fake.received.slice(offsetIdx + 1);
const firstMove = afterOffset.find(l => /(^|\s)G[01](\s|$)/.test(l));
check(
  'retracts relatively after zeroing on the plate',
  !!firstMove && /(^|\s)G91(\s|$)/.test(firstMove),
  firstMove || '(no move after offset)'
);
// An absolute Z move here is the exact bug: it is a coordinate in the frame
// G10 just redefined, not a lift.
check(
  'no absolute Z move straight after the offset',
  !afterOffset.some(l => /^G0 Z-?[\d.]+$/.test(l)),
  afterOffset.join(' | ')
);
check('absolute mode restored after zeroing', afterOffset.some(l => /(^|\s)G90(\s|$)/.test(l)));

// --- 2c. Re-zeroing at a tool change keeps the job paused, not idle -------
// Changing a bit invalidates work Z0, so re-zeroing has to be possible without
// cancelling the job — and it has to give the pause back when it finishes, or
// the resume banner disappears with the job still half-streamed.
await reconnect();
await webSerialManager.startJob(['G90 G21', 'G1 X1.000', 'T1 M6', 'G1 X2.000'].join('\n'));
check(
  'tool change pauses the job',
  webSerialManager.getState().status === 'PAUSED_TOOL',
  webSerialManager.getState().status
);

await webSerialManager.zeroZ(12);
check(
  'still paused after a re-zero',
  webSerialManager.getState().status === 'PAUSED_TOOL',
  webSerialManager.getState().status
);

await webSerialManager.resumeJob();
check(
  'job runs to completion after the re-zero',
  webSerialManager.getState().status === 'IDLE',
  webSerialManager.getState().status
);
check('post-change line was sent', fake.received.includes('G1 X2.000'));

// --- 3. A missed probe fails loudly instead of returning a flat map --------
await reconnect({ probeMisses: true });
let probeErr = '';
try {
  await webSerialManager.probeSurfaceMesh({ minX: 0, minY: 0, maxX: 60, maxY: 40 });
} catch (e: any) {
  probeErr = e.message;
}
check('missed probe throws', probeErr.includes('contact'), probeErr || '(no error)');
check('machine returns to idle after a failed probe', webSerialManager.getState().status === 'IDLE', webSerialManager.getState().status);

// --- 4. A rejected command aborts the job ---------------------------------
await reconnect({ errorOn: 'X5.000' });
await webSerialManager.startJob(['G90', 'G1 X1.000', 'G1 X5.000', 'G1 X9.000'].join('\n'));
check('error: aborts the job', webSerialManager.getState().status === 'ERROR', webSerialManager.getState().status);
check('error is reported', (webSerialManager.getState().lastError || '').includes('error:1'), webSerialManager.getState().lastError || '');

await webSerialManager.disconnect();
console.log(`\n${fails} failure(s)`);
if (fails) throw new Error(`${fails} serial protocol test failure(s)`);
