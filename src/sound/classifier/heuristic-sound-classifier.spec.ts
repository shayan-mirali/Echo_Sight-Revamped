import { AudioFrame } from '../sound.types';
import { HeuristicSoundClassifier } from './heuristic-sound-classifier';

function tone(freq: number, amp = 0.6, n = 4096, sr = 16000): AudioFrame {
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return { samples: s, sampleRate: sr };
}

describe('HeuristicSoundClassifier', () => {
  const classifier = new HeuristicSoundClassifier();

  it('returns nothing for silence (below the noise floor)', () => {
    const out = classifier.classify({ samples: new Float32Array(4096), sampleRate: 16000 });
    expect(out).toEqual([]);
  });

  it('classifies a loud 1 kHz tone as a Siren', () => {
    const out = classifier.classify(tone(1000));
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].label).toBe('Siren');
    expect(out[0].confidence).toBeGreaterThan(0.5);
  });

  it('classifies a low ~400 Hz tone as a Car Horn', () => {
    const out = classifier.classify(tone(400));
    expect(out[0].label).toBe('Car Horn');
  });

  it('returns results sorted by descending confidence within [0,1]', () => {
    const out = classifier.classify(tone(1000));
    for (let i = 1; i < out.length; i++) {
      expect(out[i - 1].confidence).toBeGreaterThanOrEqual(out[i].confidence);
    }
    for (const c of out) {
      expect(c.confidence).toBeGreaterThanOrEqual(0);
      expect(c.confidence).toBeLessThanOrEqual(1);
    }
  });
});
