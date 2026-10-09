export interface PWLPoint {
  t: number;
  v: number;
}

export interface McuExecutionResult {
  pwlOutputs: Record<string, PWLPoint[]>;
  pinModes: Record<string, 'INPUT' | 'OUTPUT'>;
  logs: string[];
}

/**
 * Everything a sketch carries from one slice of the run to the next.
 *
 * A slice does not restart the sketch: it resumes the generator where the last
 * `sleep()` left it, with the pin modes, the last driven voltages and the clock
 * still set. That is why this is handed back out and parked on the node rather
 * than rebuilt — a state rebuilt each slice would make every `sleep()` in a
 * sketch run forever and every output start again from 0V.
 */
export interface McuState {
  /** Time within the current slice; the PWL outputs are written against it. */
  mcuTimeMs: number;
  /** Time at which the current slice began, so `millis()` keeps counting across slices. */
  sliceStartMs?: number;
  simLengthMs: number;
  inputWaveforms: Record<string, PWLPoint[]>;
  logs: string[];
  pinModes: Record<string, 'INPUT' | 'OUTPUT'>;
  /** Last value driven onto each output, so the next slice starts from it. */
  lastPinVals: Record<string, number>;
  pwlOutputs: Record<string, PWLPoint[]>;
  /** The compiled sketch, mid-run. `yield` hands back a sleep in ms. */
  generator?: Generator<number, void, unknown>;
  /** A sleep that ran past the end of a slice, and how much of it was served. */
  pendingYield?: { duration: number; elapsed: number } | null;
}

export function executeMcuCode(
  code: string,
  simLengthSeconds: number,
  inputWaveforms: Record<string, PWLPoint[]>,
  initialState?: unknown
): McuExecutionResult & { newState: McuState } {
  // `unknown` in, because what arrives is whatever was parked on the node last
  // slice — out of a saved file or an MCP agent as easily as out of this
  // function. The fields the rest of this body relies on are all filled in
  // immediately below, which is what makes the assertion good.
  const state = (initialState || {}) as McuState;

  // Setup execution context inside state to share with generator closures
  state.mcuTimeMs = 0;
  state.sliceStartMs = state.sliceStartMs ?? 0;
  state.inputWaveforms = inputWaveforms;
  state.simLengthMs = simLengthSeconds * 1000;
  state.logs = [];

  // Persist pin configuration and last value across slices
  state.pinModes = state.pinModes || {};
  state.lastPinVals = state.lastPinVals || {};

  // Re-initialize pwlOutputs for each output pin with its last value
  state.pwlOutputs = {};
  for (const pin in state.pinModes) {
     if (state.pinModes[pin] === 'OUTPUT') {
        const lastVal = state.lastPinVals[pin] ?? 0;
        state.pwlOutputs[pin] = [{ t: 0, v: lastVal }];
     }
  }

  function getVoltageAtTime(pin: string, timeMs: number): number {
    const wave = state.inputWaveforms[pin];
    if (!wave || wave.length === 0) return 0;
    
    let lastP = wave[0];
    for (let i = 0; i < wave.length; i++) {
      const p = wave[i];
      if (p.t >= timeMs) {
        const dt = p.t - lastP.t;
        if (dt === 0) return lastP.v;
        const fraction = (timeMs - lastP.t) / dt;
        return lastP.v + fraction * (p.v - lastP.v);
      }
      lastP = p;
    }
    return lastP.v;
  }

  const api = {
    HIGH: 1,
    LOW: 0,
    INPUT: 'INPUT',
    OUTPUT: 'OUTPUT',
    state,
    simLength: state.simLengthMs,
    pinMode: (pin: string, mode: 'INPUT' | 'OUTPUT') => {
       state.pinModes[pin] = mode;
       if (mode === 'OUTPUT' && !state.pwlOutputs[pin]) {
          state.pwlOutputs[pin] = [{ t: 0, v: 0 }]; // start at 0V
       }
    },
    digitalWrite: (pin: string, val: number) => {
       if (state.pinModes[pin] !== 'OUTPUT') return;
       const out = state.pwlOutputs[pin];
       const v = val ? 5 : 0;
       
       state.lastPinVals[pin] = v; // Remember last value for next slice
       
       if (out.length > 0 && out[out.length - 1].v === v) return;
       
       if (out.length > 0 && out[out.length - 1].t === state.mcuTimeMs) {
         out[out.length - 1].v = v;
       } else {
         const lastVal = out.length > 0 ? out[out.length - 1].v : 0;
         if (state.mcuTimeMs > 0 && out.length > 0 && out[out.length - 1].t < state.mcuTimeMs) {
           out.push({ t: state.mcuTimeMs - 0.001, v: lastVal });
         }
         out.push({ t: state.mcuTimeMs, v: v });
       }
    },
    analogWrite: (pin: string, val: number) => {
       if (state.pinModes[pin] !== 'OUTPUT') return;
       const out = state.pwlOutputs[pin];
       const v = (Math.max(0, Math.min(255, val)) / 255) * 5; 
       
       state.lastPinVals[pin] = v; // Remember last value for next slice
       
       if (out.length > 0 && out[out.length - 1].v === v) return;
       
       if (out.length > 0 && out[out.length - 1].t === state.mcuTimeMs) {
         out[out.length - 1].v = v;
       } else {
         const lastVal = out.length > 0 ? out[out.length - 1].v : 0;
         if (state.mcuTimeMs > 0 && out.length > 0 && out[out.length - 1].t < state.mcuTimeMs) {
           out.push({ t: state.mcuTimeMs - 0.001, v: lastVal });
         }
         out.push({ t: state.mcuTimeMs, v });
       }
    },
    digitalRead: (pin: string) => {
       const v = getVoltageAtTime(pin, state.mcuTimeMs);
       return v > 2.5 ? 1 : 0;
    },
    analogRead: (pin: string) => {
       const v = getVoltageAtTime(pin, state.mcuTimeMs);
       let val = (v / 5.0) * 1023;
       if (val < 0) val = 0;
       if (val > 1023) val = 1023;
       return Math.floor(val);
    },
    sleep: (_ms: number) => {
       // Generator-based sleep is resolved outside via yield
    },
    wait: (_ms: number) => {},
    millis: () => (state.sliceStartMs ?? 0) + state.mcuTimeMs,
    Serial: {
      println: (msg: unknown) => state.logs.push(String(msg)),
      print: (msg: unknown) => {
        if (state.logs.length === 0) state.logs.push("");
        state.logs[state.logs.length - 1] += String(msg);
      }
    }
  };

  // Compile the user script into a Generator Function on first run
  if (!state.generator) {
     const apiKeys = Object.keys(api);
     const apiValues = Object.values(api);
     const rewrittenCode = code.replace(/sleep\(/g, 'yield(').replace(/wait\(/g, 'yield(');
     
     try {
        const wrapper = new Function(...apiKeys, `return function*() { ${rewrittenCode} }`);
        const genFactory = wrapper(...apiValues);
        state.generator = genFactory();
     } catch (err) {
        console.error("MCU Compilation Error:", err);
        return { 
           pwlOutputs: {}, 
           pinModes: {}, 
           logs: ["Compilation Error: " + String(err)], 
           newState: state 
        };
     }
  }

  // Resume active sleep yield if we carried one over
  let currentYield = state.pendingYield || null;
  if (currentYield) {
     const remainingMs = currentYield.duration - currentYield.elapsed;
     if (state.mcuTimeMs + remainingMs >= state.simLengthMs) {
        currentYield.elapsed += state.simLengthMs;
        state.mcuTimeMs = state.simLengthMs;
     } else {
        state.mcuTimeMs += remainingMs;
        currentYield = null;
     }
  }

  // Run the generator function up to the slice boundary
  while (!currentYield && state.mcuTimeMs < state.simLengthMs) {
     let res;
     try {
        res = state.generator.next();
     } catch (e) {
        console.error("MCU Runtime Error:", e);
        state.logs.push("Runtime Error: " + String(e));
        break;
     }
     
     if (res.done) {
        break;
     }
     
     const sleepDuration = res.value || 0;
     if (state.mcuTimeMs + sleepDuration >= state.simLengthMs) {
        const elapsedInSlice = state.simLengthMs - state.mcuTimeMs;
        currentYield = { duration: sleepDuration, elapsed: elapsedInSlice };
        state.mcuTimeMs = state.simLengthMs;
     } else {
        state.mcuTimeMs += sleepDuration;
     }
  }

  state.pendingYield = currentYield;
  state.sliceStartMs += state.simLengthMs;

  // Finish off PWL arrays to extend to the end of the simulation slice
  for (const pin in state.pwlOutputs) {
     const out = state.pwlOutputs[pin];
     if (out.length > 0 && out[out.length - 1].t < state.simLengthMs) {
        out.push({ t: state.simLengthMs, v: out[out.length - 1].v });
     }
  }

  return { 
     pwlOutputs: state.pwlOutputs, 
     pinModes: state.pinModes, 
     logs: state.logs, 
     newState: state 
  };
}

/** What one sketch drives onto its pins over a run, which is all the netlist needs of it. */
export type McuDrive = Pick<McuExecutionResult, 'pwlOutputs' | 'pinModes'>;

/** Anything with an id, a type and data: a canvas node, without the canvas. */
type SketchNode = { id: string; type?: string; data: Record<string, unknown> };

/**
 * Runs every MCU's sketch over the next `simLengthSeconds`, from wherever it
 * was left, and parks each one's state back on its node for the next call.
 *
 * This is the only place a sketch advances. Building a netlist never does it,
 * so a netlist can be built as often as is convenient — for a bias point, a
 * sweep, a second pass — without stepping the program on behind the run.
 * To run the same window again, clear `data.state` first.
 */
export function runSketches(
  nodes: SketchNode[],
  simLengthSeconds: number,
  inputWaveforms: Record<string, Record<string, PWLPoint[]>> = {},
): { drives: Record<string, McuDrive>; logs: Record<string, string[]> } {
  const drives: Record<string, McuDrive> = {};
  const logs: Record<string, string[]> = {};
  for (const node of nodes) {
    if (node.type !== 'mcu') continue;
    const run = executeMcuCode(
      (node.data.code as string) || '',
      simLengthSeconds,
      inputWaveforms[node.id] || {},
      node.data.state || {},
    );
    node.data.state = run.newState;
    drives[node.id] = { pwlOutputs: run.pwlOutputs, pinModes: run.pinModes };
    logs[node.id] = run.logs;
  }
  return { drives, logs };
}

/**
 * A 64-bit fingerprint of what every MCU drives over a slice, for a cache key.
 *
 * The HIL cache keyed on `JSON.stringify` of the drives, which writes every
 * PWL point of every pin as text on every slice, hit or miss. This folds the
 * same content — MCU ids, pin modes, and each point's time and voltage, all
 * in sorted order — through two FNV-1a lanes over the numbers' bits instead.
 */
export function hashDrives(drives: Record<string, McuDrive>): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  const mixInt = (x: number) => {
    a = Math.imul(a ^ (x & 0xff), 0x01000193) >>> 0;
    a = Math.imul(a ^ ((x >>> 8) & 0xff), 0x01000193) >>> 0;
    a = Math.imul(a ^ ((x >>> 16) & 0xff), 0x01000193) >>> 0;
    a = Math.imul(a ^ (x >>> 24), 0x01000193) >>> 0;
    b = Math.imul(b ^ x, 0x5bd1e995) >>> 0;
    b = (b ^ (b >>> 15)) >>> 0;
  };
  const mixStr = (s: string) => {
    for (let i = 0; i < s.length; i++) mixInt(s.charCodeAt(i));
    mixInt(0xffff);
  };
  const f64 = new Float64Array(1);
  const u32 = new Uint32Array(f64.buffer);
  const mixNum = (x: number) => {
    f64[0] = x;
    mixInt(u32[0]);
    mixInt(u32[1]);
  };
  for (const id of Object.keys(drives).sort()) {
    mixStr(id);
    const { pwlOutputs, pinModes } = drives[id];
    for (const pin of Object.keys(pinModes).sort()) {
      mixStr(pin);
      mixStr(String(pinModes[pin]));
    }
    for (const pin of Object.keys(pwlOutputs).sort()) {
      mixStr(pin);
      const points = pwlOutputs[pin];
      mixInt(points.length);
      for (const p of points) {
        mixNum(p.t);
        mixNum(p.v);
      }
    }
  }
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}
