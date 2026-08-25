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

/** Reports between WCO lines, matching GRBL's own 10-30 report cadence. */
const WCO_EVERY = 8;

interface FakeGrblOptions {
  /** Height of the simulated (warped) copper surface at a given XY, in mm. */
  surface?: (x: number, y: number) => number;
  /**
   * How status reports are worded. 'both' reports MPos and WPos on every line;
   * 'mpos' is what a factory-default GRBL 1.1 ($10=1) actually sends — MPos
   * only, with a WCO every few reports and never a WPos.
   */
  reportMode?: 'both' | 'mpos';
  /** Make probes miss the surface entirely. */
  probeMisses?: boolean;
  /** Reject this command with error:1 when seen. */
  errorOn?: string;
  /**
   * Homing required ($22=1): the controller boots into a locked Alarm after
   * every reset, with no ALARM code — it is a lockout, not a fault.
   */
  homingLockout?: boolean;
  /** Fault on reset instead, as a limit trip or a reset mid-motion would. */
  faultOnReset?: number;
  /** Machine coordinates are lost across a reset by this much, in mm. */
  driftOnReset?: number;
}

class FakeGrbl {
  public maxBufferSeen = 0;
  public overflowed = false;
  public received: string[] = [];
  public statusPolls = 0;
  public locked = false;
  public softResets = 0;
  public feedHolds = 0;
  public cycleStarts = 0;

  private occupied = 0;
  private pending: string[] = [];
  private partial = '';
  private controller!: ReadableStreamDefaultController<Uint8Array>;
  private x = 0;
  private y = 0;
  private z = 5;
  // Work offsets, as set by `G10 L20 P1`. Reported WPos is MPos minus these,
  // which is what makes a zeroing command observable at all - the fake used to
  // report WPos as a copy of MPos, so nothing could tell whether a zero took.
  private offX = 0;
  private offY = 0;
  private offZ = 0;
  /** Set when an offset changed, so the next report carries a fresh WCO. */
  private wcoDue = false;
  private relative = false;
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
        const head =
          `<${this.locked ? 'Alarm' : 'Idle'}` +
          `|MPos:${this.x.toFixed(3)},${this.y.toFixed(3)},${this.z.toFixed(3)}`;
        if ((this.opts.reportMode ?? 'both') === 'mpos') {
          // Real GRBL withholds WCO from most reports and never sends WPos in
          // this mode. A reader that assumes both frames are always on the line
          // ends up subtracting a stale one from a live one.
          // GRBL forces a WCO onto the very next report after any offset
          // change, so a client is never left deriving from a stale one.
          const withWco = this.wcoDue || this.statusPolls % WCO_EVERY === 1;
          this.wcoDue = false;
          this.reply(
            head +
              (withWco
                ? `|WCO:${this.offX.toFixed(3)},${this.offY.toFixed(3)},${this.offZ.toFixed(3)}`
                : '') +
              '>'
          );
        } else {
          this.reply(
            head +
              `|WPos:${(this.x - this.offX).toFixed(3)},${(this.y - this.offY).toFixed(3)},` +
              `${(this.z - this.offZ).toFixed(3)}>`
          );
        }
        continue;
      }
      // Ctrl-X soft reset: GRBL discards the planner and everything buffered,
      // then reboots and announces itself.
      if (ch === '\x18') {
        this.softResets++;
        this.occupied = 0;
        this.pending = [];
        this.partial = '';
        this.reply('Grbl 1.1f [\'$\' for help]');
        if (this.opts.driftOnReset) this.x += this.opts.driftOnReset;
        if (this.opts.faultOnReset) {
          this.locked = true;
          this.reply(`ALARM:${this.opts.faultOnReset}`);
        } else if (this.opts.homingLockout) {
          // No ALARM code: GRBL just refuses g-code until $X or $H.
          this.locked = true;
          this.reply("[MSG:'$H'|'$X' to unlock]");
        }
        continue;
      }
      // '!' feed hold and '~' cycle start are realtime too, and never buffered.
      if (ch === '!') { this.feedHolds++; continue; }
      if (ch === '~') { this.cycleStarts++; continue; }

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

      // `G10 L20 P1 X0 Y0` declares "the current position is this coordinate",
      // so the offset is whatever makes that true. It must be handled before
      // the motion parsing below, or the coordinates on the line would be read
      // as a move.
      // `G10 L2 P1` writes the offset itself, in machine coordinates — how a
      // remembered origin is put back after the controller lost its own.
      if (/^G10\s+L2\s+P1/.test(line)) {
        for (const m of line.matchAll(/([XYZ])(-?[\d.]+)/g)) {
          const v = parseFloat(m[2]);
          if (m[1] === 'X') this.offX = v;
          if (m[1] === 'Y') this.offY = v;
          if (m[1] === 'Z') this.offZ = v;
        }
        this.wcoDue = true;
        this.reply('ok');
        continue;
      }

      if (/^G10\s+L20\s+P1/.test(line)) {
        for (const m of line.matchAll(/([XYZ])(-?[\d.]+)/g)) {
          const want = parseFloat(m[2]);
          if (m[1] === 'X') this.offX = this.x - want;
          if (m[1] === 'Y') this.offY = this.y - want;
          if (m[1] === 'Z') this.offZ = this.z - want;
        }
        this.wcoDue = true;
        this.reply('ok');
        continue;
      }

      // G90/G91 are modal, and a retract is issued as a relative lift - reading
      // one as an absolute coordinate puts the simulated tool somewhere the real
      // machine would never be.
      if (/(^|\s)G90(\s|$)/.test(line)) this.relative = false;
      if (/(^|\s)G91(\s|$)/.test(line)) this.relative = true;

      for (const m of line.matchAll(/([XYZ])(-?[\d.]+)/g)) {
        const v = parseFloat(m[2]);
        if (m[1] === 'X') this.x = this.relative ? this.x + v : v;
        if (m[1] === 'Y') this.y = this.relative ? this.y + v : v;
        if (m[1] === 'Z') this.z = this.relative ? this.z + v : v;
      }

      if (line === '$X') {
        this.locked = false;
        this.reply('ok');
        continue;
      }
      if (this.locked) {
        // A locked controller refuses g-code with error:9.
        this.reply('error:9');
        continue;
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
        // The tool ends up at the contact point, which is where the G10 that
        // follows measures its offset from.
        this.z = z - 40;
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

// The work origin is remembered in localStorage, which node does not have.
// The shim is also what lets a "reopened tab" be simulated below: what survives
// the reload is exactly what is left in here.
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
};

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

// Z0 goes on the copper first, exactly as the operator is told to do it. The
// mesh is meaningless without it: [PRB:] is in machine coordinates, so a map
// is only "how far the copper sits from Z0" once there is a Z0 to measure it
// against.
await webSerialManager.jog({ x: 0, y: 0 });
await webSerialManager.zeroZOnSurface();
await new Promise(r => setTimeout(r, 400));

// Everything the mesh probe itself sends, with the zeroing above excluded so
// the per-point counts below stay exact.
const meshStart = fake.received.length;
const grid = await webSerialManager.probeSurfaceMesh({
  minX: 0, minY: 0, maxX: 60, maxY: 40, cols: 4, rows: 4,
});
const meshSent = fake.received.slice(meshStart);

const zs = grid.points.flat().map(p => p.z);
check('probed 16 points', zs.length === 16);
check('probe values are distinct', new Set(zs.map(z => z.toFixed(3))).size > 1, `${new Set(zs.map(z => z.toFixed(3))).size} distinct`);
check('the zeroed corner reads zero', Math.abs(grid.points[0][0].z) < 1e-9, `${grid.points[0][0].z}`);
check('machine-coord offset cancelled', Math.abs(getGridStats(grid).spanZ - 0.65) < 1e-6, `span ${getGridStats(grid).spanZ}`);
check('far corner picks up the tilt', Math.abs(grid.points[0][3].z - 0.6) < 1e-6, `${grid.points[0][3].z}`);
check('probe never overflowed', !fake.overflowed);

const probeLines = meshSent.filter(l => l.includes('G38.2'));
// One stab per point, plus a re-probe of the first point at the end. The mesh
// measures differences between points, so a double stab at every one of them
// would double the probe time to tighten a number the map barely depends on —
// the reading it does depend on is work Z0, which is double-stabbed.
check('one probe per point plus a verification re-probe', probeLines.length === 17, `${probeLines.length}`);
check(
  'the mesh reports the machine repeatability it measured',
  typeof grid.verifyDeviationMm === 'number',
  `${grid.verifyDeviationMm}`
);

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
for (const [i, line] of meshSent.entries()) {
  if (!line.includes('G38.2')) continue;
  const restored = meshSent.slice(i + 1, i + 3).some(l => /(^|\s)G90(\s|$)/.test(l));
  check(`G90 restored after probe ${i}`, restored, meshSent.slice(i, i + 3).join(' | '));
  break;
}
const retracts = meshSent.filter(l => /^G0 Z/.test(l));
check('retracts between points', retracts.length >= 16, `${retracts.length}`);

// Every probe must be preceded by a retract, or the bit drags across copper.
let dragged = false;
for (let i = 1; i < meshSent.length; i++) {
  if (/^G0 X/.test(meshSent[i]) && !/^G0 Z/.test(meshSent[i - 1])) dragged = true;
}
check('never travels without retracting first', !dragged);

// --- 2-i. The map is referenced to Z0, not to its own first probe ----------
// Zeroing Z somewhere other than the mesh corner is normal - the operator
// zeroes where the bit happens to be parked. Re-referencing the map to its own
// origin corner instead of to the Z0 plane biases every cut by the height
// difference between the two, which is a whole job cutting shallow (or into
// the board) on a warp of only a few tenths.
webSerialManager.forgetSavedZero();
await reconnect({ surface: x => 0.01 * x });
await webSerialManager.jog({ x: 60, y: 0 });
await webSerialManager.zeroZOnSurface();
await new Promise(r => setTimeout(r, 400));

const offCorner = await webSerialManager.probeSurfaceMesh({
  minX: 0, minY: 0, maxX: 60, maxY: 40, cols: 3, rows: 3,
});
check(
  'the point Z0 was set on reads zero',
  Math.abs(offCorner.points[0][2].z) < 1e-6,
  `${offCorner.points[0][2].z}`
);
check(
  'the low corner reads below Z0, not at it',
  Math.abs(offCorner.points[0][0].z + 0.6) < 1e-6,
  `${offCorner.points[0][0].z}`
);

// --- 2-ii. A map that is nowhere near Z0 is a wrong zero, not a warp -------
// No zeroing at all here: the readings come back ~40mm off the work plane.
webSerialManager.forgetSavedZero();
await reconnect({ surface: x => 0.01 * x });
let biasError = '';
try {
  await webSerialManager.probeSurfaceMesh({ minX: 0, minY: 0, maxX: 60, maxY: 40, cols: 3, rows: 3 });
} catch (e: any) {
  biasError = e?.message ?? '';
}
check('a map far off Z0 is refused', /work Z0/i.test(biasError), biasError || 'no error thrown');

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

// --- 2b-ii. Zeroing reports back that it actually took -------------------
// GRBL acknowledges `G10 L20` by return, which only says the line arrived.
// Zeroing was otherwise invisible: the button did something and the only
// evidence was the DRO changing, so an offset that never applied looked
// exactly like one that did.
await reconnect();
await webSerialManager.jog({ x: 12, y: 7 });
await webSerialManager.zeroXY();
check(
  'XY zeroing is pending before the machine reports back',
  webSerialManager.getState().zeroXYPending === true
);

// The next status poll carries the new work position.
await new Promise(r => setTimeout(r, 400));
check(
  'XY zeroing is confirmed once WPos reads the origin',
  webSerialManager.getState().zeroXYConfirmed === true,
  JSON.stringify(webSerialManager.getState().wpos)
);

// Plate probing sets Z to the plate thickness, not to nothing - waiting for a
// reported zero would never confirm it.
await webSerialManager.zeroZ(12);
await new Promise(r => setTimeout(r, 400));
check(
  'Z zeroing on a plate confirms against the plate thickness',
  webSerialManager.getState().zeroZConfirmed === true,
  `wpos.z=${webSerialManager.getState().wpos.z} target=${webSerialManager.getState().zeroZTargetMm}`
);

// Moving invalidates the confirmation: it described where the machine was.
await webSerialManager.jog({ x: 5 });
check(
  'jogging clears the standing confirmation',
  webSerialManager.getState().zeroXYConfirmed === false &&
  webSerialManager.getState().zeroZConfirmed === false
);

// --- 2b-iii. The zeros outlive the tab ----------------------------------
// A tab closed mid-job used to take the only record of the work origin with
// it: the machine still held its offsets, but nothing on screen said where
// zero was, and re-zeroing by eye does not land back on the same spot.
await reconnect();
await webSerialManager.jog({ x: 12, y: 7 });
await webSerialManager.zeroXY();
await new Promise(r => setTimeout(r, 400));
await webSerialManager.zeroZ(12);
await new Promise(r => setTimeout(r, 400));

const remembered = JSON.parse(store.get('grblWorkOrigin') || '{}');
check(
  'the work origin is written down, in machine coordinates',
  Math.abs(remembered.x - 12) < 1e-6 && Math.abs(remembered.y - 7) < 1e-6,
  JSON.stringify(remembered)
);
check(
  'the Z origin is remembered alongside XY, not instead of it',
  typeof remembered.z === 'number' && remembered.zTargetMm === 12,
  JSON.stringify(remembered)
);

// Zeroing one axis pair must not wipe the other: they are set by separate
// steps, and losing Z0 to an XY re-zero is a plunge to the wrong depth.
await webSerialManager.zeroXY();
await new Promise(r => setTimeout(r, 400));
check(
  'a later XY zero keeps the remembered Z',
  typeof JSON.parse(store.get('grblWorkOrigin')!).z === 'number',
  store.get('grblWorkOrigin')!
);

// A controller that came back up without its offsets — a power cycle between
// sessions — is handed them back on connect, without being asked. That is the
// whole point: the zeros stay where they were until someone sets them again.
const savedBefore = webSerialManager.getState().savedZero!;
await reconnect();
await new Promise(r => setTimeout(r, 400));
check(
  'a lost work origin is written back on connect',
  fake.received.some(l => /^G10 L2 P1 X12\.000 Y7\.000/.test(l)),
  fake.received.filter(l => l.startsWith('G10')).join(' | ')
);
check('and it is reported as restored', webSerialManager.getState().zeroRestored === true);
await new Promise(r => setTimeout(r, 400));
check(
  'the machine works to the remembered origin again',
  Math.abs(webSerialManager.getState().workOffset!.x - 12) < 1e-6,
  JSON.stringify(webSerialManager.getState().workOffset)
);
check(
  'restoring did not move the origin',
  Math.abs(webSerialManager.getState().savedZero!.x! - savedBefore.x!) < 1e-6
);

// A machine that already agrees is left alone — writing offsets it already has
// is a chance to get them wrong for nothing.
const beforeIdle = fake.received.filter(l => /^G10 L2/.test(l)).length;
await new Promise(r => setTimeout(r, 400));
check(
  'a machine that already agrees is not written to',
  fake.received.filter(l => /^G10 L2/.test(l)).length === beforeIdle,
  `${beforeIdle} -> ${fake.received.filter(l => /^G10 L2/.test(l)).length}`
);

// Re-zeroing by hand is the operator's answer and is never written over.
await webSerialManager.jog({ x: 3 });
await webSerialManager.zeroXY();
await new Promise(r => setTimeout(r, 400));
check(
  'a manual re-zero replaces the remembered origin',
  Math.abs(JSON.parse(store.get('grblWorkOrigin')!).x - 3) < 1e-6,
  store.get('grblWorkOrigin')!
);

webSerialManager.forgetSavedZero();
check('forgetting clears it for good', !store.has('grblWorkOrigin') &&
  webSerialManager.getState().savedZero === undefined);

// --- 2b-iv. A stock GRBL reports MPos and WCO, never WPos -----------------
// $10=1 is the factory default, and in that mode a status report carries MPos
// plus a WCO every dozen-or-so reports. Reading the work offset as
// `MPos - WPos` off such a report subtracts a value that never updates, so the
// "offset" tracks the tool instead of the origin. Every consequence of that is
// destructive: a pending Z zero confirms against a WPos of 0 before the probe
// has even touched, the bogus offset gets written down as the remembered
// origin, and on the next connect it is handed back to the controller with a
// `G10 L2` that moves work zero to somewhere the tool once happened to be.
await reconnect({ reportMode: 'mpos', surface: () => 0 });
await new Promise(r => setTimeout(r, 400));
check(
  'the work offset is read from WCO',
  webSerialManager.getState().workOffset !== undefined,
  JSON.stringify(webSerialManager.getState().workOffset)
);

await webSerialManager.jog({ x: 12, y: 7 });
await webSerialManager.zeroXY();
await new Promise(r => setTimeout(r, 400));
check(
  'XY zeroing confirms without a WPos on the wire',
  webSerialManager.getState().zeroXYConfirmed === true,
  JSON.stringify(webSerialManager.getState())
);
check(
  'and the remembered origin is the real one',
  Math.abs(JSON.parse(store.get('grblWorkOrigin')!).x - 12) < 1e-6,
  store.get('grblWorkOrigin')!
);

// The tool is nowhere near the origin, which is exactly the state the old
// `MPos - WPos` read would have mistaken for a lost zero.
await webSerialManager.jog({ x: 40, y: 30 });
const l2Before = fake.received.filter(l => /^G10 L2 /.test(l)).length;
await new Promise(r => setTimeout(r, 600));
check(
  'a machine that still holds its zero is not rewritten',
  fake.received.filter(l => /^G10 L2 /.test(l)).length === l2Before,
  fake.received.filter(l => l.startsWith('G10')).join(' | ')
);
check(
  'and the origin has not moved',
  Math.abs(webSerialManager.getState().workOffset!.x - 12) < 1e-6,
  JSON.stringify(webSerialManager.getState().workOffset)
);

// Zeroing Z on the copper, then mapping the board, in MPos-only mode.
await webSerialManager.zeroZOnSurface();
await new Promise(r => setTimeout(r, 400));
check(
  'Z zeroing confirms against a derived WPos',
  webSerialManager.getState().zeroZConfirmed === true,
  `wpos.z=${webSerialManager.getState().wpos.z}`
);

const mposGrid = await webSerialManager.probeSurfaceMesh({
  minX: 0, minY: 0, maxX: 60, maxY: 40, cols: 3, rows: 3,
});
check(
  'the heightmap is still referenced to Z0',
  mposGrid.points.flat().every(pt => Math.abs(pt.z) < 1e-6),
  JSON.stringify(mposGrid.points.flat().map(pt => pt.z))
);

webSerialManager.forgetSavedZero();

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

// --- 2d. Restarting a layer rewinds to its tool change ------------------
// Restart is offered from the live progress view, mid-cut. It abandons the
// operation in flight and re-runs it from its first line — which is that
// layer's own `T<n> M6`, so the tool-change prompt comes back up with its
// re-zero controls before anything is re-cut. That prompt is the point: it is
// the step that got skipped.
await reconnect();
const twoLayers = [
  'M3 S12000',
  '; OP 1/2: Isolation routing',
  'T1 M6',
  'G1 X1.000',
  'G1 X2.000',
  '; OP 2/2: Through-hole drilling',
  'T2 M6',
  'G1 X9.000',
].join('\n');
await webSerialManager.startJob(twoLayers);
check('paused at the first tool change', webSerialManager.getState().status === 'PAUSED_TOOL', webSerialManager.getState().status);
check('current layer is the one being entered', webSerialManager.getCurrentLayer()?.label === 'Isolation routing', `${webSerialManager.getCurrentLayer()?.label}`);

// Resume into the first layer, then restart it while it is the live one.
await webSerialManager.resumeJob();
check('reached the second tool change', webSerialManager.getState().status === 'PAUSED_TOOL', webSerialManager.getState().status);
check('now cutting the second layer', webSerialManager.getCurrentLayer()?.label === 'Through-hole drilling', `${webSerialManager.getCurrentLayer()?.label}`);

const cutsBefore = fake.received.filter(l => l === 'G1 X1.000').length;

// The second tool change is a real bit change, and the bit that goes in is a
// different length — so resuming on the old work Z0 is refused. Nothing below
// is about that policy, so it is asserted once here and then overridden.
let refused = '';
try {
  await webSerialManager.resumeJob();
} catch (e: any) {
  refused = e.message;
}
check('resuming a bit change without re-zeroing is refused', refused.includes('re-zeroed'), refused || '(allowed)');
check('and the job is still sitting at the pause', webSerialManager.getState().status === 'PAUSED_TOOL', webSerialManager.getState().status);

await webSerialManager.resumeJob({ toolLengthUnchanged: true });
check('job finished', webSerialManager.getState().status === 'IDLE', webSerialManager.getState().status);

// Now run it again and restart the *live* layer part-way through.
await reconnect();
await webSerialManager.startJob(twoLayers);
await webSerialManager.resumeJob(); // past T1, cuts layer 1, stops at T2
const beforeRestart = fake.received.filter(l => l === 'G1 X9.000').length;
await webSerialManager.restartCurrentLayer();

check(
  'a restart lands back on the layer tool change',
  webSerialManager.getState().status === 'PAUSED_TOOL',
  webSerialManager.getState().status
);
check(
  'and it is THIS layer tool change, not the previous one',
  (webSerialManager.getState().pauseMessage || '').includes('T2 M6'),
  webSerialManager.getState().pauseMessage || '(none)'
);
// The planner has to be flushed, or the rest of the abandoned layer runs on
// the next cycle start. Only a soft reset does that.
check('the planner was flushed with a soft reset', fake.softResets > 0, `${fake.softResets}`);
check('a feed hold preceded the reset', fake.feedHolds > 0, `${fake.feedHolds}`);
check('nothing was re-cut before the prompt', fake.received.filter(l => l === 'G1 X9.000').length === beforeRestart, 'lines ran before the tool-change prompt');
check('progress rewound to the layer start', (webSerialManager.getState().progressPercent ?? 100) < 100);

// A reset stops the spindle, and the spindle-up line lives in the program
// header far behind this layer — so it would never be replayed. It is re-sent
// on resume, not before, so it is never turning during a bit change.
const spindleBefore = fake.received.filter(l => l === 'M3 S12000').length;
await webSerialManager.resumeJob({ toolLengthUnchanged: true });
check('the spindle is restarted on resume', fake.received.filter(l => l === 'M3 S12000').length === spindleBefore + 1, `${spindleBefore}`);
check('the layer is cut again', fake.received.filter(l => l === 'G1 X9.000').length > beforeRestart);
check('job completes after a restart', webSerialManager.getState().status === 'IDLE', webSerialManager.getState().status);
void cutsBefore;

// --- 2e. A restart recovers the controller by itself -----------------------
// With homing required ($22=1) GRBL boots into a locked Alarm after EVERY
// reset, including the deliberate one a restart performs. That lock is not a
// fault and must not cost the operator the whole board.
await reconnect({ homingLockout: true });
await webSerialManager.startJob(twoLayers);
await webSerialManager.resumeJob(); // past T1, cut layer 1, stop at T2
await webSerialManager.restartCurrentLayer();
check(
  'the homing lockout is cleared automatically',
  fake.received.includes('$X'),
  fake.received.slice(-6).join(' | ')
);
check(
  'the job survives the lockout and reaches its tool change',
  webSerialManager.getState().status === 'PAUSED_TOOL',
  `${webSerialManager.getState().status} — ${webSerialManager.getState().lastError || ''}`
);
await webSerialManager.resumeJob({ toolLengthUnchanged: true });
check('job completes after an auto-unlock', webSerialManager.getState().status === 'IDLE', webSerialManager.getState().status);

// A *coded* alarm is the opposite case: a limit trip or a reset mid-motion,
// where position is genuinely suspect. That must NOT be auto-unlocked.
await reconnect({ faultOnReset: 1 });
await webSerialManager.startJob(twoLayers);
await webSerialManager.resumeJob();
let restartErr = '';
try {
  await webSerialManager.restartCurrentLayer();
} catch (e: any) {
  restartErr = e.message;
}
check('a real fault is not silently unlocked', !fake.received.includes('$X'), fake.received.slice(-4).join(' | '));
check('a real fault stops the job', restartErr.includes('position'), restartErr || '(no error)');
check('and says how to recover', restartErr.includes('$H'), restartErr || '(no error)');

// Lost position is caught even when the controller never says so.
await reconnect({ driftOnReset: 5 });
await webSerialManager.startJob(twoLayers);
await webSerialManager.resumeJob();
let driftErr = '';
try {
  await webSerialManager.restartCurrentLayer();
} catch (e: any) {
  driftErr = e.message;
}
check('silent position loss is caught', driftErr.includes('lost'), driftErr || '(no error)');
check('and the job is not left running', webSerialManager.getState().status !== 'RUNNING', webSerialManager.getState().status);

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
