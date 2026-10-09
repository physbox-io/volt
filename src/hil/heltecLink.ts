import type { Edge } from '@xyflow/react';
import { HELTEC_V4_GPIO_PINS } from '../components/nodes/partDefaults';
import type { Hold } from './pinEncoding';

/**
 * The wire to a Heltec board: Volt → WebSocket → CYD (MicroPython relay) →
 * UART → Heltec.
 *
 * The command builders are pure; `HeltecLink` owns the socket, the REPL's line
 * buffer and the lookahead queue of slices waiting to be sent.
 */

/** A Heltec pin's role, from the node's `pins`. */
export type PinMode = 'digital_out' | 'digital_in' | 'analog_in' | string;

export type PinWrite = { pin: number; seq: Hold[] };
export type PinRead = { pin: number; type: 'analog' | 'digital' };
/** One slice's worth of what the board plays and what it reads back after. */
export type SliceCommand = { writes: PinWrite[]; reads: PinRead[] };

/**
 * Which CYD-side handler runs a slice. 'legacy' sends hil_slice (the CYD's
 * MicroPython loops gpio_write/adc_read itself, one blocking UART round trip
 * per op — simple, works against any Heltec firmware). 'native' sends
 * hil_batch (the CYD forwards the whole payload in one UART transaction and
 * the Heltec's own firmware runs the write/sleep/read loop, so there's no
 * ~11ms round trip per edge distorting the timing) — it needs firmware built
 * with the hil_batch handler (heltec/src/uart_cmd.cpp). Both answer with the
 * same `{type:"hil_slice_result", ok, values}`.
 */
export type ExecutionMode = 'legacy' | 'native';

const pinNumber = (pinId: string) => parseInt(pinId.replace('GPIO_', ''));

/**
 * Which of the Heltec node's GPIO pins actually have a wire attached. Pin
 * *mode* still comes from the node's `pins`, but polling or writing a pin
 * that's configured yet unwired wastes a round trip for nothing — a stale
 * preset once had four unconnected pins configured as digital_in, each
 * costing its own UART round trip every slice.
 */
export function connectedHeltecPins(nodeId: string, edges: Edge[]): Set<string> {
  const connected = new Set<string>();
  for (const edge of edges) {
    if (edge.source === nodeId && edge.sourceHandle && edge.sourceHandle.startsWith('GPIO_')) {
      connected.add(edge.sourceHandle);
    }
    if (edge.target === nodeId && edge.targetHandle && edge.targetHandle.startsWith('GPIO_')) {
      connected.add(edge.targetHandle);
    }
  }
  return connected;
}

/**
 * One slice's command: each wired digital_out pin's holds, and a read of each
 * wired input after. A structured payload for a fixed, already-loaded handler
 * (handle_hil_slice / handle_hil_batch in cyd-native's lib/webserver.py)
 * rather than Python source to exec(): exec() measured 700-800ms+ per call
 * on-device even for a ~15-line script, which dominated the round trip.
 */
export function buildSliceCommand(pins: Record<string, PinMode>, outputs: Record<string, Hold[]>, connected: Set<string>): SliceCommand {
  const writes: PinWrite[] = [];
  const reads: PinRead[] = [];
  for (const pinId of HELTEC_V4_GPIO_PINS) {
    if (!connected.has(pinId)) continue;
    const pin = pinNumber(pinId);
    if (pins[pinId] === 'digital_out') {
      writes.push({ pin, seq: outputs[pinId] || [[0, 0]] });
    } else if (pins[pinId] === 'analog_in') {
      reads.push({ pin, type: 'analog' });
    } else if (pins[pinId] === 'digital_in') {
      reads.push({ pin, type: 'digital' });
    }
  }
  return { writes, reads };
}

/**
 * Consecutive queued slices as one command, up to `targetMs` of playback.
 *
 * The device plays a write's whole `seq` before reporting back, so
 * concatenating slices' holds per pin turns N round trips into one. The
 * reads are the last slice's: only the analog-in reads (which drive the next
 * solve) happen less often, which is fine for a slow-changing input.
 */
export function mergeSlices(slices: (SliceCommand & { durationMs: number })[], targetMs: number):
  { command: SliceCommand; durationMs: number; taken: number } {
  let durationMs = 0;
  let taken = 0;
  const writeOrder: number[] = [];
  const writesByPin = new Map<number, Hold[]>();
  let reads: PinRead[] = [];
  while (taken < slices.length && durationMs < targetMs) {
    const item = slices[taken++];
    durationMs += item.durationMs;
    reads = item.reads;
    for (const w of item.writes) {
      let seq = writesByPin.get(w.pin);
      if (!seq) {
        seq = [];
        writesByPin.set(w.pin, seq);
        writeOrder.push(w.pin);
      }
      seq.push(...w.seq);
    }
  }
  const writes = writeOrder.map(pin => ({ pin, seq: writesByPin.get(pin)! }));
  return { command: { writes, reads }, durationMs, taken };
}

/**
 * The REPL script that sets the board up: each wired pin's direction, and,
 * for a run, the radio and GPS off — mesh relaying blocks the Heltec's main
 * loop for 100-500ms per relayed packet and GPS parsing adds more, so both
 * would stall gpio round trips.
 */
export function bootstrapCode(pins: Record<string, PinMode>, connected: Set<string>, forRun: boolean, label = 'starting...'): string {
  let code = `print('[HIL] Bootstrap: ${label}')\n`;
  code += "import lib.webserver as ws\n";
  code += "import machine, utime\n";
  code += "h = ws._mesh_get_heltec()\n";
  code += "print('[HIL] Bootstrap: h =', h)\n";
  if (forRun) {
    code += "h.lora_mode('raw')\n";
    code += "h.gps_power(0)\n";
  }
  Object.entries(pins).forEach(([pinId, mode]) => {
    if (!connected.has(pinId)) return;
    code += `h.gpio_mode(${pinNumber(pinId)}, '${mode === 'digital_out' ? 'out' : 'in'}')\n`;
  });
  return code;
}

/** What puts the board back to idle after a run: GPIO_3 low, mesh and GPS back on. */
export const STOP_CODE = "import lib.webserver as ws\n"
  + "h = ws._mesh_get_heltec()\n"
  + "h.gpio_write(3, 0)\n"
  + "h.lora_mode('mesh')\n"
  + "h.gps_power(1)\n";

/** Marks a background poll's answer among the REPL's other output. */
export const POLL_TAG = 'HIL_BG_DATA:';

/** The wired input pins, in the order a background poll prints them. */
export function polledPins(pins: Record<string, PinMode>, connected: Set<string>): string[] {
  return HELTEC_V4_GPIO_PINS
    .filter(pinId => connected.has(pinId) && (pins[pinId] === 'analog_in' || pins[pinId] === 'digital_in'));
}

/**
 * A REPL script that prints every wired input, comma-separated after
 * `POLL_TAG`, or `ok` with none — the idle board's live readings.
 */
export function backgroundPollCode(pins: Record<string, PinMode>, connected: Set<string>): string {
  const reads = polledPins(pins, connected).map(pinId => pins[pinId] === 'analog_in'
    ? `h.adc_read(${pinNumber(pinId)}) / 4095 * 3.3`
    : `h.gpio_read(${pinNumber(pinId)})`);
  const body = reads.length > 0 ? reads.map(r => `str(${r})`).join(" + ',' + ") : "'ok'";
  return `print('${POLL_TAG}', ${body})\n`;
}

/**
 * The light-to-frequency preset's photo sensor, mapped from the range it
 * really swings over onto the narrow window the simulated VCO responds to.
 * Every other pin and preset reads as measured.
 */
export function calibrateReading(pinId: string, volts: number, presetKey: string): number {
  if (pinId !== 'GPIO_1' || presetKey !== 'heltecLightToFreqHIL') return volts;
  const minPhys = 0.45;
  const maxPhys = 2.2;
  const minVirt = 0.73;
  const maxVirt = 0.92;
  const norm = Math.min(Math.max((volts - minPhys) / (maxPhys - minPhys), 0), 1);
  return minVirt + norm * (maxVirt - minVirt);
}

/** URL for a board address, or null when an https page can't open it. */
export function boardUrl(ip: string, pageIsSecure: boolean): string | null {
  // ws:// from an https page is blocked by the browser as mixed content, and
  // the failed handshake can also wedge WebSerial.
  const isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(ip);
  if (pageIsSecure && !isLocalHost && !/^wss:\/\//i.test(ip)) return null;
  return /^wss?:\/\//i.test(ip) ? ip : `ws://${ip}`;
}

export type LinkHandlers = {
  onOpen: () => void;
  /** A slice finished on the board; `values` are its raw reads by pin number. */
  onSliceResult: (values: Record<string, number> | null) => void;
  /** One complete line of REPL output. */
  onReplLine: (line: string) => void;
  onClose: () => void;
};

/**
 * The socket to one board, and the slices computed ahead of it.
 *
 * The queue exists because a single-slot lookahead (compute exactly the next
 * slice while the current one plays) has zero margin: one slow solve and the
 * board runs out of writes and idles mid-blink. Queuing several slices deep
 * absorbs that jitter.
 */
export class HeltecLink {
  socket: WebSocket | null = null;
  connected = false;
  executionMode: ExecutionMode = 'native';
  /** Slices computed but not yet sent. */
  private queue: (SliceCommand & { durationMs: number })[] = [];
  /** Playback time in `queue`, ms. */
  queuedMs = 0;
  /** The board has answered and is idle, waiting for its next command. */
  waitingForCommand = false;
  private replBuffer = '';

  /** Whether a socket is open or opening. */
  get busy(): boolean {
    return !!this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING);
  }

  get isOpen(): boolean {
    return !!this.socket && this.socket.readyState === WebSocket.OPEN;
  }

  open(url: string, handlers: LinkHandlers): void {
    const ws = new WebSocket(url);
    this.socket = ws;

    ws.onopen = () => {
      console.log(`[HIL] WebSocket connected to CYD at ${url}`);
      this.connected = true;
      handlers.onOpen();
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'hil_slice_result') {
          handlers.onSliceResult(msg.ok && msg.values ? msg.values : null);
          return;
        }
        if (msg.type === 'repl_output') {
          if (msg.output && !msg.output.includes(POLL_TAG)) {
            console.log("[HIL REPL Output]:", msg.output);
          }
          this.replBuffer += msg.output;
          let newlineIdx;
          while ((newlineIdx = this.replBuffer.indexOf('\n')) !== -1) {
            const line = this.replBuffer.slice(0, newlineIdx).trim();
            this.replBuffer = this.replBuffer.slice(newlineIdx + 1);
            handlers.onReplLine(line);
          }
        }
      } catch (e) {
        console.error("[HIL] Error parsing websocket message:", e);
      }
    };

    ws.onclose = () => {
      console.log("[HIL] WebSocket connection closed");
      this.connected = false;
      handlers.onClose();
    };

    ws.onerror = (err) => {
      console.error("[HIL] WebSocket error:", err);
    };
  }

  close(): void {
    this.connected = false;
    if (!this.socket) return;
    // Already closed, or never opened: either way the socket is going.
    try { this.socket.close(); } catch { /* closing a dead socket */ }
    this.socket = null;
  }

  sendRepl(code: string): void {
    this.socket?.send(JSON.stringify({ cmd: 'repl_input', code }));
  }

  sendAudio(samples: Int16Array): void {
    if (this.isOpen) this.socket!.send(samples.buffer);
  }

  /** Empties the queue for a fresh run. */
  resetQueue(): void {
    this.queue = [];
    this.queuedMs = 0;
    this.waitingForCommand = false;
  }

  /** Forget the REPL output half-read from a previous run. */
  resetRepl(): void {
    this.replBuffer = '';
  }

  /** A freshly computed slice: straight to an idle board, else onto the queue. */
  push(command: SliceCommand, durationMs: number): void {
    if (this.waitingForCommand && this.isOpen) {
      this.send(command);
      this.waitingForCommand = false;
    } else {
      this.queue.push({ ...command, durationMs });
      this.queuedMs += durationMs;
    }
  }

  /**
   * Sends the next batch of queued slices, if there is one and the socket is
   * open. Returns whether it did.
   */
  dispatch(batchTargetMs: number): boolean {
    if (this.queue.length === 0) return false;
    const { command, durationMs, taken } = mergeSlices(this.queue, batchTargetMs);
    this.queue.splice(0, taken);
    this.queuedMs -= durationMs;
    if (!this.isOpen) return false;
    this.send(command);
    return true;
  }

  private send(command: SliceCommand): void {
    const cmd = this.executionMode === 'native' ? 'hil_batch' : 'hil_slice';
    this.socket!.send(JSON.stringify({ cmd, ...command }));
  }
}
