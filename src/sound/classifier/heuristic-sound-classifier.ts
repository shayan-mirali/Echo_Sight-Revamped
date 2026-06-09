import { Injectable, Logger } from '@nestjs/common';

import { SoundClass } from '../../common/defaults';
import { AudioFrame, Classification } from '../sound.types';
import { AudioFeatures, extractFeatures } from './audio-features';
import { SoundClassifier } from './sound-classifier.interface';

/**
 * A real, dependency-free sound classifier driven by loudness + frequency
 * features (see {@link AudioFeatures}). It genuinely reacts to live audio —
 * a loud tonal sweep scores as a siren, a sharp broadband transient as a
 * knock, voiced mid-band energy as speech — without shipping a gigabyte model.
 *
 * It is deliberately a heuristic: accuracy is "good enough to demo and build
 * the whole pipeline against," and it lives behind {@link SoundClassifier} so a
 * trained model can replace it later (see `SOUND_CLASSIFIER`). "Name Call" is
 * intentionally not produced here — it needs words, not just acoustics, and is
 * derived in `SoundService` from a Speech result + the ASR seam.
 */
@Injectable()
export class HeuristicSoundClassifier implements SoundClassifier {
  private readonly logger = new Logger(HeuristicSoundClassifier.name);

  /** Frames quieter than this (dBFS) are treated as silence. */
  private static readonly NOISE_FLOOR_DB = -55;

  classify(frame: AudioFrame): Classification[] {
    const f = extractFeatures(frame);

    if (f.rmsDb < HeuristicSoundClassifier.NOISE_FLOOR_DB) return [];

    // Score each acoustic class in [0, 1]. Name Call is excluded by design.
    const scores: Array<[SoundClass, number]> = [
      ['Door Knock', this.scoreKnock(f)],
      ['Siren', this.scoreSiren(f)],
      ['Car Horn', this.scoreHorn(f)],
      ['Dog Bark', this.scoreBark(f)],
      ['Speech', this.scoreSpeech(f)],
    ];

    // Louder audio is more likely a real event than ambient noise — fold a
    // gentle loudness term into every score so a faint match doesn't fire.
    const loudness = clamp01((f.rmsDb + 55) / 45); // -55dB -> 0, -10dB -> 1
    const ranked = scores
      .map(([label, raw]): Classification => {
        const confidence = clamp01(0.45 * loudness + 0.55 * raw * (0.4 + 0.6 * loudness));
        return { label, confidence };
      })
      .filter((c) => c.confidence > 0.01)
      .sort((a, b) => b.confidence - a.confidence);

    return ranked;
  }

  // ── Per-class membership scores ────────────────────────────────────────

  /** Knocks: sharp broadband transients — high crest factor, lots of energy
   * up high, not a sustained tone. */
  private scoreKnock(f: AudioFeatures): number {
    const transient = smoothstep(4, 9, f.crestFactor);
    const broadband = smoothstep(0.18, 0.5, f.flatness);
    const punch = f.bands.highMid + f.bands.high + f.bands.air;
    return transient * broadband * smoothstep(0.25, 0.6, punch);
  }

  /** Sirens: loud, strongly tonal, dominant pitch in the 600–1600 Hz sweep
   * region with energy in the mid band. */
  private scoreSiren(f: AudioFeatures): number {
    const tonal = 1 - smoothstep(0.05, 0.3, f.flatness);
    const pitch = band(f.dominantHz, 600, 800, 1500, 1800);
    const midHeavy = smoothstep(0.25, 0.6, f.bands.mid + f.bands.highMid);
    return tonal * pitch * midHeavy;
  }

  /** Car horns: loud, tonal, low-pitched fundamental (~300–600 Hz) with
   * strong low-band energy. */
  private scoreHorn(f: AudioFeatures): number {
    const tonal = 1 - smoothstep(0.06, 0.32, f.flatness);
    const pitch = band(f.dominantHz, 250, 350, 650, 850);
    const lowHeavy = smoothstep(0.25, 0.6, f.bands.low + f.bands.sub);
    return tonal * pitch * lowHeavy;
  }

  /** Dog barks: bursty, harmonic-but-rough mid energy, moderate crest. */
  private scoreBark(f: AudioFeatures): number {
    const rough = band(f.flatness, 0.08, 0.18, 0.35, 0.5);
    const midBite = smoothstep(0.3, 0.65, f.bands.low + f.bands.mid + f.bands.highMid);
    const bursty = band(f.crestFactor, 2.5, 4, 6, 9);
    return rough * midBite * bursty;
  }

  /** Speech: energy concentrated across the voice bands (~300–3500 Hz),
   * moderate zero-crossing rate, neither a pure tone nor white noise. */
  private scoreSpeech(f: AudioFeatures): number {
    const voiceBand = f.bands.low + f.bands.mid + f.bands.highMid;
    const concentrated = smoothstep(0.55, 0.85, voiceBand);
    const voiced = band(f.flatness, 0.05, 0.12, 0.3, 0.45);
    const zcrOk = band(f.zcr, 0.02, 0.05, 0.18, 0.3);
    const centroidOk = band(f.centroidHz, 300, 600, 2200, 3200);
    return concentrated * voiced * zcrOk * centroidOk;
  }
}

// ── Membership helpers ──────────────────────────────────────────────────

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Smooth 0→1 ramp between `edge0` and `edge1` (Hermite). */
function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Trapezoidal membership: 0 below `lo`, ramps to 1 across [lo, loFull], stays
 * 1 across [loFull, hiFull], ramps back to 0 across [hiFull, hi].
 */
function band(
  x: number,
  lo: number,
  loFull: number,
  hiFull: number,
  hi: number,
): number {
  if (x <= lo || x >= hi) return 0;
  if (x < loFull) return smoothstep(lo, loFull, x);
  if (x > hiFull) return 1 - smoothstep(hiFull, hi, x);
  return 1;
}
