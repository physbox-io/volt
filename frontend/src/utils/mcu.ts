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
  let mcuTimeMs = 0;
  const pwlOutputs: Record<string, PWLPoint[]> = {};
  const pinModes: Record<string, 'INPUT' | 'OUTPUT'> = {};
  const logs: string[] = [];
  const simLengthMs = simLengthSeconds * 1000;
  const state = initialState || {};


  function getVoltageAtTime(pin: string, timeMs: number): number {
    const wave = inputWaveforms[pin];
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
    simLength: simLengthMs,
    pinMode: (pin: string, mode: 'INPUT' | 'OUTPUT') => {
       pinModes[pin] = mode;
       if (mode === 'OUTPUT' && !pwlOutputs[pin]) {
          pwlOutputs[pin] = [{ t: 0, v: 0 }]; // start at 0V
       }
    },
    digitalWrite: (pin: string, val: number) => {
       if (pinModes[pin] !== 'OUTPUT') return;
       const out = pwlOutputs[pin];
       const v = val ? 5 : 0;
       
       if (out.length > 0 && out[out.length - 1].v === v) return;
       
       if (out.length > 0 && out[out.length - 1].t === mcuTimeMs) {
         out[out.length - 1].v = v;
       } else {
         const lastVal = out.length > 0 ? out[out.length - 1].v : 0;
         if (mcuTimeMs > 0 && out.length > 0 && out[out.length - 1].t < mcuTimeMs) {
           out.push({ t: mcuTimeMs - 0.001, v: lastVal });
         }
         out.push({ t: mcuTimeMs, v: v });
       }
    },
    analogWrite: (pin: string, val: number) => {
       if (pinModes[pin] !== 'OUTPUT') return;
       const out = pwlOutputs[pin];
       const v = (Math.max(0, Math.min(255, val)) / 255) * 5; 
       
       if (out.length > 0 && out[out.length - 1].v === v) return;
       
       if (out.length > 0 && out[out.length - 1].t === mcuTimeMs) {
         out[out.length - 1].v = v;
       } else {
         const lastVal = out.length > 0 ? out[out.length - 1].v : 0;
         if (mcuTimeMs > 0 && out.length > 0 && out[out.length - 1].t < mcuTimeMs) {
           out.push({ t: mcuTimeMs - 0.001, v: lastVal });
         }
         out.push({ t: mcuTimeMs, v });
       }
    },
    digitalRead: (pin: string) => {
       const v = getVoltageAtTime(pin, mcuTimeMs);
       return v > 2.5 ? 1 : 0;
    },
    analogRead: (pin: string) => {
       const v = getVoltageAtTime(pin, mcuTimeMs);
       let val = (v / 5.0) * 1023;
       if (val < 0) val = 0;
       if (val > 1023) val = 1023;
       return Math.floor(val);
    },
    sleep: (ms: number) => {
       if (ms <= 0) ms = 1; // prevent infinite 0-delay loops from hanging
       mcuTimeMs += ms;
       if (mcuTimeMs >= simLengthMs) {
          throw new Error("SIM_END");
       }
    },
    wait: (ms: number) => api.sleep(ms),
    millis: () => mcuTimeMs,
    Serial: {
      println: (msg: any) => logs.push(String(msg)),
      print: (msg: any) => {
        if (logs.length === 0) logs.push("");
        logs[logs.length - 1] += String(msg);
      }
    }
  };

  try {
     const fn = new Function(...Object.keys(api), code);
     fn(...Object.values(api));
  } catch (e: any) {
     if (e.message !== "SIM_END") {
        console.error("MCU Execution Error:", e);
     }
  }
  
  // Finish off PWL arrays to extend to the end of the simulation
  for (const pin in pwlOutputs) {
     const out = pwlOutputs[pin];
     if (out.length > 0 && out[out.length - 1].t < simLengthMs) {
        out.push({ t: simLengthMs, v: out[out.length - 1].v });
     }
  }

  return { pwlOutputs, pinModes, logs, newState: state };
}
