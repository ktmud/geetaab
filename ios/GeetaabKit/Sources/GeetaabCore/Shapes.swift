/// Open-string MIDI notes, low E to high E.
public let STANDARD_TUNING = [40, 45, 50, 55, 59, 64]

public struct Barre: Sendable, Codable, Hashable {
  public var fret: Int
  /// String indices, low E = 0.
  public var from: Int
  public var to: Int

  public init(fret: Int, from: Int, to: Int) {
    self.fret = fret
    self.from = from
    self.to = to
  }
}

/// The hint shown under a diagram, as data rather than a sentence.
///
/// The interface reads in two languages, so the shape table names the fact and
/// the dictionary writes it out.
public enum ShapeNote: Sendable, Codable, Hashable {
  case fourStringF
  case barre(family: String, fret: Int)
}

public struct ChordShape: Sendable, Codable, Hashable {
  public var root: Int
  public var quality: ChordQuality
  /// Fret per string, low E first. -1 is a muted string, 0 is open.
  public var frets: [Int]
  /// Fretting finger per string: 0 for open or muted, 1-4 otherwise.
  public var fingers: [Int]
  public var barre: Barre?
  /// 1 = first week, 2 = a few weeks in, 3 = needs a full barre.
  public var difficulty: Int
  /// Hint shown under the diagram, worded by the dictionary.
  public var note: ShapeNote?

  public init(
    root: Int, quality: ChordQuality, frets: [Int], fingers: [Int], barre: Barre? = nil,
    difficulty: Int, note: ShapeNote? = nil
  ) {
    self.root = root
    self.quality = quality
    self.frets = frets
    self.fingers = fingers
    self.barre = barre
    self.difficulty = difficulty
    self.note = note
  }
}

// Pitch classes: C0 D2 E4 F5 G7 A9 B11.
private let OPEN_SHAPES: [ChordShape] = [
  ChordShape(root: 0, quality: .maj, frets: [-1, 3, 2, 0, 1, 0], fingers: [0, 3, 2, 0, 1, 0], difficulty: 1),
  ChordShape(root: 0, quality: .maj7, frets: [-1, 3, 2, 0, 0, 0], fingers: [0, 3, 2, 0, 0, 0], difficulty: 1),
  ChordShape(root: 0, quality: .dom7, frets: [-1, 3, 2, 3, 1, 0], fingers: [0, 3, 2, 4, 1, 0], difficulty: 2),
  ChordShape(root: 2, quality: .maj, frets: [-1, -1, 0, 2, 3, 2], fingers: [0, 0, 0, 1, 3, 2], difficulty: 1),
  ChordShape(root: 2, quality: .min, frets: [-1, -1, 0, 2, 3, 1], fingers: [0, 0, 0, 2, 3, 1], difficulty: 1),
  ChordShape(root: 2, quality: .dom7, frets: [-1, -1, 0, 2, 1, 2], fingers: [0, 0, 0, 2, 1, 3], difficulty: 1),
  ChordShape(
    root: 2, quality: .min7, frets: [-1, -1, 0, 2, 1, 1], fingers: [0, 0, 0, 2, 1, 1],
    barre: Barre(fret: 1, from: 4, to: 5), difficulty: 2),
  ChordShape(
    root: 2, quality: .maj7, frets: [-1, -1, 0, 2, 2, 2], fingers: [0, 0, 0, 1, 1, 1],
    barre: Barre(fret: 2, from: 3, to: 5), difficulty: 2),
  ChordShape(root: 2, quality: .sus2, frets: [-1, -1, 0, 2, 3, 0], fingers: [0, 0, 0, 1, 3, 0], difficulty: 1),
  ChordShape(root: 2, quality: .sus4, frets: [-1, -1, 0, 2, 3, 3], fingers: [0, 0, 0, 1, 2, 3], difficulty: 1),
  ChordShape(root: 4, quality: .maj, frets: [0, 2, 2, 1, 0, 0], fingers: [0, 2, 3, 1, 0, 0], difficulty: 1),
  ChordShape(root: 4, quality: .min, frets: [0, 2, 2, 0, 0, 0], fingers: [0, 2, 3, 0, 0, 0], difficulty: 1),
  ChordShape(root: 4, quality: .dom7, frets: [0, 2, 0, 1, 0, 0], fingers: [0, 2, 0, 1, 0, 0], difficulty: 1),
  ChordShape(root: 4, quality: .min7, frets: [0, 2, 0, 0, 0, 0], fingers: [0, 2, 0, 0, 0, 0], difficulty: 1),
  ChordShape(root: 4, quality: .maj7, frets: [0, 2, 1, 1, 0, 0], fingers: [0, 3, 1, 2, 0, 0], difficulty: 2),
  ChordShape(root: 4, quality: .sus4, frets: [0, 2, 2, 2, 0, 0], fingers: [0, 1, 2, 3, 0, 0], difficulty: 1),
  ChordShape(
    root: 5, quality: .maj7, frets: [-1, -1, 3, 2, 1, 0], fingers: [0, 0, 3, 2, 1, 0], difficulty: 1,
    note: .fourStringF),
  ChordShape(root: 7, quality: .maj, frets: [3, 2, 0, 0, 0, 3], fingers: [2, 1, 0, 0, 0, 3], difficulty: 1),
  ChordShape(root: 7, quality: .dom7, frets: [3, 2, 0, 0, 0, 1], fingers: [3, 2, 0, 0, 0, 1], difficulty: 1),
  ChordShape(root: 7, quality: .maj7, frets: [3, 2, 0, 0, 0, 2], fingers: [3, 2, 0, 0, 0, 1], difficulty: 2),
  ChordShape(root: 9, quality: .maj, frets: [-1, 0, 2, 2, 2, 0], fingers: [0, 0, 1, 2, 3, 0], difficulty: 1),
  ChordShape(root: 9, quality: .min, frets: [-1, 0, 2, 2, 1, 0], fingers: [0, 0, 2, 3, 1, 0], difficulty: 1),
  ChordShape(root: 9, quality: .dom7, frets: [-1, 0, 2, 0, 2, 0], fingers: [0, 0, 2, 0, 3, 0], difficulty: 1),
  ChordShape(root: 9, quality: .min7, frets: [-1, 0, 2, 0, 1, 0], fingers: [0, 0, 2, 0, 1, 0], difficulty: 1),
  ChordShape(root: 9, quality: .maj7, frets: [-1, 0, 2, 1, 2, 0], fingers: [0, 0, 2, 1, 3, 0], difficulty: 2),
  ChordShape(root: 9, quality: .sus2, frets: [-1, 0, 2, 2, 0, 0], fingers: [0, 0, 1, 2, 0, 0], difficulty: 1),
  ChordShape(root: 9, quality: .sus4, frets: [-1, 0, 2, 2, 3, 0], fingers: [0, 0, 1, 2, 3, 0], difficulty: 1),
  ChordShape(root: 11, quality: .dom7, frets: [-1, 2, 1, 2, 0, 2], fingers: [0, 2, 1, 3, 0, 4], difficulty: 2),
  ChordShape(root: 11, quality: .min7, frets: [-1, 2, 0, 2, 0, 2], fingers: [0, 2, 0, 3, 0, 4], difficulty: 2),
]

private struct MovableSpec {
  let quality: ChordQuality
  /// Fret offsets from the barre, -1 for a muted string.
  let offsets: [Int]
  let fingers: [Int]
  /// Root pitch class when the barre sits at fret 0.
  let openRoot: Int
  let barreTo: Int
  let family: String
}

private let MOVABLE_SPECS: [MovableSpec] = [
  MovableSpec(quality: .maj, offsets: [0, 2, 2, 1, 0, 0], fingers: [1, 3, 4, 2, 1, 1], openRoot: 4, barreTo: 5, family: "E"),
  MovableSpec(quality: .min, offsets: [0, 2, 2, 0, 0, 0], fingers: [1, 3, 4, 1, 1, 1], openRoot: 4, barreTo: 5, family: "E"),
  MovableSpec(quality: .dom7, offsets: [0, 2, 0, 1, 0, 0], fingers: [1, 3, 1, 2, 1, 1], openRoot: 4, barreTo: 5, family: "E"),
  MovableSpec(quality: .min7, offsets: [0, 2, 0, 0, 0, 0], fingers: [1, 3, 1, 1, 1, 1], openRoot: 4, barreTo: 5, family: "E"),
  MovableSpec(quality: .maj7, offsets: [0, 2, 1, 1, 0, 0], fingers: [1, 4, 2, 3, 1, 1], openRoot: 4, barreTo: 5, family: "E"),
  MovableSpec(quality: .sus4, offsets: [0, 2, 2, 2, 0, 0], fingers: [1, 2, 3, 4, 1, 1], openRoot: 4, barreTo: 5, family: "E"),
  MovableSpec(quality: .maj, offsets: [-1, 0, 2, 2, 2, 0], fingers: [0, 1, 3, 3, 3, 1], openRoot: 9, barreTo: 5, family: "A"),
  MovableSpec(quality: .min, offsets: [-1, 0, 2, 2, 1, 0], fingers: [0, 1, 3, 4, 2, 1], openRoot: 9, barreTo: 5, family: "A"),
  MovableSpec(quality: .dom7, offsets: [-1, 0, 2, 0, 2, 0], fingers: [0, 1, 3, 1, 4, 1], openRoot: 9, barreTo: 5, family: "A"),
  MovableSpec(quality: .min7, offsets: [-1, 0, 2, 0, 1, 0], fingers: [0, 1, 3, 1, 2, 1], openRoot: 9, barreTo: 5, family: "A"),
  MovableSpec(quality: .maj7, offsets: [-1, 0, 2, 1, 2, 0], fingers: [0, 1, 3, 2, 4, 1], openRoot: 9, barreTo: 5, family: "A"),
  MovableSpec(quality: .sus4, offsets: [-1, 0, 2, 2, 3, 0], fingers: [0, 1, 2, 3, 4, 1], openRoot: 9, barreTo: 5, family: "A"),
  MovableSpec(quality: .sus2, offsets: [-1, 0, 2, 2, 0, 0], fingers: [0, 1, 3, 4, 1, 1], openRoot: 9, barreTo: 5, family: "A"),
]

/// MIDI notes a shape actually sounds, low string first, muted strings dropped.
public func shapeNotes(_ shape: ChordShape) -> [Int] {
  var notes: [Int] = []
  for (string, fret) in shape.frets.enumerated() where fret >= 0 {
    notes.append(STANDARD_TUNING[string] + fret)
  }
  return notes
}

public func shapePitchClasses(_ shape: ChordShape) -> Set<Int> {
  Set(shapeNotes(shape).map { $0 % 12 })
}

/// Lowest sounding note, which decides whether the voicing is in root position.
public func shapeBassPitchClass(_ shape: ChordShape) -> Int? {
  shapeNotes(shape).first.map { $0 % 12 }
}

private func movableShape(_ spec: MovableSpec, root: Int, maxFret: Int) -> ChordShape? {
  let fret = ((root - spec.openRoot) % 12 + 12) % 12
  if fret == 0 || fret > maxFret { return nil }
  let frets = spec.offsets.map { $0 < 0 ? -1 : $0 + fret }
  let from = spec.family == "E" ? 0 : 1
  return ChordShape(
    root: root, quality: spec.quality, frets: frets, fingers: spec.fingers,
    barre: Barre(fret: fret, from: from, to: spec.barreTo), difficulty: 3,
    note: .barre(family: spec.family, fret: fret))
}

/// Every playable shape for a chord, easiest first.
///
/// Open shapes come from a hand-checked table; anything else falls back to the
/// movable E- and A-shape barres so the app can always print something, even
/// for a key a beginner would rather avoid.
public func shapesFor(_ chord: ChordSymbol, maxFret: Int = 9) -> [ChordShape] {
  if chord.root < 0 { return [] }
  var out = OPEN_SHAPES.filter { $0.root == chord.root && $0.quality == chord.quality }
  func collectMovable(_ limit: Int) {
    for spec in MOVABLE_SPECS where spec.quality == chord.quality {
      if let shape = movableShape(spec, root: chord.root, maxFret: limit) { out.append(shape) }
    }
  }
  collectMovable(maxFret)
  // A few roots put their only movable shape past the usual limit; a high barre
  // still beats printing no diagram at all.
  if out.isEmpty { collectMovable(11) }
  // Ordered by index as the last tie-break, so the table's own order survives.
  // Swift's sort is not stable, and the caller's "easiest first" contract makes
  // the winner of a tie a visible choice rather than an implementation detail.
  return out.enumerated().sorted {
    let (a, b) = ($0.element, $1.element)
    if a.difficulty != b.difficulty { return a.difficulty < b.difficulty }
    let (fa, fb) = (highestFret(a), highestFret(b))
    if fa != fb { return fa < fb }
    return $0.offset < $1.offset
  }.map(\.element)
}

public func easiestShape(_ chord: ChordSymbol, maxFret: Int = 9) -> ChordShape? {
  shapesFor(chord, maxFret: maxFret).first
}

/// True when the chord has an open, barre-free voicing.
public func isOpenChord(_ chord: ChordSymbol) -> Bool {
  OPEN_SHAPES.contains { $0.root == chord.root && $0.quality == chord.quality && $0.difficulty == 1 }
}

public func highestFret(_ shape: ChordShape) -> Int {
  max(0, shape.frets.filter { $0 > 0 }.max() ?? 0)
}

public func lowestFret(_ shape: ChordShape) -> Int {
  shape.frets.filter { $0 > 0 }.min() ?? 0
}

/// Chords with a first-week open shape, for the capo search to aim at.
public let EASY_CHORDS: [ChordSymbol] = OPEN_SHAPES.filter { $0.difficulty == 1 }
  .map { ChordSymbol(root: $0.root, quality: $0.quality) }

/// Pitch classes a shape may sound and still be called this chord.
public func requiredPitchClasses(_ chord: ChordSymbol) -> [Int] {
  chord.quality.intervals.map { (chord.root + $0) % 12 }
}

/// Pitch classes a shape must sound.
///
/// The perfect fifth is the one chord tone guitarists routinely drop, because it
/// adds no colour and frees a finger; the standard C7 voicing omits it.
public func essentialPitchClasses(_ chord: ChordSymbol) -> [Int] {
  chord.quality.intervals.filter { $0 != 7 }.map { (chord.root + $0) % 12 }
}
