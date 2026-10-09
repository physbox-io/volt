import type { PartEmitter } from '../part';
import { pulseDelay, sinePhase } from '../values';

export const signalgen: PartEmitter = {
  emit: (node, { net, acDrive, time }) => {
    const rawFreq = Number(node.data.frequency);
    const freq = Number.isFinite(rawFreq) && rawFreq > 0 ? rawFreq : 0;
    const amp = Number.isFinite(Number(node.data.amplitude)) ? Number(node.data.amplitude) : 5;
    const duty = (node.data.dutyCycle !== undefined ? Number(node.data.dutyCycle) : 50) / 100;
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
    const type = freq === 0
      ? `DC ${amp}`
      : node.data.waveform === 'square'
        ? `PULSE(0 ${amp} ${pulseDelay(1 / freq, time)} ${trf} ${trf} ${duty / freq} ${1 / freq})`
        : `SINE(0 ${amp} ${freq}${sinePhase(freq, time)})`;
    return `V_${node.id} ${net('out')} ${net('gnd')} ${type}${acDrive}\n`;
  },
  timeVarying: node => Number(node.data.frequency) > 0,
};
