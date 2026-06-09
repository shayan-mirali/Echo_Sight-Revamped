import { Injectable } from '@nestjs/common';

import { AudioFrame } from '../sound.types';

/**
 * Optional speech-to-text seam.
 *
 * The feature heuristic can recognize that audio is *speech*, but it cannot
 * read the words — so it can never tell, on its own, whether someone said the
 * user's registered name. That requires ASR. Wire a real transcriber here
 * (Whisper, a cloud speech API, an on-device model) and `SoundService` will
 * upgrade a "Speech" detection to "Name Call" when the transcript contains the
 * registered name.
 *
 * The default `NoopTranscriber` returns null, so Name Call simply stays dormant
 * until a real transcriber is provided — the rest of the pipeline is unaffected.
 */
export interface SpeechTranscriber {
  /** @returns recognized text, or null if none / not supported. */
  transcribe(frame: AudioFrame): Promise<string | null>;
}

/** Nest DI token for the active `SpeechTranscriber`. */
export const SPEECH_TRANSCRIBER = Symbol('SPEECH_TRANSCRIBER');

/** No-op default: never produces a transcript. */
@Injectable()
export class NoopTranscriber implements SpeechTranscriber {
  async transcribe(): Promise<string | null> {
    return null;
  }
}
