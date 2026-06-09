import { decodeFrame, extractFeatures } from './audio-features';

function toneSamples(freq: number, n = 4096, sr = 16000, amp = 0.6): Float32Array {
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return s;
}

describe('decodeFrame', () => {
  it('round-trips Int16 PCM base64 to normalized floats', () => {
    const vals = [0, 0.5, -0.5, 1.0, -1.0];
    const buf = Buffer.alloc(vals.length * 2);
    vals.forEach((v, i) =>
      buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2),
    );

    const frame = decodeFrame({ sampleRate: 16000, pcm16: buf.toString('base64') });

    expect(frame.sampleRate).toBe(16000);
    expect(frame.samples.length).toBe(5);
    expect(frame.samples[1]).toBeCloseTo(0.5, 2);
    expect(frame.samples[2]).toBeCloseTo(-0.5, 2);
  });

  it('passes raw float samples through', () => {
    const frame = decodeFrame({ sampleRate: 16000, samples: [0.1, 0.2, 0.3] });
    expect(Array.from(frame.samples)).toHaveLength(3);
    expect(frame.samples[0]).toBeCloseTo(0.1, 5);
  });

  it('returns an empty frame when no audio is present', () => {
    const frame = decodeFrame({ sampleRate: 16000 });
    expect(frame.samples.length).toBe(0);
  });

  it('defaults the sample rate to 16000', () => {
    const frame = decodeFrame({ sampleRate: 0, samples: [0.1] });
    expect(frame.sampleRate).toBe(16000);
  });
});

describe('extractFeatures', () => {
  it('reports silence for an all-zero frame', () => {
    const f = extractFeatures({ samples: new Float32Array(2048), sampleRate: 16000 });
    expect(f.rmsDb).toBe(-100);
    expect(f.dominantHz).toBe(0);
    expect(f.flatness).toBe(1);
  });

  it('finds the dominant frequency of a pure tone', () => {
    const f = extractFeatures({ samples: toneSamples(1000), sampleRate: 16000 });
    expect(Math.abs(f.dominantHz - 1000)).toBeLessThan(20);
    expect(f.rmsDb).toBeGreaterThan(-55); // not silence
    expect(f.flatness).toBeLessThan(0.3); // tonal, not noisy
  });
});
