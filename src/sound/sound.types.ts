import { SoundClass } from '../common/defaults';

/** Alert urgency. Mirrors the Flutter `AlertSeverity` enum. */
export type Severity = 'info' | 'warning' | 'danger';

/**
 * One chunk of mono audio streamed from the client.
 *
 * The client sends 16-bit PCM (the most compact format every mic plugin can
 * produce) base64-encoded, plus its sample rate. `decodeFrame` turns this into
 * normalized float samples for the classifier.
 */
export interface AudioFramePayload {
  /** Sample rate in Hz, e.g. 16000. */
  sampleRate: number;
  /** Base64 of little-endian Int16 PCM samples. */
  pcm16?: string;
  /** Alternative to `pcm16`: raw float samples already in [-1, 1]. */
  samples?: number[];
  /** Optional monotonically increasing sequence number for client-side ordering. */
  seq?: number;
}

/** Decoded, analysis-ready audio frame. */
export interface AudioFrame {
  samples: Float32Array; // mono, normalized to [-1, 1]
  sampleRate: number;
}

/** Raw output of a `SoundClassifier` — before user settings are applied. */
export interface Classification {
  label: SoundClass;
  /** Model confidence in [0, 1]. */
  confidence: number;
}

/**
 * A surfaced alert, pushed to the client over the `alert` event and persisted
 * to history. Field names/types match the Flutter `SoundAlert` model so the
 * client can deserialize directly.
 */
export interface SoundAlertEvent {
  id: string;
  label: string;
  confidence: number;
  /** 0..360. Estimated from spectral content — a mono mic has no true DOA. */
  angle: number;
  severity: Severity;
  /** ISO-8601 timestamp. */
  timestamp: string;
  transcript: string | null;
}
