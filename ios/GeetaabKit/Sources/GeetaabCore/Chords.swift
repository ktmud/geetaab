public let CHORD_STATES = 12 * 7
public let NC_STATE = CHORD_STATES
public let TOTAL_STATES = CHORD_STATES + 1

public func stateToChord(_ state: Int) -> ChordSymbol {
  if state >= CHORD_STATES { return .noChord }
  return ChordSymbol(root: state / QUALITIES.count, quality: QUALITIES[state % QUALITIES.count])
}

public func chordToState(_ chord: ChordSymbol) -> Int {
  if chord.root < 0 { return NC_STATE }
  return chord.root * QUALITIES.count + chord.quality.stateIndex
}

/// Pitch class a harmonic lands on, relative to its fundamental.
private func harmonicOffset(_ h: Int) -> Int {
  Int((12 * log2(Double(h))).rounded()) % 12
}

/// Chord templates that include each tone's first few harmonics.
///
/// A plain triad template misreads real instruments: the root's fifth harmonic
/// puts major-third energy under every minor chord. Modelling that energy is
/// what keeps major and minor apart instead of letting it look like evidence.
private func buildTemplates() -> [Float] {
  var templates = [Float](repeating: 0, count: CHORD_STATES * 12)
  let harmonics = [1, 2, 3, 4, 5, 6]
  let decay = 0.6
  for root in 0..<12 {
    for q in 0..<QUALITIES.count {
      let state = root * QUALITIES.count + q
      let base = state * 12
      let intervals = QUALITIES[q].intervals
      for (idx, iv) in intervals.enumerated() {
        // The root anchors the chord; upper extensions are voiced more quietly.
        let voiceWeight: Double =
          idx == 0 ? 1 : (idx == intervals.count - 1 && intervals.count > 3 ? 0.7 : 0.85)
        for (hi, h) in harmonics.enumerated() {
          let pc = (root + iv + harmonicOffset(h)) % 12
          templates[base + pc] += Float(voiceWeight * pow(decay, Double(hi)))
        }
      }
      centerAndNormalize12(&templates, base)
    }
  }
  return templates
}

private func buildBassTemplates() -> [Float] {
  var templates = [Float](repeating: 0, count: CHORD_STATES * 12)
  for root in 0..<12 {
    for q in 0..<QUALITIES.count {
      let state = root * QUALITIES.count + q
      let base = state * 12
      let intervals = QUALITIES[q].intervals
      templates[base + root] += 1
      templates[base + (root + 7) % 12] += 0.35
      templates[base + (root + intervals[1]) % 12] += 0.2
      centerAndNormalize12(&templates, base)
    }
  }
  return templates
}

/// Centre a template on zero, then scale it to unit length.
///
/// Chroma from a real recording sits on a broad noise floor. Against uncentred
/// templates that floor is free score for whichever chord has the most notes, so
/// every triad drifts toward being read as a seventh. A zero-mean template
/// ignores any constant offset and scores only the shape.
private func centerAndNormalize12(_ buf: inout [Float], _ base: Int) {
  var mean = 0.0
  for i in 0..<12 { mean += Double(buf[base + i]) }
  mean /= 12
  for i in 0..<12 { buf[base + i] = Float(Double(buf[base + i]) - mean) }
  normalize12(&buf, base)
}

func normalize12(_ buf: inout [Float], _ base: Int) {
  var s = 0.0
  for i in 0..<12 { s += Double(buf[base + i]) * Double(buf[base + i]) }
  let n = s.squareRoot()
  if n < 1e-9 { return }
  for i in 0..<12 { buf[base + i] = Float(Double(buf[base + i]) / n) }
}

public let CHORD_TEMPLATES: [Float] = buildTemplates()
public let BASS_TEMPLATES: [Float] = buildBassTemplates()

/// Nudges the decoder toward chords a beginner can actually use.
///
/// Sevenths and suspensions contain the triad they decorate, so they never score
/// worse and a whole song comes back spelled in extensions. The gap is
/// calibrated between the two margins measured on synthesized chords: a plain
/// major beats its dominant seventh by only about 0.007, while a real dominant
/// seventh beats the plain major by about 0.043.
private let QUALITY_PRIOR: [Float] = QUALITIES.map { q in
  switch q {
  case .maj, .min: return 0.018
  case .dom7, .min7: return 0
  case .maj7: return -0.012
  case .sus4, .sus2: return -0.02
  }
}

public struct ScoreOptions {
  /// Weight of the bass chroma in the combined score.
  public var bassWeight: Double
  /// Frames quieter than this fraction of the median are treated as silence.
  public var silenceRatio: Double
  /// Emission for "no chord" on frames that are audible but prove nothing: a
  /// chord has to beat this to be written down. Without it, fade-ins, orchestral
  /// textures and lone melody notes all get billed as whichever template edges
  /// above zero. Scaled down on recordings whose genuine chords score low
  /// across the board, so a muddy capture is not blanked into silence.
  public var ncFloor: Double

  public init(bassWeight: Double = 0.3, silenceRatio: Double = 0.06, ncFloor: Double = 0) {
    self.bassWeight = bassWeight
    self.silenceRatio = silenceRatio
    self.ncFloor = ncFloor
  }
}

public struct ScoredFrames {
  public let scores: [Float]  // frames x TOTAL_STATES
  public let frames: Int
}

/// Cosine similarity of every frame against every chord template.
public func scoreChords(
  treble: [Float], bass: [Float], frames: Int, energy: [Float]? = nil,
  options: ScoreOptions = ScoreOptions()
) -> ScoredFrames {
  let bassWeight = options.bassWeight
  var scores = [Float](repeating: 0, count: frames * TOTAL_STATES)

  var energyThreshold = -1.0
  if let energy, !energy.isEmpty {
    let sorted = energy.sorted()
    let median = Double(sorted[sorted.count >> 1])
    energyThreshold = median * options.silenceRatio
  }

  treble.withUnsafeBufferPointer { tp in
    bass.withUnsafeBufferPointer { bp in
      CHORD_TEMPLATES.withUnsafeBufferPointer { ct in
        BASS_TEMPLATES.withUnsafeBufferPointer { bt in
          QUALITY_PRIOR.withUnsafeBufferPointer { qp in
            scores.withUnsafeMutableBufferPointer { out in
              for f in 0..<frames {
                let tBase = f * 12
                let outBase = f * TOTAL_STATES
                for s in 0..<CHORD_STATES {
                  let tmplBase = s * 12
                  var dotT = 0.0
                  var dotB = 0.0
                  for i in 0..<12 {
                    dotT += Double(tp[tBase + i]) * Double(ct[tmplBase + i])
                    dotB += Double(bp[tBase + i]) * Double(bt[tmplBase + i])
                  }
                  out[outBase + s] = Float(
                    (1 - bassWeight) * dotT + bassWeight * dotB + Double(qp[s % QUALITIES.count]))
                }
                let silent = energy != nil ? Double(energy![f]) < energyThreshold : false
                out[outBase + NC_STATE] = silent ? 1 : 0
              }
            }
          }
        }
      }
    }
  }

  let ncFloor = options.ncFloor
  if ncFloor > 0 && frames > 0 {
    var bestPerFrame = [Float](repeating: 0, count: frames)
    for f in 0..<frames {
      var best: Float = 0
      let base = f * TOTAL_STATES
      for s in 0..<CHORD_STATES where scores[base + s] > best { best = scores[base + s] }
      bestPerFrame[f] = best
    }
    let sorted = bestPerFrame.sorted()
    let median = Double(sorted[sorted.count >> 1])
    // Scaled down for recordings whose real chords score low across the board,
    // but never below what broadband noise reaches — a recording that is ALL
    // noise must not lower the bar until its own noise clears it.
    let floorValue = Float(min(ncFloor, max(0.075, 0.6 * median)))
    for f in 0..<frames {
      let idx = f * TOTAL_STATES + NC_STATE
      if scores[idx] < 1 { scores[idx] = floorValue }
    }
  }
  return ScoredFrames(scores: scores, frames: frames)
}

public struct DecodeOptions {
  /// Emission sharpness: scales similarity differences into log-probabilities.
  public var beta: Double
  /// Log-odds cost of changing chord between consecutive frames.
  public var changePenalty: Double
  /// Discount on the change cost for chords sharing pitch classes.
  public var relatedBonus: Double

  public init(beta: Double = 22, changePenalty: Double = 5, relatedBonus: Double = 0.5) {
    self.beta = beta
    self.changePenalty = changePenalty
    self.relatedBonus = relatedBonus
  }
}

private let sharedPitchClasses: [UInt8] = {
  var table = [UInt8](repeating: 0, count: TOTAL_STATES * TOTAL_STATES)
  var pcs: [[Int]] = []
  pcs.reserveCapacity(CHORD_STATES)
  for s in 0..<CHORD_STATES {
    let chord = stateToChord(s)
    pcs.append(chord.quality.intervals.map { (chord.root + $0) % 12 })
  }
  for a in 0..<CHORD_STATES {
    for b in 0..<CHORD_STATES {
      var n: UInt8 = 0
      for p in pcs[a] where pcs[b].contains(p) { n += 1 }
      table[a * TOTAL_STATES + b] = n
    }
  }
  return table
}()

/// Viterbi decode over the chord lattice.
///
/// Frame-wise argmax flickers between neighbouring chords many times a second;
/// the transition cost turns that into the handful of sustained changes a player
/// would actually write down.
public func decodeChords(_ scored: ScoredFrames, options: DecodeOptions = DecodeOptions()) -> [Int] {
  let beta = options.beta
  let changePenalty = options.changePenalty
  let relatedBonus = options.relatedBonus
  let frames = scored.frames
  if frames == 0 { return [] }

  var prev = [Double](repeating: 0, count: TOTAL_STATES)
  var next = [Double](repeating: 0, count: TOTAL_STATES)
  var back = [Int16](repeating: 0, count: frames * TOTAL_STATES)

  scored.scores.withUnsafeBufferPointer { sc in
    sharedPitchClasses.withUnsafeBufferPointer { shared in
      prev.withUnsafeMutableBufferPointer { pv in
        next.withUnsafeMutableBufferPointer { nx in
          back.withUnsafeMutableBufferPointer { bk in
            for s in 0..<TOTAL_STATES { pv[s] = beta * Double(sc[s]) }

            for f in 1..<frames {
              let inBase = f * TOTAL_STATES
              // The best predecessor for a *changed* chord is the same for every
              // target, so find it once instead of scanning all states per target.
              var bestPrev = -Double.infinity
              var bestPrevIdx = 0
              for s in 0..<TOTAL_STATES where pv[s] > bestPrev {
                bestPrev = pv[s]
                bestPrevIdx = s
              }
              for s in 0..<TOTAL_STATES {
                var bestScore = pv[s]  // stay
                var bestFrom = s
                let changeBase = bestPrev - changePenalty
                if changeBase > bestScore {
                  bestScore = changeBase
                  bestFrom = bestPrevIdx
                }
                // Related chords get a discount, which can beat the generic best path.
                if relatedBonus > 0 && s < CHORD_STATES {
                  let row = s * TOTAL_STATES
                  for p in 0..<CHORD_STATES {
                    if p == s { continue }
                    let bonus = relatedBonus * Double(shared[row + p]) / 3
                    let v = pv[p] - changePenalty + bonus
                    if v > bestScore {
                      bestScore = v
                      bestFrom = p
                    }
                  }
                }
                nx[s] = bestScore + beta * Double(sc[inBase + s])
                bk[inBase + s] = Int16(bestFrom)
              }
              for s in 0..<TOTAL_STATES { pv[s] = nx[s] }
            }
          }
        }
      }
    }
  }

  var best = 0
  for s in 1..<TOTAL_STATES where prev[s] > prev[best] { best = s }
  var path = [Int](repeating: 0, count: frames)
  path[frames - 1] = best
  var f = frames - 1
  while f > 0 {
    path[f - 1] = Int(back[f * TOTAL_STATES + path[f]])
    f -= 1
  }
  return path
}

public struct ChordSegment: Sendable, Codable, Hashable {
  public var chord: ChordSymbol
  public var start: Double  // seconds
  public var end: Double  // seconds
  /// Index range in the decoded sequence; beat indices for a beat-level decode.
  public var startIndex: Int
  public var endIndex: Int
  public var startBeat: Int?
  public var endBeat: Int?
  public var confidence: Double

  public init(
    chord: ChordSymbol, start: Double, end: Double, startIndex: Int, endIndex: Int,
    startBeat: Int? = nil, endBeat: Int? = nil, confidence: Double = 0
  ) {
    self.chord = chord
    self.start = start
    self.end = end
    self.startIndex = startIndex
    self.endIndex = endIndex
    self.startBeat = startBeat
    self.endBeat = endBeat
    self.confidence = confidence
  }
}

/// Collapse a per-frame state path into timed segments.
public func pathToSegments(
  path: [Int], times: [Double], endTime: Double, scores: [Float]? = nil
) -> [ChordSegment] {
  var segments: [ChordSegment] = []
  if path.isEmpty { return segments }
  var start = 0
  for i in 1...path.count {
    if i == path.count || path[i] != path[start] {
      let state = path[start]
      var confidence = 0.0
      if let scores {
        var sum = 0.0
        for f in start..<i { sum += Double(scores[f * TOTAL_STATES + state]) }
        confidence = sum / Double(i - start)
      }
      segments.append(
        ChordSegment(
          chord: stateToChord(state),
          start: times[start],
          end: i == path.count ? endTime : times[i],
          startIndex: start,
          endIndex: i,
          confidence: confidence))
      start = i
    }
  }
  return segments
}

public struct BeatAggregate {
  public let data: [Float]
  public let count: Int
}

/// Median-aggregate chroma frames inside each beat.
///
/// Beat-synchronous features are the standard way to stop chord boundaries from
/// drifting off the grid, and they make the decode an order of magnitude cheaper.
public func aggregateByBeats(
  chroma: [Float], frames: Int, frameRate: Double, beats: [Double]
) -> BeatAggregate {
  let count = max(0, beats.count - 1)
  var data = [Float](repeating: 0, count: count * 12)
  var bucket: [Float] = []
  bucket.reserveCapacity(64)
  for b in 0..<count {
    let f0 = max(0, Int((beats[b] * frameRate).rounded()))
    let f1 = min(frames, max(f0 + 1, Int((beats[b + 1] * frameRate).rounded())))
    for pc in 0..<12 {
      bucket.removeAll(keepingCapacity: true)
      if f0 < f1 {
        for f in f0..<f1 { bucket.append(chroma[f * 12 + pc]) }
      }
      bucket.sort()
      let mid = bucket.count >> 1
      data[b * 12 + pc] =
        bucket.isEmpty
        ? 0
        : (bucket.count % 2 == 1
          ? bucket[mid] : Float((Double(bucket[mid - 1]) + Double(bucket[mid])) / 2))
    }
    normalize12(&data, b * 12)
  }
  return BeatAggregate(data: data, count: count)
}

public func aggregateEnergyByBeats(
  energy: [Float], frames: Int, frameRate: Double, beats: [Double]
) -> [Float] {
  let count = max(0, beats.count - 1)
  var out = [Float](repeating: 0, count: count)
  for b in 0..<count {
    let f0 = max(0, Int((beats[b] * frameRate).rounded()))
    let f1 = min(frames, max(f0 + 1, Int((beats[b + 1] * frameRate).rounded())))
    var sum = 0.0
    var n = 0
    if f0 < f1 {
      for f in f0..<f1 {
        sum += Double(energy[f])
        n += 1
      }
    }
    out[b] = n > 0 ? Float(sum / Double(n)) : 0
  }
  return out
}

private func medianChromaRange(_ data: [Float], _ lo: Int, _ hi: Int) -> [Float] {
  var out = [Float](repeating: 0, count: 12)
  var bucket: [Float] = []
  for pc in 0..<12 {
    bucket.removeAll(keepingCapacity: true)
    if lo < hi {
      for b in lo..<hi { bucket.append(data[b * 12 + pc]) }
    }
    bucket.sort()
    let mid = bucket.count >> 1
    out[pc] =
      bucket.isEmpty
      ? 0
      : (bucket.count % 2 == 1
        ? bucket[mid] : Float((Double(bucket[mid - 1]) + Double(bucket[mid])) / 2))
  }
  normalize12(&out, 0)
  return out
}

/// The interior beats of a segment, which is what a re-check should judge it on.
private func interiorRange(_ seg: ChordSegment, beatCount: Int, minimumSpan: Int) -> (Int, Int)? {
  let b0 = seg.startBeat ?? 0
  let b1 = min(beatCount, seg.endBeat ?? (b0 + 1))
  let span = b1 - b0
  if span < minimumSpan { return nil }
  var lo = b0
  var hi = span >= 3 ? b1 - 1 : b1
  if span >= 4 { lo = b0 + 1 }
  if hi <= lo {
    lo = b0
    hi = b1
  }
  return (lo, hi)
}

public struct RefineOptions {
  /// Score advantage kept by the chord the decoder already chose.
  public var incumbentBonus: Double
  public var bassWeight: Double

  public init(incumbentBonus: Double = 0.025, bassWeight: Double = 0.3) {
    self.incumbentBonus = incumbentBonus
    self.bassWeight = bassWeight
  }
}

/// Re-decide each segment's chord from its interior beats only.
///
/// The chroma window is long enough that the last beat of a chord already
/// contains the next one, which is what makes plain triads come back spelled as
/// sevenths. Judging a segment from its middle removes that bleed.
public func refineSegments(
  _ segments: inout [ChordSegment], treble: [Float], bass: [Float], beatCount: Int,
  options: RefineOptions = RefineOptions()
) {
  let incumbentBonus = options.incumbentBonus
  for i in segments.indices {
    // A no-chord verdict came from the energy and evidence gates, which this
    // re-check knows nothing about; re-labelling silence would undo them.
    if segments[i].chord.root < 0 { continue }
    guard let (lo, hi) = interiorRange(segments[i], beatCount: beatCount, minimumSpan: 2) else { continue }
    let t = medianChromaRange(treble, lo, hi)
    let b = medianChromaRange(bass, lo, hi)
    let scored = scoreChords(
      treble: t, bass: b, frames: 1, energy: nil, options: ScoreOptions(bassWeight: options.bassWeight))
    let incumbent = chordToState(segments[i].chord)
    var best = incumbent
    var bestScore = Double(scored.scores[incumbent]) + incumbentBonus
    for s in 0..<CHORD_STATES where Double(scored.scores[s]) > bestScore {
      bestScore = Double(scored.scores[s])
      best = s
    }
    if best != incumbent {
      segments[i].chord = stateToChord(best)
      segments[i].confidence = bestScore
    }
  }
}

/// Chord qualities that read as one working family when consolidating.
private func qualityPool(_ q: ChordQuality) -> String {
  switch q {
  case .maj, .dom7, .maj7: return "maj"
  case .min, .min7: return "min"
  case .sus4, .sus2: return "sus"
  }
}

/// Qualities a doubtful segment may be folded into: the simple, common ones.
private let CONSOLIDATE_TARGETS: [ChordQuality] = [.maj, .min, .min7]

public struct ConsolidateOptions {
  /// Deficit a same-family (colour-only) relabel may overcome.
  public var marginSame: Double
  /// Deficit a cross-family relabel may overcome.
  public var marginCross: Double
  /// How much more established the target must be than the incumbent.
  public var supportRatio: Double
  public var bassWeight: Double

  public init(
    marginSame: Double = 0.05, marginCross: Double = 0.075, supportRatio: Double = 2,
    bassWeight: Double = 0.3
  ) {
    self.marginSame = marginSame
    self.marginCross = marginCross
    self.supportRatio = supportRatio
    self.bassWeight = bassWeight
  }
}

/// Fold rarely-seen qualities into the chord the song has already established
/// at the same root.
///
/// A published tab writes the functional chord; the recording underneath it
/// drifts. In a fingerpicked verse the accompanist plays root and fifth while
/// the melody supplies a ninth or a fourth, and the honest local reading of
/// that bar is Esus2 or C#7 even though every other verse names it Em or C#m7.
/// A human transcriber resolves this with the song's own vocabulary — "that
/// bar is the same Em as always" — which is exactly the evidence used here:
/// the same root elsewhere in the song, carrying several times the duration,
/// and a template score within a small margin on this segment's interior.
///
/// Two deliberate asymmetries keep this from doing harm. Only simple qualities
/// (maj, min, min7) can be targets, so a systematic misreading can never pile
/// onto a decorated colour; and a plain maj/min/min7 segment never flips across
/// the major/minor line, because a key-change chorus makes locally-right chords
/// globally rare — the one situation where song-level statistics lie.
public func consolidateSegments(
  _ segments: inout [ChordSegment], treble: [Float], bass: [Float], beatCount: Int,
  options: ConsolidateOptions = ConsolidateOptions()
) {
  // Durations are frozen at their pre-consolidation values: each decision is
  // made against what the first pass heard, not against earlier relabels.
  var stateDur = [Double](repeating: 0, count: CHORD_STATES)
  var poolDur: [String: Double] = [:]
  for seg in segments {
    if seg.chord.root < 0 { continue }
    let dur = seg.end - seg.start
    stateDur[chordToState(seg.chord)] += dur
    let key = "\(seg.chord.root):\(qualityPool(seg.chord.quality))"
    poolDur[key, default: 0] += dur
  }

  for i in segments.indices {
    if segments[i].chord.root < 0 { continue }
    guard let (lo, hi) = interiorRange(segments[i], beatCount: beatCount, minimumSpan: 1) else { continue }
    let t = medianChromaRange(treble, lo, hi)
    let b = medianChromaRange(bass, lo, hi)
    let scored = scoreChords(
      treble: t, bass: b, frames: 1, energy: nil, options: ScoreOptions(bassWeight: options.bassWeight))

    let root = segments[i].chord.root
    let quality = segments[i].chord.quality
    let incState = chordToState(segments[i].chord)
    let incScore = Double(scored.scores[incState])
    let ownPool = qualityPool(quality)
    let ownPoolDur = poolDur["\(root):\(ownPool)"] ?? 0
    let plain = quality == .maj || quality == .min || quality == .min7
    let incFamily = (quality == .min || quality == .min7) ? "min" : "maj"

    var best: (state: Int, score: Double)?
    for target in CONSOLIDATE_TARGETS {
      if target == quality { continue }
      let targetFamily = target == .maj ? "maj" : "min"
      if plain && targetFamily != incFamily { continue }
      let state = root * QUALITIES.count + target.stateIndex
      let targetDur = stateDur[state]
      if targetDur <= 0 { continue }
      let targetPool = qualityPool(target)
      if targetPool == ownPool {
        if targetDur < options.supportRatio * stateDur[incState] { continue }
      } else {
        let targetPoolDur = poolDur["\(root):\(targetPool)"] ?? 0
        if targetPoolDur < options.supportRatio * ownPoolDur { continue }
      }
      let margin = targetFamily == incFamily ? options.marginSame : options.marginCross
      let targetScore = Double(scored.scores[state])
      if incScore - targetScore > margin { continue }
      if best == nil || targetScore > best!.score { best = (state, targetScore) }
    }
    if let best {
      segments[i].chord = stateToChord(best.state)
      segments[i].confidence = best.score
    }
  }
}

/// Absorb sub-second no-chord gaps whose neighbours agree on the chord.
///
/// A slow strum decays to the energy floor before the next one lands, so an
/// honest frame-level decode writes C, silence, C. The player never stopped
/// playing C, and the tab should not say they did.
public func bridgeShortGaps(_ segments: [ChordSegment], maxSeconds: Double = 1) -> [ChordSegment] {
  var out: [ChordSegment] = []
  var i = 0
  while i < segments.count {
    let seg = segments[i]
    let next = i + 1 < segments.count ? segments[i + 1] : nil
    if let previousIndex = out.indices.last, let next,
      seg.chord.root < 0,
      seg.end - seg.start <= maxSeconds,
      out[previousIndex].chord.root == next.chord.root,
      out[previousIndex].chord.quality == next.chord.quality
    {
      out[previousIndex].end = next.end
      out[previousIndex].endIndex = next.endIndex
      if let endBeat = next.endBeat { out[previousIndex].endBeat = endBeat }
      i += 2  // the neighbour is folded in along with the gap
      continue
    }
    out.append(seg)
    i += 1
  }
  return out
}

/// Merge neighbouring segments that ended up on the same chord after refining.
public func mergeAdjacent(_ segments: [ChordSegment]) -> [ChordSegment] {
  var out: [ChordSegment] = []
  for seg in segments {
    if let last = out.indices.last, out[last].chord.root == seg.chord.root,
      out[last].chord.quality == seg.chord.quality
    {
      out[last].end = seg.end
      out[last].endBeat = seg.endBeat
      out[last].confidence = (out[last].confidence + seg.confidence) / 2
    } else {
      out.append(seg)
    }
  }
  return out
}
