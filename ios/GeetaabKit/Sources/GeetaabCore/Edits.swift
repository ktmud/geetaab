/// What a player changed about a song, kept apart from what was heard.
///
/// The analysis is a measurement; these are corrections and additions to it.
/// Merging the two at save time would be simpler and would be wrong: the
/// pipeline is versioned precisely so that an accuracy fix can re-analyse songs
/// a player already has, and a re-analysis that overwrote their corrections
/// would make every improvement a punishment for having used the app.
///
/// So edits are an overlay, and — this is the part that matters — they are
/// anchored in **seconds**, never in beats or bar numbers. A better tempo
/// estimate renumbers every beat in the song; it cannot move the moment at
/// four minutes twelve where the player said the chord is really a D.
public struct SongEdits: Sendable, Codable, Hashable {
  public var chords: [ChordEdit]
  public var lyrics: [LyricLine]
  public var sections: [SectionMark]
  /// A tempo the player counted themselves, when the tracker got it wrong.
  public var tempo: Double?
  public var beatsPerBar: Int?
  public var title: String?
  /// Bumped on every change, so a view can tell whether what it is showing is
  /// still current without comparing the whole structure.
  public var revision: Int

  public init(
    chords: [ChordEdit] = [], lyrics: [LyricLine] = [], sections: [SectionMark] = [],
    tempo: Double? = nil, beatsPerBar: Int? = nil, title: String? = nil, revision: Int = 0
  ) {
    self.chords = chords
    self.lyrics = lyrics
    self.sections = sections
    self.tempo = tempo
    self.beatsPerBar = beatsPerBar
    self.title = title
    self.revision = revision
  }

  public var isEmpty: Bool {
    chords.isEmpty && lyrics.isEmpty && sections.isEmpty && tempo == nil && beatsPerBar == nil
      && title == nil
  }

  public mutating func touch() { revision += 1 }
}

/// One stretch of the recording the player has re-labelled.
public struct ChordEdit: Sendable, Codable, Hashable, Identifiable {
  public var id: String
  /// The window this edit governs, in seconds of the recording.
  public var start: Double
  public var end: Double
  /// Nil means "nothing is being played here" — the player heard silence where
  /// the app wrote a chord, which is a correction the app cannot make itself.
  public var chord: ChordSymbol?
  /// What the analysis said when the edit was made. A later, better analysis
  /// that agrees with the player has absorbed the correction, and ``pruned``
  /// retires it so the overlay does not accumulate dead weight forever.
  public var replaced: ChordSymbol?

  public init(
    id: String, start: Double, end: Double, chord: ChordSymbol?, replaced: ChordSymbol? = nil
  ) {
    self.id = id
    self.start = start
    self.end = end
    self.chord = chord
    self.replaced = replaced
  }
}

/// A line of lyrics and where it lands.
///
/// Text and timing are separate fields because they arrive separately: someone
/// pastes a whole song's words in one go, then binds them to the recording a
/// line at a time by tapping along. A line with no `at` is written down but not
/// yet placed, which the practice screen shows as waiting rather than hiding.
public struct LyricLine: Sendable, Codable, Hashable, Identifiable {
  public var id: String
  public var text: String
  public var at: Double?
  /// Optional finer timing, for highlighting a word at a time. Empty means the
  /// whole line lights up together, which is what most players want.
  public var syllables: [Syllable]

  public init(id: String, text: String, at: Double? = nil, syllables: [Syllable] = []) {
    self.id = id
    self.text = text
    self.at = at
    self.syllables = syllables
  }

  public var isBound: Bool { at != nil }
}

public struct Syllable: Sendable, Codable, Hashable {
  public var text: String
  public var at: Double

  public init(text: String, at: Double) {
    self.text = text
    self.at = at
  }
}

/// Verse, chorus, bridge — whatever the player calls it.
public struct SectionMark: Sendable, Codable, Hashable, Identifiable {
  public var id: String
  public var at: Double
  public var label: String

  public init(id: String, at: Double, label: String) {
    self.id = id
    self.at = at
    self.label = label
  }
}

// MARK: - Applying an overlay

/// The analysis as the player has corrected it.
///
/// Every boundary in either the analysis or the overlay becomes a boundary in
/// the result, and each resulting stretch takes the last edit that covers it,
/// falling back to what was heard. Doing it by intervals rather than by
/// patching the segment list means overlapping edits, edits that span several
/// detected chords, and edits that sit inside one all behave the same way,
/// which is what a player poking at a tab actually produces.
public func applyingEdits(_ analysis: AnalysisResult, _ edits: SongEdits) -> AnalysisResult {
  var result = analysis
  if let tempo = edits.tempo { result.tempo = tempo }
  if let beatsPerBar = edits.beatsPerBar { result.beatsPerBar = beatsPerBar }
  guard !edits.chords.isEmpty else { return result }

  let duration = analysis.duration
  var boundaries: [Double] = [0]
  for seg in analysis.segments {
    boundaries.append(seg.start)
    boundaries.append(seg.end)
  }
  for edit in edits.chords {
    boundaries.append(clamp(edit.start, 0, duration))
    boundaries.append(clamp(edit.end, 0, duration))
  }
  boundaries.append(duration)
  boundaries = boundaries.map { clamp($0, 0, duration) }.sorted()

  var spans: [ChordSegment] = []
  for i in 1..<boundaries.count {
    let start = boundaries[i - 1]
    let end = boundaries[i]
    if end - start < 1e-6 { continue }
    let middle = (start + end) / 2

    var chord: ChordSymbol?
    var confidence = 0.0
    // Last edit wins, so a correction made on top of a correction is the one
    // the player is looking at.
    for edit in edits.chords
    where clamp(edit.start, 0, duration) <= middle && middle < clamp(edit.end, 0, duration) {
      chord = edit.chord ?? .noChord
      confidence = 1
    }
    if chord == nil {
      if let seg = analysis.segments.last(where: { $0.start <= middle && middle < $0.end }) {
        chord = seg.chord
        confidence = seg.confidence
      } else {
        chord = .noChord
      }
    }

    spans.append(
      ChordSegment(
        chord: chord!, start: start, end: end, startIndex: 0, endIndex: 0,
        startBeat: nearestBeat(analysis.beats, start),
        endBeat: max(nearestBeat(analysis.beats, start) + 1, nearestBeat(analysis.beats, end)),
        confidence: confidence))
  }

  var merged = mergeAdjacent(spans)
  for i in merged.indices {
    merged[i].startIndex = merged[i].startBeat ?? 0
    merged[i].endIndex = merged[i].endBeat ?? 0
  }
  result.segments = merged
  return result
}

/// Drop edits a later analysis has caught up with.
///
/// An overlay that only ever grows makes every future improvement invisible:
/// the player's old correction keeps overriding a pipeline that now agrees
/// with it anyway, and a pipeline that has since learned something better is
/// held back by a note about a bug that is fixed.
public func pruned(_ edits: SongEdits, against analysis: AnalysisResult) -> SongEdits {
  var out = edits
  out.chords = edits.chords.filter { edit in
    guard let intended = edit.chord else { return true }
    let middle = (edit.start + edit.end) / 2
    guard let seg = analysis.segments.last(where: { $0.start <= middle && middle < $0.end })
    else { return true }
    return seg.chord != intended
  }
  return out
}

/// Lyric lines in the order they are sung, unbound ones last.
public func orderedLyrics(_ lines: [LyricLine]) -> [LyricLine] {
  let bound = lines.filter(\.isBound).sorted { ($0.at ?? 0) < ($1.at ?? 0) }
  let unbound = lines.filter { !$0.isBound }
  return bound + unbound
}

/// The lyric line that should be lit at `time`, if any.
public func lyricLine(at time: Double, in lines: [LyricLine]) -> LyricLine? {
  orderedLyrics(lines).filter(\.isBound).last { ($0.at ?? 0) <= time }
}

private func clamp(_ v: Double, _ lo: Double, _ hi: Double) -> Double {
  hi <= lo ? lo : min(hi, max(lo, v))
}

private func nearestBeat(_ beats: [Double], _ time: Double) -> Int {
  guard !beats.isEmpty else { return 0 }
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
