/// Bumped whenever a change to this pipeline would give a stored song a
/// different tab. A song saved under an older number is re-analysed from its
/// audio the next time it is opened, so an accuracy fix reaches songs a player
/// already has rather than only new ones.
///
/// History:
///   1  the pipeline as first shipped
///   2  graded N.C., free-time detection, parabolic tempo, three tab levels
///   3  consolidateSegments: a song's own vocabulary settles drifting bars
public let ANALYSIS_VERSION = 3

public struct AnalysisResult: Sendable, Codable {
  public var duration: Double
  public var tempo: Double
  public var beats: [Double]
  public var beatsPerBar: Int
  /// Index of the first downbeat within `beats`.
  public var barPhase: Int
  public var key: KeyEstimate
  public var tuning: Double
  public var segments: [ChordSegment]
  /// Detected chord for each beat interval, as a lattice state.
  public var beatStates: [Int]
  public var confidence: Double
  /// Normalised periodicity of the onsets; low means no steady pulse to find.
  public var rhythmicity: Double
  /// True when the piece plays freely and the beat grid is only approximate.
  public var freeTime: Bool
}

public struct AnalyzeOptions {
  public var onProgress: ((String, Double) -> Void)?
  /// Override the detected tempo, in BPM. Also disables octave correction.
  public var tempoHint: Double?
  public var beatsPerBar: Int?

  public init(
    onProgress: ((String, Double) -> Void)? = nil, tempoHint: Double? = nil, beatsPerBar: Int? = nil
  ) {
    self.onProgress = onProgress
    self.tempoHint = tempoHint
    self.beatsPerBar = beatsPerBar
  }
}

private struct Decoded {
  var segments: [ChordSegment]
  var path: [Int]
  var beatCount: Int
  var beatEnergy: [Float]
  var scores: [Float]
}

/// Below this the onsets share no common period worth calling a tempo.
private let FREE_TIME_RHYTHMICITY = 0.08

/// Full analysis of a mono recording: tempo and beats, then beat-synchronous
/// chord decoding, then key.
///
/// Chords are decoded on the beat grid rather than on raw frames so boundaries
/// land where a player would write them, and so the lattice search stays small
/// enough to run on a phone.
public func analyzeAudio(
  samples: [Float], sampleRate: Double, options: AnalyzeOptions = AnalyzeOptions()
) -> AnalysisResult {
  let report = options.onProgress ?? { _, _ in }
  let duration = Double(samples.count) / sampleRate

  report("resampling", 0.05)
  let mono22 = resample(samples, from: sampleRate, to: ONSET_SAMPLE_RATE)
  let mono11 = resample(mono22, from: ONSET_SAMPLE_RATE, to: CHROMA_SAMPLE_RATE)

  report("finding the beat", 0.25)
  let onset = onsetEnvelope(mono22, sampleRate: ONSET_SAMPLE_RATE)
  let tempoEstimate = estimateTempo(onset)
  var tempo = options.tempoHint ?? tempoEstimate.bpm
  var beats = beatGrid(onset: onset, tempo: tempo, duration: duration)
  // Autocorrelation strength over variance is scale-free: a strummed song lands
  // well above rubato fingerpicking, whose onsets share no common period.
  let rhythmicity = onsetRhythmicity(onset, strength: tempoEstimate.strength)

  report("listening for chords", 0.5)
  let chroma = computeChromagram(mono11, sampleRate: CHROMA_SAMPLE_RATE)
  let frameRate = CHROMA_SAMPLE_RATE / Double(CHROMA_HOP_SIZE)

  report("working out the changes", 0.75)
  var decoded = decodeOnGrid(chroma: chroma, frameRate: frameRate, beats: beats)
  let freeTime = options.tempoHint == nil && rhythmicity < FREE_TIME_RHYTHMICITY

  if !freeTime, options.tempoHint == nil, shouldHalveTempo(tempo: tempo, segments: decoded.segments) {
    tempo /= 2
    beats = beatGrid(onset: onset, tempo: tempo, duration: duration)
    decoded = decodeOnGrid(chroma: chroma, frameRate: frameRate, beats: beats)
  }

  if freeTime {
    // With no pulse to find, the tracked beats carry no information, and
    // snapping chord changes to them puts every boundary wrong by up to a
    // beat. Decode on a fixed half-second grid instead, with a stiffer change
    // cost because free playing holds its harmony for seconds at a time.
    var fineGrid: [Double] = []
    var t = 0.0
    while t < duration {
      fineGrid.append(t)
      t += 0.5
    }
    var fine = decodeOnGrid(chroma: chroma, frameRate: frameRate, beats: fineGrid, changePenalty: 3)
    // The bar model still runs on the beat grid, so segment edges snap to the
    // nearest beat only after the boundaries themselves are settled.
    for i in fine.segments.indices {
      let startBeat = nearestBeatIndex(beats, fine.segments[i].start)
      fine.segments[i].startBeat = startBeat
      fine.segments[i].endBeat = max(startBeat + 1, nearestBeatIndex(beats, fine.segments[i].end))
    }
    decoded.segments = fine.segments
  }

  // The autocorrelation names a tempo; the tracker then negotiates it against
  // the actual onsets. The grid it settled on is the truer reading, so the
  // reported BPM comes from the beats themselves. A forced tempo is echoed
  // back untouched — overriding an override reads as the app ignoring you.
  if options.tempoHint == nil, !freeTime, beats.count >= 9 {
    var intervals: [Double] = []
    for i in 1..<beats.count { intervals.append(beats[i] - beats[i - 1]) }
    let median = medianOf(intervals)
    if median > 1e-3 { tempo = 60 / median }
  }

  report("naming the key", 0.9)
  let changeBeats = decoded.segments.map { $0.startBeat ?? 0 }
  let beatsPerBar = options.beatsPerBar ?? (freeTime ? 4 : estimateBeatsPerBar(changeBeats: changeBeats))
  let barPhase =
    freeTime
    ? 0
    : estimateBarPhase(
      changeBeats: changeBeats, beatsPerBar: beatsPerBar, beatCount: decoded.beatCount,
      beatEnergy: decoded.beatEnergy)
  let key = estimateKey(chordToneHistogram(decoded.segments))

  let totalDuration = decoded.segments.reduce(0.0) { $0 + ($1.end - $1.start) }
  let confidence =
    totalDuration > 0
    ? decoded.segments.reduce(0.0) { $0 + $1.confidence * ($1.end - $1.start) } / totalDuration
    : 0

  report("done", 1)
  return AnalysisResult(
    duration: duration, tempo: tempo, beats: beats, beatsPerBar: beatsPerBar, barPhase: barPhase,
    key: key, tuning: chroma.tuning, segments: decoded.segments, beatStates: decoded.path,
    confidence: confidence, rhythmicity: rhythmicity, freeTime: freeTime)
}

private func nearestBeatIndex(_ beats: [Double], _ time: Double) -> Int {
  var best = 0
  var bestDist = Double.infinity
  for i in beats.indices {
    let d = abs(beats[i] - time)
    if d < bestDist {
      bestDist = d
      best = i
    }
  }
  return best
}

private func onsetRhythmicity(_ onset: OnsetEnvelope, strength: Double) -> Double {
  let values = onset.values
  let n = max(1, values.count)
  var mean = 0.0
  for v in values { mean += Double(v) }
  mean /= Double(n)
  var variance = 0.0
  for v in values {
    let d = Double(v) - mean
    variance += d * d
  }
  variance /= Double(n)
  return variance > 1e-12 ? max(0, strength) / variance : 0
}

private func beatGrid(onset: OnsetEnvelope, tempo: Double, duration: Double) -> [Double] {
  var beats = trackBeats(onset, bpm: tempo)
  if beats.count < 2 {
    let period = 60 / tempo
    beats = []
    var t = 0.0
    while t < duration {
      beats.append(t)
      t += period
    }
  }
  return padBeatGrid(beats, duration: duration)
}

private func decodeOnGrid(
  chroma: Chromagram, frameRate: Double, beats: [Double], changePenalty: Double = 2.2
) -> Decoded {
  let treble = aggregateByBeats(
    chroma: chroma.treble, frames: chroma.frames, frameRate: frameRate, beats: beats)
  let bass = aggregateByBeats(
    chroma: chroma.bass, frames: chroma.frames, frameRate: frameRate, beats: beats)
  let beatEnergy = aggregateEnergyByBeats(
    energy: chroma.energy, frames: chroma.frames, frameRate: frameRate, beats: beats)

  let scored = scoreChords(
    treble: treble.data, bass: bass.data, frames: treble.count, energy: beatEnergy,
    options: ScoreOptions(bassWeight: 0.3, ncFloor: 0.12))
  // One beat is the shortest chord worth writing down, so the change cost here
  // is far lower than a frame-level decode would use.
  let path = decodeChords(
    scored, options: DecodeOptions(beta: 22, changePenalty: changePenalty, relatedBonus: 0.4))
  let beatTimes = Array(beats.prefix(treble.count))
  var raw = pathToSegments(
    path: path, times: beatTimes, endTime: beats.last ?? 0, scores: scored.scores)
  // The decode ran on the beat grid, so segment indices are already beat
  // numbers; deriving them from timestamps would accumulate rounding drift.
  for i in raw.indices {
    raw[i].startBeat = raw[i].startIndex
    raw[i].endBeat = raw[i].endIndex
  }
  refineSegments(&raw, treble: treble.data, bass: bass.data, beatCount: treble.count)
  var merged = mergeAdjacent(raw)
  consolidateSegments(&merged, treble: treble.data, bass: bass.data, beatCount: treble.count)
  return Decoded(
    segments: bridgeShortGaps(mergeAdjacent(merged)), path: path, beatCount: treble.count,
    beatEnergy: beatEnergy, scores: scored.scores)
}

/// Decide whether the tempo came back at double time.
///
/// Autocorrelation cannot separate a beat from half a beat: the same strumming
/// pattern at 72 BPM and at 144 BPM produces an identical onset envelope. The
/// tie-break has to come from the harmony, where chords that never change faster
/// than every eighth bar mean the grid is counting twice as fast as the player.
/// The guards keep genuinely fast songs with slow harmony from being halved.
private func shouldHalveTempo(tempo: Double, segments: [ChordSegment]) -> Bool {
  if tempo < 125 || tempo / 2 < 55 { return false }
  let durations =
    segments
    .filter { !$0.chord.isNoChord }
    .map { ($0.endBeat ?? 0) - ($0.startBeat ?? 0) }
    .sorted()
  if durations.count < 4 { return false }
  let low = durations[Int(floor(Double(durations.count) * 0.2))]
  return low >= 8
}

/// Duration-weighted histogram of the pitch classes the detected chords sound.
public func chordToneHistogram(_ segments: [ChordSegment]) -> [Double] {
  var hist = [Double](repeating: 0, count: 12)
  for seg in segments {
    if seg.chord.isNoChord { continue }
    let dur = max(0, seg.end - seg.start)
    for (idx, iv) in seg.chord.quality.intervals.enumerated() {
      // The root carries the most weight for key-finding; colour tones the least.
      let w: Double = idx == 0 ? 1 : (idx == 1 ? 0.7 : 0.55)
      hist[(seg.chord.root + iv) % 12] += dur * w
    }
  }
  let total = hist.reduce(0, +)
  if total > 0 { for i in 0..<12 { hist[i] /= total } }
  return hist
}

/// Best chord for a short chroma window, for the live readout while recording.
///
/// No temporal smoothing here by design: the caller wants immediate feedback
/// that the microphone is hearing something musical.
public func bestChordForChroma(treble: [Float], bass: [Float]) -> (state: Int, score: Double) {
  let scored = scoreChords(treble: treble, bass: bass, frames: 1)
  var best = 0
  for s in 1..<TOTAL_STATES where scored.scores[s] > scored.scores[best] { best = s }
  return (best, Double(scored.scores[best]))
}
