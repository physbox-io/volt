/**
 * Turning a simulated slice into what the board plays.
 *
 * Pure functions of a slice's waveforms: no socket, no React. A digital_out
 * pin becomes a run-length list of levels, and a speaker becomes a buffer of
 * PCM samples.
 */

/** A net's voltage over a slice, as `findNetGraph` returns it. */
export type Trace = { timestamps_ms: number[]; voltage_levels: number[] };

/** One level held for a time: [0 | 1, microseconds]. */
export type Hold = [number, number];

/** Half of 3.3V logic. */
const LOGIC_THRESHOLD_V = 1.65;

/** A pin is assumed to be toggling about this slowly until it is seen to. */
export const DEFAULT_HALF_PERIOD_MS = 50;

/**
 * A digital_out pin's level over one slice, as the holds the board plays.
 *
 * Crossings of the 1.65V threshold become edges. A pulse shorter than one and
 * a half report steps is the solver's quantisation, not the circuit, and is
 * dropped rather than played. The holds always add up to the slice. With no
 * trace the pin is held low for the whole slice.
 *
 * `shortestPulseUs` is the shortest hold that ended in an edge, or null when
 * the pin did not change: what the next slice's step size is scaled to.
 */
export function encodePinEdges(
  trace: Trace | null,
  sliceMs: number,
  maxStepMs: number,
): { seq: Hold[]; shortestPulseUs: number | null } {
  const seq: Hold[] = [];
  if (!trace || trace.timestamps_ms.length === 0) {
    seq.push([0, Math.round(sliceMs * 1000)]);
    return { seq, shortestPulseUs: null };
  }
  const minPulseUs = maxStepMs * 1000 * 1.5;
  let shortestPulseUs: number | null = null;
  let lastState = trace.voltage_levels[0] > LOGIC_THRESHOLD_V ? 1 : 0;
  let lastT = 0;
  for (let i = 1; i < trace.timestamps_ms.length; i++) {
    const state = trace.voltage_levels[i] > LOGIC_THRESHOLD_V ? 1 : 0;
    if (state === lastState) continue;
    const t = trace.timestamps_ms[i];
    const durationUs = (t - lastT) * 1000;
    if (durationUs < minPulseUs) continue;
    seq.push([lastState, Math.round(durationUs)]);
    if (shortestPulseUs === null || durationUs < shortestPulseUs) shortestPulseUs = durationUs;
    lastState = state;
    lastT = t;
  }
  seq.push([lastState, Math.round((sliceMs - lastT) * 1000)]);
  return { seq, shortestPulseUs };
}

/** A pin's tracked half-period, moved toward the shortest pulse it just played. */
export function trackHalfPeriod(previousMs: number | undefined, shortestPulseUs: number): number {
  const alpha = 0.3;
  return alpha * (shortestPulseUs / 1000) + (1 - alpha) * (previousMs ?? DEFAULT_HALF_PERIOD_MS);
}

/**
 * The report and maximum internal step for a slice, in ms.
 *
 * A fixed 1ms step can't resolve edges once a half-period gets down to a few
 * ms, so the step is scaled to whichever digital_out pin is oscillating
 * fastest: about ten samples a half-period, never coarser than 1ms (0.1ms with
 * a speaker, which has to be heard). The floor is a point-count budget, not a
 * guessed frequency cutoff. It hasn't been profiled against per-slice solve
 * time: tune it down if slices miss their real-time budget, up if there is
 * compute to spare.
 */
export function chooseMaxStepMs(halfPeriodsMs: Record<string, number>, sliceMs: number, hasSpeaker: boolean): number {
  const MAX_POINTS_PER_SLICE = 2000;
  const minStepMs = sliceMs / MAX_POINTS_PER_SLICE;
  const tracked = Object.values(halfPeriodsMs);
  const fastestHalfPeriodMs = tracked.length > 0 ? Math.min(...tracked) : DEFAULT_HALF_PERIOD_MS;
  const maxStepLimit = hasSpeaker ? 0.1 : 1.0;
  return Math.min(maxStepLimit, Math.max(minStepMs, fastestHalfPeriodMs / 10));
}

/**
 * A speaker's voltage over one slice as 16kHz signed 16-bit PCM: resampled
 * linearly, its DC offset removed, and normalised to a fixed peak, so a quiet
 * circuit is still heard. Null with no trace to play.
 */
export function encodeSpeakerAudio(speaker: Trace | null, ground: Trace | null, sliceMs: number): Int16Array | null {
  if (!speaker || speaker.timestamps_ms.length === 0) return null;
  const times = speaker.timestamps_ms;
  const volts = speaker.voltage_levels;
  const gndVolts = ground ? ground.voltage_levels : null;

  const sampleRate = 16000;
  const frameCount = Math.floor(sampleRate * (sliceMs / 1000));
  const audioBuffer = new Int16Array(frameCount);

  let dataIdx = 0;
  let sumV = 0;
  const rawV = new Float32Array(frameCount);
  for (let i = 0; i < frameCount; i++) {
    const t_ms = (i / sampleRate) * 1000;
    while (dataIdx < times.length - 2 && times[dataIdx + 1] < t_ms) {
      dataIdx++;
    }
    const t1 = times[dataIdx];
    const t2 = times[dataIdx + 1];
    const v1 = volts[dataIdx] - (gndVolts ? gndVolts[dataIdx] : 0);
    const v2 = volts[dataIdx + 1] - (gndVolts ? gndVolts[dataIdx + 1] : 0);
    let v = v1;
    if (t2 > t1) {
      const fraction = (t_ms - t1) / (t2 - t1);
      v = v1 + fraction * (v2 - v1);
    }
    rawV[i] = v;
    sumV += v;
  }

  // Subtract DC offset
  const meanV = sumV / frameCount;
  let maxAbs = 0.001;
  for (let i = 0; i < frameCount; i++) {
    rawV[i] -= meanV;
    if (Math.abs(rawV[i]) > maxAbs) maxAbs = Math.abs(rawV[i]);
  }

  // Normalize and convert to Int16
  const targetPeak = 20000;
  for (let i = 0; i < frameCount; i++) {
    audioBuffer[i] = Math.round((rawV[i] / maxAbs) * targetPeak);
  }
  return audioBuffer;
}
