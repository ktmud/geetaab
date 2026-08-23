#if canImport(Accelerate)
import Accelerate
#endif

/// Real-input magnitude spectrum, sized once and reused across every frame.
///
/// Two implementations sit behind one interface: Accelerate's split-complex
/// real FFT where it exists, and an iterative radix-2 Cooley-Tukey otherwise.
/// Both compute in double precision, which is what keeps a phone and a test
/// machine agreeing on a chromagram to more places than the analysis can use.
public final class FFT {
  public let size: Int
  private let half: Int

  #if canImport(Accelerate)
  private let setup: FFTSetupD
  private let log2n: vDSP_Length
  private var realp: [Double]
  private var imagp: [Double]
  private var padded: [Double]
  #else
  private let cosTable: [Double]
  private let sinTable: [Double]
  private let rev: [UInt32]
  private var re: [Double]
  private var im: [Double]
  #endif

  public init(size: Int) {
    precondition(size >= 8 && size & (size - 1) == 0, "FFT size must be a power of two of at least 8, got \(size)")
    self.size = size
    self.half = size / 2

    #if canImport(Accelerate)
    self.log2n = vDSP_Length(size.trailingZeroBitCount)
    guard let setup = vDSP_create_fftsetupD(log2n, FFTRadix(kFFTRadix2)) else {
      preconditionFailure("Accelerate would not allocate an FFT of size \(size)")
    }
    self.setup = setup
    self.realp = [Double](repeating: 0, count: half)
    self.imagp = [Double](repeating: 0, count: half)
    self.padded = [Double](repeating: 0, count: size)
    #else
    var cosT = [Double](repeating: 0, count: half)
    var sinT = [Double](repeating: 0, count: half)
    for i in 0..<half {
      cosT[i] = cos(2 * Double.pi * Double(i) / Double(size))
      sinT[i] = sin(2 * Double.pi * Double(i) / Double(size))
    }
    self.cosTable = cosT
    self.sinTable = sinT
    let bits = size.trailingZeroBitCount
    var r = [UInt32](repeating: 0, count: size)
    for i in 0..<size {
      var acc: Int = 0
      for b in 0..<bits where i & (1 << b) != 0 { acc |= 1 << (bits - 1 - b) }
      r[i] = UInt32(acc)
    }
    self.rev = r
    self.re = [Double](repeating: 0, count: size)
    self.im = [Double](repeating: 0, count: size)
    #endif
  }

  deinit {
    #if canImport(Accelerate)
    vDSP_destroy_fftsetupD(setup)
    #endif
  }

  /// Magnitude spectrum of one real frame, written into `out` (size/2 + 1 long).
  ///
  /// `frame` may be shorter than the transform, in which case it is zero-padded;
  /// the caller's buffer is never written to.
  public func magnitudes(_ frame: UnsafePointer<Double>, count: Int, into out: UnsafeMutablePointer<Double>) {
    let n = size

    #if canImport(Accelerate)
    padded.withUnsafeMutableBufferPointer { p in
      let take = min(count, n)
      p.baseAddress!.update(from: frame, count: take)
      if take < n { p.baseAddress!.advanced(by: take).update(repeating: 0, count: n - take) }
    }
    realp.withUnsafeMutableBufferPointer { rp in
      imagp.withUnsafeMutableBufferPointer { ip in
        var split = DSPDoubleSplitComplex(realp: rp.baseAddress!, imagp: ip.baseAddress!)
        padded.withUnsafeBufferPointer { src in
          src.baseAddress!.withMemoryRebound(to: DSPDoubleComplex.self, capacity: half) { interleaved in
            vDSP_ctozD(interleaved, 2, &split, 1, vDSP_Length(half))
          }
        }
        vDSP_fft_zripD(setup, &split, 1, log2n, FFTDirection(FFT_FORWARD))
        // The packed real transform folds Nyquist into imagp[0] and returns
        // everything at twice its amplitude.
        out[0] = abs(rp[0]) * 0.5
        out[half] = abs(ip[0]) * 0.5
        for k in 1..<half {
          out[k] = (rp[k] * rp[k] + ip[k] * ip[k]).squareRoot() * 0.5
        }
      }
    }
    #else
    re.withUnsafeMutableBufferPointer { reBuf in
      im.withUnsafeMutableBufferPointer { imBuf in
        let r = reBuf.baseAddress!
        let i = imBuf.baseAddress!
        let take = min(count, n)
        r.update(from: frame, count: take)
        if take < n { r.advanced(by: take).update(repeating: 0, count: n - take) }
        i.update(repeating: 0, count: n)
        transform(r, i)
        for k in 0...half {
          out[k] = (r[k] * r[k] + i[k] * i[k]).squareRoot()
        }
      }
    }
    #endif
  }

  #if !canImport(Accelerate)
  private func transform(_ re: UnsafeMutablePointer<Double>, _ im: UnsafeMutablePointer<Double>) {
    let n = size
    rev.withUnsafeBufferPointer { rv in
      for i in 0..<n {
        let j = Int(rv[i])
        if j > i {
          var t = re[i]; re[i] = re[j]; re[j] = t
          t = im[i]; im[i] = im[j]; im[j] = t
        }
      }
    }
    cosTable.withUnsafeBufferPointer { ct in
      sinTable.withUnsafeBufferPointer { st in
        var len = 2
        while len <= n {
          let halfLen = len >> 1
          let step = n / len
          var i = 0
          while i < n {
            var j = 0
            var k = 0
            while j < halfLen {
              let l = i + j
              let rr = l + halfLen
              let wr = ct[k]
              let wi = -st[k]
              let tr = re[rr] * wr - im[rr] * wi
              let ti = re[rr] * wi + im[rr] * wr
              re[rr] = re[l] - tr
              im[rr] = im[l] - ti
              re[l] += tr
              im[l] += ti
              j += 1
              k += step
            }
            i += len
          }
          len <<= 1
        }
      }
    }
  }
  #endif
}

/// Periodic Hann window, the correct variant for STFT analysis.
public func hannWindow(_ size: Int) -> [Double] {
  var w = [Double](repeating: 0, count: size)
  for i in 0..<size { w[i] = 0.5 - 0.5 * cos(2 * Double.pi * Double(i) / Double(size)) }
  return w
}
