import { machineSocketUrl, submitMachineJob } from './apiClient';

// ---------------------------------------------------------------------------
// GRBL byte transports.
//
// The machine controller (webSerialManager) drives GRBL purely in terms of
// "send a line" and "send a realtime byte", and consumes raw serial RX chunks.
// Everything below that abstraction — a USB Web Serial port, or a WebSocket to
// an ESP32 proxy plugged into the machine — lives here. The controller's
// character-counting flow control is unchanged either way: over WiFi the proxy
// relays bytes transparently, so the 127-byte buffer accounting stays valid.
// ---------------------------------------------------------------------------

/** A raw byte pipe to a GRBL controller. Lines are ASCII G-code. */
export interface GrblTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Writes one G-code line. The line has NO trailing newline; the transport adds it. */
  writeLine(line: string): Promise<void>;
  /** Writes a single realtime byte verbatim — no newline, jumps the line queue. */
  writeRealtime(byte: number): Promise<void>;
  /** Registers the sink for raw serial RX chunks (byte-for-byte serial text). */
  onData(cb: (chunk: string) => void): void;
  /** Registers a callback when the connection is closed or dropped unexpectedly. */
  onDisconnect?(cb: (err?: Error) => void): void;
  /**
   * Hands a whole program over for the far end to run by itself.
   *
   * Present only on transports where the machine can do that. Over USB this
   * browser is the streamer and the job lives as long as the tab; through a
   * Tekno Box the device runs the program instead.
   */
  runJob?(
    gcode: string,
    options: { name?: string; estimatedSeconds?: number }
  ): Promise<{ delivered: boolean; message: string }>;
  isOpen(): boolean;
}

/** Longest wait for the WiFi proxy to open the machine link before giving up. */
const WS_CONNECT_TIMEOUT_MS = 8000;

/** The subset of relay JSON frames this transport acts on. */
interface GrblFrame {
  type?: string;
  err?: string;
  data?: string;
}

// ---------------------------------------------------------------------------
// USB — Web Serial
// ---------------------------------------------------------------------------

/**
 * Talks to the machine over the Web Serial API. Reads are decoded to text via a
 * TextDecoderStream (serial RX is ASCII); writes go out on a raw byte writer so
 * a realtime byte lands on the wire exactly, with no UTF-8 re-encoding.
 */
export class WebSerialTransport implements GrblTransport {
  private port: any = null;
  private reader: ReadableStreamDefaultReader<string> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private encoder = new TextEncoder();
  private isReading = false;
  private open = false;
  private dataCb: ((chunk: string) => void) | null = null;
  private disconnectCb: ((err?: Error) => void) | null = null;
  private baudRate: number;

  constructor(baudRate = 115200) {
    this.baudRate = baudRate;
  }

  onData(cb: (chunk: string) => void): void {
    this.dataCb = cb;
  }

  onDisconnect(cb: (err?: Error) => void): void {
    this.disconnectCb = cb;
  }

  isOpen(): boolean {
    return this.open;
  }

  async connect(): Promise<void> {
    this.port = await (navigator as any).serial.requestPort();
    await this.port.open({ baudRate: this.baudRate });

    // This pipe rejects when the port closes or the cable is pulled; that is
    // handled by disconnect(), so swallow it rather than leaving a floating
    // unhandled rejection.
    const textDecoder = new TextDecoderStream();
    this.port.readable.pipeTo(textDecoder.writable).catch(() => {});
    this.reader = textDecoder.readable.getReader();

    this.writer = this.port.writable.getWriter();

    this.open = true;
    this.isReading = true;
    void this.readLoop();
  }

  async disconnect(): Promise<void> {
    this.isReading = false;
    this.open = false;
    try {
      if (this.reader) await this.reader.cancel();
      if (this.writer) await this.writer.close();
      if (this.port) await this.port.close();
    } catch {
      // Ignore cleanup errors — the port may already be gone.
    }
    this.port = null;
    this.reader = null;
    this.writer = null;
  }

  async writeLine(line: string): Promise<void> {
    if (!this.writer) throw new Error('Not connected to a machine');
    await this.writer.write(this.encoder.encode(line + '\n'));
  }

  async writeRealtime(byte: number): Promise<void> {
    if (!this.writer) return;
    try {
      await this.writer.write(new Uint8Array([byte & 0xff]));
    } catch {
      // The read loop reports the disconnect; a realtime byte is fire-and-forget.
    }
  }

  private async readLoop(): Promise<void> {
    while (this.isReading && this.reader) {
      try {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) this.dataCb?.(value);
      } catch {
        break;
      }
    }
    if (this.open) {
      this.open = false;
      this.disconnectCb?.();
    }
  }
}

// ---------------------------------------------------------------------------
// WiFi — WebSocket proxy (ESP32)
// ---------------------------------------------------------------------------

/**
 * Talks to the machine through an ESP32 that exposes a WebSocket on port 80.
 * Browser frames are JSON: a line becomes `grbl_line`, a realtime byte becomes
 * `grbl_raw`, and the device relays serial RX back as `grbl_data`. The same
 * socket also carries unrelated traffic (mesh_*, hil_*, repl_*), so anything
 * that is not a `grbl_data` / `grbl_status` frame is ignored.
 */
export class CloudTransport implements GrblTransport {
  private ws: WebSocket | null = null;
  private open = false;
  private dataCb: ((chunk: string) => void) | null = null;
  private disconnectCb: ((err?: Error) => void) | null = null;
  private deviceId: string;
  private baudRate: number;

  constructor(deviceId: string, baudRate = 115200) {
    this.deviceId = deviceId;
    this.baudRate = baudRate;
  }

  onData(cb: (chunk: string) => void): void {
    this.dataCb = cb;
  }

  onDisconnect(cb: (err?: Error) => void): void {
    this.disconnectCb = cb;
  }

  isOpen(): boolean {
    return this.open;
  }

  private url(): string | null {
    return machineSocketUrl(this.deviceId);
  }

  connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const url = this.url();
      if (!url) {
        reject(new Error('Sign in to physbox, and pair a Tekno Box, to cut over WiFi.'));
        return;
      }
      let settled = false;
      try {
        this.ws = new WebSocket(url);
      } catch (e) {
        reject(e instanceof Error ? e : new Error(`Invalid WebSocket address: ${url}`));
        return;
      }

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.cleanup();
        reject(new Error(`Timed out connecting to ${url}`));
      }, WS_CONNECT_TIMEOUT_MS);

      const done = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) {
          this.cleanup();
          reject(err);
        } else {
          this.open = true;
          resolve();
        }
      };

      // Nothing to send on open: the relay authenticates from the URL and
      // answers with `welcome`. The baud rate is the device's business, since
      // it is the one holding the cable.
      void this.baudRate;

      this.ws.onmessage = ev => {
        if (typeof ev.data !== 'string') return;
        let msg: GrblFrame;
        try {
          msg = JSON.parse(ev.data) as GrblFrame;
        } catch {
          return;
        }
        if (!msg || typeof msg !== 'object') return;

        if (msg.type === 'welcome') {
          done();
          return;
        }

        if (msg.type === 'device_offline') {
          // The relay is up; the machine is not. From here the two are the same
          // thing — commands will not reach the cutter either way — so it is
          // reported as a dropped link rather than swallowed.
          if (settled) {
            this.open = false;
            this.disconnectCb?.(new Error(msg.err || 'The machine is not connected.'));
          } else {
            done(new Error(msg.err || 'That machine is not switched on.'));
          }
          return;
        }

        if (msg.type === 'machine_data' && typeof msg.data === 'string') {
          this.dataCb?.(msg.data);
        }
        // Every other type (mesh_*, hil_*, repl_*, …) is not ours — ignore it.
      };

      this.ws.onerror = () => {
        if (settled) {
          this.open = false;
          this.disconnectCb?.(new Error(`WebSocket connection error to ${url}`));
        } else {
          done(new Error(`Could not connect to ${url}`));
        }
      };

      this.ws.onclose = () => {
        this.open = false;
        if (settled) {
          this.disconnectCb?.();
        } else {
          done(new Error(`Connection to ${url} closed before the machine link opened`));
        }
      };
    });
  }

  async disconnect(): Promise<void> {
    this.open = false;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.close();
      } catch {
        // Best effort — we are tearing the socket down regardless.
      }
    }
    this.cleanup();
  }

  private cleanup(): void {
    if (!this.ws) return;
    this.ws.onopen = null;
    this.ws.onmessage = null;
    this.ws.onerror = null;
    this.ws.onclose = null;
    try {
      this.ws.close();
    } catch {
      // Ignore — already closing.
    }
    this.ws = null;
  }

  async writeLine(line: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to a machine');
    }
    this.ws.send(JSON.stringify({ type: 'machine_line', data: line }));
  }

  async writeRealtime(byte: number): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify({ type: 'machine_realtime', bytes: [byte & 0xff] }));
    } catch {
      // Fire-and-forget, same as a serial realtime byte.
    }
  }

  /**
   * Hands a whole program to the machine to cut on its own.
   *
   * Not streamed from here, unlike the USB path. GRBL acknowledges a line at a
   * time, so a round trip through physbox per line would be unusable — and a
   * browser tab is the wrong thing to hang a long job on. Once this returns the
   * cut survives the laptop being shut.
   */
  async runJob(
    gcode: string,
    options: { name?: string; estimatedSeconds?: number } = {}
  ): Promise<{ delivered: boolean; message: string }> {
    const result = await submitMachineJob({
      deviceId: this.deviceId,
      gcode,
      name: options.name,
      estimatedSeconds: options.estimatedSeconds,
    });
    return { delivered: result.delivered, message: result.message };
  }
}
