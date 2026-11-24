import type { PartEmitter } from '../part';
import { numParam } from '../params';
import { pulseDelay, sinePhase } from '../values';

export const signalgen: PartEmitter = {
  emit: (node, { net, acDrive, time }) => {
    const rawFreq = numParam(node.data, 'frequency', 0);
    const freq = rawFreq > 0 ? rawFreq : 0;
    const amp = numParam(node.data, 'amplitude', 5);
    const dutyPct = Math.max(0, Math.min(100, numParam(node.data, 'dutyCycle', 50)));
    const duty = dutyPct / 100;
    /*
     * 0Hz is DC, and now behaves like it.
     *
     * The frequency used to be read as `frequency || 1`, so a generator set
     * to 0 was quietly run at 1Hz — the canvas said 0Hz and the trace showed
     * a 1Hz wave. Zero cannot go into PULSE or SINE (both divide by it), so
     * it becomes what it actually means: a DC source at the set amplitude.
     *
     * For square waves the pulse is a 0-to-amp swing with a configurable duty
     * cycle, and the rise and fall are kept small relative to the period.
     */
    const trf = freq > 0 ? Math.min(1e-6, 0.01 / freq) : 1e-6;
    const period = freq > 0 ? 1 / freq : 0;
    const pw = freq > 0 ? Math.min(duty * period, Math.max(0, period - 2 * trf)) : 0;
    const type = freq === 0
      ? `DC ${amp}`
      : node.data.waveform === 'square'
        ? dutyPct <= 0
          ? 'DC 0'
          : dutyPct >= 100
            ? `DC ${amp}`
            : `PULSE(0 ${amp} ${pulseDelay(period, time)} ${trf} ${trf} ${pw} ${period})`
        : `SINE(0 ${amp} ${freq}${sinePhase(freq, time)})`;
    return `V_${node.id} ${net('out')} ${net('gnd')} ${type}${acDrive}\n`;
  },
  timeVarying: node => numParam(node.data, 'frequency', 0) > 0,
};
