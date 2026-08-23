import XCTest

@testable import GeetaabCore

private func segment(_ name: String, _ start: Double, _ end: Double, confidence: Double = 0.5)
  -> ChordSegment
{
  let chord: ChordSymbol
  switch name {
  case "N.C.": chord = .noChord
  case "G": chord = ChordSymbol(root: 7, quality: .maj)
  case "D": chord = ChordSymbol(root: 2, quality: .maj)
  case "Am": chord = ChordSymbol(root: 9, quality: .min)
  case "C": chord = ChordSymbol(root: 0, quality: .maj)
  case "Em": chord = ChordSymbol(root: 4, quality: .min)
  default: fatalError("unknown chord \(name)")
  }
  return ChordSegment(
    chord: chord, start: start, end: end, startIndex: 0, endIndex: 0, confidence: confidence)
}

private func analysis(
  segments: [ChordSegment], duration: Double = 16, beatPeriod: Double = 0.5
) -> AnalysisResult {
  var beats: [Double] = []
  var t = 0.0
  while t < duration {
    beats.append(t)
    t += beatPeriod
  }
  return AnalysisResult(
    duration: duration, tempo: 60 / beatPeriod, beats: beats, beatsPerBar: 4, barPhase: 0,
    key: estimateKey(chordToneHistogram(segments)), tuning: 0, segments: segments, beatStates: [],
    confidence: 0.5, rhythmicity: 0.5, freeTime: false)
}

private func names(_ result: AnalysisResult) -> [String] {
  result.segments.map { $0.chord.name() }
}

private func bounds(_ result: AnalysisResult) -> [String] {
  result.segments.map { "\($0.chord.name())@\($0.start)-\($0.end)" }
}

final class EditOverlayTests: XCTestCase {
  private let base = analysis(segments: [
    segment("G", 0, 4), segment("D", 4, 8), segment("Am", 8, 12), segment("C", 12, 16),
  ])

  func testEmptyOverlayChangesNothing() {
    let out = applyingEdits(base, SongEdits())
    XCTAssertEqual(bounds(out), bounds(base))
  }

  func testEditInsideOneSegmentSplitsIt() {
    var edits = SongEdits()
    edits.chords = [ChordEdit(id: "a", start: 5, end: 6, chord: ChordSymbol(root: 4, quality: .min))]
    let out = applyingEdits(base, edits)
    XCTAssertEqual(names(out), ["G", "D", "Em", "D", "Am", "C"])
    XCTAssertEqual(out.segments[2].start, 5)
    XCTAssertEqual(out.segments[2].end, 6)
    XCTAssertEqual(out.segments[2].confidence, 1, "a player's correction is not a guess")
  }

  func testEditSpanningSeveralSegmentsReplacesThemAll() {
    var edits = SongEdits()
    edits.chords = [ChordEdit(id: "a", start: 3, end: 13, chord: ChordSymbol(root: 4, quality: .min))]
    let out = applyingEdits(base, edits)
    XCTAssertEqual(names(out), ["G", "Em", "C"])
    XCTAssertEqual(out.segments[0].end, 3)
    XCTAssertEqual(out.segments[2].start, 13)
  }

  func testLastOverlappingEditWins() {
    var edits = SongEdits()
    edits.chords = [
      ChordEdit(id: "a", start: 4, end: 8, chord: ChordSymbol(root: 4, quality: .min)),
      ChordEdit(id: "b", start: 6, end: 8, chord: ChordSymbol(root: 0, quality: .maj)),
    ]
    let out = applyingEdits(base, edits)
    XCTAssertEqual(names(out), ["G", "Em", "C", "Am", "C"])
    XCTAssertEqual(out.segments[2].start, 6)
  }

  func testEditingToNoChord() {
    var edits = SongEdits()
    edits.chords = [ChordEdit(id: "a", start: 0, end: 4, chord: nil)]
    let out = applyingEdits(base, edits)
    XCTAssertEqual(names(out), ["N.C.", "D", "Am", "C"])
  }

  func testAdjacentEditsThatAgreeAreMerged() {
    var edits = SongEdits()
    let em = ChordSymbol(root: 4, quality: .min)
    edits.chords = [
      ChordEdit(id: "a", start: 4, end: 6, chord: em),
      ChordEdit(id: "b", start: 6, end: 8, chord: em),
    ]
    let out = applyingEdits(base, edits)
    XCTAssertEqual(names(out), ["G", "Em", "Am", "C"])
    XCTAssertEqual(out.segments[1].start, 4)
    XCTAssertEqual(out.segments[1].end, 8)
  }

  func testEditsAreClampedToTheRecording() {
    var edits = SongEdits()
    edits.chords = [ChordEdit(id: "a", start: -5, end: 2, chord: ChordSymbol(root: 4, quality: .min))]
    let out = applyingEdits(base, edits)
    XCTAssertEqual(out.segments.first?.start, 0)
    XCTAssertEqual(names(out), ["Em", "G", "D", "Am", "C"])
  }

  /// The whole reason edits are anchored in seconds.
  ///
  /// A better tempo estimate renumbers every beat in the song. If the overlay
  /// spoke in beats, the correction a player made at five seconds would land
  /// somewhere else entirely — which would make improving the pipeline a way
  /// of corrupting people's work.
  func testEditsSurviveAChangedBeatGrid() {
    var edits = SongEdits()
    edits.chords = [ChordEdit(id: "a", start: 5, end: 6, chord: ChordSymbol(root: 4, quality: .min))]

    let reanalysed = analysis(
      segments: [segment("G", 0, 4.2), segment("D", 4.2, 8.1), segment("Am", 8.1, 12), segment("C", 12, 16)],
      beatPeriod: 0.37)  // a different tempo, so every beat index has moved

    let before = applyingEdits(base, edits)
    let after = applyingEdits(reanalysed, edits)

    let editedBefore = before.segments.first { $0.chord.name() == "Em" }
    let editedAfter = after.segments.first { $0.chord.name() == "Em" }
    XCTAssertEqual(editedBefore?.start, 5)
    XCTAssertEqual(editedAfter?.start, 5, "the correction stayed where the player put it")
    XCTAssertEqual(editedAfter?.end, 6)
    XCTAssertNotEqual(
      editedBefore?.startBeat, editedAfter?.startBeat,
      "the beat numbering really did change underneath it")
  }

  func testOverridesReachTheResult() {
    var edits = SongEdits()
    edits.tempo = 132
    edits.beatsPerBar = 3
    let out = applyingEdits(base, edits)
    XCTAssertEqual(out.tempo, 132)
    XCTAssertEqual(out.beatsPerBar, 3)
  }
}

final class EditPruningTests: XCTestCase {
  func testAnEditTheAnalysisNowAgreesWithRetires() {
    let em = ChordSymbol(root: 4, quality: .min)
    var edits = SongEdits()
    edits.chords = [
      ChordEdit(id: "kept", start: 1, end: 2, chord: em),
      ChordEdit(id: "absorbed", start: 5, end: 6, chord: em),
    ]
    let better = analysis(segments: [
      segment("G", 0, 4), segment("Em", 4, 8), segment("Am", 8, 12), segment("C", 12, 16),
    ])
    let out = pruned(edits, against: better)
    XCTAssertEqual(out.chords.map(\.id), ["kept"])
  }

  func testNoChordEditsAreNeverPruned() {
    // "There is nothing here" is a judgement the analysis cannot make for
    // itself, so it never counts as having caught up.
    var edits = SongEdits()
    edits.chords = [ChordEdit(id: "silence", start: 1, end: 2, chord: nil)]
    let out = pruned(edits, against: analysis(segments: [segment("N.C.", 0, 16)]))
    XCTAssertEqual(out.chords.map(\.id), ["silence"])
  }
}

final class LyricTests: XCTestCase {
  func testOrderingPutsUnboundLinesLast() {
    let lines = [
      LyricLine(id: "c", text: "third", at: 9),
      LyricLine(id: "unbound", text: "not placed yet"),
      LyricLine(id: "a", text: "first", at: 1),
      LyricLine(id: "b", text: "second", at: 5),
    ]
    XCTAssertEqual(orderedLyrics(lines).map(\.id), ["a", "b", "c", "unbound"])
  }

  func testLineLookupAtATime() {
    let lines = [
      LyricLine(id: "a", text: "first", at: 1),
      LyricLine(id: "b", text: "second", at: 5),
      LyricLine(id: "unbound", text: "not placed yet"),
    ]
    XCTAssertNil(lyricLine(at: 0.5, in: lines), "nothing is sung before the first line")
    XCTAssertEqual(lyricLine(at: 1, in: lines)?.id, "a")
    XCTAssertEqual(lyricLine(at: 4.9, in: lines)?.id, "a")
    XCTAssertEqual(lyricLine(at: 5, in: lines)?.id, "b")
    XCTAssertEqual(lyricLine(at: 500, in: lines)?.id, "b", "an unbound line is never sung")
  }
}

final class EditRoundTripTests: XCTestCase {
  func testOverlaySurvivesEncoding() throws {
    var edits = SongEdits()
    edits.chords = [
      ChordEdit(
        id: "a", start: 5, end: 6, chord: ChordSymbol(root: 4, quality: .min),
        replaced: ChordSymbol(root: 2, quality: .maj))
    ]
    edits.lyrics = [
      LyricLine(
        id: "l1", text: "在这座城市里", at: 12.5,
        syllables: [Syllable(text: "在", at: 12.5), Syllable(text: "这", at: 12.8)])
    ]
    edits.sections = [SectionMark(id: "s1", at: 0, label: "主歌")]
    edits.tempo = 128
    edits.title = "未命名"
    edits.touch()

    let data = try JSONEncoder().encode(edits)
    let back = try JSONDecoder().decode(SongEdits.self, from: data)
    XCTAssertEqual(back, edits)
    XCTAssertEqual(back.lyrics.first?.text, "在这座城市里")
    XCTAssertEqual(back.revision, 1)
    XCTAssertFalse(back.isEmpty)
  }
}

final class LyricSnappingTests: XCTestCase {
  /// 120 BPM: a beat every half second.
  private let fast: [Double] = (0..<80).map { Double($0) * 0.5 }
  /// 60 BPM, where a line can genuinely sit a long way from any beat.
  private let slow: [Double] = (0..<40).map { Double($0) }

  func testLateTapsLandOnTheBeatTheyWereAimedAt() {
    // Every tap two tenths late. Nearest-beat snapping alone would push these
    // to 2.5, 4.5 and 6.5 — further from the music, not closer.
    let lines = [
      LyricLine(id: "a", text: "one", at: 2.18),
      LyricLine(id: "b", text: "two", at: 4.21),
      LyricLine(id: "c", text: "three", at: 6.16),
    ]
    let snapped = snappedToBeats(lines, beats: fast)
    XCTAssertEqual(snapped.map(\.at), [2.0, 4.0, 6.0])
  }

  func testTapLagIsMeasuredFromWhereTapsSitInsideTheBeat() {
    let lines = [
      LyricLine(id: "a", text: "one", at: 2.18),
      LyricLine(id: "b", text: "two", at: 4.21),
      LyricLine(id: "c", text: "three", at: 6.16),
      LyricLine(id: "d", text: "four", at: 8.20),
    ]
    let lag = tapLag(lines, beats: fast)
    XCTAssertNotNil(lag)
    XCTAssertEqual(lag!, 0.1875, accuracy: 0.01)
  }

  func testEarlyTapsGiveANegativeLagRatherThanCancellingOut() {
    // Taps just *before* the beat sit at a phase near a whole beat. Averaged
    // without wrapping they would read as nearly a beat late.
    let lines = [
      LyricLine(id: "a", text: "one", at: 1.94),
      LyricLine(id: "b", text: "two", at: 3.95),
      LyricLine(id: "c", text: "three", at: 5.93),
    ]
    let lag = tapLag(lines, beats: fast)
    XCTAssertNotNil(lag)
    XCTAssertLessThan(lag!, 0)
    XCTAssertEqual(lag!, -0.06, accuracy: 0.02)
    XCTAssertEqual(snappedToBeats(lines, beats: fast).map(\.at), [2.0, 4.0, 6.0])
  }

  func testALineFarFromAnyBeatIsNotPulledOntoOne() {
    // A held or syncopated entry at 60 BPM, well past half a beat from either
    // neighbour. The lag correction still reaches it — the same late finger
    // placed it — but it is not dragged onto a beat it was never aiming at.
    let lines = [
      LyricLine(id: "a", text: "one", at: 2.0),
      LyricLine(id: "b", text: "two", at: 4.0),
      LyricLine(id: "held", text: "three", at: 6.55),
      LyricLine(id: "d", text: "four", at: 8.0),
    ]
    let snapped = snappedToBeats(lines, beats: slow)
    let held = snapped.first { $0.id == "held" }?.at
    XCTAssertNotNil(held)
    XCTAssertEqual(held!, 6.55, accuracy: 0.05, "moved only by the global lag")
    XCTAssertFalse(slow.contains(held!), "and not onto a beat")
    XCTAssertEqual(snapped.first { $0.id == "a" }?.at, 2.0)
  }

  func testUnboundLinesAreUntouched() {
    let lines = [LyricLine(id: "a", text: "not placed")]
    XCTAssertNil(snappedToBeats(lines, beats: fast).first?.at)
  }

  func testNoUsableGridMeansNoChange() {
    let lines = [LyricLine(id: "a", text: "one", at: 2.18)]
    XCTAssertEqual(snappedToBeats(lines, beats: []).first?.at, 2.18)
    XCTAssertEqual(snappedToBeats(lines, beats: [1.0]).first?.at, 2.18)
    XCTAssertNil(tapLag(lines, beats: []))
  }

  func testTooFewLinesToClaimALag() {
    let lines = [
      LyricLine(id: "a", text: "one", at: 2.18),
      LyricLine(id: "b", text: "two", at: 4.21),
    ]
    XCTAssertNil(tapLag(lines, beats: fast))
  }

  func testSnappingSettlesRatherThanCreeping() {
    // Run twice and nothing moves the second time: once the lines are on the
    // grid the measured lag is zero, so the correction stops applying.
    let lines = [
      LyricLine(id: "a", text: "one", at: 2.18),
      LyricLine(id: "b", text: "two", at: 4.21),
      LyricLine(id: "c", text: "three", at: 6.16),
    ]
    let once = snappedToBeats(lines, beats: fast)
    let twice = snappedToBeats(once, beats: fast)
    XCTAssertEqual(twice.map(\.at), once.map(\.at))
  }

  func testCorrectionNeverPushesALineBeforeTheRecording() {
    let lines = [
      LyricLine(id: "a", text: "one", at: 0.05),
      LyricLine(id: "b", text: "two", at: 2.2),
      LyricLine(id: "c", text: "three", at: 4.2),
    ]
    for line in snappedToBeats(lines, beats: fast) {
      XCTAssertGreaterThanOrEqual(line.at ?? 0, 0)
    }
  }
}
