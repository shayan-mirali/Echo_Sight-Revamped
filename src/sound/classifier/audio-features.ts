import { AudioFrame, AudioFramePayload } from '../sound.types';

/**
 * Audio analysis utilities — decoding + a small FFT + the time/frequency
 * features the heuristic classifier reasons over. No external deps: this runs
 * anywhere Node runs, which is the whole point of the "heuristic now" choice.
 */

/** Decode a wire payload into normalized mono float samples. */
export function decodeFrame(payload: AudioFramePayload): AudioFrame {
  const sampleRate = payload.sampleRate || 16000;

  if (payload.samples && payload.samples.length > 0) {
    return { samples: Float32Array.from(payload.samples), sampleRate };
  }

  if (payload.pcm16) {
    const buf = Buffer.from(payload.pcm16, 'base64');
    // Int16LE -> [-1, 1]. (buf.length may be odd if truncated; floor the count.)
    const count = Math.floor(buf.length / 2);
    const out = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      out[i] = buf.readInt16LE(i * 2) / 32768;
    }
    return { samples: out, sampleRate };
  }

  return { samples: new Float32Array(0), sampleRate };
}

/** Time + frequency features extracted from one frame. */
export interface AudioFeatures {
  rms: number; // 0..~1
  rmsDb: number; // dBFS, ~ -100 (silence) .. 0 (full scale)
  peak: number; // 0..1
  crestFactor: number; // peak / rms — high for transients (knocks), low for tones
  zcr: number; // zero crossings per sample, 0..1 — high for noisy/sibilant sound
  dominantHz: number; // frequency of the strongest spectral bin
  centroidHz: number; // spectral "center of mass" — brightness
  flatness: number; // 0 (pure tone) .. 1 (white noise)
  bands: BandEnergies; // fraction of spectral energy per band, sums ~1
}

/** Energy fraction in perceptually meaningful bands (each 0..1). */
export interface BandEnergies {
  sub: number; // < 250 Hz   (rumble, low horn)
  low: number; // 250–700 Hz  (horn fundamentals, voice pitch, bark)
  mid: number; // 700–1600 Hz (siren sweep, voice formants)
  highMid: number; // 1600–3500 Hz (speech intelligibility, bark bite)
  high: number; // 3500–7000 Hz (sibilance, horn/siren harmonics)
  air: number; // > 7000 Hz   (transient sharpness, hiss)
}

const BAND_EDGES: Array<[keyof BandEnergies, number, number]> = [
  ['sub', 0, 250],
  ['low', 250, 700],
  ['mid', 700, 1600],
  ['highMid', 1600, 3500],
  ['high', 3500, 7000],
  ['air', 7000, Infinity],
];

export function extractFeatures(frame: AudioFrame): AudioFeatures {
  const { samples, sampleRate } = frame;
  const n = samples.length;

  if (n === 0) {
    return {
      rms: 0,
      rmsDb: -100,
      peak: 0,
      crestFactor: 0,
      zcr: 0,
      dominantHz: 0,
      centroidHz: 0,
      flatness: 1,
      bands: { sub: 0, low: 0, mid: 0, highMid: 0, high: 0, air: 0 },
    };
  }

  // ── Time-domain ──────────────────────────────────────────────────────
  let sumSq = 0;
  let peak = 0;
  let crossings = 0;
  let prev = samples[0];
  for (let i = 0; i < n; i++) {
    const s = samples[i];
    sumSq += s * s;
    const a = Math.abs(s);
    if (a > peak) peak = a;
    if (i > 0 && ((prev < 0 && s >= 0) || (prev >= 0 && s < 0))) crossings++;
    prev = s;
  }
  const rms = Math.sqrt(sumSq / n);
  const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -100;
  const crestFactor = rms > 1e-6 ? peak / rms : 0;
  const zcr = crossings / n;

  // ── Frequency-domain ─────────────────────────────────────────────────
  const fftSize = largestPow2AtMost(Math.min(n, 4096));
  const spectrum = magnitudeSpectrum(samples, fftSize); // length fftSize/2
  const binHz = sampleRate / fftSize;

  let total = 0;
  let dominantMag = 0;
  let dominantBin = 0;
  let centroidNum = 0;
  let logSum = 0;
  let nonZero = 0;
  const bands: BandEnergies = {
    sub: 0,
    low: 0,
    mid: 0,
    highMid: 0,
    high: 0,
    air: 0,
  };

  for (let k = 1; k < spectrum.length; k++) {
    const mag = spectrum[k];
    const hz = k * binHz;
    total += mag;
    centroidNum += hz * mag;
    if (mag > dominantMag) {
      dominantMag = mag;
      dominantBin = k;
    }
    if (mag > 0) {
      logSum += Math.log(mag);
      nonZero++;
    }
    for (const [name, lo, hi] of BAND_EDGES) {
      if (hz >= lo && hz < hi) {
        bands[name] += mag;
        break;
      }
    }
  }

  if (total > 0) {
    for (const key of Object.keys(bands) as Array<keyof BandEnergies>) {
      bands[key] /= total;
    }
  }

  // Spectral flatness: geometric mean / arithmetic mean of the magnitude
  // spectrum. ~0 for a pure tone, ~1 for white noise.
  const arithMean = total / (spectrum.length - 1);
  const geoMean = nonZero > 0 ? Math.exp(logSum / nonZero) : 0;
  const flatness = arithMean > 0 ? Math.min(1, geoMean / arithMean) : 1;

  return {
    rms,
    rmsDb,
    peak,
    crestFactor,
    zcr,
    dominantHz: dominantBin * binHz,
    centroidHz: total > 0 ? centroidNum / total : 0,
    flatness,
    bands,
  };
}

function largestPow2AtMost(x: number): number {
  let p = 1;
  while (p * 2 <= x) p *= 2;
  return Math.max(2, p);
}

/**
 * Hann-windowed real FFT magnitude spectrum via an iterative radix-2
 * Cooley–Tukey transform. Returns the first `size/2` magnitude bins.
 */
function magnitudeSpectrum(samples: Float32Array, size: number): Float32Array {
  const re = new Float64Array(size);
  const im = new Float64Array(size);

  // Copy + Hann window to reduce spectral leakage.
  for (let i = 0; i < size; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
    re[i] = samples[i] * w;
  }

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  // Butterflies.
  for (let len = 2; len <= size; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < size; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const aRe = re[i + k];
        const aIm = im[i + k];
        const bRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const bIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = aRe + bRe;
        im[i + k] = aIm + bIm;
        re[i + k + len / 2] = aRe - bRe;
        im[i + k + len / 2] = aIm - bIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }

  const half = size >> 1;
  const out = new Float32Array(half);
  for (let k = 0; k < half; k++) {
    out[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / size;
  }
  return out;
}
