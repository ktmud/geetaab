/// Deciding whether the microphone is hearing music at all.
///
/// The obvious tool — an off-the-shelf voice-activity model — is the wrong one:
/// VADs are trained to find speech and to *reject* music, the exact opposite of
/// what "wait for the song to start" needs, and shipping model weights would
/// break this app's promise that nothing is downloaded. What separates a song
/// from a quiet room, a conversation, or a fan is already measured by the chroma
/// analysis the live chord readout runs four times a second, so the detector
/// reads its answer from there instead:
///
/// - a song is *loud enough* to register at all,
/// - its energy *concentrates* on a few pitch classes instead of smearing
///   across all twelve the way broadband noise does,
/// - the harmony *holds still* for beats at a time, where speech glides to a
///   new pitch every syllable,
/// - its loudness *breathes* — strums, plucks and drums put a pulse on the
///   energy envelope that mains hum and appliance drone entirely lack, and
/// - the pitch classes that are lit *look like a chord* to the same
///   zero-centred templates the transcription uses, which a slamming door or a
///   vacuum cleaner never will.
///
/// No single feature survives every impostor — steady noise is as "steady" as
/// any chord, and a mains hum is literally a perfect fifth — but each impostor
/// fails at least one, so the verdict is the conjunction.
public struct MusicFeatures: Sendable {
  /// RMS level of the analysis window, 0..1.
  public var level: Double
  /// Share of pitch-class energy held by the top three classes, 0..1.
  public var tonality: Double
  /// Similarity of chroma frames a quarter-second apart, 0..1.
  public var steadiness: Double
  /// Variation of the energy envelope across the window, 0..~1.
  public var activity: Double
  /// Best match against the zero-centred chord templates.
  public var chordScore: Double

  public init(level: Double, tonality: Double, steadiness: Double, activity: Double, chordScore: Double) {
    self.level = level
    self.tonality = tonality
    self.steadiness = steadiness
    self.activity = activity
    self.chordScore = chordScore
  }
}

/// Below this RMS the room is silent for practical purposes.
public let MUSIC_LEVEL_FLOOR = 0.0035
/// Flat noise spreads 12 ways and lands near 0.28; played chords sit above 0.32.
public let MUSIC_TONALITY_FLOOR = 0.3
/// Held harmony stays above 0.9; gliding speech falls under 0.81.
public let MUSIC_STEADINESS_FLOOR = 0.85
/// Hum and stationary noise barely move; strummed music swings far above.
public let MUSIC_ACTIVITY_FLOOR = 0.1
/// The centred templates score the noise floor near zero, so little is plenty.
public let MUSIC_CHORD_FLOOR = 0.08

public func isMusical(_ f: MusicFeatures) -> Bool {
  f.level >= MUSIC_LEVEL_FLOOR && f.tonality >= MUSIC_TONALITY_FLOOR
    && f.steadiness >= MUSIC_STEADINESS_FLOOR && f.activity >= MUSIC_ACTIVITY_FLOOR
    && f.chordScore >= MUSIC_CHORD_FLOOR
}

/// Assemble the verdict's inputs from work the live readout has already done.
public func musicFeatures(from chroma: Chromagram, level: Double, chordScore: Double) -> MusicFeatures {
  MusicFeatures(
    level: level,
    tonality: chromaTonality(chroma),
    steadiness: chromaSteadiness(chroma),
    activity: chromaActivity(chroma),
    chordScore: chordScore)
}

/// Share of the energy-weighted mean chroma held by its three largest bins.
public func chromaTonality(_ chroma: Chromagram) -> Double {
  var mean = [Double](repeating: 0, count: 12)
  var wsum = 0.0
  for f in 0..<chroma.frames {
    let w = Double(chroma.energy[f])
    if w <= 0 { continue }
    for i in 0..<12 { mean[i] += Double(chroma.treble[f * 12 + i]) * w }
    wsum += w
  }
  if wsum <= 0 { return 0 }
  let total = mean.reduce(0, +)
  if total <= 0 { return 0 }
  let sorted = mean.sorted(by: >)
  return (sorted[0] + sorted[1] + sorted[2]) / total
}

/// Mean cosine similarity between chroma frames roughly a quarter-second apart.
///
/// The lag matters: neighbouring STFT frames share most of their samples, so
/// even noise looks steady one hop away. A quarter second is past the window
/// overlap but still shorter than a beat, which is the timescale on which
/// played harmony actually holds still.
public func chromaSteadiness(_ chroma: Chromagram) -> Double {
  let lag = max(1, Int((0.25 * chroma.frameRate).rounded()))
  if chroma.frames <= lag { return 0 }
  var acc = 0.0
  var wsum = 0.0
  for f in 0..<(chroma.frames - lag) {
    let w = (Double(chroma.energy[f]) * Double(chroma.energy[f + lag])).squareRoot()
    if w <= 0 { continue }
    var dot = 0.0
    for i in 0..<12 {
      dot += Double(chroma.treble[f * 12 + i]) * Double(chroma.treble[(f + lag) * 12 + i])
    }
    acc += dot * w
    wsum += w
  }
  return wsum > 0 ? acc / wsum : 0
}

/// Coefficient of variation of the per-frame energy envelope.
///
/// Playing puts attacks and decays on the envelope; hum, drone and stationary
/// noise hold it flat. This is what keeps a loud refrigerator — tonal, steady,
/// and shaped like a bare fifth — from passing for a song.
public func chromaActivity(_ chroma: Chromagram) -> Double {
  // The STFT zero-pads both ends, so the outermost frames fade in and out no
  // matter what the signal does; measured across them even a dead-steady hum
  // shows a pulse. Only the fully-covered interior frames can testify.
  let margin = Int(ceil(Double(chroma.fftSize) / 2 / Double(chroma.hopSize)))
  var lo = margin
  var hi = chroma.frames - margin
  if hi - lo < 4 {
    lo = 0
    hi = chroma.frames
  }
  if hi - lo < 2 { return 0 }
  var mean = 0.0
  for f in lo..<hi { mean += Double(chroma.energy[f]) }
  mean /= Double(hi - lo)
  if mean <= 0 { return 0 }
  var varSum = 0.0
  for f in lo..<hi {
    let d = Double(chroma.energy[f]) - mean
    varSum += d * d
  }
  return (varSum / Double(hi - lo)).squareRoot() / mean
}

/// Hysteresis over per-window verdicts.
///
/// One window can pass on a cough or a doorbell; requiring several in a row
/// costs under a second of latency and stops the recorder springing on every
/// transient. Once open the gate stays open — a song's quiet bar is not the
/// song ending, and stopping is the player's call anyway.
public final class MusicGate {
  private var streak = 0
  private var isOpen = false
  private let onCount: Int

  public init(onCount: Int = 3) {
    self.onCount = onCount
  }

  public var open: Bool { isOpen }

  @discardableResult
  public func push(_ features: MusicFeatures) -> Bool {
    if !isOpen {
      streak = isMusical(features) ? streak + 1 : 0
      if streak >= onCount { isOpen = true }
    }
    return isOpen
  }

  public func reset() {
    streak = 0
    isOpen = false
  }
}
