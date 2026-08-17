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
  isOpen(): boolean;
}

/** Longest wait for the WiFi proxy to open the machine link before giving up. */
const WS_CONNECT_TIMEOUT_MS = 8000;

/** The subset of proxy JSON frames this transport acts on. */
interface GrblFrame {
  type?: string;
  open?: boolean;
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
export class WebSocketTransport implements GrblTransport {
  private ws: WebSocket | null = null;
  private open = false;
  private dataCb: ((chunk: string) => void) | null = null;
  private disconnectCb: ((err?: Error) => void) | null = null;
  private ip: string;
  private baudRate: number;

  constructor(ip: string, baudRate = 115200) {
    this.ip = ip;
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

  private url(): string {
    const raw = this.ip.trim();
    const withScheme = /^wss?:\/\//i.test(raw) ? raw : `ws://${raw}`;
    // Root path on port 80, as the proxy expects.
    return withScheme.replace(/\/+$/, '') + '/';
  }

  connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.ip.trim()) {
        reject(new Error('Enter the device IP address for WiFi mode'));
        return;
      }

      const url = this.url();
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

      this.ws.onopen = () => {
        this.ws?.send(JSON.stringify({ cmd: 'grbl_open', baud: this.baudRate }));
      };

      this.ws.onmessage = ev => {
        if (typeof ev.data !== 'string') return;
        let msg: GrblFrame;
        try {
          msg = JSON.parse(ev.data) as GrblFrame;
        } catch {
          return;
        }
        if (!msg || typeof msg !== 'object') return;

        if (msg.type === 'grbl_status') {
          if (msg.open === true) done();
          else if (msg.open === false) {
            if (settled) {
              this.open = false;
              this.disconnectCb?.(new Error(msg.err || 'Machine link dropped'));
            } else {
              done(new Error(msg.err || 'The device could not open the machine link'));
            }
          }
          return;
        }

        if (msg.type === 'grbl_data' && typeof msg.data === 'string') {
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
        this.ws.send(JSON.stringify({ cmd: 'grbl_close' }));
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
    this.ws.send(JSON.stringify({ cmd: 'grbl_line', data: line }));
  }

  async writeRealtime(byte: number): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify({ cmd: 'grbl_raw', bytes: [byte & 0xff] }));
    } catch {
      // Fire-and-forget, same as a serial realtime byte.
    }
  }
}
