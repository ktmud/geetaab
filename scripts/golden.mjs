/* Dump reference outputs of the analysis pipeline as JSON.

   A second implementation of this pipeline — the native one — reproduces this
   file from the same inputs, which is what turns "the port compiles" into "the
   port agrees". Everything it needs is here: the fixture is synthesized by an
   integer PRNG, so any language that can multiply 32-bit words rebuilds the
   same recording rather than having to ship one.

   Run it after any change to src/core or src/music that is meant to change
   results, and commit the new file alongside:

     npx vite-node scripts/golden.mjs [output.json]
*/
import { writeFile } from 'node:fs/promises';
import { FFT, hannWindow } from '../src/core/fft.ts';
import { resample, stft, toMono, normalizePeak, medianOf } from '../src/core/dsp.ts';
import { computeChromagram, estimateTuning, averageChroma, CHROMA_SAMPLE_RATE } from '../src/core/chroma.ts';
import { onsetEnvelope, estimateTempo, trackBeats, padBeatGrid, estimateBeatsPerBar, estimateBarPhase, ONSET_SAMPLE_RATE } from '../src/core/beats.ts';
import { scoreChords, decodeChords, TOTAL_STATES, stateToChord, aggregateByBeats, aggregateEnergyByBeats } from '../src/core/chords.ts';
import { estimateKey } from '../src/core/key.ts';
import { chordName } from '../src/core/chordTypes.ts';
import { analyzeAudio, chordToneHistogram, bestChordForChroma } from '../src/core/analyze.ts';
import { renderProgression, DEMO_PROGRESSION, renderShapeStrum } from '../src/audio/synth.ts';
import { shapesFor, easiestShape } from '../src/music/shapes.ts';
import { chooseCapo, toPlayableChord, patternsFor, patternById, suggestStrum } from '../src/music/arrange.ts';
import { buildTab } from '../src/music/tab.ts';
import { reduceSegments, levelsWorthOffering } from '../src/music/levels.ts';
import { engraveTab, barsPerSystemFor, METRICS, stringY } from '../src/music/tabEngrave.ts';
import { barTab, tabSystems, songTabText } from '../src/music/tabText.ts';
import { pitchClassHue } from '../src/music/pitchColor.ts';
import { isMusical, musicFeaturesFrom } from '../src/core/music.ts';

/** A few numbers that a wrong port cannot reproduce by accident. */
function digest(arr) {
  const a = Array.from(arr);
  let sum = 0;
  let sumAbs = 0;
  let weighted = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i];
    sumAbs += Math.abs(a[i]);
    weighted += a[i] * ((i % 97) + 1);
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < a.length; i++) {
    if (a[i] < lo) lo = a[i];
    if (a[i] > hi) hi = a[i];
  }
  const probes = [];
  const step = Math.max(1, Math.floor(a.length / 12));
  for (let i = 0; i < a.length && probes.length < 12; i += step) probes.push(a[i]);
  return {
    length: a.length,
    sum,
    sumAbs,
    weighted,
    min: a.length ? lo : 0,
    max: a.length ? hi : 0,
    head: a.slice(0, 6),
    tail: a.slice(-6),
    probes,
  };
}

const out = {};

// --- primitives -------------------------------------------------------------
out.hann64 = Array.from(hannWindow(64));

{
  const n = 64;
  const frame = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    frame[i] = Math.sin((2 * Math.PI * 5 * i) / n) + 0.5 * Math.cos((2 * Math.PI * 17 * i) / n);
  }
  const mags = new Float64Array(n / 2 + 1);
  new FFT(n).magnitudes(frame, mags);
  out.fft64 = Array.from(mags);
}

// --- the reference recording ------------------------------------------------
const SR = 48000;
const signal = renderProgression(DEMO_PROGRESSION, { sampleRate: SR, seed: 1337, noise: 0.004 });
out.signalRate = SR;
out.signal = digest(signal);

// Exercises the cached-phase resampler (period 147) and the direct fallback.
const at22 = resample(signal, SR, ONSET_SAMPLE_RATE);
const at11 = resample(at22, ONSET_SAMPLE_RATE, CHROMA_SAMPLE_RATE);
out.resample48to22 = digest(at22);
out.resample22to11 = digest(at11);
out.resampleOddRatio = digest(resample(signal.subarray(0, 100000), 44100, 11111));

// --- spectra ----------------------------------------------------------------
const spec = stft(at11, CHROMA_SAMPLE_RATE, { fftSize: 8192, hopSize: 1024 });
out.stft = { frames: spec.frames, bins: spec.bins, data: digest(spec.data) };
out.tuning = estimateTuning(spec);

const chroma = computeChromagram(at11, CHROMA_SAMPLE_RATE);
out.chroma = {
  frames: chroma.frames,
  frameRate: chroma.frameRate,
  tuning: chroma.tuning,
  treble: digest(chroma.treble),
  bass: digest(chroma.bass),
  energy: digest(chroma.energy),
  frame100Treble: Array.from(chroma.treble.subarray(100 * 12, 101 * 12)),
  frame100Bass: Array.from(chroma.bass.subarray(100 * 12, 101 * 12)),
};
out.averageChroma = Array.from(averageChroma(chroma.treble, chroma.frames, chroma.energy));

// --- rhythm -----------------------------------------------------------------
const onset = onsetEnvelope(at22, ONSET_SAMPLE_RATE);
out.onset = { fps: onset.fps, values: digest(onset.values) };
const tempo = estimateTempo(onset);
out.tempo = { bpm: tempo.bpm, strength: tempo.strength, alternate: tempo.alternate };
const tracked = trackBeats(onset, tempo.bpm);
out.trackBeats = digest(tracked);
const padded = padBeatGrid(tracked, signal.length / SR);
out.padBeatGrid = digest(padded);

// --- chord scoring and decoding --------------------------------------------
const t100 = chroma.treble.slice(100 * 12, 101 * 12);
const b100 = chroma.bass.slice(100 * 12, 101 * 12);
out.scoreFrame100 = Array.from(scoreChords(t100, b100, 1).scores);
out.bestChordFrame100 = bestChordForChroma(t100, b100);

const agg = aggregateByBeats(chroma.treble, chroma.frames, chroma.frameRate, padded);
const aggBass = aggregateByBeats(chroma.bass, chroma.frames, chroma.frameRate, padded);
const aggEnergy = aggregateEnergyByBeats(chroma.energy, chroma.frames, chroma.frameRate, padded);
out.aggregate = { count: agg.count, treble: digest(agg.data), bass: digest(aggBass.data), energy: digest(aggEnergy) };

const scored = scoreChords(agg.data, aggBass.data, agg.count, aggEnergy, { bassWeight: 0.3, ncFloor: 0.12 });
out.scoredGrid = digest(scored.scores);
const path = decodeChords(scored, { beta: 22, changePenalty: 2.2, relatedBonus: 0.4 });
out.decodePath = path;
out.decodeNames = path.map((s) => chordName(stateToChord(s)));

// --- key --------------------------------------------------------------------
out.keyFromHistogram = estimateKey([0.2, 0.01, 0.1, 0.02, 0.12, 0.08, 0.01, 0.18, 0.02, 0.14, 0.03, 0.09]);
{
  // A histogram whose bare correlation says G major, with segment evidence
  // that says C: the chords open and close on C, C occupies the most time,
  // and G7→C recurs. The evidence must flip the verdict — a port that
  // ignores the segment argument reproduces G major here and is caught.
  const gLeaningHist = [0.1195, 0.0575, 0.1078, 0.0566, 0.0945, 0.072, 0.0655, 0.1408, 0.0549, 0.085, 0.0554, 0.0905];
  out.keyBareGLean = estimateKey(gLeaningHist);
  const evidence = [
    { root: 0, quality: 'maj', start: 0, end: 4 },
    { root: 5, quality: 'maj', start: 4, end: 6 },
    { root: 7, quality: 'dom7', start: 6, end: 8 },
    { root: 0, quality: 'maj', start: 8, end: 12 },
    { root: 9, quality: 'min', start: 12, end: 14 },
    { root: 7, quality: 'maj', start: 14, end: 16 },
    { root: 0, quality: 'maj', start: 16, end: 20 },
  ];
  out.keyFromEvidence = estimateKey(gLeaningHist, evidence);
}

// --- the whole pipeline -----------------------------------------------------
const analysis = analyzeAudio(signal, SR);
out.analysis = {
  duration: analysis.duration,
  tempo: analysis.tempo,
  beatsPerBar: analysis.beatsPerBar,
  barPhase: analysis.barPhase,
  key: analysis.key,
  tuning: analysis.tuning,
  confidence: analysis.confidence,
  rhythmicity: analysis.rhythmicity,
  freeTime: analysis.freeTime,
  beatCount: analysis.beats.length,
  beats: digest(analysis.beats),
  segments: analysis.segments.map((s) => ({
    name: chordName(s.chord),
    start: s.start,
    end: s.end,
    startBeat: s.startBeat,
    endBeat: s.endBeat,
    confidence: s.confidence,
    // Slash-chord pass: the sounding bass when it is a non-root chord tone.
    // Undefined serializes to nothing, so root-position segments are as before.
    bass: s.bass,
  })),
};
out.chordToneHistogram = chordToneHistogram(analysis.segments);

// --- arrangement ------------------------------------------------------------
const capo = chooseCapo(analysis.segments, analysis.key);
out.capo = capo;
out.capoLiteral = chooseCapo(analysis.segments, analysis.key, { simplify: false });

const tabs = {
  easy: buildTab({ ...analysis, segments: reduceSegments(analysis.segments, analysis.beatsPerBar) }),
  standard: buildTab(analysis),
  faithful: buildTab(analysis, { simplify: false }),
};
out.levels = levelsWorthOffering(tabs);
out.tabs = Object.fromEntries(
  Object.entries(tabs).map(([name, tab]) => [
    name,
    {
      capo: tab.capo,
      capoOpenRatio: tab.capoOpenRatio,
      shapeKeyName: tab.shapeKeyName,
      tempo: tab.tempo,
      beatsPerBar: tab.beatsPerBar,
      strumId: tab.strum.id,
      eventCount: tab.events.length,
      barCount: tab.bars.length,
      barSignatures: tab.bars.slice(0, 12).map((b) => b.signature),
      palette: tab.palette.map((c) => ({
        label: c.label,
        shapeLabel: c.shapeLabel,
        frets: c.shape.frets,
        fingers: c.shape.fingers,
        difficulty: c.shape.difficulty,
        substituted: Boolean(c.substitutedFrom),
      })),
      loop: tab.loop,
      confidence: tab.confidence,
    },
  ]),
);

// --- shape tables -----------------------------------------------------------
out.shapes = {};
for (const root of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
  for (const quality of ['maj', 'min', 'dom7', 'min7', 'maj7', 'sus4', 'sus2']) {
    const list = shapesFor({ root, quality });
    out.shapes[`${root}:${quality}`] = list.map((s) => ({
      frets: s.frets,
      fingers: s.fingers,
      difficulty: s.difficulty,
      barre: s.barre ?? null,
    }));
  }
}
out.patterns4 = patternsFor(4).map((p) => p.id);
out.patterns3 = patternsFor(3).map((p) => p.id);
out.suggestStrum = [60, 96, 150].map((bpm) => suggestStrum(bpm, 4).id);
// patternById searches only the strums, so a picking id comes back as the
// default. That is easy to "fix" in a port and wrong to: the web resolves a
// player's choice at its own call site, against patternsFor. Recorded here so
// the two cannot quietly disagree about it.
out.patternById = ['held', 'classic', 'waltz', 'pick-simple', 'pick-alternating', 'nonsense'].map(
  (id) => patternById(id).id,
);
out.shapeStrum = digest(renderShapeStrum([-1, 3, 2, 0, 1, 0], { sampleRate: 22050 }));

// --- engraved tablature -----------------------------------------------------
// Coordinates rather than characters, so a port that gets the arithmetic wrong
// draws a plausible-looking staff with the wrong thing on it. Two systems is
// enough to cover bar widths, the carried chord name, and the wrap.
out.engrave = {
  metrics: METRICS,
  stringY: [1, 2, 3, 4, 5, 6].map(stringY),
  barsPerSystem: {
    quarters: barsPerSystemFor(4, patternById('quarters')),
    eighths: barsPerSystemFor(4, patternById('eighths')),
    classic: barsPerSystemFor(4, patternById('classic')),
    waltz: barsPerSystemFor(3, patternById('waltz')),
    pickAlternating: barsPerSystemFor(4, patternById('pick-alternating')),
  },
  systems: engraveTab(tabs.standard).slice(0, 2).map((system) => ({
    startBar: system.startBar,
    width: system.width,
    contentWidth: system.contentWidth,
    bars: system.bars.map((bar) => ({
      index: bar.index,
      x: bar.x,
      width: bar.width,
      names: bar.names.map((n) => ({
        label: n.label,
        x: n.x,
        anchor: n.anchor,
        frets: n.shape ? n.shape.frets : null,
      })),
      columns: bar.columns.map((c) => ({
        x: c.x,
        direction: c.direction,
        accent: c.accent,
        finger: c.finger ?? null,
        notes: c.notes.map((n) => [n.string, n.fret, n.y]),
      })),
    })),
  })),
};
// The picked layout writes one string per column, which is a different code
// path from a strum and the one a port is most likely to get wrong.
{
  // Resolved the way the interface resolves a player's choice — patternById
  // knows only the strums, and asking it for a picking pattern hands back
  // quarters, which is how this fixture was wrong the first time.
  const pickPattern = patternsFor(analysis.beatsPerBar).find((p) => p.id === 'pick-53231323');
  const picked = buildTab(analysis, { strum: pickPattern });
  out.engravePicked = engraveTab(picked).slice(0, 1).map((system) => ({
    contentWidth: system.contentWidth,
    columns: system.bars.flatMap((bar) =>
      bar.columns.map((c) => ({
        x: c.x,
        finger: c.finger ?? null,
        notes: c.notes.map((n) => [n.string, n.fret]),
      })),
    ),
  }));
}

// --- plain-text tablature ---------------------------------------------------
// What the share sheet hands over, and the one form of a tab that survives
// being pasted into a message. Column alignment is the whole value, so it is
// compared as exact strings.
out.tabText = {
  bar0: barTab(tabs.standard.bars[0], tabs.standard.strum),
  systems: tabSystems(tabs.standard.bars, tabs.standard.strum, 2)
    .slice(0, 2)
    .map((s) => ({ label: s.label, startBar: s.startBar, bars: s.bars, text: s.text })),
  song: songTabText(tabs.standard, 'Reference song').split('\n'),
};
{
  const pickPattern = patternsFor(analysis.beatsPerBar).find((p) => p.id === 'pick-alternating');
  const picked = buildTab(analysis, { strum: pickPattern });
  out.tabTextPicked = barTab(picked.bars[0], picked.strum);
}

// --- pitch colour -----------------------------------------------------------
// Hue walks the circle of fifths rather than the chromatic scale, so a song is
// the same colours in both builds. That is a claim worth checking rather than
// repeating in a comment.
out.pitchClassHue = Array.from({ length: 12 }, (_, pc) => pitchClassHue(pc));

// --- a song that changes twice a bar ----------------------------------------
// The demo progression holds each chord for a whole bar, so it never reaches
// the easy level's hold pass. This one changes every two beats, which is what
// that pass exists for, and without it here a port could get the pass wrong
// and every check above would still agree.
{
  const fast = [
    { root: 0, quality: 'maj', beats: 2 },
    { root: 9, quality: 'min', beats: 2 },
    { root: 5, quality: 'maj', beats: 2 },
    { root: 7, quality: 'maj', beats: 2 },
    { root: 0, quality: 'maj', beats: 2 },
    { root: 9, quality: 'min', beats: 2 },
    { root: 5, quality: 'maj', beats: 2 },
    { root: 7, quality: 'maj', beats: 2 },
    { root: 0, quality: 'maj', beats: 2 },
    { root: 9, quality: 'min', beats: 2 },
    { root: 5, quality: 'maj', beats: 2 },
    { root: 7, quality: 'maj', beats: 2 },
    { root: 0, quality: 'maj', beats: 2 },
    { root: 9, quality: 'min', beats: 2 },
    { root: 5, quality: 'maj', beats: 2 },
    { root: 7, quality: 'maj', beats: 4 },
  ];
  const signal2 = renderProgression(fast, { sampleRate: 44100, bpm: 132, seed: 99, noise: 0.003 });
  const a2 = analyzeAudio(signal2, 44100);
  const reduced = reduceSegments(a2.segments, a2.beatsPerBar);
  const tabs2 = {
    easy: buildTab({ ...a2, segments: reduced }),
    standard: buildTab(a2),
    faithful: buildTab(a2, { simplify: false }),
  };
  out.fastSong = {
    rate: 44100,
    signal: digest(signal2),
    tempo: a2.tempo,
    beatsPerBar: a2.beatsPerBar,
    key: a2.key.name,
    segments: a2.segments.map((s) => ({
      name: chordName(s.chord),
      startBeat: s.startBeat,
      endBeat: s.endBeat,
    })),
    reduced: reduced.map((s) => ({
      name: chordName(s.chord),
      startBeat: s.startBeat,
      endBeat: s.endBeat,
      start: s.start,
      end: s.end,
    })),
    levels: levelsWorthOffering(tabs2),
    easyBars: tabs2.easy.bars.map((b) => b.signature),
    standardBars: tabs2.standard.bars.map((b) => b.signature),
  };
}

// --- the music gate ---------------------------------------------------------
{
  const window = at11.slice(Math.floor(4 * CHROMA_SAMPLE_RATE), Math.floor(5.5 * CHROMA_SAMPLE_RATE));
  const c = computeChromagram(window, CHROMA_SAMPLE_RATE, { fftSize: 4096, hopSize: 1024 });
  let sum = 0;
  for (let i = 0; i < window.length; i++) sum += window[i] * window[i];
  const level = Math.sqrt(sum / window.length);
  const tre = Float32Array.from(averageChroma(c.treble, c.frames, c.energy));
  const bas = Float32Array.from(averageChroma(c.bass, c.frames, c.energy));
  const norm = (v) => {
    let s = 0;
    for (let i = 0; i < v.length; i++) s += v[i] * v[i];
    const n = Math.sqrt(s);
    if (n > 1e-9) for (let i = 0; i < v.length; i++) v[i] /= n;
  };
  norm(tre);
  norm(bas);
  const best = bestChordForChroma(tre, bas);
  const features = musicFeaturesFrom(c, level, best.score);
  out.gate = { level, ...features, musical: isMusical(features), bestState: best.state, bestScore: best.score };
}

const target = process.argv[2]
  ? new URL(process.argv[2], `file://${process.cwd()}/`)
  : new URL('../golden/golden.json', import.meta.url);
await writeFile(target, JSON.stringify(out, null, 1));
console.log(`wrote ${target.pathname}`);
