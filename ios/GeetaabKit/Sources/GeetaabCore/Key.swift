public enum Mode: String, Sendable, Codable, Hashable {
  case major, minor
}

public struct KeyEstimate: Sendable, Codable, Hashable {
  public var tonic: Int
  public var mode: Mode
  /// Correlation of the winning profile, 0..1-ish.
  public var confidence: Double
  public var useFlats: Bool
  public var name: String

  public init(tonic: Int, mode: Mode, confidence: Double, useFlats: Bool, name: String) {
    self.tonic = tonic
    self.mode = mode
    self.confidence = confidence
    self.useFlats = useFlats
    self.name = name
  }
}

// Krumhansl-Kessler tonal hierarchy profiles.
private let MAJOR_PROFILE: [Double] = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
private let MINOR_PROFILE: [Double] = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

private func correlate(_ a: [Double], _ b: [Double]) -> Double {
  let n = a.count
  guard n > 0, b.count == n else { return 0 }
  let ma = a.reduce(0, +) / Double(n)
  let mb = b.reduce(0, +) / Double(n)
  var num = 0.0, da = 0.0, db = 0.0
  for i in 0..<n {
    let x = a[i] - ma
    let y = b[i] - mb
    num += x * y
    da += x * x
    db += y * y
  }
  let den = (da * db).squareRoot()
  return den > 0 ? num / den : 0
}

/// Position on the circle of fifths; negative means the key is spelled flat.
private let FIFTHS: [Int: Int] = [0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 1: -5, 8: -4, 3: -3, 10: -2, 5: -1]

public func keyUsesFlats(tonic: Int, mode: Mode) -> Bool {
  let majorTonic = mode == .major ? tonic : (tonic + 3) % 12
  return (FIFTHS[majorTonic] ?? 0) < 0
}

/// Key from a pitch-class distribution.
///
/// `weights` is normally the duration-weighted histogram of detected chord
/// tones, which tracks the key better than raw chroma because it has already
/// been cleaned up by the chord decoder.
public func estimateKey(_ weights: [Double]) -> KeyEstimate {
  var best: KeyEstimate?
  for tonic in 0..<12 {
    for mode in [Mode.major, .minor] {
      let profile = mode == .major ? MAJOR_PROFILE : MINOR_PROFILE
      var rotated = [Double](repeating: 0, count: 12)
      for i in 0..<12 { rotated[i] = profile[((i - tonic) % 12 + 12) % 12] }
      let score = correlate(weights, rotated)
      if best == nil || score > best!.confidence {
        let useFlats = keyUsesFlats(tonic: tonic, mode: mode)
        best = KeyEstimate(
          tonic: tonic, mode: mode, confidence: score, useFlats: useFlats,
          name: "\(noteName(tonic, useFlats: useFlats)) \(mode.rawValue)"
        )
      }
    }
  }
  return best!
}

/// Scale degrees of the diatonic triads, used to label chords with numerals.
private let MAJOR_DEGREES = [0, 2, 4, 5, 7, 9, 11]
private let MINOR_DEGREES = [0, 2, 3, 5, 7, 8, 10]
private let MAJOR_NUMERALS = ["I", "ii", "iii", "IV", "V", "vi", "vii°"]
private let MINOR_NUMERALS = ["i", "ii°", "III", "iv", "v", "VI", "VII"]

/// Roman numeral for a chord root in a key, or nil when it is chromatic.
public func romanNumeral(root: Int, key: KeyEstimate) -> String? {
  let degrees = key.mode == .major ? MAJOR_DEGREES : MINOR_DEGREES
  let numerals = key.mode == .major ? MAJOR_NUMERALS : MINOR_NUMERALS
  let rel = ((root - key.tonic) % 12 + 12) % 12
  guard let idx = degrees.firstIndex(of: rel) else { return nil }
  return numerals[idx]
}
