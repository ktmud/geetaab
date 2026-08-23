/// Which finger plucks which string.
///
/// None of this is heard from the recording — it is derived from the chord
/// shape, which is why it can be exact where the transcription can only be
/// likely. Classical practice fixes the treble: the index sits on the third
/// string, the middle on the second, the ring on the first. Only the thumb
/// moves, and where it goes depends on the chord: C is rooted on the fifth
/// string, G on the sixth, D on the fourth. Beginners reliably start every
/// chord from the sixth string because nothing tells them otherwise, and that
/// one habit is what a printed pattern of string numbers cannot fix — the
/// right string is different for every chord in the song.
public enum Finger: String, Sendable, Codable, Hashable {
  case p, i, m, a
}

/// A string a pattern step plucks. The trebles are literal; the two bass slots
/// are resolved against whichever chord is sounding.
public enum PluckString: Sendable, Codable, Hashable {
  case bass
  case altBass
  case fixed(Int)
}

public struct Pluck: Sendable, Codable, Hashable {
  public var string: PluckString
  public var finger: Finger

  public init(string: PluckString, finger: Finger) {
    self.string = string
    self.finger = finger
  }
}

/// Display numbering: string 6 is the low E, string 1 the high E.
public typealias StringNumber = Int

private func toDisplay(_ index: Int) -> StringNumber { 6 - index }

/// The lowest string the shape actually sounds — the chord's bass note.
///
/// `frets` runs low E first with -1 for a muted string, so the first entry that
/// is played is the bass. C gives the fifth string, G the sixth, D the fourth.
public func bassStringOf(_ shape: ChordShape) -> StringNumber {
  let index = shape.frets.firstIndex { $0 >= 0 } ?? 0
  return toDisplay(index)
}

/// The bass the thumb alternates onto.
///
/// The next sounding string above the root, but never past the fourth: below
/// that the thumb would be treading on the fingers' territory and the pattern
/// stops sounding like an alternating bass at all. A chord whose bass is
/// already the fourth string simply does not alternate.
public func altBassStringOf(_ shape: ChordShape) -> StringNumber {
  guard let root = shape.frets.firstIndex(where: { $0 >= 0 }) else { return 6 }
  var i = root + 1
  while i <= 2 {
    if shape.frets[i] >= 0 { return toDisplay(i) }
    i += 1
  }
  return toDisplay(root)
}

/// The string a step plucks, once the chord is known.
public func pluckStringOf(_ pluck: Pluck, shape: ChordShape) -> StringNumber {
  switch pluck.string {
  case .bass: return bassStringOf(shape)
  case .altBass: return altBassStringOf(shape)
  case .fixed(let n): return n
  }
}
