/// E1 to G7: from below a guitar's low E up past the top of its harmonics.
public let SPECTRO_MIN_MIDI = 28
public let SPECTRO_MAX_MIDI = 103
public let SPECTRO_BINS = SPECTRO_MAX_MIDI - SPECTRO_MIN_MIDI + 1

/// Folds capture chunks into one spectrum column per chunk, one bin per
/// semitone.
///
/// Semitone bins rather than linear frequency for the same reason the analysis
/// uses chroma: on a log-frequency axis a chord is a fixed visual shape that
/// moves up and down with pitch, so the backdrop the recording screen paints
/// with these columns reads as music rather than as a heat map. Bin values are
/// for display, not analysis — compressed to 0..1 against a reference that only
/// ever rises, so a whole take stays comparable to itself.
public final class SpectrogramBinner {
  public let bins = SPECTRO_BINS
  private let fft: FFT
  private let window: [Double]
  private var mags: [Double]
  private let starts: [Int]
  private let lengths: [Int]
  private let offsets: [Int]
  private let weights: [Float]
  private var frame: [Double]
  private var reference = 6.0

  public init(sampleRate: Double, fftSize: Int = 4096) {
    self.fft = FFT(size: fftSize)
    self.window = hannWindow(fftSize)
    self.mags = [Double](repeating: 0, count: fftSize / 2 + 1)
    self.frame = [Double](repeating: 0, count: fftSize)

    // The same Gaussian fold the chromagram uses, at the capture rate. Low
    // semitones sit closer together than the FFT can resolve and blur into
    // each other, which for a backdrop is a feature.
    let binWidth = sampleRate / Double(fftSize)
    let maxBin = fftSize / 2
    var starts = [Int](repeating: 0, count: bins)
    var lengths = [Int](repeating: 0, count: bins)
    var offsets = [Int](repeating: 0, count: bins)
    var flat: [Float] = []
    for b in 0..<bins {
      let freq = 440 * pow(2, Double(SPECTRO_MIN_MIDI + b - 69) / 12)
      let semitoneHz = freq * (pow(2, 1.0 / 12) - 1)
      let sigma = max(0.32 * semitoneHz, 0.9 * binWidth)
      let lo = max(1, Int(floor((freq - 3 * sigma) / binWidth)))
      let hi = min(maxBin, Int(ceil((freq + 3 * sigma) / binWidth)))
      offsets[b] = flat.count
      starts[b] = lo
      guard lo <= hi else { lengths[b] = 0; continue }
      var w: [Double] = []
      var sum = 0.0
      for k in lo...hi {
        let d = (Double(k) * binWidth - freq) / sigma
        let g = exp(-0.5 * d * d)
        w.append(g)
        sum += g
      }
      if sum > 0 { for i in w.indices { w[i] /= sum } }
      lengths[b] = w.count
      flat.append(contentsOf: w.map(Float.init))
    }
    self.starts = starts
    self.lengths = lengths
    self.offsets = offsets
    self.weights = flat
  }

  /// Start a new take without building a new binner.
  ///
  /// The reference is what makes a whole take comparable to itself, so it has
  /// to go when the take does — but the object must not, because the audio
  /// thread holds a reference to it and replacing that is a data race.
  public func reset() {
    reference = 6
  }

  /// Display values 0..1 for one capture chunk.
  public func column(_ chunk: [Float]) -> [Float] {
    let n = min(chunk.count, frame.count)
    for i in 0..<n { frame[i] = Double(chunk[i]) * window[i] }
    if n < frame.count { for i in n..<frame.count { frame[i] = 0 } }
    frame.withUnsafeBufferPointer { f in
      mags.withUnsafeMutableBufferPointer { m in
        fft.magnitudes(f.baseAddress!, count: frame.count, into: m.baseAddress!)
      }
    }

    var out = [Float](repeating: 0, count: bins)
    var peak = 0.0
    for b in 0..<bins {
      let start = starts[b]
      let len = lengths[b]
      let off = offsets[b]
      var acc = 0.0
      for i in 0..<len { acc += mags[start + i] * Double(weights[off + i]) }
      out[b] = Float(acc)
      if acc > peak { peak = acc }
    }
    if peak > reference { reference = peak }
    let gamma = 25.0
    let logMax = log1p(gamma)
    for b in 0..<bins { out[b] = Float(log1p(gamma * Double(out[b]) / reference) / logMax) }
    return out
  }
}
