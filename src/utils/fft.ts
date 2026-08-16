/**
 * Radix-2 Cooley-Tukey FFT
 * Input: array of real-valued time-domain samples (length will be zero-padded to next power of 2)
 * Output: array of { freq, mag } where mag is in dB
 */

export interface FFTBin {
  freq: number;  // Hz
  mag: number;   // dB (20*log10)
}

/** Compute FFT of real-valued signal. sampleRate in Hz. */
export function computeFFT(samples: number[], sampleRate: number): FFTBin[] {
  // Zero-pad to next power of 2
  let N = 1;
  while (N < samples.length) N <<= 1;

  // Apply Hanning window and copy into real/imag arrays
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < samples.length; i++) {
    const window = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (samples.length - 1)));
    re[i] = samples[i] * window;
  }

  // Bit-reversal permutation
  const bits = Math.log2(N);
  for (let i = 0; i < N; i++) {
    const j = bitReverse(i, bits);
    if (j > i) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  // Cooley-Tukey butterfly
  for (let size = 2; size <= N; size <<= 1) {
    const halfSize = size >> 1;
    const angle = -2 * Math.PI / size;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);
    for (let i = 0; i < N; i += size) {
      let curRe = 1, curIm = 0;
      for (let j = 0; j < halfSize; j++) {
        const tRe = curRe * re[i + j + halfSize] - curIm * im[i + j + halfSize];
        const tIm = curRe * im[i + j + halfSize] + curIm * re[i + j + halfSize];
        re[i + j + halfSize] = re[i + j] - tRe;
        im[i + j + halfSize] = im[i + j] - tIm;
        re[i + j] += tRe;
        im[i + j] += tIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }

  // Convert to magnitude spectrum (only first half — positive frequencies)
  const bins: FFTBin[] = [];
  const halfN = N >> 1;
  for (let i = 0; i < halfN; i++) {
    const mag = Math.sqrt(re[i] * re[i] + im[i] * im[i]) / halfN;
    const dB = mag > 1e-12 ? 20 * Math.log10(mag) : -120;
    bins.push({
      freq: (i * sampleRate) / N,
      mag: dB,
    });
  }

  return bins;
}

function bitReverse(x: number, bits: number): number {
  let result = 0;
  for (let i = 0; i < bits; i++) {
    result = (result << 1) | (x & 1);
    x >>= 1;
  }
  return result;
}
