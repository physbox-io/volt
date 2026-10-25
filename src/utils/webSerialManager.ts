import {
  GrblMachine,
  RT_HOLD,
  TelemetryThrottle,
  classifyPauseLine,
  getGridStats,
  gridFromPoints,
  gridOffPlaneMm,
  normalizeGrid,
  parseJobProgram,
  retractProgram,
  round3,
  stripGcodeComment,
  warpGcode,
  type JobPauseKind,
  type MachineState as BaseMachineState,
  type MachineStatus,
  type ParsedJob,
  type ProbeGrid,
  type ProbePoint,
  type StatusReport,
  type Vec3,
} from '@physbox-io/machining';
import { machineSocketUrl, postMachineTelemetry, submitMachineJob,
  type MachiningTelemetry,
  type RemoteCommand,
} from './apiClient';
import { cloudAutosave } from './cloudDocuments';
import { machineBedStore } from './machineBed';
import { isBoardFlipLine, splitAtBoardFlip } from './boardLevelling';

// ---------------------------------------------------------------------------
// Volt's machine
// ---------------------------------------------------------------------------
//
// The wire, the GRBL protocol, the line queue, the coordinate frames, jogging,
// probing and the streaming loop all live in @physbox-io/machining, shared with
// Etch and Mesh. What is left here is what is specific to milling a circuit
// board: the remembered work origin, the confirmation that a Z datum belongs to
// *this* board and *this* bit, the tool-change rule, the surface mesh probe and
// the guards on the map it produces.
//
// Those are not incidental differences. A laser has no Z datum to get wrong and
// a carve is forgiving of a tenth of a millimetre; an isolation pass is 35
// microns of foil, and every one of the refusals below is a board that came out
// wrong before the check existed.

export type { MachineStatus };
export type { ProbeGrid, ProbePoint };

/**
 * What the program being cut is, for whoever is watching it remotely and for
 * the run archive afterwards.
 *
 * The machine layer cannot work any of this out: it is handed a string of
 * G-code. The CAM panel knows which circuit produced it and what laminate and
 * bits it was planned for, and passes it to `startJob`.
 *
 * The archive opens a run from the *first* telemetry frame of a job and never
 * revisits its settings, so this has to be in place before the first line goes
 * out — which is why `startJob` takes it rather than a setter somewhere.
 */
/** What a job that ran to the end took. */
export interface CompletedJob {
  finishedAt: number;
  elapsedSeconds: number;
  totalLines: number;
  jobName?: string;
}

export interface JobContext {
  name?: string;
  settings?: Record<string, unknown> | null;
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

export interface MachineState extends BaseMachineState {
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
   * Whether a work datum has been *established* on those axes during this
   * connection — as opposed to the tool currently standing on it.
   *
   * The distinction is the whole point. `zeroXYConfirmed`/`zeroZConfirmed`
   * describe where the tool is, so any jog clears them, and jogging away from
   * the origin is the next thing anyone does after setting it: park on the
   * corner, set XY0, jog over the copper, probe Z0, jog clear. By the time the
   * job is started both `Confirmed` flags are false again even though both
   * zeros are perfectly good — which is how "Z zero has not been confirmed
   * this session" came up on a machine that had just been zeroed, and how Go
   * to Zero sat disabled with the origin sitting right there.
   *
   * These flags say the origin exists. They survive motion and are cleared
   * only by a fresh connection, where the controller may be a different
   * machine in a different state.
   */
  zeroXYSet?: boolean;
  zeroZSet?: boolean;
  /**
   * Set at a tool-change pause and cleared by a Z zeroing operation. While it
   * is true, resuming would cut with a work Z0 that describes the *previous*
   * bit — which is a gouge as deep as the two bits differ in length.
   */
  needsZeroBeforeResume?: boolean;
  /**
   * The last job that ran to its final line, for the "Job complete" notice.
   * Set only by `onJobFinished`, at the final acknowledged line, so a cancel,
   * an alarm or a dropped link never raise it; cleared when the next job starts.
   */
  lastCompletedJob?: CompletedJob | null;
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
   * Set when the remembered origin had to be written back onto the controller
   * because its own offsets had been lost. Purely informational — the restore
   * has already happened by the time this is true.
   */
  zeroRestored?: boolean;
  /** The controller reports the probe input closed right now (`Pn:P`). */
  probePinActive?: boolean;
  /**
   * The probe input has been seen to close at least once on this connection.
   *
   * Every probe here is a `G38.2`, which the controller stops on contact — so
   * the one way a probe drives the bit through the board is a circuit that
   * never closes: a clip left off, a lead on the wrong side of the collet, a
   * tip glazed with resin from the last cut. Nothing in the controller can
   * tell that apart from "not there yet" until the search runs out. Touching
   * the bit to the copper by hand before the first stab proves the circuit,
   * and it is refused until that has happened.
   */
  probeCircuitSeen?: boolean;
}

export interface ProbeMeshOptions {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  cols?: number;
  rows?: number;
  probeDepthMm?: number;
  clearanceMm?: number;
  probeFeed?: number;
  travelFeed?: number;
  onProgress?: (done: number, total: number) => void;
}

export type MachineStateListener = (state: MachineState) => void;

const DEFAULT_TOUCH_PLATE_MM = 12;
const PROBE_RETRACT_MM = 5;
/**
 * How far a Z zeroing probe searches for the surface. The bit is parked a few
 * millimetres above it first, so this only has to cover that gap; it used to
 * be 25mm, which on a circuit that failed to close was a 25mm drive through
 * the board.
 */
const ZERO_SEARCH_MM = 10;
/** The most a mesh point searches, however far up the tool was parked. */
const MAX_MESH_SEARCH_MM = 15;

/**
 * How far the whole probed surface may sit from work Z0 before the map is
 * refused. A board warps by tenths of a millimetre; more than this means Z0 is
 * not on this copper at all.
 */
const MAX_SURFACE_OFFSET_MM = 1.5;

/**
 * The most the two readings of the verification point may disagree by. A
 * machine that cannot find the same spot twice cannot be levelled to, and a map
 * built from single readings hides that completely.
 */
const MAX_PROBE_SCATTER_MM = 0.15;

/**
 * How far a map may sit bodily off the Z0 plane, beyond the board's own warp.
 * Tighter than MAX_SURFACE_OFFSET_MM because it catches the quiet failure
 * rather than the gross one — see probeSurfaceMesh.
 */
const SURFACE_PLANE_TOLERANCE_MM = 0.05;

/** How close a reported work position must be to count a zeroing as confirmed. */
const ZERO_CONFIRM_TOLERANCE_MM = 0.1;

/** How far the controller's offset may differ from the saved one before it is restored. */
const ZERO_MATCH_TOLERANCE_MM = 0.02;

const SAVED_ZERO_KEY = 'grblWorkOrigin';

const TELEMETRY_INTERVAL_MS = 1000;

function loadSavedZero(): SavedWorkOrigin | undefined {
  try {
    const raw = localStorage.getItem(SAVED_ZERO_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return undefined;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
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
  try {
    if (saved) localStorage.setItem(SAVED_ZERO_KEY, JSON.stringify(saved));
    else localStorage.removeItem(SAVED_ZERO_KEY);
  } catch {
    // A browser with storage disabled loses the memory, not the session.
  }
}

/** Whether the controller's offset has drifted from the remembered one. */
function driftsFrom(saved: SavedWorkOrigin | undefined, offset: Vec3): boolean {
  if (!saved) return false;
  return (['x', 'y', 'z'] as const).some(
    a => saved[a] !== undefined && Math.abs(saved[a]! - offset[a]) > ZERO_MATCH_TOLERANCE_MM
  );
}

/**
 * How long a layer restart waits for the feed hold to bring the machine to a
 * standstill before it gives up and leaves it in hold. A rapid at default
 * acceleration can take over two seconds to stop; this is generous on purpose,
 * since the alternative to waiting is a reset in motion.
 */
const RESTART_HOLD_TIMEOUT_MS = 10_000;

/** How far machine position may move across a restart's soft reset. */
const RESTART_POSITION_TOLERANCE_MM = 0.05;

/**
 * The spindle line a restarted operation needs replayed on resume, or null if
 * the operation brings the spindle up itself.
 *
 * An operation that changes bit (or stops the spindle for the flip) before it
 * cuts restarts the spindle itself afterwards, so a replay would only spin the
 * old bit up before the park and M5.
 * Otherwise the speed is the last one the program set before the operation —
 * the bit already in the collet is the one that asked for it.
 */
export function layerSpindleRestart(program: string[], startIndex: number): string | null {
  for (let i = startIndex; i < program.length; i++) {
    const code = stripGcodeComment(program[i]).toUpperCase();
    // A bit change, or a stop for the operator (the flip), with the spindle
    // brought down first: the program spins it back up itself afterwards.
    if (classifyPauseLine(program[i]) === 'tool' || /\bM0*5\b/.test(code)) return null;
    if (/\bG0*[123]\b/.test(code)) break;
  }
  for (let i = startIndex - 1; i >= 0; i--) {
    const code = stripGcodeComment(program[i]).toUpperCase();
    if (/\bM0*5\b/.test(code)) return null;
    if (/\bM0*[34]\b/.test(code)) return stripGcodeComment(program[i]);
  }
  return null;
}

/**
 * Whether a G54 offset reads as the blank one a controller comes up with after
 * a firmware reset or an EEPROM wipe. A real zero is never exactly on machine
 * zero on all three axes — that corner is the homing switch, not a board.
 */
function offsetLost(offset: Vec3): boolean {
  return (['x', 'y', 'z'] as const).every(a => Math.abs(offset[a]) <= ZERO_MATCH_TOLERANCE_MM);
}

/**
 * Exported for the policy tests, which drive it against a fake controller.
 * Application code uses the `webSerialManager` singleton below — there is one
 * machine, and two managers fighting over one serial port is not a state worth
 * making reachable.
 */
export class WebSerialManager extends GrblMachine<MachineState> {
  /**
   * Whether this connection has already settled the remembered work origin —
   * restored it, found it already in place, or had it overridden by a manual
   * re-zero. Reset on connect; see restoreSavedZeroIfLost.
   */
  private zeroRestoreDone = false;

  /**
   * Count of completed Z zeroing operations. Compared against its value at the
   * last tool-change pause to answer "did the operator actually re-zero?" —
   * which `zeroZConfirmed` cannot, because that flag means "the tool is
   * standing at the zero", and any jog clears it. Jogging after a re-zero does
   * not un-set the origin, and the pause dialog invites jogging.
   */
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

  /** What the running job is, as the archive should remember it. */
  private jobContext: JobContext = {};
  /** What the last real job (not a frame) was called. See `lastJobName`. */
  private runFromJobName: string | undefined;
  /** When the job on the wire started streaming, for the run time it finishes with. */
  private jobStartedAt: number | null = null;

  /** Telemetry pacing — see `onStateNotified`. */
  private telemetry = new TelemetryThrottle<MachiningTelemetry>({
    intervalMs: TELEMETRY_INTERVAL_MS,
    post: (frame) =>
      postMachineTelemetry('circuit', frame).then((commands) => this.applyRemoteCommands(commands)),
  });

  constructor() {
    super({ endpoints: { machineSocketUrl, submitMachineJob } });
  }

  protected createInitialState(): MachineState {
    return { ...super.createInitialState(), savedZero: loadSavedZero() };
  }

  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------

  protected async onConnected(): Promise<void> {
    // A fresh link is a fresh chance for the controller to have come up without
    // the work origin it had last time.
    this.zeroRestoreDone = false;
    // A new link may be a different machine, or the same one power-cycled. Any
    // datum this session believed in belonged to the old connection.
    this.updateState({
      zeroRestored: false,
      zeroXYSet: false,
      zeroZSet: false,
      probePinActive: false,
      probeCircuitSeen: false,
    });
  }

  // -------------------------------------------------------------------------
  // Zero confirmation and the remembered origin
  // -------------------------------------------------------------------------

  /**
   * Resolves a pending zero as soon as the machine reports the work origin
   * where it was asked to be, and remembers it once it has.
   */
  protected onStatusReport(
    report: StatusReport,
    frames: { wpos: Vec3; wco?: Vec3; framesKnown: boolean }
  ): Partial<MachineState> | void {
    const { wpos, wco: workOffset, framesKnown } = frames;
    const patch: Partial<MachineState> = {};
    // `grblState` keeps only the word; whether a hold has finished
    // decelerating lives in the sub-state, which a layer restart waits on.
    this.lastSubState = report.subState;

    // GRBL lists the asserted pins only while one is asserted, so a report
    // with no `Pn` field means the probe is open.
    const probePinActive = /P/.test(report.pins ?? '');
    if (probePinActive !== !!this.state.probePinActive) patch.probePinActive = probePinActive;
    if (probePinActive && !this.state.probeCircuitSeen) patch.probeCircuitSeen = true;

    if (
      framesKnown &&
      this.state.zeroXYPending &&
      Math.abs(wpos.x) < ZERO_CONFIRM_TOLERANCE_MM &&
      Math.abs(wpos.y) < ZERO_CONFIRM_TOLERANCE_MM
    ) {
      patch.zeroXYPending = false;
      patch.zeroXYConfirmed = true;
      patch.zeroXYSet = true;
    }
    if (
      framesKnown &&
      this.state.zeroZPending &&
      Math.abs(wpos.z - (this.state.zeroZTargetMm ?? 0)) < ZERO_CONFIRM_TOLERANCE_MM
    ) {
      patch.zeroZPending = false;
      patch.zeroZConfirmed = true;
      patch.zeroZSet = true;
    }

    // A zero that has just taken is the moment worth remembering: the origin is
    // where the machine says it is, not where the command asked for it.
    if (patch.zeroXYConfirmed && workOffset) {
      Object.assign(patch, this.rememberZero({ x: workOffset.x, y: workOffset.y }));
    }
    if (patch.zeroZConfirmed && workOffset) {
      Object.assign(
        patch,
        this.rememberZero({ z: workOffset.z, zTargetMm: this.state.zeroZTargetMm ?? 0 })
      );
    }

    // With a *real* offset reading in hand, a controller that came back up
    // without its offsets can be handed them back. Until a WCO has arrived the
    // offset is unknown rather than zero, and restoring against a guess would
    // move the origin instead of preserving it.
    if (framesKnown && workOffset) void this.restoreSavedZeroIfLost(workOffset);

    return patch;
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
   * Puts the remembered origin back onto the controller when the controller has
   * evidently *lost* it — a firmware reset or an EEPROM wipe, which leaves G54
   * at all zeros. This is the whole point of remembering it: the zeros stay
   * where they were until the operator sets them again.
   *
   * Only then. A G54 that is non-zero and merely *different* from the
   * remembered one is somebody's newer zero — a blank set up from another app
   * or another browser — and writing the old origin over it moved the job onto
   * the previous board's position. Nothing here can tell which of two real
   * zeros is right, so the controller's own wins.
   *
   * Only once the machine has homed on this connection, too. G54 is an offset
   * from machine position, and machine position before homing is wherever the
   * gantry stood at power-on: restoring against it puts the origin wherever
   * that offset happens to land today.
   *
   * And a restore never counts as a Z datum (`zeroZSet`). The Z offset is
   * written back so the DRO reads sensibly, but it describes the bit that was
   * in the collet when it was taken; a different bit, or the same one reseated,
   * is a different length, and the first plunge would go as deep as the two
   * differ. Z is always touched off afresh.
   *
   * `G10 L2` writes the offset in machine coordinates directly. `L20`, the one
   * the zeroing buttons use, would instead re-zero on wherever the tool is
   * parked right now — which is exactly the mistake being avoided.
   *
   * Runs at most once per connection, and never while the machine is locked out
   * (it would answer error:9) or mid-job.
   */
  private async restoreSavedZeroIfLost(offset: Vec3): Promise<void> {
    if (this.zeroRestoreDone || !this.state.connected) return;
    if (this.state.status === 'ALARM' || this.isRunning()) return;

    const saved = this.state.savedZero;
    if (!driftsFrom(saved, offset) || !offsetLost(offset)) {
      // Nothing remembered, the machine already agrees, or the machine holds a
      // different real zero that is newer than ours. In every case there is
      // nothing to restore, now or later on this connection.
      this.zeroRestoreDone = true;
      return;
    }
    // Lost, but not yet restorable: try again on a later report, once homed.
    if (!this.state.hasHomed) return;

    this.zeroRestoreDone = true;
    const words = (['x', 'y', 'z'] as const)
      .filter(a => saved![a] !== undefined)
      .map(a => `${a.toUpperCase()}${saved![a]!.toFixed(3)}`)
      .join(' ');
    try {
      await this.sendLine(`G10 L2 P1 ${words}`);
      this.updateState({
        zeroRestored: true,
        zeroXYSet: this.state.zeroXYSet || saved!.x !== undefined || saved!.y !== undefined,
      });
    } catch {
      // A controller that refuses the offset leaves the operator to re-zero;
      // saying so is the UI's job, and the flag simply stays clear.
      this.zeroRestoreDone = false;
    }
  }

  /**
   * Drops the last reported machine error.
   *
   * `lastError` is written by an alarm or a refused line and then left
   * standing: nothing in the protocol layer ever says "and that is over with".
   * A probe that alarmed once therefore kept a red banner on screen through
   * every successful operation that followed it, until the tab was closed.
   * The UI clears it when the operator starts the next action, which is the
   * moment the old failure stops describing anything.
   */
  public clearLastError(): void {
    if (this.state.lastError !== undefined) this.updateState({ lastError: undefined });
  }

  /** Forgets the remembered origin. The controller's own offsets are left alone. */
  public forgetSavedZero(): void {
    writeSavedZero(undefined);
    this.updateState({ savedZero: undefined, zeroRestored: false });
  }

  /**
   * Drops any standing "zeroed here" confirmation. Called whenever the machine
   * moves under its own steam, because the confirmation described where it was
   * rather than where the origin is.
   *
   * `zeroXYSet`/`zeroZSet` are deliberately left alone: the origin is still
   * exactly where it was put. Only the tool has moved off it.
   */
  protected onMachineMoved(): void {
    this.updateState({
      zeroXYPending: false,
      zeroXYConfirmed: false,
      zeroZPending: false,
      zeroZConfirmed: false,
    });
  }

  // -------------------------------------------------------------------------
  // Zeroing
  // -------------------------------------------------------------------------

  public async zeroXY(): Promise<void> {
    this.updateState({ zeroXYPending: true, zeroXYConfirmed: false });
    await super.zeroXY();
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
    await this.runZeroZ(touchPlateThicknessMm + surfaceOffsetMm, ZERO_SEARCH_MM);
  }

  /**
   * Sets work Z0 on the copper surface directly under the bit, using the
   * continuity clip rather than a touch plate. This is the zero the mesh probe
   * references, so it is the one to set before auto-levelling.
   *
   * `surfaceOffsetMm` is how far the copper *here* stands above the plane the
   * height map is referenced to. Zero for the first zeroing of a job, when that
   * plane is being defined; afterwards it is the map's own reading at this XY.
   * Without it, re-zeroing at a tool change anywhere other than the exact point
   * the map was referenced from shifts every remaining cut by the height
   * difference between the two spots — which is the whole warp on a bowed
   * board. With it, the operator can re-zero wherever the bit happens to be
   * parked and the job carries on cutting to the same plane.
   */
  public async zeroZOnSurface(surfaceOffsetMm = 0): Promise<void> {
    await this.runZeroZ(surfaceOffsetMm, ZERO_SEARCH_MM);
  }

  /**
   * Refuses to probe on a circuit nobody has proved. See `probeCircuitSeen`.
   *
   * The opposite state is refused too: an input that reads closed with the
   * bit in the air is a lead shorted to the frame or `$6` set the wrong way,
   * and the controller would alarm on the first stab (ALARM:4) rather than
   * measure anything.
   */
  private assertProbeCircuit(): void {
    if (this.state.probePinActive) {
      throw new Error(
        'The probe input already reads closed. If the bit is not touching the copper, the ' +
          'lead is shorted or the probe pin invert ($6) is set the wrong way — either way a ' +
          'probe cannot tell contact from open air, so it is not started.'
      );
    }
    if (!this.state.probeCircuitSeen) {
      throw new Error(
        'The probe circuit has not been proved on this connection. Clip the continuity lead ' +
          'on, touch the bit to the copper by hand until the probe light comes on, then try ' +
          'again. A probe stops only when that circuit closes; without it the bit is driven ' +
          'into the board.'
      );
    }
  }

  /**
   * The body both Z zeroing routines share.
   *
   * Re-zeroing is the main reason to stop for a tool change, so this has to be
   * callable mid-job. The status is restored rather than forced to IDLE:
   * clobbering a PAUSED_TOOL would take the resume banner off screen while the
   * job was still sitting there half-streamed.
   */
  private async runZeroZ(targetZmm: number, searchDepthMm: number): Promise<void> {
    this.assertUnlocked();
    this.assertProbeCircuit();
    const resumeStatus = this.state.status;
    this.updateState({
      status: 'PROBING',
      zeroZPending: true,
      zeroZConfirmed: false,
      zeroZTargetMm: round3(targetZmm),
    });
    try {
      await this.sendLine('G21');
      await this.sendLine('G90');
      const contact = await this.probeDownTwice(searchDepthMm, 50);
      this.updateState({ zeroZScatterMm: contact.scatterMm });
      await this.sendLine(`G10 L20 P1 Z${targetZmm.toFixed(3)}`);
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

  // -------------------------------------------------------------------------
  // Job policy
  // -------------------------------------------------------------------------

  /**
   * Refuses to start a job while the Z datum is unconfirmed.
   *
   * GRBL keeps G54's Z offset in EEPROM across sessions, tools and boards, so a
   * datum that reads back as perfectly valid may belong to a different setup
   * entirely — connecting leaves it unconfirmed until proven otherwise.
   * "Proven" means this session zeroed Z itself (`zeroZSet`, which survives
   * the jog clear of the copper that follows every probe — see the flag's own
   * note).
   *
   * A restored origin (`zeroRestored`) used to count as well, and it must not:
   * the remembered Z was taken with whatever bit was in the collet then, and a
   * restore landing over a fresh bit was a plunge as deep as the two differ.
   */
  protected assertReadyToCut(): void {
    if (!this.state.zeroZSet) {
      throw new Error(
        'Z zero has not been set this session. Touch off Z on the copper with the bit you are ' +
          'about to cut with before running a job: a Z move against an unconfirmed datum can ' +
          'drive the tool into the board.'
      );
    }
  }

  protected onJobStarted(_parsed: ParsedJob): void {
    this.toolChangesSeen = 0;
    this.jobStartedAt = Date.now();
    this.updateState({ lastCompletedJob: null });
  }

  protected onJobFinished(): Partial<MachineState> {
    const now = Date.now();
    const started = this.jobStartedAt;
    this.jobStartedAt = null;
    return {
      lastCompletedJob: {
        finishedAt: now,
        elapsedSeconds: started === null ? 0 : (now - started) / 1000,
        totalLines: this.state.totalLines,
        jobName: this.jobContext.name,
      },
    };
  }

  /**
   * Streams a program, recorded as whatever the caller says it is.
   *
   * The context is taken here rather than set separately because it has to be
   * in place before the first line goes out: the archive opens a run from the
   * first telemetry frame and keeps the settings it arrived with. A caller that
   * passes nothing — a test, a bare jog program — clears whatever the last job
   * left, so a run is never filed under the one before it.
   */
  override async startJob(gcode: string, job: JobContext = {}): Promise<void> {
    this.jobContext = job;
    this.runFromJobName = job.name;
    await super.startJob(gcode);
  }

  /**
   * A frame or other check, recorded as what it is, that leaves the board's
   * program and its Run From offer alone. Framing the blank after a crash is
   * exactly when that offer is about to be needed.
   */
  override async startAuxiliaryJob(gcode: string, job: JobContext = {}): Promise<void> {
    this.jobContext = job;
    await super.startAuxiliaryJob(gcode);
  }

  /**
   * Why this program could not start right now, or null if it would.
   *
   * `startJob` makes every one of these refusals itself, but only once the
   * panel has already switched to the CAM view and marked itself busy; asked
   * first, the Start button can say why before anything changes on screen.
   * The program asked about must be the one that will be streamed — warped by
   * the height map if it is to be — since its reach is part of the answer.
   */
  public jobBlockedReason(gcode: string): string | null {
    return this.startBlockedReason(parseJobProgram(gcode).lines);
  }

  /**
   * What the last job was recorded as — the one a Run From picks up, since a
   * run from a line streams that job's program again under its own name.
   */
  /** The job a Run From would replay — not a frame run since. */
  public lastJobName(): string | undefined {
    return this.runFromJobName;
  }

  protected describePause(
    kind: JobPauseKind,
    line: string
  ): { status: MachineStatus; message: string; extra?: Partial<MachineState> } {
    if (kind === 'material') {
      return {
        status: 'PAUSED_MATERIAL',
        message: 'M0 Pause: Swap material sheet and click Resume.',
      };
    }

    // A new bit is a different length, so the work Z0 the job has been cutting
    // to no longer describes this tool. Remember how many zeroing operations
    // had happened when the machine stopped, so resumeJob can tell whether the
    // operator actually did one.
    this.zeroZOpsAtPause = this.zeroZOps;
    const isFirstTool = this.toolChangesSeen === 0;
    this.toolChangesSeen++;
    return {
      status: 'PAUSED_TOOL',
      message: `Tool Change: ${line}. Change bit and click Resume.`,
      extra: { needsZeroBeforeResume: !isFirstTool },
    };
  }

  protected assertReadyToResume(): void {
    if (this.state.status === 'PAUSED_TOOL' && this.state.needsZeroBeforeResume) {
      if (this.zeroZOps === this.zeroZOpsAtPause) {
        throw new Error(
          'Work Z0 has not been re-zeroed since the bit change, so it still describes the ' +
            'previous tool. Re-zero Z before resuming.'
        );
      }
    }
  }

  /**
   * The bit change has been dealt with, so the demand for a re-zero goes with
   * it. Cleared here rather than after `resumeJob` returns: streaming may reach
   * the *next* tool change before that, and clearing afterwards would wipe a
   * demand that had just been raised.
   */
  protected onJobResuming(): Partial<MachineState> {
    return { needsZeroBeforeResume: false };
  }

  /**
   * Abandons the operation being cut and runs it again from its first line.
   *
   * The case this exists for: an operation is cutting at the wrong depth — work
   * Z0 was never re-probed after the last bit change — and it is obvious while
   * it is still going. Without this the only option is to cancel and cut the
   * whole board again, including the operations that came out fine.
   *
   * Every operation begins with its own `T<n> M6`, and the rewind deliberately
   * includes it: the stream stops there exactly as it did the first time
   * through, so the tool-change prompt comes back up with its re-zero controls
   * before a single line is re-cut. That prompt is the whole point — it is the
   * step that was skipped.
   *
   * Stopping mid-cut means clearing GRBL's planner, and a feed hold alone will
   * not do that: the queued blocks survive it and would run on the next cycle
   * start. Only a soft reset flushes them — and a soft reset of a machine that
   * is still moving is ALARM:3 with position lost. This used to wait a fixed
   * 600 ms after the hold, which a rapid at default acceleration overruns, and
   * then offered Resume over a machine that no longer knew where it was. So the
   * reset waits for the controller itself to say the hold is complete, and the
   * restart is refused afterwards if the reset cost anything.
   */
  public async restartCurrentLayer(): Promise<void> {
    if (!this.isRunning()) throw new Error('No job is running');

    const layer = this.getCurrentLayer();
    if (!layer) throw new Error('This job has no operation markers to restart from');

    // Stop feeding the controller before anything else, so the streamer cannot
    // push another line at it while it decelerates or resets.
    this.isPaused = true;
    this.pauseKind = 'operator';
    this.queue.hold();
    this.updateState({ status: 'PAUSED_OPERATOR', pauseMessage: `Restarting "${layer.label}"…` });

    await this.writeRealtime(RT_HOLD);
    if (!(await this.awaitStandstill(this.restartHoldTimeoutMs))) {
      // Never reset a machine that may still be moving. It is left exactly as
      // an operator pause leaves it — in feed hold, planner intact — so Resume
      // carries on and E-stop is still there.
      const message =
        `The machine did not report standing still within ${this.restartHoldTimeoutMs / 1000}s ` +
        "of the feed hold, so it was not reset — resetting a moving machine loses its " +
        'position. It is still in feed hold: Resume to carry on, or E-stop.';
      this.updateState({ pauseMessage: message });
      throw new Error(message);
    }

    // Read once the hold has settled, so it is where the tool actually stopped
    // — the reference for checking that the reset cost nothing.
    const posBefore = { ...this.state.mpos };

    // eStop empties the queue along with everything else; the program is kept
    // aside so it can be rewound rather than lost.
    const program = this.gcodeQueue;
    const layers = this.jobLayers;
    this.alarmFaultSeen = false;
    await this.eStop();
    await this.awaitStatus();

    const refuse = (message: string): never => {
      this.isJobRunning = false;
      this.isPaused = false;
      this.pauseKind = null;
      this.updateState({ pauseMessage: undefined, lastError: message });
      throw new Error(message);
    };

    // With homing required ($22=1) GRBL always boots into a locked Alarm, even
    // after a reset from a standstill that cost it nothing. That lock is not a
    // fault, and it is cleared. A *coded* alarm is the opposite — a reset that
    // landed in motion, a limit trip — where position really is suspect.
    if (this.alarmFaultSeen) {
      refuse(
        'The machine raised an alarm during the restart, so its position can no longer be ' +
          `trusted. ${this.state.lastError ?? ''} Home it ($H), re-zero, and run the job again.`
      );
    }
    if (this.state.status === 'ALARM') {
      await this.sendLine('$X').catch(() => {});
      await this.awaitStatus();
    }

    // The work offsets survive a reset — they live in EEPROM — but only mean
    // anything if machine position survived too. Checked, not assumed.
    const posAfter = this.state.mpos;
    const drift = Math.max(
      Math.abs(posAfter.x - posBefore.x),
      Math.abs(posAfter.y - posBefore.y),
      Math.abs(posAfter.z - posBefore.z)
    );
    if (drift > RESTART_POSITION_TOLERANCE_MM) {
      refuse(
        `The machine lost ${drift.toFixed(2)}mm of position during the restart, so the job can ` +
          'no longer be trusted to cut in the right place. Home it ($H), re-zero, and run the ' +
          'job again.'
      );
    }
    if (this.state.status === 'ALARM') {
      refuse(`The controller would not come out of alarm. ${this.state.lastError ?? ''}`.trim());
    }

    // A reset drops modal state.
    await this.sendLine('G21');
    await this.sendLine('G90');

    // Rewound to the operation's first line, tool change included.
    this.gcodeQueue = program;
    this.jobLayers = layers;
    this.currentQueueIndex = layer.startIndex;
    this.completedLines = layer.startIndex;
    this.isJobRunning = true;
    this.isPaused = true;
    this.pauseKind = 'stream';
    // The reset stopped the spindle. An operation that opens with its own bit
    // change brings the spindle back up itself, after the M6 — spinning it up
    // on resume would have it turning through that park and M5, with hands
    // about to go near the collet. Otherwise it is replayed on resume, at the
    // speed the program last asked for before this operation: the bit in the
    // collet is the one that set it, not whatever the header started with.
    const spindle = layerSpindleRestart(program, layer.startIndex);
    this.spindleRestartPending = spindle !== null;
    if (spindle) this.jobSpindleLine = spindle;
    this.zeroZOpsAtPause = this.zeroZOps;
    this.updateState({
      status: 'PAUSED_TOOL',
      currentLine: layer.startIndex,
      progressPercent: Math.round((layer.startIndex / program.length) * 100),
      pauseMessage: `Restarting "${layer.label}". Re-zero Z, then click Resume.`,
      needsZeroBeforeResume: true,
    });
  }

  /** See RESTART_HOLD_TIMEOUT_MS. An instance field so the tests need not wait it out. */
  protected restartHoldTimeoutMs = RESTART_HOLD_TIMEOUT_MS;

  /** The sub-state of the latest status report — `Hold:0` vs `Hold:1`. */
  private lastSubState: number | undefined;

  /** Set by a coded `ALARM:n` line; see restartCurrentLayer. */
  private alarmFaultSeen = false;

  protected onAlarm(): void {
    this.alarmFaultSeen = true;
  }

  /**
   * Polls until the controller reports it has stopped — `Hold:0` (hold
   * complete; `Hold:1` is still decelerating) or `Idle` — and says whether it
   * did before the timeout. An alarm is not a standstill worth resetting from.
   */
  private async awaitStandstill(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (this.state.connected) {
      await this.awaitStatus();
      const word = this.state.grblState ?? '';
      if ((word.startsWith('Hold') && this.lastSubState === 0) || word.startsWith('Idle')) return true;
      if (word.startsWith('Alarm') || Date.now() >= deadline) return false;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Surface mesh probing
  // -------------------------------------------------------------------------

  /**
   * Runs the Z-surface mesh probe across the board and returns a grid of
   * offsets relative to the work Z0 plane, ready to hand to warpGcode.
   *
   * Requires work XY zero at the board origin and Z zero on the copper surface
   * — see zeroZOnSurface.
   */
  public async probeSurfaceMesh(opts: ProbeMeshOptions): Promise<ProbeGrid> {
    this.assertUnlocked();
    this.assertProbeCircuit();

    const cols = Math.max(2, Math.round(opts.cols ?? 4));
    const rows = Math.max(2, Math.round(opts.rows ?? 4));
    let probeDepth = opts.probeDepthMm ?? 3;
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
      // turns a contact height into "how far the copper sits above or below the
      // Z0 plane" — which is exactly the number warpGcode adds. Read once, up
      // front: nothing in the loop below changes a work offset.
      const workOffset = await this.awaitWorkOffset();

      // Zeroing leaves the tool parked PROBE_RETRACT_MM up, and the first point
      // then lifts a further clearance before it searches — more than the
      // default search covers, so the first point alarmed out with nothing
      // touched. When Z0 was set on this connection the live work Z says how
      // far down the copper is, and the search is stretched to reach it, plus
      // a little for the surface being lower here than where Z0 was taken.
      // Bounded, and a longer search is only ever a longer G38.2: it still
      // stops on contact, and the contact circuit was proved before starting.
      if (this.state.zeroZSet && this.state.wpos.z > 0) {
        probeDepth = Math.min(
          MAX_MESH_SEARCH_MM,
          Math.max(probeDepth, this.state.wpos.z + clearance + 1)
        );
      }

      /*
       * Relative, and every lift below it is too.
       *
       * This used to be an absolute `G0 Z<clearance>`, on the reasoning that
       * the datum had just been confirmed by `zeroZOnSurface` and each probe
       * needs a known height to search from. The reasoning holds right up until
       * the datum is wrong — a Z zeroed on the wrong face, a G54 offset left
       * over from another job — and then the move that was meant to lift clear
       * is a full-speed plunge through the board before any probe has run. That
       * is not hypothetical: it destroyed a tool and a plate on Mesh, which is
       * why no probe routine in any of these apps commands an absolute Z any
       * more.
       *
       * The height the tool starts at is the operator's, and each lift below
       * tracks the surface it just measured.
       */
      await this.sendProgram(retractProgram(clearance));

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

          // XY only: no Z word, so the tool crosses at the height the last
          // lift left it, which tracks the copper rather than a datum.
          await this.sendLine(`G0 X${x.toFixed(3)} Y${y.toFixed(3)} F${travelFeed}`);
          const contact = await this.probeDown(probeDepth, probeFeed);
          await this.sendProgram(retractProgram(clearance));

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
      // Relative, as above: a fixed-depth probe follows this move, and an
      // absolute Z before a probe is the plunge this routine refuses to make.
      await this.sendProgram(retractProgram(clearance));
      await this.sendLine(`G0 X${first.x.toFixed(3)} Y${first.y.toFixed(3)} F${travelFeed}`);
      const recheck = await this.probeDown(probeDepth, probeFeed);
      const recheckZ = workOffset ? round3(recheck.z - workOffset.z) : recheck.z;
      const verifyDeviationMm = Math.abs(round3(recheckZ - first.z));

      // The last move of the routine, with no probe left to follow it, so this
      // one really is just a retract — clamped like any other.
      const finalClearZ = await this.clampedRetractZ(clearance * 2);
      await this.sendLine(`G0 Z${finalClearZ.toFixed(3)} F${travelFeed}`);
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
            "while an older height map was loaded, which offsets the new zero by that map's " +
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

  /**
   * Warps G-code Z coordinates using a probed surface heightmap — up to the
   * board flip, and not past it.
   *
   * The map is a measurement of the face that was up when it was probed.
   * After the flip the bit is cutting the other face, re-clamped, and the map
   * describes a surface that is now underneath: applying it there cut the
   * bottom copper to the top's warp, mirrored wrong and in the wrong places.
   * The bottom runs unlevelled instead, at the depth the exporter gave it.
   */
  public applyHeightmapToGcode(gcode: string, grid: ProbeGrid | null): string {
    if (!grid) return gcode;
    const { probedFace, afterFlip } = splitAtBoardFlip(gcode);
    const warped = warpGcode(probedFace, grid);
    return afterFlip === null ? warped : `${warped}\n${afterFlip}`;
  }

  /**
   * The spindle speed the job on the wire will next ask for, or null if it asks
   * for none. At a tool change this is the bit going in: every bit carries its
   * own speed, set on the line after its M6.
   */
  public nextSpindleRpm(): number | null {
    if (!this.isJobRunning) return null;
    for (let i = this.currentQueueIndex; i < this.gcodeQueue.length; i++) {
      const code = stripGcodeComment(this.gcodeQueue[i]).toUpperCase();
      if (!/\bM0*[34]\b/.test(code)) continue;
      const s = /\bS(\d+(?:\.\d+)?)/.exec(code);
      if (s) return parseFloat(s[1]);
    }
    return null;
  }

  /**
   * Whether the job on the wire has reached its board flip. From there on the
   * bit is over the face the height map does *not* describe, so a re-zero must
   * not be offset by the map's reading (see `zeroZOnSurface`).
   */
  public isPastBoardFlip(): boolean {
    if (!this.isJobRunning) return false;
    const at = this.gcodeQueue.findIndex(isBoardFlipLine);
    return at >= 0 && this.currentQueueIndex > at;
  }

  /** Emergency Stop (Ctrl-X soft reset, then spindle off). */
  public async eStop(): Promise<void> {
    if (!this.transport) return;
    await super.eStop();
    // Queued like any line, so its `ok` is booked to it: written straight to
    // the transport, that reply went unclaimed and answered whatever was sent
    // next. The reset above has already waited for the controller to come
    // back up, so this reaches one that is listening.
    await this.sendLine('M5').catch(() => {});
  }

  // -------------------------------------------------------------------------
  // Telemetry
  // -------------------------------------------------------------------------

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
   * another device, and so the run archive has it. `postMachineTelemetry` is a
   * no-op unless the user is signed in, so this costs nothing for a local-only
   * user.
   *
   * Paced by the shared `TelemetryThrottle`: position at most once a second, a
   * change of status at once — that is the part someone watching remotely
   * actually needs promptly — and a final frame when the controller drops off
   * mid-job, so the run closes as the crash it was rather than reading
   * "running" until the server times it out.
   */
  protected onStateNotified(state: MachineState): void {
    if (!state.connected) {
      const reason = state.lastError ? ` (${state.lastError})` : '';
      this.telemetry.connectionLost((last) => ({
        ...last,
        status: 'error',
        lastError: `Lost the connection to the controller at line ${last.currentLine}${reason}.`,
      }));
      return;
    }

    this.telemetry.offer(
      {
        status: this.telemetryStatus(state.status),
        jobName: this.jobContext.name,
        // What the board was cut from and with. Without it an archived run says
        // how long it took and nothing about what it produced.
        settings: this.jobContext.settings ?? null,
        progressPercent: state.progressPercent,
        currentLine: state.currentLine,
        totalLines: state.totalLines,
        xyz: { ...state.wpos },
        lastError: state.lastError ?? null,
        // Which cloud document this browser is working on, so an archived run
        // points back at the circuit that produced it.
        documentId: cloudAutosave.getStatus().documentId,
        documentRevision: cloudAutosave.getStatus().revision,
      },
      state.status,
      this.isJobRunning
    );
  }

  /**
   * Acts on what was asked for from another device.
   *
   * Only while a job is actually on the wire. The queue is drained by the post
   * regardless, so a command that arrives against an idle machine is discarded
   * rather than held: it was aimed at a cut, and that cut is over.
   *
   * Sequentially, because the trims are realtime bytes and GRBL counts them —
   * two writes racing is two nudges in an order neither end chose.
   *
   * An unrecognised kind is ignored rather than guessed at. The server already
   * refuses to queue one this build has not claimed; this is the same rule
   * stated where it is enforced.
   */
  private async applyRemoteCommands(commands: RemoteCommand[]): Promise<void> {
    if (!commands?.length || !this.isRunning()) return;

    for (const c of commands) {
      try {
        if (c.kind === 'pause') {
          await this.pauseJob();
          continue;
        }

        if (c.kind === 'resume') {
          await this.resumeRemotely();
          continue;
        }

        if (c.kind === 'rapid') {
          if (c.step === 100 || c.step === 50 || c.step === 25) {
            await this.setRapidOverride(c.step);
          }
          continue;
        }
        if (c.kind !== 'feed' && c.kind !== 'spindle') continue;

        const nudge = c.step === 1 || c.step === -1 || c.step === 10 || c.step === -10 ? c.step : null;
        if (c.kind === 'feed') {
          if (nudge === null) await this.resetFeedOverride();
          else await this.nudgeFeedOverride(nudge);
        } else {
          if (nudge === null) await this.resetSpindleOverride();
          else await this.nudgeSpindleOverride(nudge);
        }
      } catch {
        // A dropped write is one nudge, and the next status report shows the
        // percentage that actually took. Nothing here is worth failing a post.
      }
    }
  }

  /**
   * Picks a job back up on the say-so of a device that cannot see the machine.
   *
   * Refused outright when the pause came from the program rather than from a
   * person — an M0 or an M6. Those mean somebody is at the bench with their
   * hands on the work, changing a tool or clearing a part, and the thing that
   * tells them it is safe to stand back is the operator pressing Resume where
   * they can see it. A phone in another room cannot know that, so it does not
   * get to decide it.
   *
   * An operator pause is the opposite case: it is a feed hold somebody asked
   * for, and picking it up is the whole point of being able to do this at all.
   * `resumeJob` still applies its own refusals on top — a bit change leaves Z
   * describing the previous tool, and it will not resume until that is redone.
   */
  private async resumeRemotely(): Promise<void> {
    if (this.pauseKind !== 'operator') return;
    await this.resumeJob();
  }

}

export const webSerialManager = new WebSerialManager();

// The owner's figure for the working envelope, for the travel check wherever
// the controller has not reported its own; kept current as it is edited or
// arrives from the account.
webSerialManager.setBed(machineBedStore.get());
machineBedStore.subscribe((bed) => webSerialManager.setBed(bed));
