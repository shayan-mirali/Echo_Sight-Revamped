import { AudioFrame, Classification } from '../sound.types';

/**
 * Turns a frame of audio into a ranked list of sound-class guesses.
 *
 * This is the **model seam**: today it's backed by a feature heuristic
 * (`HeuristicSoundClassifier`), but a real model (YAMNet / a TFLite export /
 * a hosted inference endpoint) can implement the same interface and be swapped
 * in via the `SOUND_CLASSIFIER` provider — nothing else in the pipeline changes.
 */
export interface SoundClassifier {
  /**
   * @returns classifications sorted by descending confidence (best first).
   *   May be empty when the frame is below the noise floor / nothing detected.
   */
  classify(frame: AudioFrame): Classification[] | Promise<Classification[]>;
}

/** Nest DI token for the active `SoundClassifier` implementation. */
export const SOUND_CLASSIFIER = Symbol('SOUND_CLASSIFIER');
