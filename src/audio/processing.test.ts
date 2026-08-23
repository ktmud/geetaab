import { describe, expect, it } from 'vitest';
import { RAW_AUDIO_CONSTRAINTS, readProcessing } from './processing';

describe('readProcessing', () => {
  it('sees a browser that honoured the constraints', () => {
    const verdict = readProcessing({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    });
    expect(verdict.processed).toBe(false);
    expect(verdict.active).toEqual([]);
    expect(verdict.unknown).toBe(false);
  });

  it('names the stages a browser left on', () => {
    // What iOS Safari does: the constraint is accepted and ignored.
    const verdict = readProcessing({
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: true,
    });
    expect(verdict.processed).toBe(true);
    expect(verdict.active).toEqual(['echoCancellation', 'autoGainControl']);
  });

  it('says so when the browser would not answer', () => {
    const verdict = readProcessing({});
    expect(verdict.unknown).toBe(true);
    expect(verdict.processed).toBe(false);
    expect(verdict.echoCancellation).toBeNull();
  });

  it('treats a missing settings object as unknown rather than as clean', () => {
    expect(readProcessing(undefined).unknown).toBe(true);
  });

  it('asks for one channel of unprocessed audio', () => {
    expect(RAW_AUDIO_CONSTRAINTS).toMatchObject({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    });
  });
});
