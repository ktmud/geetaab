public enum ChordQuality: String, Sendable, CaseIterable, Codable, Hashable {
  case maj, min, dom7, min7, maj7, sus4, sus2

  /// Semitones above the root, root included.
  public var intervals: [Int] {
    switch self {
    case .maj: return [0, 4, 7]
    case .min: return [0, 3, 7]
    case .dom7: return [0, 4, 7, 10]
    case .min7: return [0, 3, 7, 10]
    case .maj7: return [0, 4, 7, 11]
    case .sus4: return [0, 5, 7]
    case .sus2: return [0, 2, 7]
    }
  }

  public var suffix: String {
    switch self {
    case .maj: return ""
    case .min: return "m"
    case .dom7: return "7"
    case .min7: return "m7"
    case .maj7: return "maj7"
    case .sus4: return "sus4"
    case .sus2: return "sus2"
    }
  }
}

/// Detection order doubles as a tie-break preference: simpler qualities first.
public let QUALITIES: [ChordQuality] = [.maj, .min, .dom7, .min7, .maj7, .sus4, .sus2]

/// Index of each quality within ``QUALITIES``, so state arithmetic never scans.
private let QUALITY_INDEX: [ChordQuality: Int] = {
  var m: [ChordQuality: Int] = [:]
  for (i, q) in QUALITIES.enumerated() { m[q] = i }
  return m
}()

public extension ChordQuality {
  var stateIndex: Int { QUALITY_INDEX[self]! }
}

public let SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
public let FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]

public struct ChordSymbol: Sendable, Hashable, Codable {
  /// Pitch class 0-11, or -1 for "no chord".
  public var root: Int
  public var quality: ChordQuality

  public init(root: Int, quality: ChordQuality) {
    self.root = root
    self.quality = quality
  }

  public static let noChord = ChordSymbol(root: -1, quality: .maj)
  public var isNoChord: Bool { root < 0 }

  /// Pitch classes sounded by the chord, useful for scoring and voicing.
  public var pitchClasses: [Int] {
    isNoChord ? [] : quality.intervals.map { (root + $0) % 12 }
  }

  public func name(useFlats: Bool = false) -> String {
    isNoChord ? "N.C." : noteName(root, useFlats: useFlats) + quality.suffix
  }

  public func transposed(by semitones: Int) -> ChordSymbol {
    isNoChord ? self : ChordSymbol(root: (((root + semitones) % 12) + 12) % 12, quality: quality)
  }
}

public func noteName(_ pc: Int, useFlats: Bool = false) -> String {
  let idx = ((pc % 12) + 12) % 12
  return (useFlats ? FLAT_NAMES : SHARP_NAMES)[idx]
}
