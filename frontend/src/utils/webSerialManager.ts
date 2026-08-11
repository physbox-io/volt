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

import {
  warpGcode,
  gridFromPoints,
  normalizeGrid,
  type ProbeGrid,
  type ProbePoint,
} from './meshLeveler';

/** GRBL's serial RX buffer. 128 bytes, kept one byte clear for safety. */
const GRBL_RX_BUFFER_BYTES = 127;
/** Longest wait for a single line's 'ok'. Homing a large machine is slow. */
const ACK_TIMEOUT_MS = 180_000;
/** Longest wait for a [PRB:] report after G38.2. */
const PROBE_TIMEOUT_MS = 60_000;

export type MachineStatus =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'IDLE'
  | 'RUNNING'
  | 'PROBING'
  | 'PAUSED_MATERIAL'
  | 'PAUSED_TOOL'
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

interface PendingAck {
  bytes: number;
  resolve: () => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

class WebSerialManager {
  private port: any = null;
  private reader: ReadableStreamDefaultReader<string> | null = null;
  private writer: WritableStreamDefaultWriter<string> | null = null;
  private isReading = false;
  private statusPollTimer: any = null;

  private gcodeQueue: string[] = [];
  private currentQueueIndex = 0;
  private completedLines = 0;
  private isJobRunning = false;
  private isPaused = false;

  /** Lines written to the port whose 'ok' has not come back yet, in order. */
  private inflight: PendingAck[] = [];
  /** Woken whenever the inflight queue shrinks, so writers can resume. */
  private bufferWaiters: Array<() => void> = [];

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
  };

  private listeners: Set<MachineStateListener> = new Set();

  public isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'serial' in navigator;
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
  }

  private updateState(patch: Partial<MachineState>) {
    this.state = { ...this.state, ...patch };
    this.notify();
  }

  /** Requests USB port from user and opens connection at 115200 baud. */
  public async connect(baudRate = 115200): Promise<boolean> {
    if (this.state.connected) return true;

    if (!this.isSupported()) {
      this.updateState({ status: 'ERROR', lastError: 'WebSerial API is not supported in this browser. Use Chrome, Edge, or Opera.' });
      return false;
    }

    try {
      this.updateState({ status: 'CONNECTING' });
      this.port = await (navigator as any).serial.requestPort();
      await this.port!.open({ baudRate });

      // These pipes reject when the port closes or the cable is pulled; that
      // is handled by disconnect(), so swallow it rather than leaving a
      // floating unhandled rejection.
      const textDecoder = new TextDecoderStream();
      this.port!.readable!.pipeTo(textDecoder.writable).catch(() => {});
      this.reader = textDecoder.readable.getReader();

      const textEncoder = new TextEncoderStream();
      textEncoder.readable.pipeTo(this.port!.writable!).catch(() => {});
      this.writer = textEncoder.writable.getWriter();

      this.isReading = true;
      this.readLoop();

      this.updateState({ status: 'IDLE', connected: true, lastError: undefined });

      // GRBL status polling. '?' is a realtime command: it bypasses the RX
      // buffer and draws no 'ok', so it is safe to send during a job too.
      this.statusPollTimer = setInterval(() => {
        if (this.state.connected) this.sendRaw('?');
      }, 250);

      return true;
    } catch (e: any) {
      this.updateState({ status: 'ERROR', connected: false, lastError: e.message || 'Failed to open serial port' });
      return false;
    }
  }

  /** Disconnects from serial port. */
  public async disconnect() {
    this.isReading = false;
    this.isJobRunning = false;
    if (this.statusPollTimer) clearInterval(this.statusPollTimer);
    this.failPending(new Error('Serial port disconnected'));

    try {
      if (this.reader) await this.reader.cancel();
      if (this.writer) await this.writer.close();
      if (this.port) await this.port.close();
    } catch (e) {
      // Ignore cleanup errors
    }

    this.port = null;
    this.reader = null;
    this.writer = null;
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
    if (!this.writer) throw new Error('Not connected to a machine');

    const payload = line + '\n';
    const bytes = payload.length;

    // The second clause lets an oversized line through once the buffer is
    // empty, rather than waiting forever for room that will never exist.
    while (this.inflightBytes() + bytes > GRBL_RX_BUFFER_BYTES && this.inflight.length > 0) {
      await new Promise<void>(resolve => this.bufferWaiters.push(resolve));
      if (!this.writer) throw new Error('Not connected to a machine');
    }

    const ack = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.failPending(new Error(`Timed out waiting for the machine to acknowledge "${line}"`));
      }, ACK_TIMEOUT_MS);
      this.inflight.push({ bytes, resolve, reject, timer });
    });

    await this.sendRaw(payload);
    return { ack };
  }

  /** Sends a single G-code line and waits for the machine to acknowledge it. */
  public async sendLine(line: string): Promise<void> {
    const trimmed = line.trim();
    if (!trimmed) return;
    const { ack } = await this.enqueueLine(trimmed);
    await ack;
  }

  /** Resolves once every sent line has been acknowledged. */
  private async drain(): Promise<void> {
    while (this.inflight.length > 0) {
      await new Promise<void>(resolve => this.bufferWaiters.push(resolve));
    }
  }

  private async sendRaw(data: string) {
    if (this.writer) {
      await this.writer.write(data);
    }
  }

  /** Continuous read loop processing serial input responses from GRBL/Marlin. */
  private async readLoop() {
    let buffer = '';
    while (this.isReading && this.reader) {
      try {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) {
          buffer += value;
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const l of lines) {
            this.parseLine(l.trim());
          }
        }
      } catch (e) {
        break;
      }
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

      for (let i = 1; i < parts.length; i++) {
        const p = parts[i];
        if (p.startsWith('MPos:')) {
          const coords = p.replace('MPos:', '').split(',').map(Number);
          mpos = { x: coords[0] || 0, y: coords[1] || 0, z: coords[2] || 0 };
        } else if (p.startsWith('WPos:')) {
          const coords = p.replace('WPos:', '').split(',').map(Number);
          wpos = { x: coords[0] || 0, y: coords[1] || 0, z: coords[2] || 0 };
        }
      }

      let status: MachineStatus = this.state.status;
      if (grblState.startsWith('Alarm')) status = 'ALARM';
      else if (grblState.startsWith('Hold')) status = 'PAUSED_MATERIAL';
      else if (!this.isJobRunning && this.state.status !== 'PROBING') status = 'IDLE';

      this.updateState({ mpos, wpos, status });
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
        ack.reject(new Error(`Machine rejected a command (${line})`));
      }
      this.wakeBufferWaiters();
      return;
    }

    if (line.startsWith('ALARM:')) {
      this.isJobRunning = false;
      this.updateState({ status: 'ALARM', lastError: line });
      this.failPending(new Error(`Machine alarm: ${line}`));
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
    const rawLines = gcode
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith(';'));

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
      if (line.startsWith('M0') || line.startsWith('M00')) {
        await this.drain();
        this.isPaused = true;
        this.currentQueueIndex++;
        this.updateState({ status: 'PAUSED_MATERIAL', pauseMessage: 'M0 Pause: Swap material sheet and click Resume.' });
        return;
      }
      if (line.includes('M6') || line.startsWith('T')) {
        await this.drain();
        this.isPaused = true;
        this.currentQueueIndex++;
        this.updateState({ status: 'PAUSED_TOOL', pauseMessage: `Tool Change: ${line}. Change bit and click Resume.` });
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

  /** Resumes execution after interactive pause (M0 or M6 tool change). */
  public async resumeJob() {
    if (!this.isPaused) return;
    this.isPaused = false;
    this.updateState({ status: 'RUNNING', pauseMessage: undefined });
    return this.processQueue();
  }

  /** Cancels the running job. */
  public async cancelJob() {
    this.isJobRunning = false;
    this.isPaused = false;
    this.gcodeQueue = [];
    await this.eStop();
    this.updateState({ status: 'IDLE', progressPercent: 0 });
  }

  // -------------------------------------------------------------------------
  // Zeroing and probing
  // -------------------------------------------------------------------------

  /** Triggers hardware homing cycle ($H). */
  public async homeMachine(): Promise<void> {
    await this.sendLine('$H');
  }

  /** Kills GRBL Alarm state ($X). */
  public async unlockAlarm(): Promise<void> {
    await this.sendLine('$X');
    this.updateState({ status: 'IDLE', lastError: undefined });
  }

  /** Sets current XY position as G54 Work Origin (0,0). */
  public async zeroXY(): Promise<void> {
    await this.sendLine('G10 L20 P1 X0 Y0');
  }

  /** Runs Auto Z-Probe Macro for CNC Tool Changes. */
  public async zeroZ(touchPlateThicknessMm = 15.0): Promise<void> {
    await this.probeDown(30, 50);
    await this.sendLine(`G10 L20 P1 Z${touchPlateThicknessMm.toFixed(3)}`);
    await this.sendLine('G0 Z10.000');
  }

  /**
   * Sets work Z0 on the copper surface directly under the bit, using the
   * continuity clip rather than a touch plate. This is the zero the mesh
   * probe references, so it is the one to set before auto-levelling.
   */
  public async zeroZOnSurface(): Promise<void> {
    this.updateState({ status: 'PROBING' });
    try {
      await this.sendLine('G21');
      await this.sendLine('G90');
      await this.probeDown(25, 50);
      await this.sendLine('G10 L20 P1 Z0');
      await this.sendLine('G0 Z2.000');
      await this.drain();
    } finally {
      if (this.state.status === 'PROBING') this.updateState({ status: 'IDLE' });
    }
  }

  /**
   * Single G38.2 probe toward the work surface, resolving with the contact
   * point reported by GRBL. Rejects if the probe never touches.
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
      await this.sendLine(`G38.2 Z${(-Math.abs(maxDepthMm)).toFixed(3)} F${feed}`);
    } catch (err) {
      if (this.probeWaiter) {
        clearTimeout(this.probeWaiter.timer);
        this.probeWaiter = null;
      }
      throw err;
    }

    return probed;
  }

  /**
   * Runs the Z-surface mesh probe across the board and returns a grid of
   * offsets relative to the work Z0 plane, ready to hand to warpGcode.
   *
   * Requires work XY zero at the board origin and Z zero on the copper
   * surface — see zeroZOnSurface.
   */
  public async probeSurfaceMesh(opts: ProbeMeshOptions): Promise<ProbeGrid> {
    const cols = Math.max(2, Math.round(opts.cols ?? 4));
    const rows = Math.max(2, Math.round(opts.rows ?? 4));
    const probeDepth = opts.probeDepthMm ?? 3;
    const clearance = opts.clearanceMm ?? 2;
    const probeFeed = opts.probeFeed ?? 50;
    const travelFeed = opts.travelFeed ?? 1500;

    const stepX = (opts.maxX - opts.minX) / (cols - 1);
    const stepY = (opts.maxY - opts.minY) / (rows - 1);
    const total = rows * cols;

    this.updateState({ status: 'PROBING', probeProgress: { done: 0, total }, lastError: undefined });

    try {
      await this.sendLine('G21');
      await this.sendLine('G90');
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

          rowPoints[colIdx] = { x, y, z: contact.z };

          done++;
          this.updateState({ probeProgress: { done, total } });
          opts.onProgress?.(done, total);
        }
        points.push(rowPoints);
      }

      await this.sendLine(`G0 Z${(clearance * 2).toFixed(3)} F${travelFeed}`);
      await this.sendLine(`G0 X${opts.minX.toFixed(3)} Y${opts.minY.toFixed(3)} F${travelFeed}`);
      await this.drain();

      const grid = gridFromPoints(points);
      if (!grid) throw new Error('Probe produced too few points to interpolate');

      // Re-reference to the origin corner, where the operator set Z0.
      return normalizeGrid(grid);
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
    if (!this.writer) return;
    this.isJobRunning = false;
    await this.sendRaw('\x18'); // Ctrl+X soft reset
    this.failPending(new Error('Emergency stop'));
    await this.sendRaw('M5\n');
  }
}

export const webSerialManager = new WebSerialManager();
