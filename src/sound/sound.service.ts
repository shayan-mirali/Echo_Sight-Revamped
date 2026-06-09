import { Inject, Injectable, Logger } from '@nestjs/common';

import { SoundClass } from '../common/defaults';
import { PrismaService } from '../prisma/prisma.service';
import { decodeFrame, extractFeatures } from './classifier/audio-features';
import {
  SOUND_CLASSIFIER,
  SoundClassifier,
} from './classifier/sound-classifier.interface';
import {
  SPEECH_TRANSCRIBER,
  SpeechTranscriber,
} from './classifier/speech-transcriber.interface';
import {
  AudioFramePayload,
  Severity,
  SoundAlertEvent,
} from './sound.types';

/** Per-connection snapshot of the settings the pipeline applies server-side. */
export interface UserSoundSettings {
  registeredName: string;
  sensitivityThreshold: number; // 0..1
  enabledClassifications: Record<string, boolean>;
}

/**
 * A surfaced detection that has passed classification + the user's settings but
 * is not yet persisted. The gateway applies a per-label cooldown to this before
 * asking the service to `record` it, so a sustained sound doesn't flood history.
 */
export interface AlertCandidate {
  label: string;
  confidence: number;
  angle: number;
  severity: Severity;
  transcript: string | null;
}

/** Severity per class — mirrors the Flutter mapping (kept in lockstep). */
const SEVERITY: Record<SoundClass, Severity> = {
  'Car Horn': 'danger',
  Siren: 'danger',
  'Dog Bark': 'warning',
  'Door Knock': 'warning',
  Speech: 'info',
  'Name Call': 'info',
};

@Injectable()
export class SoundService {
  private readonly logger = new Logger(SoundService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SOUND_CLASSIFIER) private readonly classifier: SoundClassifier,
    @Inject(SPEECH_TRANSCRIBER) private readonly transcriber: SpeechTranscriber,
  ) {}

  /**
   * Analyze one streamed audio frame:
   * decode → classify → upgrade Speech→Name Call → apply user settings.
   *
   * Returns a candidate to surface, or null if nothing should. This step does
   * NOT touch the database — the gateway debounces candidates per label and
   * only then calls {@link record}, so a continuous sound persists once, not
   * once per frame.
   */
  async analyzeFrame(
    settings: UserSoundSettings,
    payload: AudioFramePayload,
  ): Promise<AlertCandidate | null> {
    const frame = decodeFrame(payload);
    if (frame.samples.length === 0) return null;

    const results = await this.classifier.classify(frame);
    if (results.length === 0) return null;

    let { label } = results[0];
    const { confidence } = results[0];

    // Speech → Name Call upgrade (only meaningful once an ASR seam is wired).
    let transcript: string | null = null;
    if (label === 'Speech') {
      transcript = await this.transcriber.transcribe(frame);
      if (transcript && this.mentionsName(transcript, settings.registeredName)) {
        label = 'Name Call';
      }
    }

    // ── Apply the user's settings, server-side ──────────────────────────
    if (confidence < settings.sensitivityThreshold) return null;
    if (settings.enabledClassifications[label] === false) return null;

    return {
      label,
      confidence,
      angle: this.estimateAngle(frame),
      severity: SEVERITY[label as SoundClass] ?? 'info',
      transcript: label === 'Name Call' || label === 'Speech' ? transcript : null,
    };
  }

  /** Persist a surfaced alert to history and return the client-facing event. */
  async record(
    userId: string,
    candidate: AlertCandidate,
  ): Promise<SoundAlertEvent> {
    const row = await this.prisma.soundAlert.create({
      data: { userId, ...candidate },
    });
    return this.toEvent(row);
  }

  // ── History (synced to the Flutter history screen) ─────────────────────

  async listAlerts(userId: string, limit = 100): Promise<SoundAlertEvent[]> {
    const rows = await this.prisma.soundAlert.findMany({
      where: { userId },
      orderBy: { detectedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 500),
    });
    return rows.map((r) => this.toEvent(r));
  }

  async deleteAlert(userId: string, id: string): Promise<void> {
    // Scope the delete to the owner so one user can't remove another's rows.
    await this.prisma.soundAlert.deleteMany({ where: { id, userId } });
  }

  async clearAlerts(userId: string): Promise<void> {
    await this.prisma.soundAlert.deleteMany({ where: { userId } });
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private mentionsName(transcript: string, name: string): boolean {
    const n = name.trim().toLowerCase();
    if (!n) return false;
    // Whole-word, case-insensitive match.
    return new RegExp(`\\b${escapeRegExp(n)}\\b`, 'i').test(transcript);
  }

  /**
   * Estimate a 0..360 bearing from spectral brightness. A mono mic carries no
   * true direction-of-arrival, so this is a stable *placement* (a given pitch
   * always lands in the same spot on the radar), not a real direction — swap in
   * a stereo/mic-array DOA estimate when multi-channel audio is available.
   */
  private estimateAngle(frame: ReturnType<typeof decodeFrame>): number {
    const { centroidHz } = extractFeatures(frame);
    const hz = Math.max(50, Math.min(centroidHz, 8000));
    const t = Math.log2(hz / 50) / Math.log2(8000 / 50); // 0..1
    return Math.round(t * 359);
  }

  private toEvent(row: {
    id: string;
    label: string;
    confidence: number;
    angle: number;
    severity: string;
    transcript: string | null;
    detectedAt: Date;
  }): SoundAlertEvent {
    return {
      id: row.id,
      label: row.label,
      confidence: row.confidence,
      angle: row.angle,
      severity: row.severity as Severity,
      timestamp: row.detectedAt.toISOString(),
      transcript: row.transcript,
    };
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
