import { AudioFramePayload } from './sound.types';

/**
 * Server-side guards for the `audio` WebSocket message.
 *
 * The audio path does NOT go through the HTTP `ValidationPipe`, so a malicious
 * or buggy client could otherwise stream junk: 100 MB base64 blobs, a million
 * float samples, an absurd sample rate, or a flood of frames per second. These
 * limits bound CPU/memory per frame; the gateway enforces the per-second rate
 * separately (see {@link FrameRateLimiter}).
 */
export const AUDIO_LIMITS = {
  /** Min/max accepted sample rate (Hz). Covers 8 kHz telephony → 48 kHz. */
  minSampleRate: 8_000,
  maxSampleRate: 48_000,
  /**
   * Max base64 length for `pcm16`. 48 kHz × 1 s × 2 bytes ≈ 96 KB raw ≈ 128 KB
   * base64 — so this caps a frame at roughly one second of the highest rate.
   */
  maxPcm16Base64Length: 200_000,
  /** Max number of raw float `samples` (the `samples` payload alternative). */
  maxRawSamples: 48_000,
} as const;

export type FrameRejectReason =
  | 'not-an-object'
  | 'bad-sample-rate'
  | 'no-audio'
  | 'pcm16-too-large'
  | 'pcm16-not-base64'
  | 'samples-too-large'
  | 'samples-not-numeric';

export interface FrameValidation {
  ok: boolean;
  reason?: FrameRejectReason;
}

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Validate a raw `audio` payload before it reaches `decodeFrame`. Returns
 * `{ ok: true }` for a frame safe to process, or a reason the gateway can log
 * (and use to decide whether to disconnect a persistently abusive client).
 */
export function validateFramePayload(payload: unknown): FrameValidation {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, reason: 'not-an-object' };
  }
  const p = payload as AudioFramePayload;

  const rate = p.sampleRate;
  if (
    typeof rate !== 'number' ||
    !Number.isFinite(rate) ||
    rate < AUDIO_LIMITS.minSampleRate ||
    rate > AUDIO_LIMITS.maxSampleRate
  ) {
    return { ok: false, reason: 'bad-sample-rate' };
  }

  const hasPcm = typeof p.pcm16 === 'string' && p.pcm16.length > 0;
  const hasSamples = Array.isArray(p.samples) && p.samples.length > 0;
  if (!hasPcm && !hasSamples) {
    return { ok: false, reason: 'no-audio' };
  }

  if (hasPcm) {
    if (p.pcm16!.length > AUDIO_LIMITS.maxPcm16Base64Length) {
      return { ok: false, reason: 'pcm16-too-large' };
    }
    if (!BASE64_RE.test(p.pcm16!)) {
      return { ok: false, reason: 'pcm16-not-base64' };
    }
  }

  if (hasSamples) {
    if (p.samples!.length > AUDIO_LIMITS.maxRawSamples) {
      return { ok: false, reason: 'samples-too-large' };
    }
    // A handful of NaN/Infinity would poison the FFT — reject non-finite input.
    for (let i = 0; i < p.samples!.length; i++) {
      const s = p.samples![i];
      if (typeof s !== 'number' || !Number.isFinite(s)) {
        return { ok: false, reason: 'samples-not-numeric' };
      }
    }
  }

  return { ok: true };
}

/**
 * A fixed-window per-connection frame-rate limiter. A normal client streams a
 * few frames per second; this caps the burst a single socket can push so one
 * client can't pin a CPU core. Returns whether the frame is allowed.
 */
export class FrameRateLimiter {
  private windowStart = 0;
  private count = 0;

  /**
   * @param maxPerWindow max frames allowed per window
   * @param windowMs     window length in ms
   */
  constructor(
    private readonly maxPerWindow: number,
    private readonly windowMs: number,
  ) {}

  /** @param now current epoch ms (injected so this stays deterministic/testable). */
  allow(now: number): boolean {
    if (now - this.windowStart >= this.windowMs) {
      this.windowStart = now;
      this.count = 0;
    }
    this.count++;
    return this.count <= this.maxPerWindow;
  }
}
