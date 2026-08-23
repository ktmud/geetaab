public struct SynthChord: Sendable, Hashable {
  public var root: Int  // pitch class, 0 = C
  public var quality: ChordQuality
  public var beats: Int

  public init(root: Int, quality: ChordQuality, beats: Int) {
    self.root = root
    self.quality = quality
    self.beats = beats
  }
}

public struct SynthOptions {
  public var bpm: Double
  public var sampleRate: Double
  /// Percussion helps the beat tracker lock on, exactly as it does in real songs.
  public var drums: Bool
  /// Sixteenth-note strum grid, one entry per eighth of a bar.
  public var strum: Bool
  public var noise: Double
  public var seed: UInt32

  public init(
    bpm: Double = 96, sampleRate: Double = 44100, drums: Bool = true, strum: Bool = true,
    noise: Double = 0, seed: UInt32 = 1337
  ) {
    self.bpm = bpm
    self.sampleRate = sampleRate
    self.drums = drums
    self.strum = strum
    self.noise = noise
    self.seed = seed
  }
}

/// Deterministic PRNG so synthesized fixtures are byte-stable across runs —
/// and, because every step is 32-bit integer arithmetic, byte-stable across
/// languages too. The web build and this one render the same demo track.
public struct Mulberry32 {
  private var a: UInt32

  public init(seed: UInt32) {
    self.a = seed
  }

  public mutating func next() -> Double {
    a = a &+ 0x6d2b_79f5
    var t = a
    t = (t ^ (t >> 15)) &* (t | 1)
    t ^= t &+ ((t ^ (t >> 7)) &* (t | 61))
    return Double(t ^ (t >> 14)) / 4_294_967_296
  }
}

private func midiToFreq(_ midi: Double) -> Double {
  440 * pow(2, (midi - 69) / 12)
}

/// Bass note plus a close upper voicing, the way a guitar actually sits.
public func voicingFor(root: Int, quality: ChordQuality) -> [Int] {
  let bass = 40 + ((root - 4 + 12) % 12)  // E2..D#3
  var notes = [bass]
  for iv in quality.intervals { notes.append(60 + ((root + iv) % 12)) }  // C4..B4
  notes.append(bass + 12)  // doubled root, the way an open guitar chord rings
  return notes
}

/// Karplus-Strong plucked string.
///
/// A delay line seeded with filtered noise gives the full harmonic series of a
/// real string for the cost of one multiply-add per sample, which keeps the test
/// fixtures cheap enough to synthesize on every run.
private func addPluck(
  _ out: inout [Float], startSample: Int, midi: Int, amp: Double, sampleRate: Double,
  decay: Double, rand: inout Mulberry32
) {
  if startSample < 0 || startSample >= out.count { return }
  let f0 = midiToFreq(Double(midi))
  // The loop filter contributes half a sample of delay; fold it into the length
  // so the string sounds at the requested pitch rather than a few cents flat.
  let n = max(2, Int((sampleRate / f0 - 0.5).rounded()))
  var buf = [Float](repeating: 0, count: n)
  var lp = 0.0
  for i in 0..<n {
    lp = 0.65 * lp + 0.35 * (rand.next() * 2 - 1)
    buf[i] = Float(lp)
  }
  let len = min(out.count - startSample, Int(floor(decay * sampleRate)))
  let g = pow(0.001, Double(n) / (decay * sampleRate))  // -60 dB after `decay`
  var idx = 0
  var last = 0.0
  for i in 0..<len {
    let cur = Double(buf[idx])
    out[startSample + i] = Float(Double(out[startSample + i]) + amp * cur)
    buf[idx] = Float(g * 0.5 * (cur + last))
    last = cur
    idx = idx + 1 == n ? 0 : idx + 1
  }
}

private func addKick(_ out: inout [Float], at: Int, sampleRate: Double, amp: Double) {
  let len = min(out.count - at, Int(floor(0.22 * sampleRate)))
  if len <= 0 { return }
  for i in 0..<len {
    let t = Double(i) / sampleRate
    let f = 110 * exp(-t * 28) + 45
    let env = exp(-t * 16)
    out[at + i] = Float(Double(out[at + i]) + amp * env * sin(2 * Double.pi * f * t))
  }
}

/// Decaying noise burst through a one-pole highpass: snares and hats.
private func addNoiseHit(
  _ out: inout [Float], at: Int, sampleRate: Double, amp: Double, decayRate: Double,
  brightness: Double, rand: inout Mulberry32
) {
  if at < 0 || at >= out.count { return }
  let len = min(out.count - at, Int(floor(5 / decayRate * sampleRate)))
  if len <= 0 { return }
  var prevIn = 0.0
  var prevOut = 0.0
  var env = amp
  let step = exp(-decayRate / sampleRate)
  for i in 0..<len {
    let white = rand.next() * 2 - 1
    prevOut = brightness * (prevOut + white - prevIn)
    prevIn = white
    out[at + i] = Float(Double(out[at + i]) + env * prevOut)
    env *= step
  }
}

/// Render a chord progression to a mono buffer.
///
/// Used both for the in-app demo track and as ground truth in the analysis
/// tests, so the pipeline can be verified without a microphone.
public func renderProgression(_ chords: [SynthChord], options: SynthOptions = SynthOptions()) -> [Float] {
  let sampleRate = options.sampleRate
  var rand = Mulberry32(seed: options.seed)

  let beatSeconds = 60 / options.bpm
  let totalBeats = chords.reduce(0) { $0 + $1.beats }
  let totalSamples = Int(ceil((Double(totalBeats) + 1) * beatSeconds * sampleRate))
  var out = [Float](repeating: 0, count: totalSamples)

  var beatCursor = 0
  let beatsPerBar = 4
  for chord in chords {
    let notes = voicingFor(root: chord.root, quality: chord.quality)
    // Offsets within a bar, in beats: down on 1, then the standard
    // down-down-up-up-down shape most beginner songbooks open with.
    let strumOffsets: [Double] = options.strum ? [0, 1, 1.5, 2.5, 3] : [0]
    var bar = 0
    while bar * beatsPerBar < chord.beats {
      for offset in strumOffsets {
        let position = Double(bar * beatsPerBar) + offset
        if position >= Double(chord.beats) { continue }
        let down = position.truncatingRemainder(dividingBy: 1) == 0
        let at = Int(floor((Double(beatCursor) + position) * beatSeconds * sampleRate))
        if at >= totalSamples { continue }
        let amp = (down ? 0.22 : 0.14) * (0.9 + 0.2 * rand.next())
        let order = down ? notes : notes.reversed().map { $0 }
        for (idx, midi) in order.enumerated() {
          let spread = Int(floor(Double(idx) * 0.012 * sampleRate))
          addPluck(
            &out, startSample: at + spread, midi: midi, amp: amp, sampleRate: sampleRate,
            decay: 1.6, rand: &rand)
        }
      }
      bar += 1
    }
    beatCursor += chord.beats
  }

  if options.drums {
    for b in 0..<totalBeats {
      let at = Int(floor(Double(b) * beatSeconds * sampleRate))
      let inBar = b % 4
      if inBar == 0 || inBar == 2 { addKick(&out, at: at, sampleRate: sampleRate, amp: 0.5) }
      if inBar == 1 || inBar == 3 {
        addNoiseHit(
          &out, at: at, sampleRate: sampleRate, amp: 0.3, decayRate: 26, brightness: 0.7,
          rand: &rand)
      }
      for off in [0.0, 0.5] {
        let hat = Int(floor((Double(b) + off) * beatSeconds * sampleRate))
        if hat < totalSamples {
          addNoiseHit(
            &out, at: hat, sampleRate: sampleRate, amp: 0.09, decayRate: 90, brightness: 0.97,
            rand: &rand)
        }
      }
    }
  }

  if options.noise > 0 {
    for i in out.indices { out[i] = Float(Double(out[i]) + options.noise * (rand.next() * 2 - 1)) }
  }
  normalizePeak(&out, peak: 0.9)
  return out
}

/// One slow strum of an actual fingering, low string first.
///
/// Unlike ``renderProgression`` this voices the exact frets of a shape rather
/// than an idealised chord, so the chord library plays what the diagram above
/// it shows — a learner checking their own strum against it hears the same
/// notes in the same octaves.
public func renderShapeStrum(
  frets: [Int], sampleRate: Double = 44100, seed: UInt32 = 20
) -> [Float] {
  var rand = Mulberry32(seed: seed)
  var out = [Float](repeating: 0, count: Int(ceil(2.4 * sampleRate)))
  var voice = 0
  for (string, fret) in frets.enumerated() {
    if fret < 0 { continue }
    let at = Int(floor(Double(voice) * 0.032 * sampleRate))
    voice += 1
    addPluck(
      &out, startSample: at, midi: STANDARD_TUNING[string] + fret, amp: 0.3,
      sampleRate: sampleRate, decay: 2.1, rand: &rand)
  }
  normalizePeak(&out, peak: 0.85)
  return out
}

/// The demo progression: I–V–vi–IV in G, the backbone of a huge slice of pop.
public let DEMO_PROGRESSION: [SynthChord] = [
  SynthChord(root: 7, quality: .maj, beats: 4),
  SynthChord(root: 2, quality: .maj, beats: 4),
  SynthChord(root: 9, quality: .min, beats: 4),
  SynthChord(root: 0, quality: .maj, beats: 4),
  SynthChord(root: 7, quality: .maj, beats: 4),
  SynthChord(root: 2, quality: .maj, beats: 4),
  SynthChord(root: 9, quality: .min, beats: 4),
  SynthChord(root: 0, quality: .maj, beats: 4),
]
