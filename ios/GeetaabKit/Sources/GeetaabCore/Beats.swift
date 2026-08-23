public let ONSET_SAMPLE_RATE: Double = 22050
public let ONSET_FFT_SIZE = 2048
public let ONSET_HOP_SIZE = 512

public struct OnsetEnvelope {
  public let values: [Float]
  public let fps: Double
}

/// Spectral-flux onset strength.
///
/// Flux is measured on log magnitudes so a quiet verse and a loud chorus produce
/// comparable peaks, and only rising bins count — falling energy is a note
/// ending, not a new one starting.
public func onsetEnvelope(
  _ signal: [Float], sampleRate: Double = ONSET_SAMPLE_RATE,
  fftSize: Int = ONSET_FFT_SIZE, hopSize: Int = ONSET_HOP_SIZE
) -> OnsetEnvelope {
  let spec = stft(signal, sampleRate: sampleRate, fftSize: fftSize, hopSize: hopSize)
  let frames = spec.frames
  let bins = spec.bins
  let maxBin = min(bins - 1, Int(floor(8000 / (sampleRate / 2) * Double(bins - 1))))
  var values = [Float](repeating: 0, count: frames)
  let gamma = 40.0

  spec.data.withUnsafeBufferPointer { data in
    values.withUnsafeMutableBufferPointer { out in
      guard frames > 1, maxBin >= 1 else { return }
      for f in 1..<frames {
        var flux = 0.0
        let cur = f * bins
        let prev = (f - 1) * bins
        for k in 1...maxBin {
          let a = log1p(gamma * Double(data[cur + k]))
          let b = log1p(gamma * Double(data[prev + k]))
          let d = a - b
          if d > 0 { flux += d }
        }
        out[f] = Float(flux)
      }
    }
  }

  // Subtract a moving average so a sustained crescendo does not read as a
  // continuous stream of onsets.
  let window = max(3, Int((0.35 * (sampleRate / Double(hopSize))).rounded()))
  var smoothed = [Float](repeating: 0, count: frames)
  var acc: Double = 0
  let half = window >> 1
  for f in 0..<(frames + half) {
    if f < frames { acc += Double(values[f]) }
    if f - window >= 0 { acc -= Double(values[f - window]) }
    let centre = f - half
    if centre >= 0 && centre < frames {
      let n = Double(min(min(f + 1, window), frames))
      smoothed[centre] = Float(max(0, Double(values[centre]) - acc / n))
    }
  }

  var maxV: Float = 0
  for v in smoothed where v > maxV { maxV = v }
  if maxV > 0 { for i in smoothed.indices { smoothed[i] /= maxV } }

  return OnsetEnvelope(values: smoothed, fps: sampleRate / Double(hopSize))
}

public struct TempoEstimate {
  public let bpm: Double
  public let strength: Double
  /// Runner-up, usually the half- or double-time reading.
  public let alternate: Double
}

/// Tempo from the autocorrelation of the onset envelope, biased by a log-normal
/// prior around 120 BPM so half- and double-time peaks do not win by default.
public func estimateTempo(
  _ onset: OnsetEnvelope, minBpm: Double = 50, maxBpm: Double = 210
) -> TempoEstimate {
  let values = onset.values
  let fps = onset.fps
  let n = values.count
  let minLag = max(2, Int(floor(60 / maxBpm * fps)))
  let maxLag = min(n - 1, Int(ceil(60 / minBpm * fps)))
  if maxLag <= minLag { return TempoEstimate(bpm: 120, strength: 0, alternate: 120) }

  var mean = 0.0
  for v in values { mean += Double(v) }
  mean /= Double(max(1, n))

  var byLag = [Double](repeating: 0, count: maxLag - minLag + 1)
  values.withUnsafeBufferPointer { v in
    for lag in minLag...maxLag {
      var sum = 0.0
      for i in lag..<n { sum += (Double(v[i]) - mean) * (Double(v[i - lag]) - mean) }
      sum /= Double(n - lag)
      let bpm = 60 * fps / Double(lag)
      let prior = exp(-0.5 * pow(log2(bpm / 120) / 0.9, 2))
      byLag[lag - minLag] = sum * prior
    }
  }

  var bestIdx = 0
  for i in 1..<byLag.count where byLag[i] > byLag[bestIdx] { bestIdx = i }
  // The lag grid quantises tempo to whole envelope frames — over 1% at pop
  // tempi. A parabola through the peak and its neighbours reads between them.
  var lag = Double(minLag + bestIdx)
  if bestIdx > 0 && bestIdx < byLag.count - 1 {
    let left = byLag[bestIdx - 1]
    let centre = byLag[bestIdx]
    let right = byLag[bestIdx + 1]
    let denom = left - 2 * centre + right
    if denom < 0 { lag += max(-0.5, min(0.5, 0.5 * (left - right) / denom)) }
  }
  let bestBpm = 60 * fps / lag
  let bestScore = byLag[bestIdx]

  var scores: [(bpm: Double, score: Double)] = []
  scores.reserveCapacity(byLag.count)
  for i in byLag.indices { scores.append((60 * fps / Double(minLag + i), byLag[i])) }
  scores.sort { $0.score > $1.score }
  let alternate = scores.first { abs(log2($0.bpm / bestBpm)) > 0.4 }?.bpm ?? bestBpm

  return TempoEstimate(bpm: bestBpm, strength: bestScore, alternate: alternate)
}

/// Dynamic-programming beat tracker (Ellis 2007).
///
/// Picks the beat sequence that best trades off landing on onset peaks against
/// keeping a steady period, which survives the missing and syncopated onsets a
/// greedy peak-picker trips over.
public func trackBeats(_ onset: OnsetEnvelope, bpm: Double, tightness: Double = 100) -> [Double] {
  let values = onset.values
  let fps = onset.fps
  let n = values.count
  if n < 4 { return [] }
  let period = 60 / bpm * fps
  if !period.isFinite || period < 2 { return [] }

  var score = [Double](repeating: 0, count: n)
  var back = [Int](repeating: -1, count: n)
  let searchLo = Int((-2 * period).rounded())
  let searchHi = Int((-period / 2).rounded())

  score.withUnsafeMutableBufferPointer { sc in
    back.withUnsafeMutableBufferPointer { bk in
      values.withUnsafeBufferPointer { v in
        for t in 0..<n {
          var bestScore = -Double.infinity
          var bestIdx = -1
          var d = searchLo
          while d <= searchHi {
            let prev = t + d
            if prev < 0 { d += 1; continue }
            let ratio = Double(-d) / period
            if ratio <= 0 { d += 1; continue }
            let penalty = -tightness * pow(log(ratio), 2)
            let value = sc[prev] + penalty
            if value > bestScore {
              bestScore = value
              bestIdx = prev
            }
            d += 1
          }
          if bestIdx < 0 {
            sc[t] = Double(v[t])
            bk[t] = -1
          } else {
            sc[t] = Double(v[t]) + bestScore
            bk[t] = bestIdx
          }
        }
      }
    }
  }

  // Start the backtrace from a late, strong beat rather than the global max,
  // which otherwise clips the tail of the track.
  var tail = n - 1
  var bestTail = -Double.infinity
  let from = max(0, n - Int(ceil(period * 2)))
  for t in from..<n where score[t] > bestTail {
    bestTail = score[t]
    tail = t
  }

  var framesOut: [Int] = []
  var t = tail
  while t >= 0 {
    framesOut.append(t)
    if back[t] < 0 { break }
    t = back[t]
  }
  framesOut.reverse()
  return framesOut.map { Double($0) / fps }
}

/// Extend a beat list backwards to zero and forwards to `duration` using the
/// median inter-beat interval, so the grid covers the whole recording.
public func padBeatGrid(_ beats: [Double], duration: Double) -> [Double] {
  if beats.count < 2 { return beats }
  var deltas: [Double] = []
  for i in 1..<beats.count { deltas.append(beats[i] - beats[i - 1]) }
  deltas.sort()
  let period = deltas[deltas.count >> 1]
  if !period.isFinite || period <= 0 { return beats }

  var out = beats
  var t = out[0] - period
  while t > 0 {
    out.insert(t, at: 0)
    t -= period
  }
  t = out[out.count - 1] + period
  while t < duration {
    out.append(t)
    t += period
  }
  return out
}

/// Bar phase in 0..beatsPerBar-1, chosen so that chord changes land on downbeats.
///
/// Harmony changing at the top of a bar is one of the most reliable cues in
/// popular music, and it is a far better downbeat signal than accent strength on
/// a recording captured through a phone microphone.
public func estimateBarPhase(
  changeBeats: [Int], beatsPerBar: Int, beatCount: Int, beatEnergy: [Float]? = nil
) -> Int {
  if beatsPerBar <= 1 { return 0 }
  var votes = [Double](repeating: 0, count: beatsPerBar)
  for b in changeBeats {
    if b < 0 || b >= beatCount { continue }
    votes[((b % beatsPerBar) + beatsPerBar) % beatsPerBar] += 1
  }
  if let beatEnergy {
    let scale = 0.15 / Double(max(1, beatCount))
    for b in 0..<min(beatCount, beatEnergy.count) {
      votes[b % beatsPerBar] += Double(beatEnergy[b]) * scale
    }
  }
  var best = 0
  for p in 1..<beatsPerBar where votes[p] > votes[best] { best = p }
  return best
}

/// Guess between 4/4 and 3/4 from how far apart chord changes sit.
///
/// Only a clear preference flips the answer: 4/4 is overwhelmingly the common
/// case, and a wrong guess reshapes every bar in the generated tab.
public func estimateBeatsPerBar(changeBeats: [Int]) -> Int {
  if changeBeats.count < 4 { return 4 }
  var gaps: [Int] = []
  for i in 1..<changeBeats.count {
    let g = changeBeats[i] - changeBeats[i - 1]
    if g > 0 && g <= 16 { gaps.append(g) }
  }
  if gaps.count < 3 { return 4 }
  var four = 0
  var three = 0
  for g in gaps {
    if g % 4 == 0 { four += 1 }
    if g % 3 == 0 { three += 1 }
  }
  return Double(three) > Double(four) * 1.5 ? 3 : 4
}
