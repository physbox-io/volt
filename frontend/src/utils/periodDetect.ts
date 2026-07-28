/**
 * Autocorrelation-based period detection.
 *
 * Deliberately shape-agnostic: rather than assuming a square/sine/triangle
 * waveform and looking for edges or zero-crossings, this measures how
 * self-similar the signal is at each candidate lag. A periodic signal's
 * autocorrelation has a strong peak at lag == period even when the waveform
 * itself drifts/jitters/deforms cycle to cycle (real HIL/SPICE traces do),
 * because the correlation is an aggregate similarity measure, not a
 * per-sample shape match.
 */

export interface PeriodEstimate {
  periodMs: number;
  freqHz: number;
  confidence: number; // 0..1, normalized autocorrelation peak strength
}

/** Resample irregular (t, v) points onto a uniform time grid via linear interpolation. */
function resampleUniform(points: { t: number; v: number }[], numSamples: number): { dt: number; samples: Float64Array } {
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const span = t1 - t0;
  const dt = span / (numSamples - 1);
  const samples = new Float64Array(numSamples);
  let j = 0;
  for (let i = 0; i < numSamples; i++) {
    const t = t0 + i * dt;
    while (j < points.length - 2 && points[j + 1].t < t) j++;
    const a = points[j];
    const b = points[j + 1] ?? a;
    const frac = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
    samples[i] = a.v + (b.v - a.v) * frac;
  }
  return { dt, samples };
}

/**
 * Detect the dominant period in a scope trace.
 * Returns null if fewer than ~2 candidate cycles are present or no
 * confident periodicity is found.
 */
export function detectPeriod(points: { t: number; v: number }[]): PeriodEstimate | null {
  if (points.length < 8) return null;

  const span = points[points.length - 1].t - points[0].t;
  if (span <= 0) return null;

  // Uniform grid, capped for perf; direct-sum autocorrelation is O(N * maxLag).
  const numSamples = Math.min(points.length, 512);
  const { dt, samples } = resampleUniform(points, numSamples);
  const n = samples.length;

  const mean = samples.reduce((s, v) => s + v, 0) / n;
  const centered = new Float64Array(n);
  for (let i = 0; i < n; i++) centered[i] = samples[i] - mean;

  const energy = centered.reduce((s, v) => s + v * v, 0);
  if (energy < 1e-12) return null; // flat signal, nothing to detect

  // Search lags from a small minimum (avoid trivial near-zero-lag peak)
  // up to half the window (need at least ~2 cycles visible to trust a period).
  const minLag = Math.max(2, Math.floor(n * 0.01));
  const maxLag = Math.floor(n / 2);
  if (maxLag <= minLag) return null;

  const corr = new Float64Array(maxLag - minLag);
  for (let lag = minLag; lag < maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < n - lag; i++) sum += centered[i] * centered[i + lag];
    corr[lag - minLag] = sum / energy; // normalize to [-1, 1] at lag 0 reference
  }

  // Find the first strong local maximum (first cycle repeat), not just the
  // global max, so sub/super-harmonics don't get picked over the true period.
  let bestIdx = -1;
  let bestVal = -Infinity;
  const threshold = 0.5; // require reasonably strong self-similarity
  for (let i = 1; i < corr.length - 1; i++) {
    if (corr[i] > corr[i - 1] && corr[i] >= corr[i + 1] && corr[i] > threshold) {
      bestIdx = i;
      bestVal = corr[i];
      break;
    }
  }

  // Fallback: no peak cleared the threshold — take the global max if it's
  // at least weakly indicative, otherwise report no detection.
  if (bestIdx === -1) {
    for (let i = 0; i < corr.length; i++) {
      if (corr[i] > bestVal) {
        bestVal = corr[i];
        bestIdx = i;
      }
    }
    if (bestVal < 0.3) return null;
  }

  const lag = bestIdx + minLag;
  const periodMs = lag * dt;
  if (periodMs <= 0) return null;

  return {
    periodMs,
    freqHz: 1000 / periodMs,
    confidence: Math.max(0, Math.min(1, bestVal)),
  };
}
