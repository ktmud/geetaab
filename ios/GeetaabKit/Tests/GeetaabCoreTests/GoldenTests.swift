import XCTest

@testable import GeetaabCore

/// The reference recording, rendered once for the whole suite.
///
/// It is the same signal `scripts/golden.mjs` analysed, produced by the same
/// integer PRNG and the same arithmetic, so a mismatch anywhere downstream is a
/// difference in the port rather than in the fixture.
enum Fixture {
  static let sampleRate: Double = 48000
  static let signal: [Float] = renderProgression(
    DEMO_PROGRESSION,
    options: SynthOptions(sampleRate: sampleRate, noise: 0.004, seed: 1337))
  static let at22: [Float] = resample(signal, from: sampleRate, to: ONSET_SAMPLE_RATE)
  static let at11: [Float] = resample(at22, from: ONSET_SAMPLE_RATE, to: CHROMA_SAMPLE_RATE)
  static let chroma: Chromagram = computeChromagram(at11, sampleRate: CHROMA_SAMPLE_RATE)
  static let onset: OnsetEnvelope = onsetEnvelope(at22, sampleRate: ONSET_SAMPLE_RATE)
  static let analysis: AnalysisResult = analyzeAudio(samples: signal, sampleRate: sampleRate)
}

final class PrimitiveTests: XCTestCase {
  func testHannWindow() {
    assertClose(hannWindow(64), Golden.doubles("hann64"), tolerance: 1e-15, "hann64")
  }

  func testFFTMagnitudes() {
    let n = 64
    var frame = [Double](repeating: 0, count: n)
    for i in 0..<n {
      frame[i] =
        sin(2 * Double.pi * 5 * Double(i) / Double(n))
        + 0.5 * cos(2 * Double.pi * 17 * Double(i) / Double(n))
    }
    var mags = [Double](repeating: 0, count: n / 2 + 1)
    frame.withUnsafeBufferPointer { f in
      mags.withUnsafeMutableBufferPointer { m in
        FFT(size: n).magnitudes(f.baseAddress!, count: n, into: m.baseAddress!)
      }
    }
    assertClose(mags, Golden.doubles("fft64"), tolerance: 1e-13, "fft64")
  }

  func testSynthesizedSignalMatches() {
    // Everything else is only meaningful if the two languages built the same
    // recording to begin with.
    assertDigest(
      Digest.of(Fixture.signal), Digest(Golden.object("signal")), tolerance: 1e-6, "signal")
  }

  func testResamplerCachedPhases() {
    assertDigest(
      Digest.of(Fixture.at22), Digest(Golden.object("resample48to22")), tolerance: 1e-6,
      "resample 48k->22.05k")
    assertDigest(
      Digest.of(Fixture.at11), Digest(Golden.object("resample22to11")), tolerance: 1e-6,
      "resample 22.05k->11.025k")
  }

  func testResamplerDirectFallback() {
    // 44100 into 11111 shares no useful factor, so the phase cache stands down
    // and the direct form has to produce the same answer.
    let slice = Array(Fixture.signal.prefix(100_000))
    let out = resample(slice, from: 44100, to: 11111)
    assertDigest(
      Digest.of(out), Digest(Golden.object("resampleOddRatio")), tolerance: 1e-6,
      "resample 44.1k->11111")
  }
}

final class SpectrumTests: XCTestCase {
  func testStft() {
    let spec = stft(Fixture.at11, sampleRate: CHROMA_SAMPLE_RATE, fftSize: 8192, hopSize: 1024)
    let expected = Golden.object("stft")
    XCTAssertEqual(spec.frames, Int(expected.num("frames")))
    XCTAssertEqual(spec.bins, Int(expected.num("bins")))
    assertDigest(
      Digest.of(spec.data), Digest(expected["data"] as! [String: Any]), tolerance: 1e-6, "stft")
  }

  func testTuning() {
    let spec = stft(Fixture.at11, sampleRate: CHROMA_SAMPLE_RATE, fftSize: 8192, hopSize: 1024)
    assertClose(estimateTuning(spec), Golden.number("tuning"), tolerance: 1e-6, "tuning")
  }

  func testChromagram() {
    let expected = Golden.object("chroma")
    let c = Fixture.chroma
    XCTAssertEqual(c.frames, Int(expected.num("frames")))
    assertClose(c.frameRate, expected.num("frameRate"), tolerance: 1e-12, "frameRate")
    assertClose(c.tuning, expected.num("tuning"), tolerance: 1e-6, "chroma tuning")
    assertDigest(
      Digest.of(c.treble), Digest(expected["treble"] as! [String: Any]), tolerance: 1e-6, "treble")
    assertDigest(
      Digest.of(c.bass), Digest(expected["bass"] as! [String: Any]), tolerance: 1e-6, "bass")
    assertDigest(
      Digest.of(c.energy), Digest(expected["energy"] as! [String: Any]), tolerance: 1e-6, "energy")
    assertClose(
      Array(c.treble[1200..<1212]).map(Double.init), expected.nums("frame100Treble"),
      tolerance: 1e-6, "frame 100 treble")
    assertClose(
      Array(c.bass[1200..<1212]).map(Double.init), expected.nums("frame100Bass"), tolerance: 1e-6,
      "frame 100 bass")
  }

  func testAverageChroma() {
    let avg = averageChroma(Fixture.chroma.treble, frames: Fixture.chroma.frames, weights: Fixture.chroma.energy)
    assertClose(avg.map(Double.init), Golden.doubles("averageChroma"), tolerance: 1e-6, "averageChroma")
  }
}

final class RhythmTests: XCTestCase {
  func testOnsetEnvelope() {
    let expected = Golden.object("onset")
    assertClose(Fixture.onset.fps, expected.num("fps"), tolerance: 1e-12, "onset fps")
    assertDigest(
      Digest.of(Fixture.onset.values), Digest(expected["values"] as! [String: Any]),
      tolerance: 1e-6, "onset")
  }

  func testTempo() {
    let expected = Golden.object("tempo")
    let t = estimateTempo(Fixture.onset)
    assertClose(t.bpm, expected.num("bpm"), tolerance: 1e-6, "bpm")
    assertClose(t.strength, expected.num("strength"), tolerance: 1e-6, "strength")
    assertClose(t.alternate, expected.num("alternate"), tolerance: 1e-6, "alternate")
  }

  func testBeatTracking() {
    let t = estimateTempo(Fixture.onset)
    let tracked = trackBeats(Fixture.onset, bpm: t.bpm)
    assertDigest(
      Digest.of(tracked), Digest(Golden.object("trackBeats")), tolerance: 1e-9, "trackBeats")
    let padded = padBeatGrid(tracked, duration: Double(Fixture.signal.count) / Fixture.sampleRate)
    assertDigest(
      Digest.of(padded), Digest(Golden.object("padBeatGrid")), tolerance: 1e-9, "padBeatGrid")
  }
}

final class ChordTests: XCTestCase {
  func testScoreOneFrame() {
    let t = Array(Fixture.chroma.treble[1200..<1212])
    let b = Array(Fixture.chroma.bass[1200..<1212])
    let scored = scoreChords(treble: t, bass: b, frames: 1)
    assertClose(
      scored.scores.map(Double.init), Golden.doubles("scoreFrame100"), tolerance: 1e-6,
      "scoreChords frame 100")
    let best = bestChordForChroma(treble: t, bass: b)
    let expected = Golden.object("bestChordFrame100")
    XCTAssertEqual(best.state, Int(expected.num("state")))
    assertClose(best.score, expected.num("score"), tolerance: 1e-6, "best chord score")
  }

  func testBeatAggregationAndDecode() {
    let t = estimateTempo(Fixture.onset)
    let padded = padBeatGrid(
      trackBeats(Fixture.onset, bpm: t.bpm),
      duration: Double(Fixture.signal.count) / Fixture.sampleRate)
    let c = Fixture.chroma
    let agg = aggregateByBeats(
      chroma: c.treble, frames: c.frames, frameRate: c.frameRate, beats: padded)
    let aggBass = aggregateByBeats(
      chroma: c.bass, frames: c.frames, frameRate: c.frameRate, beats: padded)
    let aggEnergy = aggregateEnergyByBeats(
      energy: c.energy, frames: c.frames, frameRate: c.frameRate, beats: padded)

    let expected = Golden.object("aggregate")
    XCTAssertEqual(agg.count, Int(expected.num("count")))
    assertDigest(
      Digest.of(agg.data), Digest(expected["treble"] as! [String: Any]), tolerance: 1e-6,
      "beat treble")
    assertDigest(
      Digest.of(aggBass.data), Digest(expected["bass"] as! [String: Any]), tolerance: 1e-6,
      "beat bass")
    assertDigest(
      Digest.of(aggEnergy), Digest(expected["energy"] as! [String: Any]), tolerance: 1e-6,
      "beat energy")

    let scored = scoreChords(
      treble: agg.data, bass: aggBass.data, frames: agg.count, energy: aggEnergy,
      options: ScoreOptions(bassWeight: 0.3, ncFloor: 0.12))
    assertDigest(
      Digest.of(scored.scores), Digest(Golden.object("scoredGrid")), tolerance: 1e-6, "scored grid")

    let path = decodeChords(
      scored, options: DecodeOptions(beta: 22, changePenalty: 2.2, relatedBonus: 0.4))
    XCTAssertEqual(path, Golden.doubles("decodePath").map { Int($0) }, "decoded path")
    XCTAssertEqual(
      path.map { stateToChord($0).name() }, Golden.strings("decodeNames"), "decoded chord names")
  }

  func testKeyFromHistogram() {
    let key = estimateKey([0.2, 0.01, 0.1, 0.02, 0.12, 0.08, 0.01, 0.18, 0.02, 0.14, 0.03, 0.09])
    let expected = Golden.object("keyFromHistogram")
    XCTAssertEqual(key.tonic, Int(expected.num("tonic")))
    XCTAssertEqual(key.mode.rawValue, expected.str("mode"))
    XCTAssertEqual(key.name, expected.str("name"))
    XCTAssertEqual(key.useFlats, expected["useFlats"] as? Bool)
    assertClose(key.confidence, expected.num("confidence"), tolerance: 1e-12, "key confidence")
  }
}

final class PipelineTests: XCTestCase {
  func testFullAnalysis() {
    let a = Fixture.analysis
    let expected = Golden.object("analysis")
    assertClose(a.duration, expected.num("duration"), tolerance: 1e-12, "duration")
    assertClose(a.tempo, expected.num("tempo"), tolerance: 1e-6, "tempo")
    XCTAssertEqual(a.beatsPerBar, Int(expected.num("beatsPerBar")))
    XCTAssertEqual(a.barPhase, Int(expected.num("barPhase")))
    XCTAssertEqual(a.key.name, (expected["key"] as! [String: Any]).str("name"))
    assertClose(a.tuning, expected.num("tuning"), tolerance: 1e-6, "tuning")
    assertClose(a.confidence, expected.num("confidence"), tolerance: 1e-6, "confidence")
    assertClose(a.rhythmicity, expected.num("rhythmicity"), tolerance: 1e-6, "rhythmicity")
    XCTAssertEqual(a.freeTime, expected["freeTime"] as? Bool)
    XCTAssertEqual(a.beats.count, Int(expected.num("beatCount")))
    assertDigest(
      Digest.of(a.beats), Digest(expected["beats"] as! [String: Any]), tolerance: 1e-9, "beats")

    let segments = expected["segments"] as! [[String: Any]]
    XCTAssertEqual(a.segments.count, segments.count, "segment count")
    guard a.segments.count == segments.count else { return }
    for (i, seg) in a.segments.enumerated() {
      XCTAssertEqual(seg.chord.name(), segments[i].str("name"), "segment \(i) chord")
      assertClose(seg.start, segments[i].num("start"), tolerance: 1e-9, "segment \(i) start")
      assertClose(seg.end, segments[i].num("end"), tolerance: 1e-9, "segment \(i) end")
      XCTAssertEqual(seg.startBeat, Int(segments[i].num("startBeat")), "segment \(i) startBeat")
      XCTAssertEqual(seg.endBeat, Int(segments[i].num("endBeat")), "segment \(i) endBeat")
      assertClose(
        seg.confidence, segments[i].num("confidence"), tolerance: 1e-6, "segment \(i) confidence")
    }
  }

  func testChordToneHistogram() {
    assertClose(
      chordToneHistogram(Fixture.analysis.segments), Golden.doubles("chordToneHistogram"),
      tolerance: 1e-9, "chordToneHistogram")
  }

  func testCapoChoice() {
    let capo = chooseCapo(segments: Fixture.analysis.segments, key: Fixture.analysis.key)
    let expected = Golden.object("capo")
    XCTAssertEqual(capo.fret, Int(expected.num("fret")))
    assertClose(capo.openRatio, expected.num("openRatio"), tolerance: 1e-9, "openRatio")
    assertClose(capo.score, expected.num("score"), tolerance: 1e-9, "capo score")
    XCTAssertEqual(capo.shapeKeyName, expected.str("shapeKeyName"))

    let literal = chooseCapo(
      segments: Fixture.analysis.segments, key: Fixture.analysis.key,
      options: CapoOptions(simplify: false))
    let expectedLiteral = Golden.object("capoLiteral")
    XCTAssertEqual(literal.fret, Int(expectedLiteral.num("fret")))
    assertClose(literal.score, expectedLiteral.num("score"), tolerance: 1e-9, "literal capo score")
  }

  func testTabsAtEveryLevel() {
    let a = Fixture.analysis
    var easyAnalysis = a
    easyAnalysis.segments = reduceSegments(a.segments, beatsPerBar: a.beatsPerBar)
    let tabs: [(TabLevel, SongTab)] = [
      (.easy, buildTab(easyAnalysis)),
      (.standard, buildTab(a)),
      (.faithful, buildTab(a, options: BuildTabOptions(simplify: false))),
    ]

    for (level, tab) in tabs {
      let expected = Golden.object("tabs.\(level.rawValue)")
      XCTAssertEqual(tab.capo, Int(expected.num("capo")), "\(level) capo")
      assertClose(
        tab.capoOpenRatio, expected.num("capoOpenRatio"), tolerance: 1e-9, "\(level) openRatio")
      XCTAssertEqual(tab.shapeKeyName, expected.str("shapeKeyName"), "\(level) shape key")
      XCTAssertEqual(tab.beatsPerBar, Int(expected.num("beatsPerBar")), "\(level) beatsPerBar")
      XCTAssertEqual(tab.strum.id, expected.str("strumId"), "\(level) strum")
      XCTAssertEqual(tab.events.count, Int(expected.num("eventCount")), "\(level) events")
      XCTAssertEqual(tab.bars.count, Int(expected.num("barCount")), "\(level) bars")
      XCTAssertEqual(
        tab.bars.prefix(12).map(\.signature), (expected["barSignatures"] as! [Any]).map { $0 as! String },
        "\(level) bar signatures")

      let palette = expected["palette"] as! [[String: Any]]
      XCTAssertEqual(tab.palette.count, palette.count, "\(level) palette size")
      if tab.palette.count == palette.count {
        for (i, chord) in tab.palette.enumerated() {
          XCTAssertEqual(chord.label, palette[i].str("label"), "\(level) palette \(i) label")
          XCTAssertEqual(
            chord.shapeLabel, palette[i].str("shapeLabel"), "\(level) palette \(i) shape label")
          XCTAssertEqual(chord.shape.frets, palette[i].ints("frets"), "\(level) palette \(i) frets")
          XCTAssertEqual(
            chord.shape.fingers, palette[i].ints("fingers"), "\(level) palette \(i) fingers")
          XCTAssertEqual(
            chord.shape.difficulty, Int(palette[i].num("difficulty")),
            "\(level) palette \(i) difficulty")
          XCTAssertEqual(
            chord.substitutedFrom != nil, palette[i]["substituted"] as? Bool,
            "\(level) palette \(i) substituted")
        }
      }

      if let loop = expected["loop"] as? [String: Any] {
        XCTAssertNotNil(tab.loop, "\(level) loop")
        XCTAssertEqual(tab.loop?.length, Int(loop.num("length")), "\(level) loop length")
        XCTAssertEqual(
          tab.loop?.bars, (loop["bars"] as! [Any]).map { $0 as! String }, "\(level) loop bars")
        assertClose(
          tab.loop?.coverage ?? -1, loop.num("coverage"), tolerance: 1e-12, "\(level) loop coverage")
      } else {
        XCTAssertNil(tab.loop, "\(level) loop should be absent")
      }
    }

    let levels = levelsWorthOffering(easy: tabs[0].1, standard: tabs[1].1, faithful: tabs[2].1)
    XCTAssertEqual(levels.map(\.rawValue), Golden.strings("levels"), "levels worth offering")
  }
}

final class ShapeTests: XCTestCase {
  func testEveryShapeInTheTable() {
    let expected = Golden.object("shapes")
    for root in 0..<12 {
      for quality in QUALITIES {
        let key = "\(root):\(quality.rawValue)"
        guard let want = expected[key] as? [[String: Any]] else {
          XCTFail("golden.json has no shapes for \(key)")
          continue
        }
        let got = shapesFor(ChordSymbol(root: root, quality: quality))
        XCTAssertEqual(got.count, want.count, "\(key): shape count")
        guard got.count == want.count else { continue }
        for (i, shape) in got.enumerated() {
          XCTAssertEqual(shape.frets, want[i].ints("frets"), "\(key)[\(i)] frets")
          XCTAssertEqual(shape.fingers, want[i].ints("fingers"), "\(key)[\(i)] fingers")
          XCTAssertEqual(shape.difficulty, Int(want[i].num("difficulty")), "\(key)[\(i)] difficulty")
          if let barre = want[i]["barre"] as? [String: Any] {
            XCTAssertEqual(shape.barre?.fret, Int(barre.num("fret")), "\(key)[\(i)] barre fret")
            XCTAssertEqual(shape.barre?.from, Int(barre.num("from")), "\(key)[\(i)] barre from")
            XCTAssertEqual(shape.barre?.to, Int(barre.num("to")), "\(key)[\(i)] barre to")
          } else {
            XCTAssertNil(shape.barre, "\(key)[\(i)] should have no barre")
          }
        }
      }
    }
  }

  func testPatternOrdering() {
    XCTAssertEqual(patternsFor(beatsPerBar: 4).map(\.id), Golden.strings("patterns4"))
    XCTAssertEqual(patternsFor(beatsPerBar: 3).map(\.id), Golden.strings("patterns3"))
    XCTAssertEqual(
      [60.0, 96, 150].map { suggestStrum(tempo: $0, beatsPerBar: 4).id },
      Golden.strings("suggestStrum"))
  }

  func testShapeStrumRender() {
    let out = renderShapeStrum(frets: [-1, 3, 2, 0, 1, 0], sampleRate: 22050)
    assertDigest(Digest.of(out), Digest(Golden.object("shapeStrum")), tolerance: 1e-6, "shapeStrum")
  }
}

final class MusicGateTests: XCTestCase {
  func testGateAgreesOnTheReferenceWindow() {
    let from = Int(4 * CHROMA_SAMPLE_RATE)
    let to = Int(5.5 * CHROMA_SAMPLE_RATE)
    let window = Array(Fixture.at11[from..<to])
    let c = computeChromagram(
      window, sampleRate: CHROMA_SAMPLE_RATE, options: ChromaOptions(fftSize: 4096, hopSize: 1024))
    var sum = 0.0
    for v in window { sum += Double(v) * Double(v) }
    let level = (sum / Double(window.count)).squareRoot()
    var treble = averageChroma(c.treble, frames: c.frames, weights: c.energy)
    var bass = averageChroma(c.bass, frames: c.frames, weights: c.energy)
    normalizeVector(&treble)
    normalizeVector(&bass)
    let best = bestChordForChroma(treble: treble, bass: bass)
    let features = musicFeatures(from: c, level: level, chordScore: best.score)

    let expected = Golden.object("gate")
    assertClose(level, expected.num("level"), tolerance: 1e-6, "gate level")
    assertClose(features.tonality, expected.num("tonality"), tolerance: 1e-6, "tonality")
    assertClose(features.steadiness, expected.num("steadiness"), tolerance: 1e-6, "steadiness")
    assertClose(features.activity, expected.num("activity"), tolerance: 1e-6, "activity")
    assertClose(features.chordScore, expected.num("chordScore"), tolerance: 1e-6, "chordScore")
    XCTAssertEqual(isMusical(features), expected["musical"] as? Bool, "musical verdict")
    XCTAssertEqual(best.state, Int(expected.num("bestState")), "best state")
  }
}

/// The unit-length normalisation the live readout applies before scoring.
func normalizeVector(_ v: inout [Float]) {
  var sum = 0.0
  for x in v { sum += Double(x) * Double(x) }
  let n = sum.squareRoot()
  if n > 1e-9 { for i in v.indices { v[i] = Float(Double(v[i]) / n) } }
}
