#if canImport(Accelerate)
import Accelerate
#endif

/// Average all channels down to one.
public func toMono(_ channels: [[Float]]) -> [Float] {
  guard let first = channels.first else { return [] }
  if channels.count == 1 { return first }
  let n = first.count
  var out = [Float](repeating: 0, count: n)
  out.withUnsafeMutableBufferPointer { o in
    for ch in channels {
      ch.withUnsafeBufferPointer { c in
        let take = min(n, c.count)
        for i in 0..<take { o[i] += c[i] }
      }
    }
    // Every arithmetic step is taken in double and only the store narrows, which
    // is what a Float32Array does in the reference implementation. Accumulating
    // in Float instead drifts by an ulp per operation, and an ulp is enough to
    // move a chord across a template boundary.
    let inv = 1 / Double(channels.count)
    for i in 0..<n { o[i] = Float(Double(o[i]) * inv) }
  }
  return out
}

/// Band-limited resampling with a Hann-windowed sinc kernel.
///
/// The cutoff tracks the lower of the two rates, so downsampling removes content
/// that would otherwise fold back into the chroma bands as phantom notes.
///
/// The kernel is rebuilt per output phase rather than per output sample. Audio
/// rates are ratios of small integers, so only `srOut / gcd` distinct phases
/// exist however long the recording is — for 48k into 22.05k that is 147 kernels
/// instead of four million, and it is the difference between the resampler
/// costing seconds on a phone and costing a tenth of one. Where the ratio is not
/// rational enough for that to pay, the direct form still runs.
public func resample(_ input: [Float], from srIn: Double, to srOut: Double, zeros: Int = 8) -> [Float] {
  if srIn == srOut || input.isEmpty { return input }
  let ratio = srOut / srIn
  let outLength = max(1, Int((Double(input.count) * ratio).rounded()))
  let fc = 0.5 * 0.95 * min(1, ratio)
  let support = Double(zeros) / (2 * fc)

  if let phases = PhasedKernels(srIn: srIn, srOut: srOut, ratio: ratio, fc: fc, support: support) {
    return phases.apply(input, outLength: outLength)
  }
  return resampleDirect(input, ratio: ratio, outLength: outLength, fc: fc, support: support)
}

private func resampleDirect(
  _ input: [Float], ratio: Double, outLength: Int, fc: Double, support: Double
) -> [Float] {
  var out = [Float](repeating: 0, count: outLength)
  input.withUnsafeBufferPointer { src in
    out.withUnsafeMutableBufferPointer { dst in
      for i in 0..<outLength {
        let centre = Double(i) / ratio
        let start = max(0, Int(ceil(centre - support)))
        let end = min(src.count - 1, Int(floor(centre + support)))
        if start > end { continue }
        var sum = 0.0
        var norm = 0.0
        for j in start...end {
          let w = kernelWeight(x: Double(j) - centre, fc: fc, support: support)
          sum += Double(src[j]) * w
          norm += w
        }
        dst[i] = norm != 0 ? Float(sum / norm) : 0
      }
    }
  }
  return out
}

@inline(__always)
private func kernelWeight(x: Double, fc: Double, support: Double) -> Double {
  let t = 2 * fc * x
  let sinc = t == 0 ? 1 : sin(Double.pi * t) / (Double.pi * t)
  let win = 0.5 + 0.5 * cos(Double.pi * x / support)
  return sinc * win
}

/// One windowed-sinc kernel per distinct fractional position of the read head.
private struct PhasedKernels {
  let period: Int
  /// Input index the kernel of phase `p` starts at, relative to `floor(centre)`.
  let offsets: [Int]
  let taps: [Int]
  let weights: [Double]
  let norms: [Double]
  let starts: [Int]
  let ratio: Double

  /// More phases than this and rebuilding kernels costs more than it saves.
  static let maxPeriod = 8192

  init?(srIn: Double, srOut: Double, ratio: Double, fc: Double, support: Double) {
    // Only exact integer rates give an exactly repeating phase; anything else
    // would drift out of step with the cached kernels over a long recording.
    guard
      srIn > 0, srOut > 0,
      srIn == srIn.rounded(), srOut == srOut.rounded(),
      srIn < 4_000_000, srOut < 4_000_000
    else { return nil }
    let a = Int(srIn)
    let b = Int(srOut)
    let period = b / gcd(a, b)
    guard period >= 1, period <= Self.maxPeriod else { return nil }

    var offsets: [Int] = []
    var taps: [Int] = []
    var weights: [Double] = []
    var norms: [Double] = []
    offsets.reserveCapacity(period)
    taps.reserveCapacity(period)
    norms.reserveCapacity(period)
    var cursor = 0
    var starts: [Int] = []
    starts.reserveCapacity(period)

    for p in 0..<period {
      let centre = Double(p) / ratio
      let base = Int(floor(centre))
      let lo = Int(ceil(centre - support))
      let hi = Int(floor(centre + support))
      let count = max(0, hi - lo + 1)
      offsets.append(lo - base)
      taps.append(count)
      starts.append(cursor)
      var norm = 0.0
      if count > 0 {
        for j in lo...hi {
          let w = kernelWeight(x: Double(j) - centre, fc: fc, support: support)
          weights.append(w)
          norm += w
        }
        cursor += count
      }
      norms.append(norm)
    }

    self.period = period
    self.offsets = offsets
    self.taps = taps
    self.weights = weights
    self.norms = norms
    self.starts = starts
    self.ratio = ratio
  }

  func apply(_ input: [Float], outLength: Int) -> [Float] {
    var out = [Float](repeating: 0, count: outLength)
    let n = input.count
    input.withUnsafeBufferPointer { src in
      out.withUnsafeMutableBufferPointer { dst in
        weights.withUnsafeBufferPointer { w in
          var phase = 0
          for i in 0..<outLength {
            let count = taps[phase]
            if count > 0 {
              let base = Int(floor(Double(i) / ratio))
              let from = base + offsets[phase]
              let kernel = w.baseAddress! + starts[phase]
              if from >= 0 && from + count <= n {
                var sum = 0.0
                for k in 0..<count { sum += Double(src[from + k]) * kernel[k] }
                dst[i] = Float(sum / norms[phase])
              } else {
                // Clipped by an edge of the signal: renormalise over the taps
                // that survive, exactly as the direct form does.
                var sum = 0.0
                var norm = 0.0
                for k in 0..<count {
                  let j = from + k
                  if j < 0 || j >= n { continue }
                  sum += Double(src[j]) * kernel[k]
                  norm += kernel[k]
                }
                dst[i] = norm != 0 ? Float(sum / norm) : 0
              }
            }
            phase += 1
            if phase == period { phase = 0 }
          }
        }
      }
    }
    return out
  }
}

private func gcd(_ a: Int, _ b: Int) -> Int {
  var x = abs(a)
  var y = abs(b)
  while y != 0 { (x, y) = (y, x % y) }
  return max(1, x)
}

public struct Stft {
  /// Magnitudes laid out frame-major: frame `f` occupies `[f*bins, (f+1)*bins)`.
  public let data: [Float]
  public let frames: Int
  public let bins: Int
  public let fftSize: Int
  public let hopSize: Int
  public let sampleRate: Double
}

/// Magnitude STFT with frame `f` centred on sample `f * hopSize` and the signal
/// zero-padded at both ends, so frame indices convert to timestamps by a plain
/// multiply with no window-length offset.
public func stft(_ signal: [Float], sampleRate: Double, fftSize: Int, hopSize: Int) -> Stft {
  let bins = fftSize / 2 + 1
  let frames = max(1, signal.count / hopSize + 1)
  let fft = FFT(size: fftSize)
  let win = hannWindow(fftSize)
  var frame = [Double](repeating: 0, count: fftSize)
  var mags = [Double](repeating: 0, count: bins)
  var data = [Float](repeating: 0, count: frames * bins)
  let half = fftSize >> 1

  signal.withUnsafeBufferPointer { sig in
    win.withUnsafeBufferPointer { w in
      frame.withUnsafeMutableBufferPointer { fr in
        mags.withUnsafeMutableBufferPointer { mg in
          data.withUnsafeMutableBufferPointer { out in
            for f in 0..<frames {
              let start = f * hopSize - half
              for i in 0..<fftSize {
                let idx = start + i
                fr[i] = (idx >= 0 && idx < sig.count) ? Double(sig[idx]) * w[i] : 0
              }
              fft.magnitudes(fr.baseAddress!, count: fftSize, into: mg.baseAddress!)
              let base = f * bins
              for k in 0..<bins { out[base + k] = Float(mg[k]) }
            }
          }
        }
      }
    }
  }
  return Stft(data: data, frames: frames, bins: bins, fftSize: fftSize, hopSize: hopSize, sampleRate: sampleRate)
}

/// Seconds at the centre of frame `f`.
public func frameTime(_ f: Int, hopSize: Int, sampleRate: Double) -> Double {
  Double(f * hopSize) / sampleRate
}

public func meanOf<C: Collection>(_ values: C) -> Double where C.Element == Double {
  if values.isEmpty { return 0 }
  return values.reduce(0, +) / Double(values.count)
}

public func medianOf(_ values: [Double]) -> Double {
  if values.isEmpty { return 0 }
  let s = values.sorted()
  let mid = s.count >> 1
  return s.count % 2 == 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/// Peak absolute value scaled to `peak`; silent input is returned untouched.
public func normalizePeak(_ signal: inout [Float], peak: Double = 0.99) {
  var maxAbs = 0.0
  for v in signal { let a = abs(Double(v)); if a > maxAbs { maxAbs = a } }
  if maxAbs < 1e-6 { return }
  let g = peak / maxAbs
  for i in signal.indices { signal[i] = Float(Double(signal[i]) * g) }
}
