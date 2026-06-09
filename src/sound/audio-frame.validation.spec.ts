import {
  AUDIO_LIMITS,
  FrameRateLimiter,
  validateFramePayload,
} from './audio-frame.validation';

const validPcm = Buffer.alloc(4096 * 2).toString('base64');

describe('validateFramePayload', () => {
  it('accepts a well-formed pcm16 frame', () => {
    expect(validateFramePayload({ sampleRate: 16000, pcm16: validPcm }).ok).toBe(true);
  });

  it('accepts a well-formed raw samples frame', () => {
    expect(validateFramePayload({ sampleRate: 16000, samples: [0.1, -0.2, 0.3] }).ok).toBe(true);
  });

  it('rejects non-objects', () => {
    expect(validateFramePayload(null).reason).toBe('not-an-object');
    expect(validateFramePayload('nope').reason).toBe('not-an-object');
  });

  it('rejects out-of-range or non-numeric sample rates', () => {
    expect(validateFramePayload({ sampleRate: 1000, pcm16: validPcm }).reason).toBe('bad-sample-rate');
    expect(validateFramePayload({ sampleRate: 96000, pcm16: validPcm }).reason).toBe('bad-sample-rate');
    expect(validateFramePayload({ sampleRate: 'x', pcm16: validPcm }).reason).toBe('bad-sample-rate');
  });

  it('rejects a frame with no audio', () => {
    expect(validateFramePayload({ sampleRate: 16000 }).reason).toBe('no-audio');
  });

  it('rejects oversized pcm16', () => {
    const huge = 'A'.repeat(AUDIO_LIMITS.maxPcm16Base64Length + 1);
    expect(validateFramePayload({ sampleRate: 16000, pcm16: huge }).reason).toBe('pcm16-too-large');
  });

  it('rejects non-base64 pcm16', () => {
    expect(validateFramePayload({ sampleRate: 16000, pcm16: '!!!not base64!!!' }).reason).toBe(
      'pcm16-not-base64',
    );
  });

  it('rejects too many raw samples', () => {
    const big = new Array(AUDIO_LIMITS.maxRawSamples + 1).fill(0);
    expect(validateFramePayload({ sampleRate: 16000, samples: big }).reason).toBe('samples-too-large');
  });

  it('rejects non-finite samples', () => {
    expect(validateFramePayload({ sampleRate: 16000, samples: [0.1, NaN] }).reason).toBe(
      'samples-not-numeric',
    );
    expect(validateFramePayload({ sampleRate: 16000, samples: [0.1, Infinity] }).reason).toBe(
      'samples-not-numeric',
    );
  });
});

describe('FrameRateLimiter', () => {
  it('allows up to the cap within a window, then blocks', () => {
    const rl = new FrameRateLimiter(3, 1000);
    expect(rl.allow(0)).toBe(true);
    expect(rl.allow(100)).toBe(true);
    expect(rl.allow(200)).toBe(true);
    expect(rl.allow(300)).toBe(false); // 4th in the window
  });

  it('resets after the window elapses', () => {
    const rl = new FrameRateLimiter(2, 1000);
    expect(rl.allow(0)).toBe(true);
    expect(rl.allow(10)).toBe(true);
    expect(rl.allow(20)).toBe(false);
    expect(rl.allow(1100)).toBe(true); // new window
  });
});
