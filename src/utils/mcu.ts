export interface PWLPoint {
  t: number;
  v: number;
}

export interface McuExecutionResult {
  pwlOutputs: Record<string, PWLPoint[]>;
  pinModes: Record<string, 'INPUT' | 'OUTPUT'>;
  logs: string[];
}

export function executeMcuCode(
  code: string,
  simLengthSeconds: number,
  inputWaveforms: Record<string, PWLPoint[]>,
  initialState?: any
): McuExecutionResult & { newState: any } {
  const state = initialState || {};

  // Setup execution context inside state to share with generator closures
  state.mcuTimeMs = 0;
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
    millis: () => state.mcuTimeMs,
    Serial: {
      println: (msg: any) => state.logs.push(String(msg)),
      print: (msg: any) => {
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
     } catch (e: any) {
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
