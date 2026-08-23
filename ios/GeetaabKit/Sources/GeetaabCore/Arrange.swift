public struct CapoChoice: Sendable, Codable, Hashable {
  public var fret: Int
  /// Fraction of playing time spent on first-week open shapes, 0..1.
  public var openRatio: Double
  public var score: Double
  /// Key the player reads from, with the capo on.
  public var shapeKeyName: String
}

private func easeOf(_ shape: ChordShape?) -> Double {
  guard let shape else { return 0 }
  if shape.difficulty == 1 { return 1 }
  if shape.difficulty == 2 { return 0.55 }
  return 0.1
}

public struct CapoOptions {
  public var maxFret: Int
  /// Score the shapes that will actually be played, substitutions included.
  public var simplify: Bool

  public init(maxFret: Int = 7, simplify: Bool = true) {
    self.maxFret = maxFret
    self.simplify = simplify
  }
}

/// Choose a capo position.
///
/// A capo does not make a song easier by itself; it makes it easier when the
/// shapes it moves the player onto are open ones. So the search scores each fret
/// by how much of the song's *playing time* lands on first-week shapes, then
/// prefers the lowest fret among near-equal options.
///
/// The shapes it scores are the ones the tab will really print, substitutions
/// and all. Scoring literal shapes instead undervalues any key whose awkward
/// chord has an easy stand-in, which is how a song in Eb ends up recommending
/// the capo that leaves a Bm in it rather than the one that turns the whole song
/// into C, G, Am and Fmaj7.
public func chooseCapo(
  segments: [ChordSegment], key: KeyEstimate, options: CapoOptions = CapoOptions()
) -> CapoChoice {
  // Insertion order is kept so the summation order does not depend on hashing,
  // which is what lets a capo choice be reproduced exactly from a saved song.
  var order: [ChordSymbol] = []
  var index: [ChordSymbol: Int] = [:]
  var durations: [Double] = []
  var total = 0.0
  for seg in segments {
    if seg.chord.isNoChord { continue }
    let duration = max(0, seg.end - seg.start)
    if duration <= 0 { continue }
    if let i = index[seg.chord] {
      durations[i] += duration
    } else {
      index[seg.chord] = order.count
      order.append(seg.chord)
      durations.append(duration)
    }
    total += duration
  }
  if total == 0 {
    return CapoChoice(fret: 0, openRatio: 0, score: 0, shapeKeyName: key.name)
  }

  var best: CapoChoice?
  for fret in 0...options.maxFret {
    var ease = 0.0
    var open = 0.0
    for (i, chord) in order.enumerated() {
      let playable = toPlayableChord(
        chord, options: SimplifyOptions(capo: fret, key: key, simplify: options.simplify))
      let shape = playable?.shape
      ease += easeOf(shape) * durations[i]
      if shape?.difficulty == 1 { open += durations[i] }
    }
    let openRatio = open / total
    // Capos cost something real: retuning check, a brighter tone, and one more
    // thing to own. Only take one when it buys a clear gain.
    let penalty = fret == 0 ? 0 : 0.06 + Double(fret) * 0.012
    let score = ease / total - penalty
    if best == nil || score > best!.score + 1e-9 {
      let shapeTonic = ((key.tonic - fret) % 12 + 12) % 12
      best = CapoChoice(
        fret: fret, openRatio: openRatio, score: score,
        shapeKeyName:
          "\(noteName(shapeTonic, useFlats: keyUsesFlats(tonic: shapeTonic, mode: key.mode))) \(key.mode.rawValue)"
      )
    }
  }
  return best!
}

/// Substitutions that keep a chord recognisable while dropping its hard shape.
private func simplificationOrder(_ q: ChordQuality) -> [ChordQuality] {
  switch q {
  case .maj: return [.maj, .maj7, .dom7, .sus4]
  case .min: return [.min, .min7]
  case .dom7: return [.dom7, .maj, .maj7]
  case .min7: return [.min7, .min]
  case .maj7: return [.maj7, .maj]
  case .sus4: return [.sus4, .maj, .dom7]
  case .sus2: return [.sus2, .maj]
  }
}

public struct PlayableChord: Sendable, Codable, Hashable {
  /// What the recording actually contains.
  public var sounding: ChordSymbol
  /// What the player fingers, after the capo.
  public var shapeChord: ChordSymbol
  public var shape: ChordShape
  /// The detected chord, when the shape is a simplification of it.
  public var substitutedFrom: ChordSymbol?
  /// Name of the chord in the song, spelled for the song's key.
  public var label: String
  /// Name of the shape under the fingers, spelled for the key being read.
  public var shapeLabel: String
}

public struct SimplifyOptions {
  public var capo: Int
  public var key: KeyEstimate
  /// Allow substitutions that change the chord's colour. Off keeps it literal.
  public var simplify: Bool
  /// Hardest shape to accept before trying a substitution.
  public var maxDifficulty: Int

  public init(capo: Int, key: KeyEstimate, simplify: Bool = true, maxDifficulty: Int = 2) {
    self.capo = capo
    self.key = key
    self.simplify = simplify
    self.maxDifficulty = maxDifficulty
  }
}

/// Pick the shape a learner should actually play for a detected chord.
///
/// Substitutions are ordered by what the chord is doing in the key: a dominant
/// gets a seventh (B becomes B7), while everything else prefers a major seventh
/// (F becomes Fmaj7). Both are the moves a teacher makes to get a student past a
/// barre without the song sounding wrong.
public func toPlayableChord(_ chord: ChordSymbol, options: SimplifyOptions) -> PlayableChord? {
  if chord.isNoChord { return nil }
  let capo = options.capo
  let key = options.key
  let shapeChord = chord.transposed(by: -capo)
  let useFlats = key.useFlats
  // With a capo on, the player is reading in a different key from the one the
  // room hears, and that key decides whether the shape is a Bb or an A#.
  let shapeTonic = ((key.tonic - capo) % 12 + 12) % 12
  let shapeFlats = capo == 0 ? useFlats : keyUsesFlats(tonic: shapeTonic, mode: key.mode)

  let direct = easiestShape(shapeChord)
  if !options.simplify || (direct != nil && direct!.difficulty <= options.maxDifficulty) {
    if let direct {
      return PlayableChord(
        sounding: chord, shapeChord: shapeChord, shape: direct, substitutedFrom: nil,
        label: chord.name(useFlats: useFlats), shapeLabel: shapeChord.name(useFlats: shapeFlats))
    }
  }

  let isDominant = ((chord.root - key.tonic) % 12 + 12) % 12 == 7
  var order = simplificationOrder(chord.quality)
  if isDominant {
    // Stable partial sort: dom7 to the front, everything else in place.
    order = order.filter { $0 == .dom7 } + order.filter { $0 != .dom7 }
  }

  for quality in order {
    let candidate = ChordSymbol(root: shapeChord.root, quality: quality)
    if let shape = easiestShape(candidate), shape.difficulty <= options.maxDifficulty {
      let substituted = quality != chord.quality
      return PlayableChord(
        sounding: chord, shapeChord: candidate, shape: shape,
        substitutedFrom: substituted ? chord : nil,
        label: chord.name(useFlats: useFlats), shapeLabel: candidate.name(useFlats: shapeFlats))
    }
  }

  guard let fallback = direct ?? easiestShape(shapeChord) else { return nil }
  return PlayableChord(
    sounding: chord, shapeChord: shapeChord, shape: fallback, substitutedFrom: nil,
    label: chord.name(useFlats: useFlats), shapeLabel: shapeChord.name(useFlats: shapeFlats))
}

public enum StrumDirection: String, Sendable, Codable, Hashable {
  case down = "D"
  case up = "U"
}

public struct StrumStep: Sendable, Codable, Hashable {
  /// Position within the bar, in beats, starting at 0.
  public var beat: Double
  public var direction: StrumDirection
  public var accent: Bool
  /// Muted percussive hit rather than a ringing strum.
  public var mute: Bool
  /// Present on fingerpicking patterns: the one string this plucks and the
  /// finger that takes it. Strumming steps leave it off and sweep the chord.
  public var pluck: Pluck?

  public init(
    beat: Double, direction: StrumDirection, accent: Bool = false, mute: Bool = false,
    pluck: Pluck? = nil
  ) {
    self.beat = beat
    self.direction = direction
    self.accent = accent
    self.mute = mute
    self.pluck = pluck
  }
}

public enum StrumKind: String, Sendable, Codable, Hashable {
  case strum, pick
}

/// A right-hand pattern. Its name and description live in the app's dictionary
/// keyed by `id`, so the patterns themselves stay free of any one language.
public struct StrumPattern: Sendable, Codable, Hashable {
  public var id: String
  public var beatsPerBar: Int
  public var difficulty: Int
  public var kind: StrumKind
  public var steps: [StrumStep]
}

public let STRUM_PATTERNS: [StrumPattern] = [
  StrumPattern(
    id: "held", beatsPerBar: 4, difficulty: 1, kind: .strum,
    steps: [StrumStep(beat: 0, direction: .down, accent: true)]),
  StrumPattern(
    id: "quarters", beatsPerBar: 4, difficulty: 1, kind: .strum,
    steps: [
      StrumStep(beat: 0, direction: .down, accent: true),
      StrumStep(beat: 1, direction: .down),
      StrumStep(beat: 2, direction: .down),
      StrumStep(beat: 3, direction: .down),
    ]),
  StrumPattern(
    id: "eighths", beatsPerBar: 4, difficulty: 2, kind: .strum,
    steps: [
      StrumStep(beat: 0, direction: .down, accent: true),
      StrumStep(beat: 0.5, direction: .up),
      StrumStep(beat: 1, direction: .down),
      StrumStep(beat: 1.5, direction: .up),
      StrumStep(beat: 2, direction: .down, accent: true),
      StrumStep(beat: 2.5, direction: .up),
      StrumStep(beat: 3, direction: .down),
      StrumStep(beat: 3.5, direction: .up),
    ]),
  StrumPattern(
    id: "classic", beatsPerBar: 4, difficulty: 2, kind: .strum,
    steps: [
      StrumStep(beat: 0, direction: .down, accent: true),
      StrumStep(beat: 1, direction: .down),
      StrumStep(beat: 1.5, direction: .up),
      StrumStep(beat: 2.5, direction: .up),
      StrumStep(beat: 3, direction: .down),
      StrumStep(beat: 3.5, direction: .up),
    ]),
  StrumPattern(
    id: "ballad", beatsPerBar: 4, difficulty: 1, kind: .strum,
    steps: [
      StrumStep(beat: 0, direction: .down, accent: true),
      StrumStep(beat: 2, direction: .down),
      StrumStep(beat: 3, direction: .up),
    ]),
  StrumPattern(
    id: "waltz", beatsPerBar: 3, difficulty: 1, kind: .strum,
    steps: [
      StrumStep(beat: 0, direction: .down, accent: true),
      StrumStep(beat: 1, direction: .down),
      StrumStep(beat: 2, direction: .down),
    ]),
]

public func patternById(_ id: String) -> StrumPattern {
  ALL_PATTERNS.first { $0.id == id } ?? STRUM_PATTERNS[1]
}

/// Pick a strumming pattern for a tempo.
///
/// Fast songs get fewer strums, not more: at 150 BPM a beginner's hand cannot
/// keep up with eighths, and even quarter notes drive the song fine.
public func suggestStrum(tempo: Double, beatsPerBar: Int) -> StrumPattern {
  if beatsPerBar == 3 { return patternById("waltz") }
  if tempo < 72 { return patternById("ballad") }
  if tempo < 140 { return patternById("classic") }
  return patternById("quarters")
}

/// Fingerpicking patterns.
///
/// Written with the thumb's string left unresolved: `bass` means "whatever the
/// chord is rooted on", so the same pattern starts on the fifth string for C,
/// the sixth for G and the fourth for D without being rewritten. That is the
/// part a printed string-number pattern gets wrong for every chord but the one
/// it was written for.
public let PICK_PATTERNS: [StrumPattern] = [
  StrumPattern(
    id: "pick-simple", beatsPerBar: 4, difficulty: 1, kind: .pick,
    steps: [
      StrumStep(beat: 0, direction: .down, accent: true, pluck: Pluck(string: .bass, finger: .p)),
      StrumStep(beat: 1, direction: .down, pluck: Pluck(string: .fixed(3), finger: .i)),
      StrumStep(beat: 2, direction: .down, pluck: Pluck(string: .fixed(2), finger: .m)),
      StrumStep(beat: 3, direction: .down, pluck: Pluck(string: .fixed(1), finger: .a)),
    ]),
  StrumPattern(
    id: "pick-53231323", beatsPerBar: 4, difficulty: 2, kind: .pick,
    steps: [
      StrumStep(beat: 0, direction: .down, accent: true, pluck: Pluck(string: .bass, finger: .p)),
      StrumStep(beat: 0.5, direction: .down, pluck: Pluck(string: .fixed(3), finger: .i)),
      StrumStep(beat: 1, direction: .down, pluck: Pluck(string: .fixed(2), finger: .m)),
      StrumStep(beat: 1.5, direction: .down, pluck: Pluck(string: .fixed(3), finger: .i)),
      StrumStep(beat: 2, direction: .down, pluck: Pluck(string: .fixed(1), finger: .a)),
      StrumStep(beat: 2.5, direction: .down, pluck: Pluck(string: .fixed(3), finger: .i)),
      StrumStep(beat: 3, direction: .down, pluck: Pluck(string: .fixed(2), finger: .m)),
      StrumStep(beat: 3.5, direction: .down, pluck: Pluck(string: .fixed(3), finger: .i)),
    ]),
  StrumPattern(
    id: "pick-alternating", beatsPerBar: 4, difficulty: 3, kind: .pick,
    steps: [
      StrumStep(beat: 0, direction: .down, accent: true, pluck: Pluck(string: .bass, finger: .p)),
      StrumStep(beat: 0.5, direction: .down, pluck: Pluck(string: .fixed(2), finger: .m)),
      StrumStep(beat: 1, direction: .down, pluck: Pluck(string: .altBass, finger: .p)),
      StrumStep(beat: 1.5, direction: .down, pluck: Pluck(string: .fixed(1), finger: .a)),
      StrumStep(beat: 2, direction: .down, pluck: Pluck(string: .bass, finger: .p)),
      StrumStep(beat: 2.5, direction: .down, pluck: Pluck(string: .fixed(3), finger: .i)),
      StrumStep(beat: 3, direction: .down, pluck: Pluck(string: .altBass, finger: .p)),
      StrumStep(beat: 3.5, direction: .down, pluck: Pluck(string: .fixed(2), finger: .m)),
    ]),
]

let ALL_PATTERNS: [StrumPattern] = STRUM_PATTERNS + PICK_PATTERNS

/// Patterns that fit the given metre: strums first, then picking.
public func patternsFor(beatsPerBar: Int) -> [StrumPattern] {
  ALL_PATTERNS
    .filter { $0.beatsPerBar == beatsPerBar }
    .enumerated()
    .sorted {
      // Strums first, then picking; within each, easiest first, and the table's
      // own order settles anything still tied.
      let ka = $0.element.kind == .pick ? 1 : 0
      let kb = $1.element.kind == .pick ? 1 : 0
      if ka != kb { return ka < kb }
      if $0.element.difficulty != $1.element.difficulty {
        return $0.element.difficulty < $1.element.difficulty
      }
      return $0.offset < $1.offset
    }
    .map(\.element)
}
