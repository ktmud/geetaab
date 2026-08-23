/**
 * Comparing a transcription against reference chords.
 *
 * Three references exist in practice, in descending order of authority:
 *
 * 1. Time-aligned annotations (GuitarSet's .jams): every instant of the
 *    recording is labelled. Supports chord symbol recall — the fraction of
 *    time the detected chord equals the reference chord *at that instant* —
 *    which is the only number that punishes a right chord in the wrong place.
 * 2. Ordered sheets (published tabs read bar by bar): the chord sequence and
 *    its bar positions are known, but not where any bar falls in the
 *    recording. Supports order-aware alignment, which catches scrambled or
 *    invented changes but not timing.
 * 3. Bare vocabularies (a sheet reduced to its set of symbols): supports only
 *    "is this chord anywhere in the song", the weakest reading. A detection
 *    playing the right four chords in a scrambled order still scores 100%.
 *
 * The scripts report the strongest metric each reference supports, and keep
 * the vocabulary number alongside for comparison — the gap between the two is
 * a measurement of how much the old number flattered.
 *
 * Everything here is pure and deterministic; the scripts under scripts/ and
 * the unit tests are the callers.
 */
import {
  QUALITIES,
  SHARP_NAMES,
  FLAT_NAMES,
  isNoChord,
  chordName,
  type ChordQuality,
  type ChordSymbol,
} from './chordTypes';
import type { ChordSegment } from './chords';

export type ChordFamily = 'maj' | 'min';

/** A reference chord: family always known, exact quality only when the app's
 * vocabulary has a symbol for it (add9, dim and friends have none). */
export interface RefChord {
  root: number;
  family: ChordFamily;
  quality: ChordQuality | null;
  bass?: number;
}

/** One span of a time-aligned reference; chord null means N (no chord). */
export interface RefInterval {
  start: number;
  end: number;
  chord: RefChord | null;
}

export function pitchClass(name: string): number {
  const i = SHARP_NAMES.indexOf(name);
  if (i >= 0) return i;
  const j = FLAT_NAMES.indexOf(name);
  if (j >= 0) return j;
  throw new Error(`unknown note: ${name}`);
}

/** Major/minor family of a detected chord; sus and sevenths follow their third. */
export function familyOfQuality(q: ChordQuality): ChordFamily {
  return q === 'min' || q === 'min7' ? 'min' : 'maj';
}

/** Suffixes that land exactly on one of the app's seven vocabulary qualities.
 * Anything else (add9, 6, 9, dim, aug, ...) still has a root and family for
 * the family-level metric, but no single right symbol at the exact level. */
export const VOCAB_QUALITY: Record<string, ChordQuality> = {
  '': 'maj',
  m: 'min',
  '7': 'dom7',
  m7: 'min7',
  maj7: 'maj7',
  sus4: 'sus4',
  sus2: 'sus2',
};

/** "Cadd9", "Dm7", "G/B" → parsed reference chord. Throws on garbage. */
export function parseSheetSymbol(text: string): RefChord & { text: string } {
  const m = /^([A-G])([#b]?)(.*)$/.exec(text.trim());
  if (!m) throw new Error(`unparsed chord: ${text}`);
  const [, letter, accidental, rest] = m;
  const root = pitchClass(letter + accidental);
  const [body, bassText] = rest.split('/');
  // A leading "m" is minor; "maj" is a major seventh, still a major triad.
  const family: ChordFamily = /^m(?!aj)/.test(body) ? 'min' : 'maj';
  const quality = Object.hasOwn(VOCAB_QUALITY, body) ? VOCAB_QUALITY[body] : null;
  const bass = bassText ? pitchClass(bassText) : undefined;
  return { text: text.trim(), root, family, quality, bass };
}

/** Harte shorthands (used by .jams chord annotations) → family + exact quality. */
const HARTE_SHORTHAND: Record<string, { family: ChordFamily; quality: ChordQuality | null }> = {
  maj: { family: 'maj', quality: 'maj' },
  min: { family: 'min', quality: 'min' },
  '7': { family: 'maj', quality: 'dom7' },
  min7: { family: 'min', quality: 'min7' },
  maj7: { family: 'maj', quality: 'maj7' },
  sus4: { family: 'maj', quality: 'sus4' },
  sus2: { family: 'maj', quality: 'sus2' },
  dim: { family: 'min', quality: null },
  dim7: { family: 'min', quality: null },
  hdim7: { family: 'min', quality: null },
  aug: { family: 'maj', quality: null },
  min6: { family: 'min', quality: null },
  maj6: { family: 'maj', quality: null },
  '6': { family: 'maj', quality: null },
  '9': { family: 'maj', quality: null },
  maj9: { family: 'maj', quality: null },
  min9: { family: 'min', quality: null },
  minmaj7: { family: 'min', quality: null },
  '11': { family: 'maj', quality: null },
  min11: { family: 'min', quality: null },
  '13': { family: 'maj', quality: null },
  min13: { family: 'min', quality: null },
  sus: { family: 'maj', quality: null },
};

/**
 * Parse a Harte-syntax chord label ("D#:maj", "G#:min7", "Eb:maj6(*5)/3",
 * "C", "N"). Returns null for N/X. Alterations in parentheses and the
 * inversion degree are ignored: they never change the root or the
 * major/minor family, which is all the scoring reads.
 */
export function parseHarte(label: string): RefChord | null {
  const text = label.trim();
  if (text === 'N' || text === 'X') return null;
  const m = /^([A-G])([#b]*)(?::([^/]+))?(?:\/(.*))?$/.exec(text);
  if (!m) throw new Error(`unparsed Harte label: ${label}`);
  const [, letter, accidentals, qualityText] = m;
  let root = pitchClass(letter);
  for (const a of accidentals) root += a === '#' ? 1 : -1;
  root = ((root % 12) + 12) % 12;
  if (!qualityText) return { root, family: 'maj', quality: 'maj' };
  const body = qualityText.replace(/\(.*$/, '').trim();
  if (body.startsWith('(')) {
    // Bare interval list, e.g. C:(b3,5) — read the family off the third.
    const minor = /b3/.test(qualityText);
    return { root, family: minor ? 'min' : 'maj', quality: null };
  }
  const known = HARTE_SHORTHAND[body];
  if (known) return { root, ...known };
  return { root, family: body.startsWith('min') ? 'min' : 'maj', quality: null };
}

export function transposeRef(chord: RefChord, semitones: number): RefChord {
  return {
    ...chord,
    root: (((chord.root + semitones) % 12) + 12) % 12,
    bass: chord.bass === undefined ? undefined : (((chord.bass + semitones) % 12) + 12) % 12,
  };
}

/** Detected chord at time t, given non-overlapping segments sorted by start. */
function chordAt(segments: ChordSegment[], t: number, cursor: { i: number }): ChordSymbol | null {
  while (cursor.i < segments.length && segments[cursor.i].end <= t) cursor.i++;
  const seg = segments[cursor.i];
  if (!seg || seg.start > t) return null;
  return seg.chord;
}

export interface RecallOptions {
  /** Semitones added to every reference root before comparing. */
  shift?: number;
  /** Grid step in seconds; 10 ms is the conventional evaluation grid. */
  grid?: number;
}

export interface RecallResult {
  shift: number;
  /** Reference time carrying any chord (the family denominator), seconds. */
  chordTime: number;
  /** ...of which the detected chord had the right root and family. */
  familyHit: number;
  /** Reference time whose exact symbol exists in the app's vocabulary. */
  exactTime: number;
  /** ...of which the detected chord was exactly that symbol. */
  exactHit: number;
  /** Reference chord time the detection left as N.C. (counted as a miss). */
  ncTime: number;
  /** Detected-chord names during missed reference time, by duration. */
  misses: Map<string, number>;
}

/**
 * Chord symbol recall over a fine time grid: at every grid instant inside a
 * reference chord span, does the detection name the same chord?
 *
 * This is the standard time-aligned measure (MIREX calls it chord symbol
 * recall / weighted chord symbol accuracy). Unlike vocabulary agreement it
 * gives no credit for the right chord in the wrong place.
 */
export function symbolRecall(
  segments: ChordSegment[],
  reference: RefInterval[],
  opts: RecallOptions = {},
): RecallResult {
  const shift = opts.shift ?? 0;
  const grid = opts.grid ?? 0.01;
  const cursor = { i: 0 };
  let chordTime = 0;
  let familyHit = 0;
  let exactTime = 0;
  let exactHit = 0;
  let ncTime = 0;
  const misses = new Map<string, number>();

  for (const span of reference) {
    if (!span.chord) continue;
    const ref = shift === 0 ? span.chord : transposeRef(span.chord, shift);
    for (let t = span.start + grid / 2; t < span.end; t += grid) {
      chordTime += grid;
      const wantExact = ref.quality !== null;
      if (wantExact) exactTime += grid;
      const det = chordAt(segments, t, cursor);
      if (det === null || isNoChord(det)) {
        ncTime += grid;
        misses.set('N.C.', (misses.get('N.C.') ?? 0) + grid);
        continue;
      }
      const famOk = det.root === ref.root && familyOfQuality(det.quality) === ref.family;
      if (famOk) {
        familyHit += grid;
        if (wantExact && det.quality === ref.quality) exactHit += grid;
      } else {
        misses.set(chordName(det), (misses.get(chordName(det)) ?? 0) + grid);
      }
    }
  }
  return { shift, chordTime, familyHit, exactTime, exactHit, ncTime, misses };
}

/** symbolRecall at each shift, keeping the one with the best family recall. */
export function bestShiftRecall(
  segments: ChordSegment[],
  reference: RefInterval[],
  shifts: number[],
  opts: Omit<RecallOptions, 'shift'> = {},
): RecallResult {
  let best: RecallResult | null = null;
  for (const shift of shifts) {
    const r = symbolRecall(segments, reference, { ...opts, shift });
    if (!best || r.familyHit > best.familyHit) best = r;
  }
  return best!;
}

export interface VocabularyResult {
  shift: number;
  played: number;
  hitFamily: number;
  hitQuality: number;
  misses: Map<string, number>;
}

/**
 * The old metric, kept for comparison: is the detected chord anywhere in the
 * reference's vocabulary, weighted by time. Position is never checked, which
 * is exactly its weakness — it is reported next to the position-aware numbers
 * so the flattery is visible, not hidden.
 */
export function vocabularyAgreement(
  segments: ChordSegment[],
  reference: RefChord[],
  shift: number,
): VocabularyResult {
  const families = new Set(reference.map((r) => `${(r.root + shift + 12) % 12}:${r.family}`));
  const seen = new Map<string, Set<ChordQuality>>();
  for (const r of reference) {
    const key = `${(r.root + shift + 12) % 12}:${r.family}`;
    if (!seen.has(key)) seen.set(key, new Set());
    if (r.quality) seen.get(key)!.add(r.quality);
  }
  // The exact tier only exists where the sheet is unambiguous about a root.
  const exact = new Map<string, ChordQuality>();
  for (const [key, qs] of seen) if (qs.size === 1) exact.set(key, [...qs][0]);

  let played = 0;
  let hitFamily = 0;
  let hitQuality = 0;
  const misses = new Map<string, number>();
  for (const seg of segments) {
    if (isNoChord(seg.chord)) continue;
    const dur = seg.end - seg.start;
    played += dur;
    const key = `${seg.chord.root}:${familyOfQuality(seg.chord.quality)}`;
    if (families.has(key)) {
      hitFamily += dur;
      if (exact.get(key) === seg.chord.quality) hitQuality += dur;
    } else {
      const name = chordName(seg.chord);
      misses.set(name, (misses.get(name) ?? 0) + dur);
    }
  }
  return { shift, played, hitFamily, hitQuality, misses };
}

/** One chord change in an ordered (but not time-aligned) reference sheet. */
export interface SheetEvent {
  chord: RefChord;
  /** Bar position in the sheet, 0-based; fractional for mid-bar changes. */
  bar: number;
}

export interface AlignmentPair {
  /** Index into the sheet events. */
  sheet: number;
  /** Index into the detected events. */
  detected: number;
}

export interface AlignmentResult {
  shift: number;
  /** Pairs aligned as equal (root + family), in order. */
  matched: AlignmentPair[];
  sheetCount: number;
  detectedCount: number;
}

/**
 * Order-aware comparison of two chord change sequences by global alignment
 * (Needleman-Wunsch). A detection that plays the sheet's chords in a
 * scrambled order can no longer score: matches must appear in the same order
 * on both sides. Equality is root + family after the given shift.
 *
 * Scores: aligning a genuine match is worth +2; a mismatch costs the same as
 * the two gaps it could be split into, so it is never forced; gaps are cheap
 * enough that an inserted wrong chord skips rather than derailing the rest.
 */
export function alignChordSequences(
  sheet: { root: number; family: ChordFamily }[],
  detected: { root: number; family: ChordFamily }[],
  shift = 0,
): AlignmentResult {
  const M = sheet.length;
  const N = detected.length;
  const MATCH = 2;
  const MISMATCH = -2;
  const GAP = -1;
  const cols = N + 1;
  const score = new Float64Array((M + 1) * cols);
  // 0 = diagonal, 1 = up (sheet gap), 2 = left (detected gap)
  const move = new Uint8Array((M + 1) * cols);
  for (let j = 1; j <= N; j++) {
    score[j] = j * GAP;
    move[j] = 2;
  }
  for (let i = 1; i <= M; i++) {
    score[i * cols] = i * GAP;
    move[i * cols] = 1;
  }
  for (let i = 1; i <= M; i++) {
    const sRoot = (sheet[i - 1].root + shift + 12) % 12;
    const sFam = sheet[i - 1].family;
    for (let j = 1; j <= N; j++) {
      const eq = detected[j - 1].root === sRoot && detected[j - 1].family === sFam;
      const diag = score[(i - 1) * cols + (j - 1)] + (eq ? MATCH : MISMATCH);
      const up = score[(i - 1) * cols + j] + GAP;
      const left = score[i * cols + (j - 1)] + GAP;
      let best = diag;
      let m = 0;
      if (up > best) {
        best = up;
        m = 1;
      }
      if (left > best) {
        best = left;
        m = 2;
      }
      score[i * cols + j] = best;
      move[i * cols + j] = m;
    }
  }
  const matched: AlignmentPair[] = [];
  let i = M;
  let j = N;
  while (i > 0 || j > 0) {
    const m = move[i * cols + j];
    if (i > 0 && j > 0 && m === 0) {
      const sRoot = (sheet[i - 1].root + shift + 12) % 12;
      if (detected[j - 1].root === sRoot && detected[j - 1].family === sheet[i - 1].family) {
        matched.push({ sheet: i - 1, detected: j - 1 });
      }
      i--;
      j--;
    } else if (i > 0 && (m === 1 || j === 0)) {
      i--;
    } else {
      j--;
    }
  }
  matched.reverse();
  return { shift, matched, sheetCount: M, detectedCount: N };
}

/** Best-shift wrapper for alignChordSequences (a sheet is written in whatever
 * key reads well; the recording may sit a capo away from it). */
export function bestShiftAlignment(
  sheet: { root: number; family: ChordFamily }[],
  detected: { root: number; family: ChordFamily }[],
  shifts: number[],
): AlignmentResult {
  let best: AlignmentResult | null = null;
  for (const shift of shifts) {
    const r = alignChordSequences(sheet, detected, shift);
    if (!best || r.matched.length > best.matched.length) best = r;
  }
  return best!;
}

/** Collapse detected segments into an ordered change sequence: no N.C., no
 * consecutive repeats at root+family level, each with its beat span. */
export function detectedChangeSequence(
  segments: ChordSegment[],
): { root: number; family: ChordFamily; quality: ChordQuality; beats: number; start: number; end: number }[] {
  const out: { root: number; family: ChordFamily; quality: ChordQuality; beats: number; start: number; end: number }[] = [];
  for (const seg of segments) {
    if (isNoChord(seg.chord)) continue;
    const family = familyOfQuality(seg.chord.quality);
    const beats = Math.max(0, (seg.endBeat ?? 0) - (seg.startBeat ?? 0));
    const last = out[out.length - 1];
    if (last && last.root === seg.chord.root && last.family === family) {
      last.beats += beats;
      last.end = seg.end;
    } else {
      out.push({ root: seg.chord.root, family, quality: seg.chord.quality, beats, start: seg.start, end: seg.end });
    }
  }
  return out;
}

/** Collapse sheet events the same way, keeping bar spans. `totalBars` bounds
 * the last event. */
export function sheetChangeSequence(
  events: SheetEvent[],
  totalBars: number,
): { root: number; family: ChordFamily; quality: ChordQuality | null; bar: number; bars: number }[] {
  const out: { root: number; family: ChordFamily; quality: ChordQuality | null; bar: number; bars: number }[] = [];
  for (const ev of events) {
    const last = out[out.length - 1];
    if (last && last.root === ev.chord.root && last.family === ev.chord.family) continue;
    out.push({ root: ev.chord.root, family: ev.chord.family, quality: ev.chord.quality, bar: ev.bar, bars: 0 });
  }
  for (let i = 0; i < out.length; i++) {
    const next = i + 1 < out.length ? out[i + 1].bar : totalBars;
    out[i].bars = Math.max(0, next - out[i].bar);
  }
  return out;
}

export type TempoClass = 'correct' | 'half' | 'double' | 'twothirds' | 'threehalves' | 'other';

/**
 * Name the relationship of a detected tempo to the truth. Half and double are
 * the octave errors; 2/3 and 3/2 appear when a swung or triplet-heavy pattern
 * offers a competing period. Tolerance is relative (default 8%).
 */
export function classifyTempo(detected: number, truth: number, tolerance = 0.08): TempoClass {
  const pairs: [TempoClass, number][] = [
    ['correct', 1],
    ['half', 0.5],
    ['double', 2],
    ['twothirds', 2 / 3],
    ['threehalves', 1.5],
  ];
  for (const [name, mult] of pairs) {
    if (Math.abs(detected / truth - mult) <= tolerance * mult) return name;
  }
  return 'other';
}

export { QUALITIES };
