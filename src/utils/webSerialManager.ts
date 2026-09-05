// ---------------------------------------------------------------------------
// WebSerial Connection & Machine Controller Manager for CNC Milling & Lasers
// Supports GRBL serial communication, homing, zeroing, interactive pauses
// (M6, M0), and conductive Z-surface heightmap probing (G38.2).
//
// Every line sent is tracked against GRBL's serial receive buffer and matched
// to its 'ok' / 'error:' response. Without that accounting the controller
// silently drops overflowed lines — losing a retract mid-probe is enough to
// drag the bit across the board.
// ---------------------------------------------------------------------------

import { postMachineTelemetry } from './apiClient';
import { cloudAutosave } from './cloudDocuments';
import {
  warpGcode,
  gridFromPoints,
  getGridStats,
  normalizeGrid,
  gridOffPlaneMm,
  type ProbeGrid,
  type ProbePoint,
} from './meshLeveler';
import {
  WebSerialTransport,
  CloudTransport,
  type GrblTransport,
} from './grblTransport';

/** GRBL realtime bytes: acted on the instant they arrive, never acknowledged. */
const RT_STATUS = 0x3f; // '?'  status report
const RT_HOLD = 0x21; // '!'  feed hold
const RT_RESUME = 0x7e; // '~'  cycle start / resume
const RT_SOFT_RESET = 0x18; // Ctrl-X soft reset
const RT_JOG_CANCEL = 0x85; //      cancel an in-flight $J= jog

/** How the machine is reached. USB Web Serial stays the default. */
export type TransportMode = 'usb' | 'wifi';

/** GRBL's serial RX buffer. 128 bytes, kept one byte clear for safety. */
const GRBL_RX_BUFFER_BYTES = 127;
/** Longest wait for a single line's 'ok'. Homing a large machine is slow. */
const ACK_TIMEOUT_MS = 180_000;
/** Longest wait for a [PRB:] report after G38.2. */
const PROBE_TIMEOUT_MS = 60_000;
/** Minimum gap between telemetry posts, when the status has not changed. */
const TELEMETRY_INTERVAL_MS = 1000;
/** Touch plate thickness assumed when a caller does not pass one, in mm. */
const DEFAULT_TOUCH_PLATE_MM = 12;
/** How far the tool lifts off the surface after a probe touches, in mm. */
const PROBE_RETRACT_MM = 5;

/** Status polls to spend waiting for a `WCO:` before giving up on work space. */
const WCO_POLL_ATTEMPTS = 40;

/**
 * How far a probed point may sit from work Z0 and still be believable as board
 * warp. Copper-clad FR4 of any size warps well under a millimetre; anything
 * beyond this is a wrong or missing Z zero, not a bent board.
 */
/** A G-code line with its `;` or `(...)` comment removed. */
function stripGcodeComment(line: string): string {
  const semi = line.indexOf(';');
  const paren = line.indexOf('(');
  const at = semi < 0 ? paren : paren < 0 ? semi : Math.min(semi, paren);
  return (at < 0 ? line : line.slice(0, at)).trim();
}

/**
 * Whether a line is an unconditional stop, ignoring anything in its comment.
 *
 * Defence in depth rather than a fix for an observed failure: `startJob` drops
 * whole-line comments before anything is queued, so today nothing with a `;` in
 * front of it reaches this test. What it guards is the *trailing* comment — a
 * bare `includes('M6')` on `G1 X10 ; back to the M6 hole` stops a job dead in
 * the middle of a cut, and nothing but the wording of our own generated
 * comments currently prevents that. Comments are not instructions.
 */
function isMaterialPause(line: string): boolean {
  return /(^|\s)M0{1,2}(\s|$)/.test(stripGcodeComment(line));
}

/** Whether a line commands a tool change, ignoring anything in its comment. */
function isToolChangePause(line: string): boolean {
  const code = stripGcodeComment(line);
  return /(^|\s)M0?6(\s|$)/.test(code) || /(^|\s)T\d+(\s|$)/.test(code);
}

const MAX_SURFACE_OFFSET_MM = 1.5;
/**
 * How far a re-probe of an already-probed point may land from its first reading
 * before the map is untrustworthy. Generous — this is the "something is loose"
 * threshold, not the repeatability figure, which is measured and reported.
 */
const MAX_PROBE_SCATTER_MM = 0.15;
/** How far the tool lifts between the fast and slow stabs of a zeroing probe. */
const PROBE_RESTAB_LIFT_MM = 0.5;
/**
 * How far the probed surface may sit clear of work Z0 *beyond* the board's own
 * measured warp before the map is treated as referenced to the wrong plane.
 * Sized for probe repeatability, not for warp — the warp is already allowed for
 * separately.
 */
const SURFACE_PLANE_TOLERANCE_MM = 0.05;
/** Time given to a feed hold to decelerate before the planner is flushed. */
const RESTART_HOLD_SETTLE_MS = 600;
/** Time given to GRBL to reboot and report its banner after a soft reset. */
const RESTART_RESET_SETTLE_MS = 1200;
/**
 * How far machine position may differ across a restart before the job is
 * abandoned. A controlled reset from a standstill should cost nothing at all;
 * this is slack for the last reported status lagging the final deceleration,
 * not licence to drift.
 */
const RESTART_POSITION_TOLERANCE_MM = 0.05;
/** Longest wait for a status report when one is asked for directly. */
const STATUS_WAIT_TIMEOUT_MS = 2000;

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * GRBL 1.1 `error:N` codes, in the operator's terms. Bare "error:9" says
 * nothing about what to do next; the overwhelmingly common one here is 9 — the
 * controller boots into Alarm whenever homing is enabled ($22=1) and refuses
 * all G-code until `$X` or `$H` clears it.
 */
const GRBL_ERRORS: Record<number, string> = {
  1: 'G-code letter with no number after it',
  2: 'G-code value was missing or malformed',
  3: 'Unsupported `$` system command',
  4: 'A negative value was given where only positive is allowed',
  5: 'Homing is disabled on this controller ($22=0)',
  7: 'EEPROM read failed; defaults were restored',
  8: '`$` command needs the machine to be idle',
  9: 'The machine is locked out in Alarm — unlock ($X) or home ($H) it first',
  10: 'Soft limits need homing enabled ($22=1)',
  11: 'Line was longer than GRBL accepts',
  15: 'Jog target exceeds the machine travel',
  16: 'Malformed jog command',
  17: 'Laser mode needs PWM-capable spindle pins',
  20: 'Unsupported or invalid G-code command',
  21: 'Two G-code commands from the same modal group on one line',
  22: 'Feed rate has not been set (missing F)',
  23: 'G-code command needs an integer value',
  24: 'Two commands that both need axis words on one line',
  25: 'A G-code word was repeated on the line',
  26: 'G-code command is missing its axis words',
  33: 'Invalid target — arc or motion endpoint is unreachable',
  34: 'Arc radius geometry is invalid',
  38: 'Tool number is out of range',
};

/** Turns a raw `error:N` line into something an operator can act on. */
function describeGrblError(line: string): string {
  const code = Number(/^error:\s*(\d+)/.exec(line)?.[1]);
  const detail = Number.isFinite(code) ? GRBL_ERRORS[code] : undefined;
  return detail ? `${detail} (${line})` : `Machine rejected a command (${line})`;
}

/** GRBL 1.1 `ALARM:N` codes. 4 and 5 are the two a probing job actually hits. */
const GRBL_ALARMS: Record<number, string> = {
  1: 'Hard limit triggered — the machine hit a limit switch and its position is lost. Home ($H) before doing anything else.',
  2: 'Soft limit: the commanded move goes outside the machine travel. Check work zero and the job origin.',
  3: 'Reset while in motion — position is lost. Home ($H) to recover.',
  4: 'Probe failed: the probe was already triggered before the cycle started. Check the continuity clip is not shorted to the bit.',
  5: 'Probe failed: the tool travelled its full search distance without touching the surface. Check the continuity clip is attached to the copper and the bit started close above it.',
  6: 'Homing failed — reset during the homing cycle.',
  7: 'Homing failed — safety door opened during homing.',
  8: 'Homing failed: the limit switch did not clear on pull-off. Check the switch and $27.',
  9: 'Homing failed: no limit switch found within the search distance.',
};

/** Turns a raw `ALARM:N` line into something an operator can act on. */
function describeGrblAlarm(line: string): string {
  const code = Number(/^ALARM:\s*(\d+)/.exec(line)?.[1]);
  const detail = Number.isFinite(code) ? GRBL_ALARMS[code] : undefined;
  return detail ? `${detail} (${line})` : `Machine alarm: ${line}`;
}

export type MachineStatus =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'IDLE'
  | 'RUNNING'
  | 'PROBING'
  | 'PAUSED_MATERIAL'
  | 'PAUSED_TOOL'
  | 'PAUSED_OPERATOR'
  | 'ALARM'
  | 'ERROR';

export interface MachineState {
  status: MachineStatus;
  connected: boolean;
  portName?: string;
  mpos: { x: number; y: number; z: number };
  wpos: { x: number; y: number; z: number };
  currentLine: number;
  totalLines: number;
  progressPercent: number;
  pauseMessage?: string;
  lastError?: string;
  /** Populated while a mesh probe is running. */
  probeProgress?: { done: number; total: number };
  /**
   * Whether the machine has since reported a work position at the origin on
   * those axes, i.e. whether the zeroing actually took.
   *
   * GRBL acknowledges `G10 L20` by return, which only says the line was
   * received. Zeroing was otherwise completely invisible from the UI: the
   * button did something and the only evidence was the DRO changing. The
   * `Pending` flags cover the gap between sending and the next status report.
   */
  zeroXYConfirmed?: boolean;
  zeroZConfirmed?: boolean;
  /**
   * Set at a tool-change pause and cleared by a Z zeroing operation. While it
   * is true, resuming would cut with a work Z0 that describes the *previous*
   * bit — which is a gouge as deep as the two bits differ in length.
   */
  needsZeroBeforeResume?: boolean;
  /**
   * How far the two stabs of the last Z zeroing probe disagreed, in mm. The
   * machine's own repeatability at the one place it matters most — everything
   * the job cuts is referenced to that zero.
   */
  zeroZScatterMm?: number;
  zeroXYPending?: boolean;
  zeroZPending?: boolean;
  /**
   * Where work Z is expected to land once a pending Z zero takes. Plate
   * probing sets Z to the plate thickness rather than to nothing, so waiting
   * for a reported zero would never confirm it.
   */
  zeroZTargetMm?: number;
  /**
   * Where the work origin sits in machine coordinates, remembered across page
   * reloads. Zeroing is the one piece of setup that cannot be redone from the
   * chair: closing the tab mid-job used to take the only record of it away with
   * it, leaving a half-cut board and nothing to line the bit back up against.
   */
  savedZero?: SavedWorkOrigin;
  /**
   * The work offset the controller is currently applying, i.e. MPos - WPos, as
   * of the last status report. Undefined until one arrives.
   */
  workOffset?: { x: number; y: number; z: number };
  /**
   * Set when the remembered origin had to be written back onto the controller
   * because its own offsets had been lost. Purely informational — the restore
   * has already happened by the time this is true.
   */
  zeroRestored?: boolean;
}

/**
 * The work origin in machine coordinates, as remembered between sessions. The
 * axes are independent because XY and Z are zeroed by separate steps, and
 * re-zeroing one must not discard the other.
 */
export interface SavedWorkOrigin {
  x?: number;
  y?: number;
  z?: number;
  /** Work Z the last Z zero aimed at: plate thickness, or 0 when on copper. */
  zTargetMm?: number;
  /** Epoch ms of the most recent zeroing, so a stale setup is visible as one. */
  savedAt: number;
}

const SAVED_ZERO_KEY = 'grblWorkOrigin';

/**
 * How far the controller's offset may sit from the remembered origin and still
 * count as the same zero. Comfortably under one step of any of these machines,
 * and above the 0.001mm rounding of GRBL's own reports.
 */
const ZERO_MATCH_TOLERANCE_MM = 0.02;

/** Reads back the remembered work origin. Absent, unparseable or empty -> none. */
function loadSavedZero(): SavedWorkOrigin | undefined {
  if (typeof localStorage === 'undefined') return undefined;
  try {
    const raw = localStorage.getItem(SAVED_ZERO_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return undefined;
    const num = (v: unknown) =>
      typeof v === 'number' && Number.isFinite(v) ? v : undefined;
    const saved: SavedWorkOrigin = {
      x: num(parsed.x),
      y: num(parsed.y),
      z: num(parsed.z),
      zTargetMm: num(parsed.zTargetMm),
      savedAt: num(parsed.savedAt) ?? 0,
    };
    const empty = saved.x === undefined && saved.y === undefined && saved.z === undefined;
    return empty ? undefined : saved;
  } catch {
    return undefined;
  }
}

function writeSavedZero(saved: SavedWorkOrigin | undefined): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (saved) localStorage.setItem(SAVED_ZERO_KEY, JSON.stringify(saved));
    else localStorage.removeItem(SAVED_ZERO_KEY);
  } catch {
    // Private mode or a full quota. The zero is still live on the controller;
    // only the memory of it across a reload is lost.
  }
}

/**
 * How close to the origin a reported work position has to be to count as
 * zeroed. Well inside what any of these machines resolve, so it reads as "at
 * the origin" without demanding an exact zero the DRO may never print.
 */
const ZERO_CONFIRM_TOLERANCE_MM = 0.1;

/** GRBL reports to 3 decimals; keeping that precision avoids phantom drift. */
function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** Parses a `x,y,z` field out of a status report. Missing axes read as 0. */
function triple(body: string): { x: number; y: number; z: number } {
  const c = body.split(',').map(Number);
  return { x: c[0] || 0, y: c[1] || 0, z: c[2] || 0 };
}

/**
 * Whether the controller's live offset has moved away from the remembered
 * origin on any axis that was remembered — i.e. whether the controller has
 * lost the zero. Axes never zeroed are not compared: an unset Z is not a
 * mismatched one.
 */
function driftsFrom(
  saved: SavedWorkOrigin | undefined,
  offset: { x: number; y: number; z: number }
): boolean {
  if (!saved) return false;
  return (['x', 'y', 'z'] as const).some(
    a => saved[a] !== undefined && Math.abs(saved[a]! - offset[a]) > ZERO_MATCH_TOLERANCE_MM
  );
}

export interface ProbeMeshOptions {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  cols?: number;
  rows?: number;
  /** How far below Z0 to search for the surface. */
  probeDepthMm?: number;
  /** Retract height between points. */
  clearanceMm?: number;
  probeFeed?: number;
  travelFeed?: number;
  onProgress?: (done: number, total: number) => void;
}

export type MachineStateListener = (state: MachineState) => void;

/** One `; OP n/m:` operation of a job, and where it starts in the queue. */
export interface JobLayer {
  startIndex: number;
  label: string;
}

interface PendingAck {
  bytes: number;
  /** The G-code that was sent, so an `error:` can name what the machine refused. */
  line: string;
  resolve: () => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

class WebSerialManager {
  /** The active byte pipe — a USB Web Serial port or a WiFi WebSocket proxy. */
  private transport: GrblTransport | null = null;
  /** Chosen transport + the paired machine it targets. Set via setTransport. */
  private transportMode: TransportMode = 'usb';
  /** Which Tekno Box to reach, from `fetchMachineDevices`. */
  private cloudDeviceId = '';
  /** Accumulates serial RX across chunks; parsed line by line on each '\n'. */
  private rxBuffer = '';
  private statusPollTimer: any = null;

  private gcodeQueue: string[] = [];
  /** Where each `; OP n/m:` operation starts in the streamed queue. */
  private jobLayers: JobLayer[] = [];
  /**
   * The job's spindle command, taken from its preamble. A restart soft-resets
   * the controller, which stops the spindle — and the spindle-up line lives in
   * the program header, far behind any layer we might rewind to, so it would
   * never be replayed.
   */
  private jobSpindleLine: string | null = null;
  /** Set by a restart; consumed by the next resume, once hands are clear. */
  private spindleRestartPending = false;
  /** Woken by each status report, so a caller can await a fresh position. */
  private statusWaiters: (() => void)[] = [];
  /**
   * Whether a coded `ALARM:N` has arrived. Cleared before a deliberate reset so
   * the bare homing lockout can be told apart from a genuine fault.
   */
  private alarmFaultSeen = false;
  private currentQueueIndex = 0;
  private completedLines = 0;
  private isJobRunning = false;
  private isPaused = false;
  /**
   * How the current pause came about. A stream pause (M0 / M6) drained the
   * buffer and left the machine idle, so resuming just feeds it again. An
   * operator pause is a GRBL feed hold with the planner still full, so resuming
   * has to send cycle start before anything else moves.
   */
  private pauseKind: 'stream' | 'operator' | null = null;

  /**
   * Whether this connection has already settled the remembered work origin —
   * restored it, found it already in place, or had it overridden by a manual
   * re-zero. Reset on connect; see restoreSavedZeroIfLost.
   */
  private zeroRestoreDone = false;

  /**
   * The most recent `WCO:` from a status report. GRBL sends it only every
   * 10-30 reports, so it is remembered rather than re-derived; undefined until
   * the first one arrives, which is what "the work frame is not known yet"
   * looks like.
   */
  private lastWco: { x: number; y: number; z: number } | undefined;

  /** GRBL's `$$` settings, populated on connect. Empty until they arrive. */
  private grblSettings = new Map<number, number>();

  /** Lines written to the port whose 'ok' has not come back yet, in order. */
  private inflight: PendingAck[] = [];
  /** Woken whenever the inflight queue shrinks, so writers can resume. */
  private bufferWaiters: Array<() => void> = [];

  /**
   * Count of completed Z zeroing operations. Compared against its value at the
   * last tool-change pause to answer "did the operator actually re-zero?" —
   * which `zeroZConfirmed` cannot, because that flag means "the tool is
   * standing at the zero", and any jog clears it. Jogging after a re-zero does
   * not un-set the origin, and the pause dialog invites jogging.
   */
  /** Reports that literally carried a `WCO:` field, as opposed to a carried-over one. */
  private wcoReports = 0;
  private zeroZOps = 0;
  private zeroZOpsAtPause = 0;
  /**
   * Tool-change pauses reached in the current job.
   *
   * The first `T<n> M6` is not a bit *change* — it is the bit the operator
   * loaded and zeroed during setup, and demanding a re-zero for it would raise
   * the alarm on every single job. An alarm that is wrong the first time is one
   * the operator learns to click past, which is worse than not having it: by
   * the second tool change, when the length really has changed, the habit is
   * already formed.
   */
  private toolChangesSeen = 0;

  private probeWaiter: {
    resolve: (r: { x: number; y: number; z: number }) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  private state: MachineState = {
    status: 'DISCONNECTED',
    connected: false,
    mpos: { x: 0, y: 0, z: 0 },
    wpos: { x: 0, y: 0, z: 0 },
    currentLine: 0,
    totalLines: 0,
    progressPercent: 0,
    savedZero: loadSavedZero(),
  };

  private listeners: Set<MachineStateListener> = new Set();

  /**
   * Telemetry pacing. The status poll runs at 4Hz and every reply calls
   * `notify()`, so posting from there unthrottled would be a request per poll
   * for the whole length of a job. Position is sampled at 1Hz instead, while a
   * change of status goes out immediately — that is the part someone watching
   * remotely actually needs promptly.
   */
  private lastTelemetryAt = 0;
  private lastTelemetryStatus: MachineStatus | null = null;

  public isSupported(): boolean {
    // WiFi rides on a secure WebSocket to physbox, which any browser can open;
    // USB needs Web Serial, which not all of them have.
    if (this.transportMode === 'wifi') return true;
    return typeof navigator !== 'undefined' && 'serial' in navigator;
  }

  /**
   * Chooses how the machine is reached. Call before connect().
   *
   * USB is a cable to this computer. WiFi is a Tekno Box, reached through
   * api.physbox.io rather than directly: the box sits behind the customer's
   * router with no address to dial and no certificate a browser would accept,
   * and a page served over https may not open a plain connection to a home
   * network anyway. So it connects out to physbox and this meets it there.
   */
  public setTransport(mode: TransportMode, deviceId?: string): void {
    this.transportMode = mode;
    if (deviceId !== undefined) this.cloudDeviceId = deviceId;
  }

  public getCloudDeviceId(): string {
    return this.cloudDeviceId;
  }

  public getTransportMode(): TransportMode {
    return this.transportMode;
  }

  public getState(): MachineState {
    return { ...this.state };
  }

  public addListener(listener: MachineStateListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  private notify() {
    const currentState = this.getState();
    this.listeners.forEach(l => l(currentState));
    this.reportTelemetry(currentState);
  }

  /** Maps our machine status onto the shared cross-app telemetry vocabulary. */
  private telemetryStatus(status: MachineStatus): string {
    switch (status) {
      case 'RUNNING':
      case 'PROBING':
        return 'running';
      case 'PAUSED_MATERIAL':
      case 'PAUSED_TOOL':
      case 'PAUSED_OPERATOR':
        return 'paused';
      case 'ALARM':
      case 'ERROR':
        return 'error';
      default:
        return 'idle';
    }
  }

  /**
   * Streams machine state to the PhysBox API so a job can be watched from
   * another device. `postMachineTelemetry` is a no-op unless the user is signed
   * in, so this costs nothing for a local-only user.
   */
  /** Set while a telemetry post is outstanding — see `reportTelemetry`. */
  private telemetryInFlight = false;

  private reportTelemetry(state: MachineState) {
    if (!state.connected) return;

    const now = Date.now();
    const statusChanged = state.status !== this.lastTelemetryStatus;
    if (!statusChanged && now - this.lastTelemetryAt < TELEMETRY_INTERVAL_MS) return;

    this.lastTelemetryAt = now;
    this.lastTelemetryStatus = state.status;
    // One at a time: a stalled network would otherwise queue a backlog of stale
    // positions that all land at once when it recovers.
    if (this.telemetryInFlight) return;
    this.telemetryInFlight = true;

    void postMachineTelemetry('circuit', {
      status: this.telemetryStatus(state.status),
      progressPercent: state.progressPercent,
      currentLine: state.currentLine,
      totalLines: state.totalLines,
      xyz: { ...state.wpos },
      lastError: state.lastError ?? null,
      // Which cloud document this browser is working on, so an archived run points
      // back at the circuit that produced it.
      documentId: cloudAutosave.getStatus().documentId,
      documentRevision: cloudAutosave.getStatus().revision,
    }).finally(() => {
      this.telemetryInFlight = false;
    });
  }

  private updateState(patch: Partial<MachineState>) {
    this.state = { ...this.state, ...patch };
    this.notify();
  }

  /**
   * Opens the machine link over the selected transport (USB by default; WiFi if
   * chosen via setTransport) at 115200 baud. For USB this prompts for a port.
   */
  public async connect(baudRate = 115200): Promise<boolean> {
    if (this.state.connected) return true;

    if (!this.isSupported()) {
      this.updateState({ status: 'ERROR', lastError: 'WebSerial API is not supported in this browser. Use Chrome, Edge, or Opera.' });
      return false;
    }

    try {
      this.updateState({ status: 'CONNECTING' });

      const transport: GrblTransport =
        this.transportMode === 'wifi'
          ? new CloudTransport(this.cloudDeviceId, baudRate)
          : new WebSerialTransport(baudRate);
      transport.onData(chunk => this.handleData(chunk));
      transport.onDisconnect?.(err => this.handleTransportDisconnect(err));
      await transport.connect();
      this.transport = transport;

      this.rxBuffer = '';
      this.updateState({
        status: 'IDLE',
        connected: true,
        lastError: undefined,
        portName: this.transportMode === 'wifi' ? 'Tekno Box (WiFi)' : 'USB Serial',
      });

      // GRBL status polling. '?' is a realtime command: it bypasses the RX
      // buffer and draws no 'ok', so it is safe to send during a job too.
      this.statusPollTimer = setInterval(() => {
        if (this.state.connected) void this.writeRealtime(RT_STATUS);
      }, 250);

      // Ask for the controller's settings so limits and rates can be read
      // rather than assumed. Failure is not fatal — a controller that does not
      // answer `$$` just leaves the map empty.
      this.grblSettings.clear();
      this.sendLine('$$').catch(() => {});

      // A fresh link is a fresh chance for the controller to have come up
      // without the work origin it had last time.
      this.zeroRestoreDone = false;
      this.lastWco = undefined;
      this.updateState({ zeroRestored: false, workOffset: undefined });

      return true;
    } catch (e: any) {
      this.transport = null;
      this.updateState({ status: 'ERROR', connected: false, lastError: e.message || 'Failed to open the machine link' });
      return false;
    }
  }

  /** Invoked when transport reports an unexpected connection drop. */
  private handleTransportDisconnect(err?: Error) {
    if (!this.state.connected && this.state.status === 'DISCONNECTED') return;
    this.isJobRunning = false;
    if (this.statusPollTimer) clearInterval(this.statusPollTimer);
    this.failPending(err || new Error('Machine link disconnected unexpectedly'));
    this.transport = null;
    this.rxBuffer = '';
    this.updateState({
      status: 'DISCONNECTED',
      connected: false,
      lastError: err?.message || 'Machine disconnected',
      progressPercent: 0,
      probeProgress: undefined,
    });
  }

  /** Closes the machine link and tears down the transport. */
  public async disconnect() {
    this.isJobRunning = false;
    if (this.statusPollTimer) clearInterval(this.statusPollTimer);
    this.failPending(new Error('Machine link disconnected'));

    try {
      if (this.transport) await this.transport.disconnect();
    } catch {
      // Ignore cleanup errors
    }

    this.transport = null;
    this.rxBuffer = '';
    this.updateState({ status: 'DISCONNECTED', connected: false, progressPercent: 0, probeProgress: undefined });
  }

  // -------------------------------------------------------------------------
  // Line transport with GRBL buffer accounting
  // -------------------------------------------------------------------------

  private inflightBytes(): number {
    return this.inflight.reduce((sum, a) => sum + a.bytes, 0);
  }

  /** Wakes anything blocked on buffer space or on the queue draining. */
  private wakeBufferWaiters() {
    const waiters = this.bufferWaiters;
    this.bufferWaiters = [];
    waiters.forEach(w => w());
  }

  /** Rejects every outstanding ack and probe — used on reset, error, or close. */
  private failPending(err: Error) {
    const pending = this.inflight;
    this.inflight = [];
    pending.forEach(a => {
      clearTimeout(a.timer);
      a.reject(err);
    });

    if (this.probeWaiter) {
      clearTimeout(this.probeWaiter.timer);
      this.probeWaiter.reject(err);
      this.probeWaiter = null;
    }

    this.wakeBufferWaiters();
  }

  /**
   * Writes a line as soon as GRBL has room for it in its RX buffer, and returns
   * the promise for that line's acknowledgement.
   *
   * Awaiting the outer call throttles the sender to the machine's buffer;
   * awaiting the returned `ack` additionally waits for the controller to
   * consume the line. Job streaming wants the former (keeping the planner fed
   * keeps motion smooth), one-off commands want the latter.
   *
   * The ack is returned boxed: an async function assimilates a bare promise
   * return value, which would silently collapse this back into send-and-wait.
   */
  private async enqueueLine(line: string): Promise<{ ack: Promise<void> }> {
    if (!this.transport) throw new Error('Not connected to a machine');

    // The transport appends the '\n', but it is still a byte on the wire, so it
    // is counted against GRBL's RX buffer exactly as before.
    const bytes = line.length + 1;

    // The second clause lets an oversized line through once the buffer is
    // empty, rather than waiting forever for room that will never exist.
    while (this.inflightBytes() + bytes > GRBL_RX_BUFFER_BYTES && this.inflight.length > 0) {
      await new Promise<void>(resolve => this.bufferWaiters.push(resolve));
      if (!this.transport) throw new Error('Not connected to a machine');
    }

    const ack = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.failPending(new Error(`Timed out waiting for the machine to acknowledge "${line}"`));
      }, ACK_TIMEOUT_MS);
      this.inflight.push({ bytes, line, resolve, reject, timer });
    });

    await this.transport.writeLine(line);
    return { ack };
  }

  /** Sends a single G-code line and waits for the machine to acknowledge it. */
  public async sendLine(line: string): Promise<void> {
    const trimmed = line.trim();
    if (!trimmed) return;
    // Any G10 moves the work origin, which makes the last WCO a description of
    // where zero used to be. Deriving a work position from it after that point
    // would report the old frame as though it were the new one — long enough
    // for a pending zero to "confirm" against a stale reading. Dropping it here
    // rather than in each caller means a new command cannot forget to.
    const movesOrigin = /^G10(\s|$)/i.test(trimmed);
    const { ack } = await this.enqueueLine(trimmed);
    await ack;
    // Dropped *after* the ack, not before the write. GRBL emits status reports
    // continuously, and one generated before it had executed the G10 still
    // carries the old offset — clearing first left that report free to land
    // afterwards and reinstate the stale value, with nothing to clear it again.
    // A report read after the 'ok' cannot predate the G10: the ack and the
    // reports come up the same stream in order.
    //
    // This is not hypothetical. A mesh probed against a work offset left over
    // from the previous zero reads as a whole surface displaced by the
    // difference between the two — the right shape, the right span, bodily
    // wrong — which is the failure the off-plane guard reports rather than the
    // one it was supposed to prevent.
    if (movesOrigin) this.lastWco = undefined;
  }

  /** Resolves once every sent line has been acknowledged. */
  private async drain(): Promise<void> {
    while (this.inflight.length > 0) {
      await new Promise<void>(resolve => this.bufferWaiters.push(resolve));
    }
  }

  /**
   * Writes a GRBL realtime byte. These jump the line: they are acted on the
   * moment they arrive rather than being queued behind the job, which is the
   * whole point of a feed hold. They are never acknowledged with an 'ok', so
   * they must not go through `enqueueLine`.
   */
  private async writeRealtime(byte: number): Promise<void> {
    if (!this.transport || !this.state.connected) return;
    await this.transport.writeRealtime(byte);
  }

  /**
   * Handles a raw serial RX chunk from the transport, whether it arrived over
   * USB or was relayed as a WebSocket `grbl_data` frame. Chunks are byte-for-
   * byte serial text, so they are accumulated and split on '\n' identically.
   */
  private handleData(chunk: string) {
    this.rxBuffer += chunk;
    const lines = this.rxBuffer.split('\n');
    this.rxBuffer = lines.pop() || '';
    for (const l of lines) {
      this.parseLine(l.trim());
    }
  }

  /** Parses GRBL status lines, e.g. <Idle|MPos:0.000,0.000,0.000|WPos:0.000,0.000,0.000> */
  private parseLine(line: string) {
    if (!line) return;

    if (line.startsWith('<') && line.endsWith('>')) {
      const content = line.substring(1, line.length - 1);
      const parts = content.split('|');
      const grblState = parts[0];

      let mpos = { ...this.state.mpos };
      let wpos = { ...this.state.wpos };
      // GRBL 1.1 sends WCO only once every few reports, so the last one seen
      // has to carry over to the reports that omit it.
      let wco = this.lastWco;
      let sawMPos = false;
      let sawWPos = false;

      for (let i = 1; i < parts.length; i++) {
        const p = parts[i];
        if (p.startsWith('MPos:')) {
          mpos = triple(p.slice(5));
          sawMPos = true;
        } else if (p.startsWith('WPos:')) {
          wpos = triple(p.slice(5));
          sawWPos = true;
        } else if (p.startsWith('WCO:')) {
          wco = triple(p.slice(4));
          this.wcoReports++;
        }
      }

      // A report carries MPos *or* WPos — which one is the `$10` mask, and its
      // factory default is MPos — plus a WCO every few reports. Only the frame
      // actually reported is fresh, so the other has to be derived from WCO
      // rather than read out of the previous report. Subtracting a stale WPos
      // from a live MPos, as this used to, makes the work offset track the tool
      // instead of the origin: it reads as drift, and the saved-zero restore
      // then writes that bogus offset onto the controller with `G10 L2`.
      if (sawMPos && sawWPos) {
        wco = {
          x: round3(mpos.x - wpos.x),
          y: round3(mpos.y - wpos.y),
          z: round3(mpos.z - wpos.z),
        };
        // Both frames in one report pins the offset down as firmly as a WCO
        // field does, so this counts as a first-hand reading too.
        this.wcoReports++;
      } else if (sawMPos && wco) {
        wpos = { x: round3(mpos.x - wco.x), y: round3(mpos.y - wco.y), z: round3(mpos.z - wco.z) };
      } else if (sawWPos && wco) {
        mpos = { x: round3(wpos.x + wco.x), y: round3(wpos.y + wco.y), z: round3(wpos.z + wco.z) };
      }
      this.lastWco = wco;

      /** Both frames are pinned down, so wpos and the offset mean something. */
      const framesKnown = !!wco && (sawMPos || sawWPos);

      let status: MachineStatus = this.state.status;
      if (grblState.startsWith('Alarm')) status = 'ALARM';
      // ALARM is otherwise sticky: the branches below only ever set IDLE when
      // no job is running, so an alarm cleared mid-job — by `$X` during a layer
      // restart, say — would keep reporting itself long after the controller
      // had gone back to work.
      else if (this.state.status === 'ALARM') {
        status = this.isJobRunning && !this.isPaused ? 'RUNNING' : 'IDLE';
      }
      // A reported Hold only names the pause when we do not already know why we
      // are paused — otherwise the poll would relabel an operator feed hold or a
      // tool change as a material swap a fraction of a second after it started.
      else if (grblState.startsWith('Hold')) {
        status = this.isPaused ? this.state.status : 'PAUSED_OPERATOR';
      }
      else if (!this.isJobRunning && this.state.status !== 'PROBING') status = 'IDLE';

      // Resolve a pending zero as soon as the machine reports the work origin
      // where it was asked to be.
      const zeroPatch: Partial<MachineState> = {};
      if (framesKnown && this.state.zeroXYPending &&
          Math.abs(wpos.x) < ZERO_CONFIRM_TOLERANCE_MM &&
          Math.abs(wpos.y) < ZERO_CONFIRM_TOLERANCE_MM) {
        zeroPatch.zeroXYPending = false;
        zeroPatch.zeroXYConfirmed = true;
      }
      if (framesKnown && this.state.zeroZPending &&
          Math.abs(wpos.z - (this.state.zeroZTargetMm ?? 0)) < ZERO_CONFIRM_TOLERANCE_MM) {
        zeroPatch.zeroZPending = false;
        zeroPatch.zeroZConfirmed = true;
      }

      // The work offset the controller is applying is exactly the machine
      // position of the work origin.
      const workOffset = wco;

      // A zero that has just taken is the moment worth remembering: the origin
      // is where the machine says it is, not where the command asked for it.
      if (zeroPatch.zeroXYConfirmed && workOffset) {
        Object.assign(zeroPatch, this.rememberZero({ x: workOffset.x, y: workOffset.y }));
      }
      if (zeroPatch.zeroZConfirmed && workOffset) {
        Object.assign(zeroPatch, this.rememberZero({
          z: workOffset.z,
          zTargetMm: this.state.zeroZTargetMm ?? 0,
        }));
      }

      this.updateState({ mpos, wpos, status, ...(workOffset ? { workOffset } : {}), ...zeroPatch });

      // With a *real* offset reading in hand, a controller that came back up
      // without its offsets can be handed them back. Only ever done once per
      // connection, and never over a zero the operator has just set. Until a
      // WCO has arrived the offset is unknown rather than zero, and restoring
      // against a guess would move the origin instead of preserving it.
      if (framesKnown) void this.restoreSavedZeroIfLost(workOffset!);
      // Anything waiting on a fresh position reading now has one.
      const waiters = this.statusWaiters;
      this.statusWaiters = [];
      waiters.forEach(w => w());
      return;
    }

    // Settings report: `$30=1000`. GRBL answers `$$` with one of these per
    // setting, each followed by its own 'ok', so they are read here and not
    // treated as a response to anything.
    if (/^\$\d+=/.test(line)) {
      const [key, value] = line.slice(1).split('=');
      const num = parseInt(key, 10);
      const val = parseFloat(value);
      if (Number.isFinite(num) && Number.isFinite(val)) {
        this.grblSettings.set(num, val);
      }
      return;
    }

    // Probe result: [PRB:0.000,0.000,-1.234:1] — trailing flag is success.
    if (line.startsWith('[PRB:')) {
      const body = line.slice(5).replace(/\]$/, '');
      const [coordPart, successPart] = body.split(':');
      const coords = coordPart.split(',').map(Number);
      const succeeded = successPart?.trim() === '1';

      if (this.probeWaiter) {
        const waiter = this.probeWaiter;
        this.probeWaiter = null;
        clearTimeout(waiter.timer);
        if (succeeded) {
          waiter.resolve({ x: coords[0] || 0, y: coords[1] || 0, z: coords[2] || 0 });
        } else {
          waiter.reject(new Error('Probe did not contact the surface within its travel'));
        }
      }
      return;
    }

    if (line === 'ok') {
      const ack = this.inflight.shift();
      if (ack) {
        clearTimeout(ack.timer);
        ack.resolve();
      }
      this.wakeBufferWaiters();
      return;
    }

    if (line.startsWith('error:')) {
      const ack = this.inflight.shift();
      if (ack) {
        clearTimeout(ack.timer);
        // The offending line matters as much as the code — during a job it is
        // the only way to tell which G-code the controller choked on.
        const sent = ack.line ? ` — sending \`${ack.line}\`` : '';
        ack.reject(new Error(describeGrblError(line) + sent));
      }
      this.wakeBufferWaiters();
      return;
    }

    if (line.startsWith('ALARM:')) {
      this.isJobRunning = false;
      // A coded alarm is a real fault — a limit trip, a reset mid-motion, a
      // failed probe. Distinct from the bare lockout GRBL boots into when
      // homing is required, which reports Alarm state but no code.
      this.alarmFaultSeen = true;
      const detail = describeGrblAlarm(line);
      this.updateState({ status: 'ALARM', lastError: detail });
      this.failPending(new Error(detail));
      return;
    }

    // Soft reset / power-on: GRBL has cleared its buffer, so must we.
    if (line.startsWith('Grbl ')) {
      this.failPending(new Error('Machine was reset'));
    }
  }

  // -------------------------------------------------------------------------
  // Job streaming
  // -------------------------------------------------------------------------

  /** Starts streaming a G-code job line by line over serial. */
  public async startJob(gcode: string): Promise<void> {
    this.assertUnlocked();

    // Layer boundaries are read from the `; OP n/m:` headers before the
    // comments are dropped — restarting an operation needs to know where each
    // one begins in the *stripped* queue, which is the only thing streamed.
    const layers: JobLayer[] = [];
    const rawLines: string[] = [];
    for (const raw of gcode.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith(';')) {
        const header = /^;\s*OP\s+(\d+)\s*\/\s*(\d+)\s*:\s*(.+?)\s*$/i.exec(line);
        if (header) {
          layers.push({ startIndex: rawLines.length, label: header[3] });
        }
        continue;
      }
      rawLines.push(line);
    }

    this.jobLayers = layers;
    this.toolChangesSeen = 0;
    this.jobSpindleLine = rawLines.find(l => /\bM[34]\b/.test(l)) ?? null;
    this.spindleRestartPending = false;
    this.gcodeQueue = rawLines;
    this.currentQueueIndex = 0;
    this.completedLines = 0;
    this.isJobRunning = true;
    this.isPaused = false;
    this.updateState({
      status: 'RUNNING',
      totalLines: rawLines.length,
      currentLine: 0,
      progressPercent: 0,
      lastError: undefined,
    });

    return this.processQueue();
  }

  private failJob(err: Error) {
    if (!this.isJobRunning) return;
    this.isJobRunning = false;
    this.gcodeQueue = [];
    this.updateState({ status: 'ERROR', lastError: err.message });
  }

  private async processQueue() {
    while (this.isJobRunning && this.currentQueueIndex < this.gcodeQueue.length) {
      if (this.isPaused) return;

      const line = this.gcodeQueue[this.currentQueueIndex];

      // Handle interactive pauses. Let the machine finish everything already
      // buffered first, or it would keep cutting past the pause point.
      if (isMaterialPause(line)) {
        await this.drain();
        this.isPaused = true;
        this.pauseKind = 'stream';
        this.currentQueueIndex++;
        this.updateState({ status: 'PAUSED_MATERIAL', pauseMessage: 'M0 Pause: Swap material sheet and click Resume.' });
        return;
      }
      if (isToolChangePause(line)) {
        await this.drain();
        this.isPaused = true;
        this.pauseKind = 'stream';
        this.currentQueueIndex++;
        // A new bit is a different length, so the work Z0 the job has been
        // cutting to no longer describes this tool. Remember how many zeroing
        // operations had happened when the machine stopped, so resumeJob can
        // tell whether the operator actually did one.
        this.zeroZOpsAtPause = this.zeroZOps;
        const isFirstTool = this.toolChangesSeen === 0;
        this.toolChangesSeen++;
        this.updateState({
          status: 'PAUSED_TOOL',
          pauseMessage: `Tool Change: ${stripGcodeComment(line)}. Change bit and click Resume.`,
          needsZeroBeforeResume: !isFirstTool,
        });
        return;
      }

      try {
        // Await the write (which blocks until GRBL has room) but not the ack —
        // progress is reported as acks land, while the planner stays fed.
        const { ack } = await this.enqueueLine(line);
        ack.then(
          () => {
            this.completedLines++;
            this.updateState({
              currentLine: this.completedLines,
              progressPercent: Math.round((this.completedLines / this.gcodeQueue.length) * 100),
            });
          },
          (err: Error) => this.failJob(err)
        );
      } catch (err: any) {
        this.failJob(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      this.currentQueueIndex++;
    }

    if (!this.isJobRunning) return;

    try {
      await this.drain();
    } catch (err: any) {
      this.failJob(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    // Re-checked after the drain: a line rejected while the tail of the job was
    // still in flight has already failed the job, and must not be overwritten
    // with a successful-looking IDLE.
    if (this.isJobRunning && this.currentQueueIndex >= this.gcodeQueue.length) {
      this.isJobRunning = false;
      this.updateState({ status: 'IDLE', progressPercent: 100 });
    }
  }

  /**
   * Operator-initiated pause: a GRBL feed hold, which decelerates and stops
   * without losing position or discarding the planner. This is the button to
   * reach for when a cut looks wrong but is not yet worth an E-stop, and it is
   * the only way to stop a running job short of one.
   */
  public async pauseJob(): Promise<void> {
    if (!this.isJobRunning || this.isPaused) return;
    this.isPaused = true;
    this.pauseKind = 'operator';
    await this.writeRealtime(RT_HOLD);
    this.updateState({
      status: 'PAUSED_OPERATOR',
      pauseMessage: 'Paused. The spindle is still running and Z has not moved.',
    });
  }

  /**
   * Asks for a status report and waits for it, so a caller reads a position
   * from now rather than from up to a poll interval ago. Resolves anyway on
   * timeout: a stale reading is handled by the drift check that follows it,
   * and hanging here would strand a half-restarted job.
   */
  private async awaitStatus(): Promise<void> {
    const fresh = new Promise<void>(resolve => {
      this.statusWaiters.push(resolve);
      setTimeout(resolve, STATUS_WAIT_TIMEOUT_MS);
    });
    await this.writeRealtime(RT_STATUS);
    await fresh;
  }

  /**
   * Asks the controller where it is and waits for the answer, so a caller that
   * is about to reason about the tool's height reads a position from now rather
   * than from up to a poll interval ago. Resolves on timeout like `awaitStatus`;
   * the caller sees a stale reading, not a hang.
   */
  public async refreshPosition(): Promise<MachineState> {
    if (this.state.connected) await this.awaitStatus();
    return this.getState();
  }

  /** Index into jobLayers of the operation currently being streamed, or -1. */
  private currentLayerIndex(): number {
    if (!this.gcodeQueue.length || !this.jobLayers.length) return -1;
    let found = -1;
    for (let i = 0; i < this.jobLayers.length; i++) {
      if (this.jobLayers[i].startIndex <= this.currentQueueIndex) found = i;
      else break;
    }
    return found;
  }

  /** The operation currently being streamed, or null outside a job. */
  public getCurrentLayer(): (JobLayer & { index: number; total: number }) | null {
    const i = this.currentLayerIndex();
    if (i < 0) return null;
    return { ...this.jobLayers[i], index: i, total: this.jobLayers.length };
  }

  /**
   * Abandons the operation being cut and runs it again from its first line.
   *
   * The case this exists for: an operation is cutting at the wrong depth —
   * work Z0 was never re-probed after the last bit change — and it is obvious
   * while it is still going. Without this the only option is to cancel and cut
   * the whole board again, including the operations that came out fine.
   *
   * Every operation begins with its own `T<n> M6`, and the rewind deliberately
   * includes it: the stream stops there exactly as it did the first time
   * through, so the tool-change prompt comes back up with its re-zero controls
   * before a single line is re-cut. That prompt is the whole point — it is the
   * step that was skipped.
   *
   * Stopping mid-cut means clearing GRBL's planner, and a feed hold alone will
   * not do that: the queued blocks survive it and would run on the next cycle
   * start. Only a soft reset flushes them, so that is what this does. A soft
   * reset from a standstill keeps machine position and work offsets — the
   * latter live in EEPROM — but on a controller with homing required ($22=1)
   * it comes back in Alarm, which is reported rather than papered over.
   */
  public async restartCurrentLayer(): Promise<void> {
    if (!this.isJobRunning) throw new Error('No job is running');

    const layer = this.getCurrentLayer();
    if (!layer) throw new Error('This job has no operation markers to restart from');

    // Stop feeding the queue before anything else, so processQueue cannot push
    // another line at the controller while it is being reset.
    this.isPaused = true;
    this.pauseKind = 'stream';
    this.updateState({ status: 'PAUSED_OPERATOR', pauseMessage: 'Restarting layer…' });

    // Decelerate under control first. Resetting a machine that is still moving
    // is what loses position and raises ALARM:3.
    await this.writeRealtime(RT_HOLD);
    await delay(RESTART_HOLD_SETTLE_MS);

    // Machine position is read *after* the hold has settled, so it reflects
    // where the tool actually stopped. It is the reference for checking that
    // the reset below cost us nothing.
    await this.awaitStatus();
    const posBefore = { ...this.state.mpos };

    // Flush the planner. Anything already accepted is discarded, and every
    // outstanding ack is failed by the `Grbl ` banner handler.
    this.alarmFaultSeen = false;
    await this.writeRealtime(RT_SOFT_RESET);
    this.failPending(new Error('Layer restarted'));
    await delay(RESTART_RESET_SETTLE_MS);

    // With homing required ($22=1) GRBL always boots into a locked Alarm, even
    // though this reset came from a standstill and cost it nothing. That lock
    // is not a fault and there is no reason to make the operator start the
    // board again over it — clear it and carry on. A *coded* alarm is the
    // opposite: a limit trip or a reset mid-motion, where position really is
    // suspect and continuing would cut in the wrong place.
    if (this.state.status === 'ALARM') {
      if (this.alarmFaultSeen) {
        this.isJobRunning = false;
        throw new Error(
          `The machine faulted during the restart, so its position can no longer be trusted. ` +
            `${this.state.lastError || ''} Home it ($H), re-zero, and run the job again.`
        );
      }
      await this.sendLine('$X');
      await this.awaitStatus();
    }

    // The work coordinate system survives a reset — G10 L20 offsets live in
    // EEPROM — but only if the controller also kept its machine position. If it
    // moved, every remaining coordinate in the job now points somewhere else,
    // so this is checked rather than assumed.
    const posAfter = this.state.mpos;
    const drift = Math.max(
      Math.abs(posAfter.x - posBefore.x),
      Math.abs(posAfter.y - posBefore.y),
      Math.abs(posAfter.z - posBefore.z)
    );
    if (drift > RESTART_POSITION_TOLERANCE_MM) {
      this.isJobRunning = false;
      throw new Error(
        `The machine lost ${drift.toFixed(2)}mm of position during the restart, so the job ` +
          'can no longer be trusted to cut in the right place. Home it ($H), re-zero, and ' +
          'run the job again.'
      );
    }

    if (this.state.status === 'ALARM') {
      this.isJobRunning = false;
      throw new Error(
        `The controller would not come out of alarm. ${this.state.lastError || ''}`.trim()
      );
    }

    // A reset drops modal state and stops the spindle. Units and distance mode
    // are re-established now; the spindle deliberately is not, because the next
    // thing that happens is a tool-change prompt with the operator's hands near
    // the cutter. It is restarted on resume instead.
    this.spindleRestartPending = !!this.jobSpindleLine;
    await this.sendLine('G21');
    await this.sendLine('G90');

    this.currentQueueIndex = layer.startIndex;
    this.completedLines = layer.startIndex;
    this.isPaused = false;
    this.pauseKind = null;
    this.updateState({
      status: 'RUNNING',
      pauseMessage: undefined,
      currentLine: this.completedLines,
      progressPercent: Math.round((this.completedLines / this.gcodeQueue.length) * 100),
    });
    return this.processQueue();
  }

  /**
   * Resumes after either an operator feed hold or an M0 / M6 stream pause.
   *
   * A tool-change pause is refused until work Z0 has been re-established. This
   * used to be advice printed on a dialog next to an always-enabled Resume
   * button, and advice is not a safeguard: the tool length is the one thing a
   * bit change always alters, and resuming without it drives the next operation
   * as deep as the two bits differ. The full-cut simulation measures 6.1mm for
   * a 4.2mm length difference — through the board, through the spoilboard, at
   * drill feed.
   *
   * There is deliberately no way past it. An override would be reached for
   * exactly when the operator is sure and in a hurry, which is the state the
   * gouge happens in, and a re-zero costs seconds. The first tool of a job does
   * not count as a change — see the tool-change pause.
   */
  public async resumeJob() {
    if (!this.isPaused) return;
    if (this.state.status === 'PAUSED_TOOL' && this.state.needsZeroBeforeResume) {
      if (this.zeroZOps === this.zeroZOpsAtPause) {
        throw new Error(
          'Work Z0 has not been re-zeroed since the bit change, so it still describes the ' +
            'previous tool. Re-zero Z before resuming.'
        );
      }
    }
    const kind = this.pauseKind;
    this.isPaused = false;
    this.pauseKind = null;
    this.updateState({ status: 'RUNNING', pauseMessage: undefined, needsZeroBeforeResume: false });
    // Only a feed hold needs cycle start. After a stream pause the machine has
    // already drained and is idle, and `~` there would be a no-op at best.
    if (kind === 'operator') {
      await this.writeRealtime(RT_RESUME);
    }
    // A restart soft-reset the controller, which stopped the spindle. It is
    // spun back up here rather than before the tool-change prompt, so it is
    // never turning while a bit is being changed.
    if (this.spindleRestartPending && this.jobSpindleLine) {
      this.spindleRestartPending = false;
      await this.sendLine(this.jobSpindleLine);
      await this.sendLine('G4 P2');
    }
    return this.processQueue();
  }

  /** Cancels the running job. */
  public async cancelJob() {
    this.isJobRunning = false;
    this.isPaused = false;
    this.pauseKind = null;
    this.gcodeQueue = [];
    await this.eStop();
    this.updateState({ status: 'IDLE', progressPercent: 0 });
  }

  // -------------------------------------------------------------------------
  // Zeroing and probing
  // -------------------------------------------------------------------------

  /**
   * Nudges the tool by a relative amount — how the bit gets over the corner of
   * the blank before zeroing.
   *
   * `$J=` rather than `G91 G0 … G90`: GRBL parses that as two distance-mode
   * words (both modal group 3) on one line and answers `error:21`. A jog is
   * also cancellable mid-move and leaves modal state alone, so the next line
   * still runs in the mode it expects.
   */
  public async jog(
    delta: { x?: number; y?: number; z?: number },
    feedRate = 1000
  ): Promise<void> {
    const axes = (['x', 'y', 'z'] as const)
      .filter(a => delta[a] !== undefined && delta[a] !== 0)
      .map(a => `${a.toUpperCase()}${delta[a]!.toFixed(3)}`)
      .join(' ');
    if (!axes) return;
    this.assertUnlocked();
    this.clearZeroConfirmation();
    await this.sendLine(`$J=G91 G21 ${axes} F${Math.round(feedRate)}`);
  }

  /** Cancels an in-flight jog (GRBL realtime 0x85), leaving modal state alone. */
  public async jogCancel(): Promise<void> {
    await this.writeRealtime(RT_JOG_CANCEL);
  }

  /** Triggers hardware homing cycle ($H). */
  public async homeMachine(): Promise<void> {
    this.clearZeroConfirmation();
    await this.sendLine('$H');
    this.updateState({ status: 'IDLE', lastError: undefined });
  }

  /**
   * Drops any standing "zeroed here" confirmation. Called whenever the machine
   * moves under its own steam, because the confirmation described where it was
   * rather than where the origin is.
   */
  private clearZeroConfirmation(): void {
    this.updateState({
      zeroXYPending: false,
      zeroXYConfirmed: false,
      zeroZPending: false,
      zeroZConfirmed: false,
    });
  }

  /** Kills GRBL Alarm state ($X). */
  public async unlockAlarm(): Promise<void> {
    await this.sendLine('$X');
    this.updateState({ status: 'IDLE', lastError: undefined });
  }

  /**
   * Refuses to start motion while the controller is locked out. GRBL boots into
   * Alarm whenever homing is enabled ($22=1), and after a limit trip or a
   * failed probe — in that state it answers every G-code line with `error:9`.
   * Failing here names the fix; letting the job start would instead surface as
   * a rejected command somewhere in the middle of the stream.
   */
  private assertUnlocked(): void {
    if (this.state.status === 'ALARM') {
      throw new Error(
        'The machine is in alarm and will refuse every command. Unlock ($X) or home ($H) it first.'
      );
    }
  }

  /**
   * Folds a freshly taken zero into the remembered origin and writes it out.
   * Returns the state patch rather than applying it, so the caller can send it
   * in the same update as the status it was derived from.
   */
  private rememberZero(patch: Partial<SavedWorkOrigin>): Partial<MachineState> {
    const savedZero: SavedWorkOrigin = {
      ...(this.state.savedZero ?? {}),
      ...patch,
      savedAt: Date.now(),
    };
    writeSavedZero(savedZero);
    // A zero set by hand is the operator's answer, so nothing is ever written
    // back over it for the rest of this connection.
    this.zeroRestoreDone = true;
    return { savedZero, zeroRestored: false };
  }

  /**
   * Puts the remembered origin back onto the controller when the controller no
   * longer has it — a firmware reset, or a tab reopened onto a machine that was
   * power-cycled in between. This is the whole point of remembering it: the
   * zeros stay where they were until the operator sets them again.
   *
   * `G10 L2` writes the offset in machine coordinates directly. `L20`, the one
   * the zeroing buttons use, would instead re-zero on wherever the tool is
   * parked right now — which is exactly the mistake being avoided.
   *
   * Runs at most once per connection, and never while the machine is locked
   * out (it would answer error:9) or mid-job.
   */
  private async restoreSavedZeroIfLost(offset: { x: number; y: number; z: number }): Promise<void> {
    if (this.zeroRestoreDone || !this.state.connected) return;
    if (this.state.status === 'ALARM' || this.isJobRunning) return;

    const saved = this.state.savedZero;
    if (!driftsFrom(saved, offset)) {
      // Either nothing is remembered or the machine already agrees. Either way
      // there is nothing to restore, now or later on this connection.
      this.zeroRestoreDone = true;
      return;
    }

    this.zeroRestoreDone = true;
    const words = (['x', 'y', 'z'] as const)
      .filter(a => saved![a] !== undefined)
      .map(a => `${a.toUpperCase()}${saved![a]!.toFixed(3)}`)
      .join(' ');
    try {
      await this.sendLine(`G10 L2 P1 ${words}`);
      this.updateState({ zeroRestored: true });
    } catch {
      // A controller that refuses the offset leaves the operator to re-zero;
      // saying so is the UI's job, and the flag simply stays clear.
      this.zeroRestoreDone = false;
    }
  }

  /** Forgets the remembered origin. The controller's own offsets are left alone. */
  public forgetSavedZero(): void {
    writeSavedZero(undefined);
    this.updateState({ savedZero: undefined, zeroRestored: false });
  }

  /** Sets current XY position as G54 Work Origin (0,0). */
  public async zeroXY(): Promise<void> {
    this.updateState({ zeroXYPending: true, zeroXYConfirmed: false });
    await this.sendLine('G10 L20 P1 X0 Y0');
  }

  /**
   * Sets the current position of one axis — or all three — as work zero.
   * `G10 L20 P1` is a real work offset rather than the temporary shift `G92`
   * gives, so it survives a reset.
   */
  public async zeroAxis(axis: 'X' | 'Y' | 'Z' | 'ALL'): Promise<void> {
    await this.sendLine(
      axis === 'ALL' ? 'G10 L20 P1 X0 Y0 Z0' : `G10 L20 P1 ${axis}0`
    );
  }

  /**
   * Returns to work origin, lifting first. Going straight there in one move
   * would drag the tool across the board at whatever Z it happens to be at.
   */
  public async gotoWorkOrigin(safeZMm = 5): Promise<void> {
    await this.sendLine('G21 G90');
    await this.sendLine(`G0 Z${safeZMm.toFixed(3)}`);
    await this.sendLine('G0 X0 Y0');
  }

  /**
   * Traces the outline of a job with the spindle off, at clearance height.
   *
   * This is the check that the board actually fits the copper blank that is
   * clamped down, made before anything plunges. The spindle is explicitly
   * stopped first: after zeroing Z the tool is sitting on the surface of the
   * stock, and framing from there with the spindle running would drag a
   * spinning cutter right around the outline of the board.
   */
  public async frameJob(
    bounds: { minX: number; minY: number; maxX: number; maxY: number },
    opts: { safeZMm?: number; feedRate?: number } = {}
  ): Promise<void> {
    const { safeZMm = 5, feedRate = 2000 } = opts;
    const { minX, minY, maxX, maxY } = bounds;

    await this.sendLine('M5');
    await this.sendLine('G21 G90');
    await this.sendLine(`G0 Z${safeZMm.toFixed(3)}`);

    const corners: Array<[number, number]> = [
      [minX, minY],
      [maxX, minY],
      [maxX, maxY],
      [minX, maxY],
      [minX, minY],
    ];
    for (const [x, y] of corners) {
      await this.sendLine(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} F${feedRate}`);
    }
  }

  /** GRBL's `$$` settings as read on connect. Empty if they never arrived. */
  public getGrblSettings(): Map<number, number> {
    return new Map(this.grblSettings);
  }

  /** A single `$$` setting, or `undefined` if it was never reported. */
  public getGrblSetting(number: number): number | undefined {
    return this.grblSettings.get(number);
  }

  /**
   * Sets work Z0 using a conductive touch plate. The tool stops on *top* of the
   * plate, so Z0 sits `touchPlateThicknessMm` below the contact point — pass
   * the real thickness or every cut is off by the difference.
   *
   * `surfaceOffsetMm` is how far the copper under the plate stands above the
   * height map's own reference plane — see {@link zeroZOnSurface}.
   */
  public async zeroZ(
    touchPlateThicknessMm = DEFAULT_TOUCH_PLATE_MM,
    surfaceOffsetMm = 0
  ): Promise<void> {
    this.assertUnlocked();
    // Re-zeroing is the main reason to stop for a tool change, so this has to
    // be callable mid-job. The status is restored rather than forced to IDLE:
    // clobbering a PAUSED_TOOL would take the resume banner off screen while
    // the job was still sitting there half-streamed.
    const resumeStatus = this.state.status;
    this.updateState({
      status: 'PROBING',
      zeroZPending: true,
      zeroZConfirmed: false,
      zeroZTargetMm: round3(touchPlateThicknessMm + surfaceOffsetMm),
    });
    try {
      await this.sendLine('G21');
      await this.sendLine('G90');
      const plate = await this.probeDownTwice(30, 50);
      this.updateState({ zeroZScatterMm: plate.scatterMm });
      await this.sendLine(
        `G10 L20 P1 Z${(touchPlateThicknessMm + surfaceOffsetMm).toFixed(3)}`
      );
      await this.awaitStatus();
      await this.retract(PROBE_RETRACT_MM);
      await this.drain();
      this.zeroZOps++;
      this.updateState({ needsZeroBeforeResume: false });
    } finally {
      if (this.state.status === 'PROBING') {
        this.updateState({ status: resumeStatus === 'PROBING' ? 'IDLE' : resumeStatus });
      }
    }
  }

  /**
   * Sets work Z0 on the copper surface directly under the bit, using the
   * continuity clip rather than a touch plate. This is the zero the mesh
   * probe references, so it is the one to set before auto-levelling.
   *
   * `surfaceOffsetMm` is how far the copper *here* stands above the plane the
   * height map is referenced to. Zero for the first zeroing of a job, when
   * that plane is being defined; afterwards it is the map's own reading at
   * this XY. Without it, re-zeroing at a tool change anywhere other than the
   * exact point the map was referenced from shifts every remaining cut by the
   * height difference between the two spots — which is the whole warp on a
   * bowed board. With it, the operator can re-zero wherever the bit happens to
   * be parked and the job carries on cutting to the same plane.
   */
  public async zeroZOnSurface(surfaceOffsetMm = 0): Promise<void> {
    this.assertUnlocked();
    // See zeroZ: an in-job re-zero must give the pause back when it finishes.
    const resumeStatus = this.state.status;
    this.updateState({
      status: 'PROBING',
      zeroZPending: true,
      zeroZConfirmed: false,
      zeroZTargetMm: round3(surfaceOffsetMm),
    });
    try {
      await this.sendLine('G21');
      await this.sendLine('G90');
      const copper = await this.probeDownTwice(25, 50);
      this.updateState({ zeroZScatterMm: copper.scatterMm });
      await this.sendLine(`G10 L20 P1 Z${surfaceOffsetMm.toFixed(3)}`);
      await this.awaitStatus();
      await this.retract(PROBE_RETRACT_MM);
      await this.drain();
      this.zeroZOps++;
      this.updateState({ needsZeroBeforeResume: false });
    } finally {
      if (this.state.status === 'PROBING') {
        this.updateState({ status: resumeStatus === 'PROBING' ? 'IDLE' : resumeStatus });
      }
    }
  }

  /**
   * Lifts the tool by a distance, in relative mode.
   *
   * Retracting off a probe has to be relative. An absolute `G0 Z<n>` is a move
   * to a coordinate in a frame that `G10 L20` has just redefined, and the tool
   * is standing at whatever height the probe stopped at: after zeroing on a
   * 12 mm plate the contact point *is* work Z 12, so an absolute `G0 Z10`
   * drives 2 mm further down — into the plate.
   */
  private async retract(mm: number): Promise<void> {
    await this.sendLine(`G91 G0 Z${Math.abs(mm).toFixed(3)}`);
    await this.sendLine('G90');
  }

  /**
   * Single G38.2 probe toward the work surface, resolving with the contact
   * point reported by GRBL. Rejects if the probe never touches.
   *
   * The probe is issued in **relative** mode (`G91`), so `maxDepthMm` is the
   * distance the tool will actually travel searching for the surface. Sent in
   * absolute mode it would instead mean "probe down to work Z = -depth", which
   * is a completely different move: with work Z0 unset — or left over from a
   * previous session — the tool descends whatever fraction of the gap happens
   * to remain, finds nothing, and GRBL raises ALARM:5. If the current work Z is
   * already below the target it would probe *upward*, away from the stock.
   *
   * `G90` is restored afterwards on its own line, since every caller and all
   * generated job G-code assumes absolute positioning.
   */
  private async probeDown(maxDepthMm: number, feed: number): Promise<{ x: number; y: number; z: number }> {
    // Register the waiter before sending: the [PRB:] report can arrive in the
    // same read chunk as the 'ok'.
    const probed = new Promise<{ x: number; y: number; z: number }>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.probeWaiter = null;
        reject(new Error('Timed out waiting for a probe result from the machine'));
      }, PROBE_TIMEOUT_MS);
      this.probeWaiter = { resolve, reject, timer };
    });

    try {
      // G91 (group 3) and G38.2 (group 1) are different modal groups, so they
      // are legal on one line — unlike a `G91 … G90` pair, which is error:21.
      await this.sendLine(`G91 G38.2 Z${(-Math.abs(maxDepthMm)).toFixed(3)} F${feed}`);
    } catch (err) {
      if (this.probeWaiter) {
        clearTimeout(this.probeWaiter.timer);
        this.probeWaiter = null;
      }
      // Restore absolute mode even on a rejected probe, or every subsequent
      // move in the job would be interpreted as a relative one.
      await this.sendLine('G90').catch(() => {});
      throw err;
    }

    try {
      return await probed;
    } finally {
      await this.sendLine('G90').catch(() => {});
    }
  }

  /**
   * Probes the surface twice and returns the slow reading, plus how far the two
   * disagreed.
   *
   * A single stab is a measurement with no error bar, and its error is not
   * small: the trigger fires when the switch closes, but the axis has already
   * been moving for a control cycle, so a fast approach reads deep by more than
   * the copper it is trying to find. Everything downstream inherits it — work
   * Z0 is that one number, the height map is referenced to it, and an isolation
   * pass is 35 microns of foil plus whatever margin is left.
   *
   * So: a fast stab to find the surface, a short lift, then a slow one to
   * measure it. The slow reading is the answer. The gap between them is the
   * first honest error bar this pipeline has ever had, and it is reported
   * rather than swallowed, because a machine that cannot agree with itself to
   * within a few microns cannot cut foil reliably no matter what depth it is
   * given.
   */
  private async probeDownTwice(
    maxDepthMm: number,
    fastFeed: number
  ): Promise<{ z: number; scatterMm: number }> {
    const fast = await this.probeDown(maxDepthMm, fastFeed);
    await this.retract(PROBE_RESTAB_LIFT_MM);
    // The second stab only has to cross the lift, and slowly: the whole point
    // is to spend the time on the reading that counts.
    const slow = await this.probeDown(
      PROBE_RESTAB_LIFT_MM * 3,
      Math.max(5, Math.round(fastFeed / 5))
    );
    return { z: slow.z, scatterMm: Math.abs(round3(slow.z - fast.z)) };
  }

  /**
   * Polls until the controller has told us where the work origin is, so that a
   * machine-coordinate reading can be converted into work space. GRBL only
   * volunteers `WCO:` every 10-30 status reports, hence the repeated asks.
   * Resolves with undefined if it never turns up.
   */
  private async awaitWorkOffset(): Promise<{ x: number; y: number; z: number } | undefined> {
    // Waits for a report that actually carried a `WCO:` field, not merely for
    // `lastWco` to be non-empty. The carried-over value is right for deriving a
    // work position report to report, and wrong as the answer to "where is the
    // origin *now*" — which is what a probe about to be referenced against it
    // is asking. Insisting on a fresh field costs a few status polls and closes
    // the whole class of stale-frame errors.
    const seenBefore = this.wcoReports;
    for (let i = 0; i < WCO_POLL_ATTEMPTS && this.wcoReports === seenBefore; i++) {
      await this.awaitStatus();
    }
    return this.wcoReports === seenBefore ? undefined : this.lastWco;
  }

  /**
   * Runs the Z-surface mesh probe across the board and returns a grid of
   * offsets relative to the work Z0 plane, ready to hand to warpGcode.
   *
   * Requires work XY zero at the board origin and Z zero on the copper
   * surface — see zeroZOnSurface.
   */
  public async probeSurfaceMesh(opts: ProbeMeshOptions): Promise<ProbeGrid> {
    this.assertUnlocked();

    const cols = Math.max(2, Math.round(opts.cols ?? 4));
    const rows = Math.max(2, Math.round(opts.rows ?? 4));
    const probeDepth = opts.probeDepthMm ?? 3;
    const clearance = opts.clearanceMm ?? 2;
    const probeFeed = opts.probeFeed ?? 50;
    const travelFeed = opts.travelFeed ?? 1500;

    // Each point probes downward from the retract height, so a search shorter
    // than that retract cannot reach the copper at all. Caught here rather than
    // at the machine, where it surfaces as ALARM:5 on the first point.
    if (probeDepth <= clearance) {
      throw new Error(
        `Probe search depth (${probeDepth}mm) must exceed the retract height (${clearance}mm), ` +
          'or the probe stops above the surface without touching it.'
      );
    }

    const stepX = (opts.maxX - opts.minX) / (cols - 1);
    const stepY = (opts.maxY - opts.minY) / (rows - 1);
    const total = rows * cols;

    this.updateState({ status: 'PROBING', probeProgress: { done: 0, total }, lastError: undefined });

    try {
      await this.sendLine('G21');
      await this.sendLine('G90');

      // [PRB:] is reported in machine coordinates, so the work origin is what
      // turns a contact height into "how far the copper sits above or below
      // the Z0 plane" — which is exactly the number warpGcode adds. Read once,
      // up front: nothing in the loop below changes a work offset.
      const workOffset = await this.awaitWorkOffset();

      await this.sendLine(`G0 Z${clearance.toFixed(3)}`);

      const points: ProbePoint[][] = [];
      let done = 0;

      for (let r = 0; r < rows; r++) {
        const rowPoints: ProbePoint[] = [];
        const y = opts.minY + r * stepY;

        for (let c = 0; c < cols; c++) {
          // Serpentine: reverse alternate rows so the head never traverses the
          // whole board between points.
          const colIdx = r % 2 === 0 ? c : cols - 1 - c;
          const x = opts.minX + colIdx * stepX;

          await this.sendLine(`G0 X${x.toFixed(3)} Y${y.toFixed(3)} F${travelFeed}`);
          const contact = await this.probeDown(probeDepth, probeFeed);
          await this.sendLine(`G0 Z${clearance.toFixed(3)} F${travelFeed}`);

          rowPoints[colIdx] = {
            x,
            y,
            z: workOffset ? round3(contact.z - workOffset.z) : contact.z,
          };

          done++;
          this.updateState({ probeProgress: { done, total } });
          opts.onProgress?.(done, total);
        }
        points.push(rowPoints);
      }

      // Re-probe the point the mesh started on. One reading per point is a
      // measurement with nothing to check it against; this second reading of a
      // known spot is the only number in the whole pipeline that says how much
      // the machine's own scatter — trigger repeatability, backlash, a frame
      // that shifted and lost steps part way round — is worth. The isolation
      // depth budget is spent against exactly that, and it used to be a
      // constant somebody picked.
      const first = points[0][0];
      await this.sendLine(`G0 Z${clearance.toFixed(3)} F${travelFeed}`);
      await this.sendLine(`G0 X${first.x.toFixed(3)} Y${first.y.toFixed(3)} F${travelFeed}`);
      const recheck = await this.probeDown(probeDepth, probeFeed);
      const recheckZ = workOffset ? round3(recheck.z - workOffset.z) : recheck.z;
      const verifyDeviationMm = Math.abs(round3(recheckZ - first.z));

      await this.sendLine(`G0 Z${(clearance * 2).toFixed(3)} F${travelFeed}`);
      await this.sendLine(`G0 X${opts.minX.toFixed(3)} Y${opts.minY.toFixed(3)} F${travelFeed}`);
      await this.drain();

      const grid = gridFromPoints(points);
      if (!grid) throw new Error('Probe produced too few points to interpolate');
      grid.verifyDeviationMm = verifyDeviationMm;

      // A machine that cannot find the same spot twice cannot be levelled to,
      // and a map built from single readings hides that completely.
      if (verifyDeviationMm > MAX_PROBE_SCATTER_MM) {
        throw new Error(
          `Re-probing the first point read ${verifyDeviationMm.toFixed(3)}mm away from its ` +
            'first reading, which is more scatter than a height map can be built on. Check the ' +
            'continuity clip for an intermittent contact, the collet for a slipping bit, and ' +
            'the Z axis for lost steps or backlash.'
        );
      }

      if (!workOffset) {
        // No WCO ever arrived, so work space is unknown and the readings are
        // raw machine heights. Falling back to the origin corner keeps the
        // *shape* of the board, but pins the map to whatever that one probe
        // read rather than to the plane the operator zeroed on.
        return normalizeGrid(grid);
      }

      // A heightmap describes a board's warp — tenths of a millimetre. A whole
      // map sitting well off the Z0 plane means Z0 is not on this copper: a
      // zero left over from another setup, a tool changed since, or a probe
      // that was never done. Cutting with it would offset the entire job by
      // that amount, so it is refused rather than streamed.
      const stats = getGridStats(grid);
      const bias = Math.max(Math.abs(stats.minZ), Math.abs(stats.maxZ));
      if (bias > MAX_SURFACE_OFFSET_MM) {
        throw new Error(
          `The probed surface sits ${bias.toFixed(2)}mm from work Z0, which is far more than a ` +
            'board warps. Work Z0 is not on this copper — zero Z on the surface with the bit ' +
            'you are about to cut with, then probe again.'
        );
      }

      // The gross check above only catches a Z0 left over from another setup.
      // The quiet failure is smaller and worse: a map that is the right *shape*
      // but sits bodily off the Z0 plane, because Z0 was set against a stale
      // map's offset rather than on the copper. warpGcode adds this map to
      // every commanded Z, so that body offset lifts the entire job — the
      // isolation pass stops severing the foil while the map still looks
      // perfectly reasonable.
      //
      // Zeroing on the copper puts Z0 *inside* the surface the map spans, so
      // the map's range should straddle zero. It is allowed to clear it by the
      // board's own warp — Z0 may have been set just outside the mesh, on a
      // corner that really is the high or low point — plus a little for probe
      // repeatability, and no further.
      const offPlane = gridOffPlaneMm(grid);
      if (offPlane > SURFACE_PLANE_TOLERANCE_MM) {
        throw new Error(
          `The whole probed surface sits ${offPlane.toFixed(3)}mm ${stats.minZ > 0 ? 'above' : 'below'} ` +
            `work Z0, but the board only varies by ${stats.spanZ.toFixed(3)}mm across the map. ` +
            'That is a displaced Z0 rather than a warped board — it usually means Z was re-zeroed ' +
            'while an older height map was loaded, which offsets the new zero by that map\'s ' +
            'reading. Clear the height map, zero Z on the copper with the bit you are cutting ' +
            'with, then probe again.'
        );
      }

      return grid;
    } finally {
      this.updateState({
        probeProgress: undefined,
        status: this.state.status === 'PROBING' ? 'IDLE' : this.state.status,
      });
    }
  }

  /** Warps G-code Z coordinates using a probed surface heightmap. */
  public applyHeightmapToGcode(gcode: string, grid: ProbeGrid | null): string {
    if (!grid) return gcode;
    return warpGcode(gcode, grid);
  }

  /** Emergency Stop (Ctrl+X soft reset, then spindle off). */
  public async eStop(): Promise<void> {
    if (!this.transport) return;
    this.isJobRunning = false;
    await this.writeRealtime(RT_SOFT_RESET); // Ctrl+X soft reset
    this.failPending(new Error('Emergency stop'));
    await this.transport.writeLine('M5');
  }
}

export const webSerialManager = new WebSerialManager();
