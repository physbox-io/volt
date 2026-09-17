import {
  GrblMachine,
  getGridStats,
  gridFromPoints,
  gridOffPlaneMm,
  normalizeGrid,
  round3,
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
import { machineSocketUrl, postMachineTelemetry, submitMachineJob } from './apiClient';
import { cloudAutosave } from './cloudDocuments';

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

  private lastTelemetryAt = 0;
  private lastTelemetryStatus: MachineStatus | null = null;
  /** Set while a telemetry post is outstanding — see reportTelemetry. */
  private telemetryInFlight = false;

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
    this.updateState({ zeroRestored: false, zeroXYSet: false, zeroZSet: false });
  }

  // -------------------------------------------------------------------------
  // Zero confirmation and the remembered origin
  // -------------------------------------------------------------------------

  /**
   * Resolves a pending zero as soon as the machine reports the work origin
   * where it was asked to be, and remembers it once it has.
   */
  protected onStatusReport(
    _report: StatusReport,
    frames: { wpos: Vec3; wco?: Vec3; framesKnown: boolean }
  ): Partial<MachineState> | void {
    const { wpos, wco: workOffset, framesKnown } = frames;
    const patch: Partial<MachineState> = {};

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
   * Puts the remembered origin back onto the controller when the controller no
   * longer has it — a firmware reset, or a tab reopened onto a machine that was
   * power-cycled in between. This is the whole point of remembering it: the
   * zeros stay where they were until the operator sets them again.
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
      this.updateState({
        zeroRestored: true,
        zeroXYSet: this.state.zeroXYSet || saved!.x !== undefined || saved!.y !== undefined,
        zeroZSet: this.state.zeroZSet || saved!.z !== undefined,
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
    await this.runZeroZ(touchPlateThicknessMm + surfaceOffsetMm, 30);
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
    await this.runZeroZ(surfaceOffsetMm, 25);
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
   * "Proven" means either this session zeroed Z itself (`zeroZSet`, which
   * survives the jog clear of the copper that follows every probe — see the
   * flag's own note), or the previously remembered origin was written back
   * and the controller's own status confirmed it landed (`zeroRestored`) — not
   * just that a restore was attempted, which `zeroRestoreDone` alone would
   * allow for a write the controller silently refused.
   */
  protected assertReadyToCut(): void {
    if (!this.state.zeroZSet && !this.state.zeroRestored) {
      throw new Error(
        'Z zero has not been set this session. Zero it — or reconnect to let the remembered ' +
          'origin restore — before running a job: a Z move against an unconfirmed datum can ' +
          'drive the tool into the board.'
      );
    }
  }

  protected onJobStarted(_parsed: ParsedJob): void {
    this.toolChangesSeen = 0;
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
   * start. Only a soft reset flushes them, so that is what this does.
   */
  public async restartCurrentLayer(): Promise<void> {
    if (!this.isRunning()) throw new Error('No job is running');

    const layer = this.getCurrentLayer();
    if (!layer) throw new Error('This job has no operation markers to restart from');

    await this.writeRealtime(0x21); // feed hold, so the reset lands at a standstill
    await new Promise<void>(resolve => setTimeout(resolve, 600));
    await this.eStop();
    await new Promise<void>(resolve => setTimeout(resolve, 1200));

    // Rewound to the operation's first line, tool change included.
    this.currentQueueIndex = layer.startIndex;
    this.completedLines = layer.startIndex;
    this.isJobRunning = true;
    this.isPaused = true;
    this.pauseKind = 'stream';
    // The reset stopped the spindle, and the spindle-up line is back in the
    // program header. It is replayed on resume rather than now, so it is never
    // turning while a bit is being changed.
    this.spindleRestartPending = true;
    this.zeroZOpsAtPause = this.zeroZOps;
    this.updateState({
      status: 'PAUSED_TOOL',
      currentLine: layer.startIndex,
      progressPercent: Math.round((layer.startIndex / this.gcodeQueue.length) * 100),
      pauseMessage: `Restarting "${layer.label}". Re-zero Z, then click Resume.`,
      needsZeroBeforeResume: true,
    });
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
      // turns a contact height into "how far the copper sits above or below the
      // Z0 plane" — which is exactly the number warpGcode adds. Read once, up
      // front: nothing in the loop below changes a work offset.
      const workOffset = await this.awaitWorkOffset();

      // Not clamped like a retract: `clearance` and `probeDepthMm` are chosen
      // together (checked above), and every probe below travels down exactly
      // `probeDepthMm` from wherever this leaves the tool. Clamping this to
      // "never below the tool's current position" — right after zeroZOnSurface
      // has just confirmed the datum below — would move it *up* instead
      // whenever the tool starts higher than `clearance`, and every probe would
      // then search too little to reach the copper.
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
      // Not clamped, same reason as the loop above: another fixed-depth probe
      // follows this move.
      await this.sendLine(`G0 Z${clearance.toFixed(3)} F${travelFeed}`);
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

  /** Warps G-code Z coordinates using a probed surface heightmap. */
  public applyHeightmapToGcode(gcode: string, grid: ProbeGrid | null): string {
    if (!grid) return gcode;
    return warpGcode(gcode, grid);
  }

  /** Emergency Stop (Ctrl-X soft reset, then spindle off). */
  public async eStop(): Promise<void> {
    if (!this.transport) return;
    await super.eStop();
    // Written straight to the transport rather than queued: the soft reset has
    // just cleared GRBL's buffer, and this has to reach a controller that is
    // still coming back up.
    await this.transport.writeLine('M5');
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
   * another device. `postMachineTelemetry` is a no-op unless the user is signed
   * in, so this costs nothing for a local-only user.
   *
   * The status poll runs at 4Hz and every reply notifies, so posting from there
   * unthrottled would be a request per poll for the whole length of a job.
   * Position is sampled at 1Hz instead, while a change of status goes out
   * immediately — that is the part someone watching remotely actually needs
   * promptly.
   */
  protected onStateNotified(state: MachineState): void {
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
      // Which cloud document this browser is working on, so an archived run
      // points back at the circuit that produced it.
      documentId: cloudAutosave.getStatus().documentId,
      documentRevision: cloudAutosave.getStatus().revision,
    }).finally(() => {
      this.telemetryInFlight = false;
    });
  }
}

export const webSerialManager = new WebSerialManager();
