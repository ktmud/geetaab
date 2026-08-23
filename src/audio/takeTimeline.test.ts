import { describe, expect, it } from 'vitest';
import { TakeTimeline } from './takeTimeline';

const RATE = 48000;
/** One capture chunk, as the worklet delivers them. */
const CHUNK = 4096;
const CHUNK_MS = (CHUNK / RATE) * 1000;

/** Feed `count` chunks arriving exactly on time, starting at `from`. */
function feed(timeline: TakeTimeline, from: number, count: number): number {
  let t = from;
  for (let i = 0; i < count; i++) {
    t += CHUNK_MS;
    timeline.push(t, CHUNK);
  }
  return t;
}

describe('TakeTimeline', () => {
  it('reports no holes when audio arrives on time', () => {
    const timeline = new TakeTimeline(RATE);
    timeline.begin(0, 0);
    feed(timeline, 0, 120);
    expect(timeline.gaps).toEqual([]);
    expect(timeline.missingSeconds).toBe(0);
    expect(timeline.seconds).toBeCloseTo((120 * CHUNK) / RATE, 6);
  });

  it('counts the flushed live window without counting it as elapsed time', () => {
    // The take opens with a second and a half of already-captured audio. That
    // is length the take has, not time it has been running, and confusing the
    // two would make every take open with a phantom hole.
    const timeline = new TakeTimeline(RATE);
    const preRoll = Math.floor(1.5 * RATE);
    timeline.begin(0, preRoll);
    expect(timeline.seconds).toBeCloseTo(1.5, 6);
    feed(timeline, 0, 60);
    expect(timeline.gaps).toEqual([]);
  });

  it('writes down audio that never arrived', () => {
    const timeline = new TakeTimeline(RATE);
    timeline.begin(0, 0);
    let t = feed(timeline, 0, 60);
    // Four seconds of wall clock pass with nothing delivered — a phone call,
    // a hidden tab, another app taking the microphone. Then it resumes.
    t += 4000;
    const gap = timeline.push(t, CHUNK);
    expect(gap).not.toBeNull();
    // Four seconds passed but one chunk did arrive at the end of them, so the
    // audio actually missing is four seconds minus that chunk. The hole is
    // what was lost, not how long the interruption felt.
    expect(gap!.seconds).toBeCloseTo(4 - CHUNK / RATE, 3);
    expect(gap!.at).toBeCloseTo((61 * CHUNK) / RATE, 3);
    expect(timeline.gaps).toHaveLength(1);
  });

  it('does not report the same hole twice', () => {
    const timeline = new TakeTimeline(RATE);
    timeline.begin(0, 0);
    let t = feed(timeline, 0, 30);
    t += 3000;
    timeline.push(t, CHUNK);
    // Everything after the hole is on time again, and the hole is already
    // accounted for, so nothing further should be reported.
    feed(timeline, t, 60);
    expect(timeline.gaps).toHaveLength(1);
  });

  it('finds a second hole after the first', () => {
    const timeline = new TakeTimeline(RATE);
    timeline.begin(0, 0);
    let t = feed(timeline, 0, 30);
    t += 2000;
    timeline.push(t, CHUNK);
    t = feed(timeline, t, 30);
    t += 5000;
    timeline.push(t, CHUNK);
    expect(timeline.gaps).toHaveLength(2);
    expect(timeline.gaps[1].seconds).toBeCloseTo(5 - CHUNK / RATE, 3);
    expect(timeline.missingSeconds).toBeCloseTo(7 - (2 * CHUNK) / RATE, 3);
  });

  it('absorbs ordinary jitter rather than calling it a hole', () => {
    // Chunks do not arrive on a metronome, and the graph has latency. Neither
    // is lost audio, and a detector that said otherwise would cry wolf on
    // every take.
    const timeline = new TakeTimeline(RATE);
    timeline.begin(0, 0);
    let t = 0;
    for (let i = 0; i < 200; i++) {
      t += CHUNK_MS + (i % 7) * 12 - 36;
      timeline.push(t, CHUNK);
    }
    expect(timeline.gaps).toEqual([]);
  });

  it('absorbs a constant delivery lag', () => {
    // Some graphs run a fixed distance behind the clock. Measured against zero
    // that reads as a permanent hole; measured against the take's own baseline
    // it reads as nothing, which is what it is.
    const timeline = new TakeTimeline(RATE);
    timeline.begin(0, 0);
    let t = 250; // the first chunk lands a quarter-second late and stays there
    for (let i = 0; i < 200; i++) {
      t += CHUNK_MS;
      timeline.push(t, CHUNK);
    }
    expect(timeline.gaps).toEqual([]);
  });

  it('ignores audio that arrives before the take begins', () => {
    const timeline = new TakeTimeline(RATE);
    expect(timeline.push(100, CHUNK)).toBeNull();
    expect(timeline.seconds).toBe(0);
  });

  it('measures how long the take has been silent, for a stall watchdog', () => {
    const timeline = new TakeTimeline(RATE);
    timeline.begin(0, 0);
    timeline.push(500, CHUNK);
    expect(timeline.silenceFor(500)).toBe(0);
    expect(timeline.silenceFor(2500)).toBeCloseTo(2, 6);
  });

  it('hands out copies, so a caller cannot rewrite the record', () => {
    const timeline = new TakeTimeline(RATE);
    timeline.begin(0, 0);
    let t = feed(timeline, 0, 10);
    t += 3000;
    timeline.push(t, CHUNK);
    const gaps = timeline.gaps;
    gaps[0].seconds = 999;
    expect(timeline.gaps[0].seconds).not.toBe(999);
  });

  it('forgets everything on reset', () => {
    const timeline = new TakeTimeline(RATE);
    timeline.begin(0, 0);
    let t = feed(timeline, 0, 10);
    t += 3000;
    timeline.push(t, CHUNK);
    timeline.reset();
    expect(timeline.seconds).toBe(0);
    expect(timeline.gaps).toEqual([]);
    expect(timeline.missingSeconds).toBe(0);
  });
});
