public let CHROMA_SAMPLE_RATE: Double = 11025
public let CHROMA_FFT_SIZE = 8192
public let CHROMA_HOP_SIZE = 1024

public struct ChromaOptions {
  public var fftSize: Int
  public var hopSize: Int
  public var minMidi: Int
  public var maxMidi: Int
  /// Log-compression strength; larger values lift quiet partials.
  public var gamma: Double
  /// Global tuning offset in semitones, from ``estimateTuning``. Nil measures it.
  public var tuning: Double?

  public init(
    fftSize: Int = CHROMA_FFT_SIZE, hopSize: Int = CHROMA_HOP_SIZE,
    minMidi: Int = 36, maxMidi: Int = 96, gamma: Double = 30, tuning: Double? = nil
  ) {
    self.fftSize = fftSize
    self.hopSize = hopSize
    self.minMidi = minMidi
    self.maxMidi = maxMidi
    self.gamma = gamma
    self.tuning = tuning
  }
}

public struct Chromagram {
  /// 12 pitch classes per frame, frame-major, each frame L2-normalised.
  public let treble: [Float]
  /// Same layout, restricted to the bass register for root detection.
  public let bass: [Float]
  public let frames: Int
  public let frameRate: Double
  public let fftSize: Int
  public let hopSize: Int
  public let sampleRate: Double
  /// Broadband energy per frame, used to gate silence into "no chord".
  public let energy: [Float]
  public let tuning: Double
}

@inline(__always)
func midiToFreq(_ midi: Double, tuning: Double) -> Double {
  440 * pow(2, (midi - 69 + tuning) / 12)
}

/// Sparse map from FFT bins onto one bin per semitone, Gaussian in frequency.
private struct BandWeights {
  let starts: [Int]
  let lengths: [Int]
  let offsets: [Int]
  let weights: [Float]

  init(sampleRate: Double, fftSize: Int, minMidi: Int, maxMidi: Int, tuning: Double) {
    let bins = fftSize / 2 + 1
    let binWidth = sampleRate / Double(fftSize)
    let count = maxMidi - minMidi + 1
    var starts = [Int](repeating: 0, count: count)
    var lengths = [Int](repeating: 0, count: count)
    var offsets = [Int](repeating: 0, count: count)
    var flat: [Float] = []
    flat.reserveCapacity(count * 8)

    for i in 0..<count {
      let fm = midiToFreq(Double(minMidi + i), tuning: tuning)
      let semitoneHz = fm * (pow(2, 1.0 / 12) - 1)
      // Narrow enough that a neighbouring semitone contributes under 1%, but never
      // narrower than the FFT can resolve or low notes would fall between bins.
      let sigma = max(0.32 * semitoneHz, 0.9 * binWidth)
      let lo = max(1, Int(floor((fm - 3 * sigma) / binWidth)))
      let hi = min(bins - 1, Int(ceil((fm + 3 * sigma) / binWidth)))
      offsets[i] = flat.count
      starts[i] = lo
      guard lo <= hi else { lengths[i] = 0; continue }
      var w: [Double] = []
      w.reserveCapacity(hi - lo + 1)
      var sum = 0.0
      for k in lo...hi {
        let d = (Double(k) * binWidth - fm) / sigma
        let g = exp(-0.5 * d * d)
        w.append(g)
        sum += g
      }
      if sum > 0 { for j in w.indices { w[j] /= sum } }
      lengths[i] = w.count
      flat.append(contentsOf: w.map(Float.init))
    }
    self.starts = starts
    self.lengths = lengths
    self.offsets = offsets
    self.weights = flat
  }
}

/// Global tuning offset in semitones, in [-0.5, 0.5).
///
/// Recordings captured off a speaker, or songs mastered slightly sharp or flat,
/// routinely sit tens of cents away from A440; without this correction their
/// energy straddles two chroma bins and every chord reads as ambiguous.
public func estimateTuning(_ spec: Stft) -> Double {
  let binWidth = spec.sampleRate / Double(spec.fftSize)
  var histogram = [Double](repeating: 0, count: 120)
  let loBin = max(2, Int(floor(midiToFreq(40, tuning: 0) / binWidth)))
  let hiBin = min(spec.bins - 2, Int(ceil(midiToFreq(96, tuning: 0) / binWidth)))
  guard loBin <= hiBin else { return 0 }

  spec.data.withUnsafeBufferPointer { data in
    for f in 0..<spec.frames {
      let base = f * spec.bins
      for k in loBin...hiBin {
        let y = Double(data[base + k])
        let left = Double(data[base + k - 1])
        let right = Double(data[base + k + 1])
        if !(y > left && y >= right) || y <= 0 { continue }
        let denom = left - 2 * y + right
        let shift = denom != 0 ? (0.5 * (left - right)) / denom : 0
        if abs(shift) > 0.5 { continue }
        let freq = (Double(k) + shift) * binWidth
        if freq <= 0 { continue }
        let midi = 69 + 12 * log2(freq / 440)
        var dev = midi - midi.rounded()
        if dev >= 0.5 { dev -= 1 }
        let slot = min(119, max(0, Int(floor((dev + 0.5) * 120))))
        histogram[slot] += y
      }
    }
  }

  // Circular mean over the histogram: the deviation axis wraps at ±50 cents.
  var sx = 0.0, sy = 0.0
  for i in 0..<120 {
    let angle = (Double(i) + 0.5) / 120 * 2 * Double.pi
    sx += histogram[i] * cos(angle)
    sy += histogram[i] * sin(angle)
  }
  if sx == 0 && sy == 0 { return 0 }
  var angle = atan2(sy, sx)
  if angle < 0 { angle += 2 * Double.pi }
  return angle / (2 * Double.pi) - 0.5
}

/// Chromagram of a mono signal that is already at ``CHROMA_SAMPLE_RATE``.
///
/// Returns separate treble and bass chroma: the treble half decides chord
/// quality, the bass half disambiguates the root and inversions.
public func computeChromagram(
  _ signal: [Float], sampleRate: Double = CHROMA_SAMPLE_RATE, options: ChromaOptions = ChromaOptions()
) -> Chromagram {
  let fftSize = options.fftSize
  let hopSize = options.hopSize
  let minMidi = options.minMidi
  let maxMidi = options.maxMidi
  let gamma = options.gamma

  let spec = stft(signal, sampleRate: sampleRate, fftSize: fftSize, hopSize: hopSize)
  let tuning = options.tuning ?? estimateTuning(spec)
  let bands = BandWeights(
    sampleRate: sampleRate, fftSize: fftSize, minMidi: minMidi, maxMidi: maxMidi, tuning: tuning)
  let nBands = maxMidi - minMidi + 1

  let frames = spec.frames
  var treble = [Float](repeating: 0, count: frames * 12)
  var bass = [Float](repeating: 0, count: frames * 12)
  var energy = [Float](repeating: 0, count: frames)
  var bandEnergy = [Double](repeating: 0, count: nBands)

  // Registers overlap on purpose: bass notes above G3 still colour the root
  // estimate, and low guitar voicings still belong to the harmony.
  let trebleLo = 48  // C3
  let trebleHi = 90  // F#6
  let bassLo = minMidi
  let bassHi = 55  // G3
  let logMax = log1p(gamma)

  spec.data.withUnsafeBufferPointer { data in
    bands.weights.withUnsafeBufferPointer { bw in
      bandEnergy.withUnsafeMutableBufferPointer { be in
        treble.withUnsafeMutableBufferPointer { tr in
          bass.withUnsafeMutableBufferPointer { ba in
            energy.withUnsafeMutableBufferPointer { en in
              for f in 0..<frames {
                let base = f * spec.bins
                var total = 0.0
                var peak = 0.0
                for b in 0..<nBands {
                  let start = bands.starts[b]
                  let len = bands.lengths[b]
                  let off = bands.offsets[b]
                  var acc = 0.0
                  for j in 0..<len { acc += Double(data[base + start + j]) * Double(bw[off + j]) }
                  be[b] = acc
                  total += acc
                  if acc > peak { peak = acc }
                }
                en[f] = Float(total)

                // Compress against the frame's own peak. Measuring loudness
                // relatively lets quiet upper voices count without also lifting
                // the leakage floor that sits a fixed ratio below every strong
                // partial.
                let inv = peak > 0 ? 1 / peak : 0
                for b in 0..<nBands { be[b] = log1p(gamma * be[b] * inv) / logMax }

                for b in 0..<nBands {
                  let midi = minMidi + b
                  let pc = ((midi % 12) + 12) % 12
                  let v = be[b]
                  if midi >= trebleLo && midi <= trebleHi {
                    tr[f * 12 + pc] = Float(Double(tr[f * 12 + pc]) + v)
                  }
                  if midi >= bassLo && midi <= bassHi {
                    ba[f * 12 + pc] = Float(Double(ba[f * 12 + pc]) + v)
                  }
                }
                normalizeFrame(tr.baseAddress! + f * 12)
                normalizeFrame(ba.baseAddress! + f * 12)
              }
            }
          }
        }
      }
    }
  }

  return Chromagram(
    treble: treble, bass: bass, frames: frames, frameRate: sampleRate / Double(hopSize),
    fftSize: fftSize, hopSize: hopSize, sampleRate: sampleRate, energy: energy, tuning: tuning)
}

@inline(__always)
func normalizeFrame(_ p: UnsafeMutablePointer<Float>) {
  var sum = 0.0
  for i in 0..<12 { sum += Double(p[i]) * Double(p[i]) }
  let n = sum.squareRoot()
  if n < 1e-9 { return }
  for i in 0..<12 { p[i] = Float(Double(p[i]) / n) }
}

/// Mean chroma across frames, weighted by frame energy and L1-normalised.
public func averageChroma(_ chroma: [Float], frames: Int, weights: [Float]? = nil) -> [Float] {
  var out = [Double](repeating: 0, count: 12)
  var wsum = 0.0
  for f in 0..<frames {
    let w = weights.map { Double($0[f]) } ?? 1
    if w <= 0 { continue }
    for i in 0..<12 { out[i] += Double(chroma[f * 12 + i]) * w }
    wsum += w
  }
  if wsum > 0 {
    let total = out.reduce(0, +)
    if total > 0 { for i in 0..<12 { out[i] /= total } }
  }
  return out.map(Float.init)
}
