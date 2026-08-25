/**
 * Cuts a whole board, end to end, against a simulated machine and a simulated
 * piece of stock — no CNC, no copper, no wasted blanks.
 *
 * The other tests check the pieces: that the g-code says what it should, that
 * the transport does not overflow, that the mesh maths cancels. None of them
 * answers the only question that matters at the bench: after streaming this
 * program to a machine standing over a *warped* board, where did the bit
 * actually go? So this one models the stock as a physical surface, tracks the
 * tool tip through every move the controller executes (interpolated, not just
 * at the endpoints), and reports what got cut, what got missed, and what got
 * dragged through.
 *
 * Run with: npx tsx src/test_full_cut_simulation.ts
 */

import { generatePcbLayout, DEFAULT_PCB_OPTIONS, type PcbOptions } from './utils/pcbExporter';
import {
  findUnwarpableCommands,
  suggestProbeGrid,
  getGridStats,
  interpolateGridZ,
  type ProbeGrid,
} from './utils/meshLeveler';
import {
  PCB_TOOL_PRESETS,
  PCB_MATERIAL_PRESETS,
  autoIsolationDepthMm,
  isolationFlatnessAllowanceMm,
} from './utils/pcbTooling';
import { timer555Blink } from './utils/presets';

let fails = 0;
const failures: string[] = [];
/**
 * The manager registers its probe waiter before sending the probe, but only
 * attaches a handler when it awaits it — so a [PRB:…:0] that arrives in the
 * same chunk as its `ok` rejects a promise nobody is listening to yet. A
 * browser logs that; node kills the process. Collected rather than ignored.
 */
const unhandled: string[] = [];
declare const process: { on(ev: string, cb: (e: any) => void): void };
process.on('unhandledRejection', (e: any) => unhandled.push(e?.message ?? String(e)));
/**
 * Something worth knowing that is not a defect: a margin thinner than it looks,
 * or the price of an operator skipping a step. Printed, never fatal.
 */
function warn(name: string, cond: boolean, detail = '') {
  if (!cond) console.log(`  WARN  ${name}  ${detail}`);
  else console.log(`  ok    ${name}`);
}

function check(name: string, cond: boolean, detail = '') {
  if (!cond) {
    fails++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  }
  console.log(`${cond ? '  ok  ' : '!!FAIL'} ${name}${cond ? '' : `  ${detail}`}`);
}

// --- The stock -------------------------------------------------------------

/** Machine Z of the spoilboard-mounted blank's copper face, before warp. */
const SURFACE_BASE_MZ = -30;
/** Where the board's own origin sits in machine coordinates. */
const BOARD_MX = -100;
const BOARD_MY = -80;

const COPPER_MM = 0.035;
const FR4_MM = 1.6;

/**
 * A real 1.6mm blank clamped at the corners: a diagonal tilt from imperfect
 * spoilboard flatness plus a shallow dish in the middle. ±0.15mm or so, which
 * is exactly the range where an uncompensated 0.16mm isolation cut either
 * misses the copper or buries the bit in the substrate.
 */
function warpMm(bx: number, by: number): number {
  return (
    0.0018 * bx - 0.0011 * by - 0.09 * Math.sin((Math.PI * bx) / 55) * Math.sin((Math.PI * by) / 40)
  );
}

/** Machine Z of the copper face at a machine XY. */
function surfaceMz(mx: number, my: number): number {
  return SURFACE_BASE_MZ + warpMm(mx - BOARD_MX, my - BOARD_MY);
}

/** Tool geometry: swapping a bit moves the tip relative to the spindle nose. */
const TOOL_LENGTHS: Record<string, number> = {
  T1: 0, // V-bit, the one Z0 is first set with
  T2: 4.2, // drill, sticks out further
  T3: 3.1,
  T99: -2.6, // end mill, shorter
};

interface MotionSample {
  kind: 'G0' | 'G1';
  bx: number;
  by: number;
  /** How far the tip is below the copper face at this point, in mm. */
  depth: number;
  /** Work Z the controller was told to be at, so error = depth + cmdZ. */
  cmdZ: number;
  /** True when the tip moved in XY at this sample. */
  moving: boolean;
  spindleOn: boolean;
  tool: string;
  line: string;
  index: number;
}

interface FakeCncOptions {
  /** Ignore the probe entirely and report a flat surface (control runs). */
  flatSurface?: boolean;
}

const GRBL_BUFFER = 128;

class FakeCnc {
  public received: string[] = [];
  public overflowed = false;
  public samples: MotionSample[] = [];
  public spindleOn = false;
  public tool = 'T1';

  /** Machine axis position. The tip sits toolLen below the axis reference. */
  private x = BOARD_MX;
  private y = BOARD_MY;
  /** Parked a few mm over the stock, as a machine is before a job. */
  private z = SURFACE_BASE_MZ + 5;
  private offX = 0;
  private offY = 0;
  private offZ = 0;
  private wcoDue = false;
  private relative = false;
  private occupied = 0;
  private pending: string[] = [];
  private partial = '';
  private draining = false;
  private statusPolls = 0;
  private controller!: ReadableStreamDefaultController<Uint8Array>;

  public readable: ReadableStream<Uint8Array>;
  public writable: WritableStream<Uint8Array>;

  private opts: FakeCncOptions;

  constructor(opts: FakeCncOptions = {}) {
    this.opts = opts;
    this.readable = new ReadableStream<Uint8Array>({ start: c => (this.controller = c) });
    this.writable = new WritableStream<Uint8Array>({
      write: chunk => this.onBytes(new TextDecoder().decode(chunk)),
    });
  }

  private get toolLen() {
    return TOOL_LENGTHS[this.tool] ?? 0;
  }

  /** Machine Z of the cutting tip. */
  private tipMz() {
    return this.z - this.toolLen;
  }

  public changeTool(t: string) {
    this.tool = t;
  }

  private reply(text: string) {
    this.controller.enqueue(new TextEncoder().encode(text + '\r\n'));
  }

  private onBytes(text: string) {
    for (const ch of text) {
      if (ch === '?') {
        this.statusPolls++;
        const withWco = this.wcoDue || this.statusPolls % 8 === 1;
        this.wcoDue = false;
        this.reply(
          `<Idle|MPos:${this.x.toFixed(3)},${this.y.toFixed(3)},${this.z.toFixed(3)}` +
            (withWco
              ? `|WCO:${this.offX.toFixed(3)},${this.offY.toFixed(3)},${this.offZ.toFixed(3)}`
              : '') +
            '>'
        );
        continue;
      }
      if (ch === '\x18') {
        this.occupied = 0;
        this.pending = [];
        this.partial = '';
        this.reply("Grbl 1.1f ['$' for help]");
        continue;
      }
      if (ch === '!' || ch === '~') continue;

      this.occupied++;
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

  /**
   * Walks the tool from where it is to where the line says, sampling the tip
   * against the stock as it goes. Endpoint-only checking would miss the whole
   * class of failure this simulation exists for: a move that starts and ends
   * clear but ploughs through the middle of a bowed board.
   */
  private travel(kind: 'G0' | 'G1', tx: number, ty: number, tz: number, line: string, index: number) {
    const dist = Math.max(Math.hypot(tx - this.x, ty - this.y), Math.abs(tz - this.z));
    const steps = Math.max(1, Math.ceil(dist / 0.1));
    const x0 = this.x;
    const y0 = this.y;
    const z0 = this.z;
    const movingXY = Math.hypot(tx - x0, ty - y0) > 1e-9;

    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const mx = x0 + (tx - x0) * t;
      const my = y0 + (ty - y0) * t;
      const mz = z0 + (tz - z0) * t;
      const tip = mz - this.toolLen;
      this.samples.push({
        kind,
        bx: mx - BOARD_MX,
        by: my - BOARD_MY,
        depth: surfaceMz(mx, my) - tip,
        cmdZ: mz - this.offZ,
        moving: movingXY,
        spindleOn: this.spindleOn,
        tool: this.tool,
        line,
        index,
      });
    }

    this.x = tx;
    this.y = ty;
    this.z = tz;
  }

  private async drain() {
    if (this.draining) return;
    this.draining = true;

    while (this.pending.length > 0) {
      const line = this.pending.shift()!;
      await new Promise(r => setTimeout(r, 0));

      const index = this.received.length;
      this.received.push(line);
      this.occupied -= line.length + 1;

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

      if (/\bM3\b|\bM4\b/.test(line)) this.spindleOn = true;
      if (/\bM5\b/.test(line)) this.spindleOn = false;

      if (/(^|\s)G90(\s|$)/.test(line)) this.relative = false;
      if (/(^|\s)G91(\s|$)/.test(line)) this.relative = true;

      if (line.includes('G38.2')) {
        // A probe travels down by the commanded distance, stopping at contact.
        const m = /Z(-?[\d.]+)/.exec(line);
        const travel = m ? Math.abs(parseFloat(m[1])) : 0;
        const surf = this.opts.flatSurface ? SURFACE_BASE_MZ : surfaceMz(this.x, this.y);
        const contactAxis = surf + this.toolLen;
        // Descending onto the face is a touch. Starting from *below* it is not:
        // the tip is already buried, so there is nothing left above it to find
        // and the probe simply drills its whole search distance.
        if (this.z > contactAxis && this.z - travel <= contactAxis) {
          this.travel('G1', this.x, this.y, contactAxis, line, index);
          this.reply(`[PRB:${this.x.toFixed(3)},${this.y.toFixed(3)},${this.z.toFixed(3)}:1]`);
        } else {
          this.travel('G1', this.x, this.y, this.z - travel, line, index);
          this.reply(`[PRB:${this.x.toFixed(3)},${this.y.toFixed(3)},${this.z.toFixed(3)}:0]`);
        }
        this.reply('ok');
        continue;
      }

      // A jog is a relative $J move. Ignoring it would leave the simulated
      // machine standing still while the code under test believes it moved —
      // and re-zeroing depends on where the tool actually is.
      const jog = /^\$J=/.test(line);
      if (jog) {
        let jx = this.x;
        let jy = this.y;
        let jz = this.z;
        for (const m of line.matchAll(/([XYZ])(-?[\d.]+)/g)) {
          const v = parseFloat(m[2]);
          if (m[1] === 'X') jx += v;
          if (m[1] === 'Y') jy += v;
          if (m[1] === 'Z') jz += v;
        }
        this.travel('G0', jx, jy, jz, line, index);
        this.reply('ok');
        continue;
      }

      const cmd = /^G0*([01])(\s|$)/.exec(line);
      if (cmd) {
        let tx = this.x;
        let ty = this.y;
        let tz = this.z;
        for (const m of line.matchAll(/([XYZ])(-?[\d.]+)/g)) {
          const v = parseFloat(m[2]);
          const abs = this.relative ? null : v;
          if (m[1] === 'X') tx = abs === null ? this.x + v : abs + this.offX;
          if (m[1] === 'Y') ty = abs === null ? this.y + v : abs + this.offY;
          if (m[1] === 'Z') tz = abs === null ? this.z + v : abs + this.offZ;
        }
        this.travel(cmd[1] === '0' ? 'G0' : 'G1', tx, ty, tz, line, index);
      }

      this.reply('ok');
    }

    this.draining = false;
  }

  /** Work-coordinate position of the tool tip, as the UI would show it. */
  public workPos() {
    return { x: this.x - this.offX, y: this.y - this.offY, z: this.z - this.offZ };
  }
  public machineXY() {
    return { x: this.x, y: this.y };
  }
  public tipDepthHere() {
    return surfaceMz(this.x, this.y) - this.tipMz();
  }
}

// --- Wire the manager to the fake machine ----------------------------------

let cnc: FakeCnc;
function installFake(opts: FakeCncOptions = {}) {
  cnc = new FakeCnc(opts);
  (globalThis as any).navigator = {
    serial: {
      requestPort: async () => ({
        open: async () => {},
        close: async () => {},
        readable: cnc.readable,
        writable: cnc.writable,
      }),
    },
  };
  return cnc;
}

const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
};

installFake();
const { webSerialManager } = await import('./utils/webSerialManager');

// --- The board -------------------------------------------------------------

const vbit = PCB_TOOL_PRESETS.find(t => t.id === 't1_vbit_30')!;
const fr4 = PCB_MATERIAL_PRESETS.find(m => m.id === 'fr4_1oz')!;

/** Options as the export modal assembles them, before any probe has run. */
function optionsWithSpan(spanZ?: number): PcbOptions {
  return {
    ...DEFAULT_PCB_OPTIONS,
    routingBudgetMs: 4000,
    isolationDepthZ: autoIsolationDepthMm(vbit, fr4, isolationFlatnessAllowanceMm(spanZ)),
  };
}

console.log('Routing the board…');
let options = optionsWithSpan(undefined);
let layout = generatePcbLayout(timer555Blink.nodes as any, timer555Blink.edges as any, options);

check('the board routes', layout.success, layout.error || `${layout.violations.length} violations`);
console.log(
  `  board ${layout.boardWidthMm.toFixed(2)} x ${layout.boardHeightMm.toFixed(2)}mm, ` +
    `${layout.drills.length} holes, ${layout.isolationPaths.length} isolation paths, ` +
    `depth Z${options.isolationDepthZ.toFixed(3)}`
);

check(
  'nothing in the program defeats the height map',
  findUnwarpableCommands(layout.gcode).length === 0,
  findUnwarpableCommands(layout.gcode).join(', ')
);

// --- 1. Set the zeros, exactly as the operator is told to ------------------

await webSerialManager.connect();
webSerialManager.forgetSavedZero();

// XY zero at the board origin corner, where the machine is already parked.
await webSerialManager.zeroXY();
await new Promise(r => setTimeout(r, 300));

// Z zero on the copper, with the V-bit, at the same corner.
await webSerialManager.zeroZOnSurface();
await new Promise(r => setTimeout(r, 300));
check('Z zero is confirmed on the copper', webSerialManager.getState().zeroZConfirmed === true);

// --- 2. Probe the mesh the modal would probe -------------------------------

const grid0 = suggestProbeGrid(layout.boardWidthMm, layout.boardHeightMm, 4, 8);
let heightmap: ProbeGrid = await webSerialManager.probeSurfaceMesh({
  minX: layout.boardOriginMm,
  minY: layout.boardOriginMm,
  maxX: layout.boardOriginMm + layout.boardWidthMm,
  maxY: layout.boardOriginMm + layout.boardHeightMm,
  cols: grid0.cols,
  rows: grid0.rows,
  probeDepthMm: 3,
  clearanceMm: options.safeZ,
});

const span = getGridStats(heightmap).spanZ;
console.log(`  probed ${grid0.cols}x${grid0.rows}, span ${span.toFixed(3)}mm`);
check(
  'the probe measured the real warp',
  Math.abs(span - realSpan()) < realSpan() * 0.25,
  `${span.toFixed(3)} vs ${realSpan().toFixed(3)} actually present`
);

/** The warp actually present over the probed area, for comparison. */
function realSpan() {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i <= 40; i++) {
    for (let j = 0; j <= 40; j++) {
      const bx = layout.boardOriginMm + (layout.boardWidthMm * i) / 40;
      const by = layout.boardOriginMm + (layout.boardHeightMm * j) / 40;
      const w = warpMm(bx, by) - warpMm(layout.boardOriginMm, layout.boardOriginMm);
      lo = Math.min(lo, w);
      hi = Math.max(hi, w);
    }
  }
  return hi - lo;
}

// The modal re-derives the isolation depth once the flatness is known, which
// re-routes the board. Do the same, then re-check the map still covers it.
options = optionsWithSpan(span);
layout = generatePcbLayout(timer555Blink.nodes as any, timer555Blink.edges as any, options);
console.log(
  `  after auto-depth: board ${layout.boardWidthMm.toFixed(2)} x ${layout.boardHeightMm.toFixed(2)}mm, ` +
    `depth Z${options.isolationDepthZ.toFixed(3)}`
);
check(
  'the freshly probed map still covers the board it was probed for',
  heightmap.maxX >= layout.boardOriginMm + layout.boardWidthMm - 1 &&
    heightmap.maxY >= layout.boardOriginMm + layout.boardHeightMm - 1,
  `mesh ${heightmap.maxX.toFixed(2)}x${heightmap.maxY.toFixed(2)} vs board ` +
    `${(layout.boardOriginMm + layout.boardWidthMm).toFixed(2)}x` +
    `${(layout.boardOriginMm + layout.boardHeightMm).toFixed(2)}`
);

// --- 3. Cut the board ------------------------------------------------------

const warped = webSerialManager.applyHeightmapToGcode(layout.gcode, heightmap);

/**
 * Runs the job to completion, answering every tool-change pause the way the
 * operator would: swap the bit, re-zero Z on the copper, resume.
 */
interface ToolChange {
  tool: string;
  /** Headroom over the copper with the old bit still fitted, in mm. */
  clearBefore: number;
  /** Headroom once the new bit is in the collet. Negative means buried. */
  clearAfter: number;
  /** Whether the spindle was still turning while the bit was swapped. */
  spinning: boolean;
}
let toolChanges: ToolChange[] = [];
/** Re-zeroing failures hit at a tool change, in order. */
const zeroErrors: string[] = [];
const allZeroErrors: string[] = [];

async function runJob(
  gcode: string,
  reZero: boolean,
  reZeroAt?: { x: number; y: number }
) {
  toolChanges = [];
  await webSerialManager.startJob(gcode);
  let guard = 0;
  while (webSerialManager.getState().status === 'PAUSED_TOOL' && guard++ < 20) {
    const msg = webSerialManager.getState().pauseMessage || '';
    const t = /\b(T\d+)\b/.exec(msg)?.[1];

    // How much room there is over the stock at the moment the operator is
    // asked to put a different bit in the collet.
    const clearBefore = -cnc.tipDepthHere();
    if (t) cnc.changeTool(t);
    toolChanges.push({
      tool: t ?? '?',
      clearBefore,
      clearAfter: -cnc.tipDepthHere(),
      spinning: cnc.spindleOn,
    });

    if (reZero) {
      // Without reZeroAt, the operator re-zeroes where the bit happens to be
      // parked — which is wherever the last operation left it, not the corner
      // the height map is referenced to.
      zeroErrors.length = 0;
      if (reZeroAt) {
        const at = cnc.machineXY();
        await webSerialManager.jog({
          x: BOARD_MX + reZeroAt.x - at.x,
          y: BOARD_MY + reZeroAt.y - at.y,
        });
        await new Promise(r => setTimeout(r, 100));
      }
      try {
        // Exactly what the pause dialog does: hand the probe the map's reading
        // at wherever the tool is standing, so Z0 lands on the map's plane
        // rather than on the local high or low spot.
        const w = cnc.workPos();
        await webSerialManager.zeroZOnSurface(interpolateGridZ(heightmap, w.x, w.y));
      } catch (e: any) {
        // A re-zero that cannot run is the operator's problem, not the rig's:
        // record it and carry on, exactly as pressing Resume anyway would.
        zeroErrors.push(`${t}: ${e?.message ?? e}`);
        allZeroErrors.push(`${t}: ${e?.message ?? e}`);
      }
      await new Promise(r => setTimeout(r, 200));
    }
    await webSerialManager.resumeJob();
  }
  return webSerialManager.getState();
}

console.log('Cutting (levelled)…');
const finalState = await runJob(warped, true);
check('the job ran to completion', finalState.status === 'IDLE', `${finalState.status} ${finalState.lastError || ''}`);
check('the controller never overflowed', !cnc.overflowed);
check('the spindle is off at the end', !cnc.spindleOn);


// --- 4. Inspect what was cut ----------------------------------------------
//
// Every sample carries both where the tip really was against the copper and
// what work Z the controller had been told to hold. An ideal machine over an
// ideally levelled board cuts `depth === -cmdZ` everywhere; the difference is
// the whole error budget of the levelling pipeline, and it is what decides
// whether a trace isolates or a board comes free of its tabs.

/**
 * The Z the *program* asked for, before levelling. Subtracting the map back
 * out is what makes a sample classifiable: "commanded -0.055" is the isolation
 * pass wherever it appears on the board, while the warped Z on the wire is a
 * different number at every point.
 */
function nominalZ(s: MotionSample, levelled: boolean): number {
  return levelled ? s.cmdZ - interpolateGridZ(heightmap, s.bx, s.by) : s.cmdZ;
}

/** How far the cut is from what the program asked for. Zero is perfect. */
function depthError(s: MotionSample, levelled: boolean): number {
  return s.depth + nominalZ(s, levelled);
}

interface DepthStats {
  n: number;
  minDepth: number;
  maxDepth: number;
  minErr: number;
  maxErr: number;
}

function stats(list: MotionSample[], levelled: boolean): DepthStats {
  const d = list.map(s => s.depth);
  const e = list.map(s => depthError(s, levelled));
  return {
    n: list.length,
    minDepth: Math.min(...d),
    maxDepth: Math.max(...d),
    minErr: Math.min(...e),
    maxErr: Math.max(...e),
  };
}

function report(label: string, st: DepthStats) {
  console.log(
    `  ${label.padEnd(20)} ${String(st.n).padStart(6)} samples  ` +
      `depth ${st.minDepth.toFixed(3)}..${st.maxDepth.toFixed(3)}mm  ` +
      `error ${st.minErr >= 0 ? '+' : ''}${st.minErr.toFixed(3)}..` +
      `${st.maxErr >= 0 ? '+' : ''}${st.maxErr.toFixed(3)}mm`
  );
}

function analyse(
  label: string,
  samples: MotionSample[],
  opts: { strict: boolean; levelled: boolean }
) {
  console.log(`\n${label}: ${samples.length} motion samples`);
  const lv = opts.levelled;
  const at = (s: MotionSample, z: number) => Math.abs(nominalZ(s, lv) - z) < 1e-3;

  const engaged = samples.filter(s => s.depth > COPPER_MM * 0.5);
  // Only the moves that actually cut: held at the operation's own depth and
  // travelling in XY. Plunges and retracts pass through the same Z values and
  // would drag the statistics somewhere meaningless.
  const iso = samples.filter(
    s => s.tool === 'T1' && s.kind === 'G1' && s.moving && at(s, options.isolationDepthZ)
  );
  const drill = samples.filter(
    s => s.tool !== 'T1' && s.tool !== 'T99' && s.kind === 'G1' && s.depth > 0.05
  );
  const profile = samples.filter(s => s.tool === 'T99' && s.kind === 'G1' && s.moving && s.depth > 0.05);

  if (iso.length) report('isolation', stats(iso, lv));
  if (drill.length) report('drilling', stats(drill, lv));
  if (profile.length) report('profile', stats(profile, lv));

  // --- Isolation: the copper has to be severed along every path -----------
  if (iso.length && opts.strict) {
    const st = stats(iso, lv);
    check(
      `${label}: every isolation cut severs the copper`,
      st.minDepth >= COPPER_MM,
      `shallowest ${st.minDepth.toFixed(4)}mm vs ${COPPER_MM}mm of foil`
    );
    warn(
      `${label}: isolation keeps a working margin over the foil`,
      st.minDepth >= COPPER_MM * 1.5,
      `only ${(st.minDepth - COPPER_MM).toFixed(4)}mm of margin — a board any worse than the ` +
        `simulated ${realSpan().toFixed(3)}mm warp leaves traces shorted`
    );
  }

  // --- Rapids must never be in the material -------------------------------
  const drags = samples.filter(s => s.kind === 'G0' && s.moving && s.depth > 0.01);
  (opts.strict ? check : warn)(
    `${label}: no rapid travels through the stock`,
    drags.length === 0,
    drags.length
      ? `${drags.length} samples, first at ${drags[0]!.bx.toFixed(2)},${drags[0]!.by.toFixed(2)} ` +
        `${drags[0]!.depth.toFixed(3)}mm deep on "${drags[0]!.line}"`
      : ''
  );

  const dead = engaged.filter(s => !s.spindleOn);
  check(
    `${label}: nothing is cut with the spindle stopped`,
    dead.length === 0,
    dead.length ? `${dead.length} samples, first on "${dead[0]!.line}"` : ''
  );

  // --- Drilling has to break through --------------------------------------
  if (drill.length && opts.strict) {
    const st = stats(drill, lv);
    check(
      `${label}: drilling breaks through the laminate`,
      st.maxDepth >= FR4_MM,
      `deepest ${st.maxDepth.toFixed(3)}mm vs ${FR4_MM}mm`
    );
    check(
      `${label}: drilling does not bury itself in the spoilboard`,
      st.maxDepth < FR4_MM + 0.5,
      `${st.maxDepth.toFixed(3)}mm`
    );
  }

  // --- The profile has to part the board everywhere but the tabs ----------
  if (profile.length && opts.strict) {
    // The final pass is the one commanded to full profile depth; the tab lifts
    // inside it are commanded shallower, which is exactly how they are told
    // apart without re-deriving the geometry.
    const tabZ = Math.min(0, options.profileDepthZ + Math.abs(options.tabHeightMm));
    const full = profile.filter(s => at(s, options.profileDepthZ));
    const tabbed = profile.filter(s => at(s, tabZ));
    const st = stats(full, lv);

    check(
      `${label}: the profile pass parts the board all the way round`,
      full.length > 0 && st.minDepth >= FR4_MM,
      `shallowest full-depth point ${st.minDepth.toFixed(3)}mm vs ${FR4_MM}mm of laminate ` +
        `(margin ${(st.minDepth - FR4_MM).toFixed(3)}mm)`
    );
    check(
      `${label}: the holding tabs are left standing`,
      tabbed.length === 0 || Math.max(...tabbed.map(s => s.depth)) < FR4_MM,
      `tab cut ${tabbed.length ? Math.max(...tabbed.map(s => s.depth)).toFixed(3) : 0}mm deep`
    );
  }

  // --- Nothing off the blank ----------------------------------------------
  const halfEdge = layout.boardOriginMm;
  const outside = samples.filter(
    s =>
      s.depth > 0.01 &&
      (s.bx < -halfEdge || s.by < -halfEdge ||
        s.bx > halfEdge * 2 + layout.boardWidthMm || s.by > halfEdge * 2 + layout.boardHeightMm)
  );
  check(
    `${label}: no cut lands off the blank`,
    outside.length === 0,
    outside.length ? `first at ${outside[0]!.bx.toFixed(2)},${outside[0]!.by.toFixed(2)}` : ''
  );

  return { iso, drill, profile };
}

analyse('levelled', cnc.samples, { strict: true, levelled: true });

// --- 4b. Where the tool stands when a bit is swapped ----------------------
// The pause dialog invites the operator to jog XY and to auto-zero Z on the
// copper. Both of those assume the tool is *above* the board. The program only
// ever retracts to safe Z before a tool change, so a bit that sticks out
// further than the last one is already inside the board the moment it is
// tightened — before anything is commanded.
for (const tc of toolChanges) {
  console.log(
    `  tool change ${tc.tool}: ${tc.clearBefore.toFixed(2)}mm of clearance before, ` +
      `${tc.clearAfter.toFixed(2)}mm after fitting the new bit` +
      `${tc.spinning ? ', spindle still turning' : ''}`
  );
}
for (const z of allZeroErrors) console.log(`  re-zero refused — ${z}`);
check(
  'the spindle is stopped before the operator is asked to change a bit',
  toolChanges.every(tc => !tc.spinning),
  `${toolChanges.filter(tc => tc.spinning).map(tc => tc.tool).join(', ')} paused with the spindle running`
);
check(
  'the copper re-zero offered at a tool change can actually run',
  allZeroErrors.length === 0,
  allZeroErrors.join(' | ')
);
check(
  'a tool change leaves room for a longer bit',
  toolChanges.every(tc => tc.clearBefore >= 10 && tc.clearAfter > 0),
  `retracts to only ${Math.min(...toolChanges.map(tc => tc.clearBefore)).toFixed(2)}mm ` +
    'over the copper — a bit protruding further than the last one lands inside the board'
);

// --- 5. The same job, re-zeroed at the corner it was mapped from -----------
// The pause dialog says XY is safe to jog and offers "Auto-Zero Z (Copper)",
// which zeroes wherever the bit is parked. On a warped board the height map is
// referenced to one particular point, so re-zeroing somewhere else shifts the
// whole rest of the job by the difference between the two.

async function freshMachine() {
  await webSerialManager.disconnect();
  installFake();
  await webSerialManager.connect();
  webSerialManager.forgetSavedZero();
  await webSerialManager.zeroXY();
  await new Promise(r => setTimeout(r, 300));
  await webSerialManager.zeroZOnSurface();
  await new Promise(r => setTimeout(r, 300));
}

await freshMachine();
console.log('\nCutting (levelled, re-zeroed back at the mapped corner)…');
await runJob(warped, true, { x: layout.boardOriginMm, y: layout.boardOriginMm });
analyse('corner re-zero', cnc.samples, { strict: true, levelled: true });

// --- 6. Resume without re-zeroing, which the dialog permits ----------------
await freshMachine();
console.log('\nCutting (tool changed, Resume pressed without re-zeroing)…');
await runJob(warped, false);
const noZero = analyse('no re-zero', cnc.samples, { strict: false, levelled: true });
const worst = [...noZero.drill, ...noZero.profile].reduce(
  (m, s) => Math.max(m, s.depth),
  0
);
console.log(
  `  deepest cut after an un-rezeroed tool change: ${worst.toFixed(3)}mm ` +
    `(bit length difference was ${Math.max(...Object.values(TOOL_LENGTHS)).toFixed(1)}mm)`
);

// --- 7. An air cut must never touch the stock ------------------------------
await freshMachine();
console.log('\nAir cut…');
const { generateAirCutGcode } = await import('./utils/pcbExporter');
await runJob(generateAirCutGcode(warped, 20), false);
const touched = cnc.samples.filter(s => s.depth > 0);
check(
  'an air cut never touches the board',
  touched.length === 0,
  touched.length
    ? `${touched.length} samples, deepest ${Math.max(...touched.map(s => s.depth)).toFixed(3)}mm ` +
      `on "${touched[0]!.line}"`
    : ''
);

// --- 8. Control: the same board with levelling off -------------------------
// If the harness cannot see an uncompensated job go wrong on this warp, it
// cannot be trusted when it says the compensated one went right.

await freshMachine();
console.log('\nCutting (control: no height map)…');
await runJob(layout.gcode, true, { x: layout.boardOriginMm, y: layout.boardOriginMm });
const raw = analyse('unlevelled', cnc.samples, { strict: false, levelled: false });
const rawMin = Math.min(...raw.iso.map(s => s.depth));
check(
  'the harness can tell an uncompensated cut apart',
  rawMin < COPPER_MM,
  `uncompensated shallowest ${rawMin.toFixed(4)}mm — the simulated warp proves nothing`
);

await webSerialManager.disconnect();

if (unhandled.length) {
  console.log(`\n${unhandled.length} unhandled promise rejection(s): ${[...new Set(unhandled)].join(' | ')}`);
}

console.log(`\n${fails} failure(s)`);
for (const f of failures) console.log(`  - ${f}`);
if (fails) throw new Error(`${fails} full-cut simulation failure(s)`);
