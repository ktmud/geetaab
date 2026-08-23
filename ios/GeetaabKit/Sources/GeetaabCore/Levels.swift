/// Three readings of the same song.
///
/// `standard` is what the app has always produced: every change the analysis
/// heard, on shapes a beginner can finger. `faithful` keeps the exact chords
/// and exact shapes. `easy` goes the other way: extensions fold into the triads
/// they decorate and passing chords shorter than half a bar are absorbed, so a
/// first-year player gets fewer, plainer changes. The lower rungs only appear
/// when they actually differ — an already-simple song needs no ladder.
public enum TabLevel: String, Sendable, Codable, Hashable, CaseIterable {
  case easy, standard, faithful
}

/// A seventh or a suspension is the triad's colour, not its identity.
private func reducedQuality(_ q: ChordQuality) -> ChordQuality {
  switch q {
  case .maj, .dom7, .maj7, .sus4, .sus2: return .maj
  case .min, .min7: return .min
  }
}

/// The harmony a beginner should learn first: same song, fewer decisions.
///
/// Reduction happens on the segments, before any shape or capo choice, so the
/// easy tab is not just easier fingerings — it is genuinely fewer chords.
public func reduceSegments(_ segments: [ChordSegment], beatsPerBar: Int) -> [ChordSegment] {
  let reduced = segments.map { seg -> ChordSegment in
    var s = seg
    if seg.chord.root >= 0 {
      s.chord = ChordSymbol(root: seg.chord.root, quality: reducedQuality(seg.chord.quality))
    }
    return s
  }
  return mergeAdjacent(absorbShort(mergeAdjacent(reduced), beatsPerBar: beatsPerBar))
}

private func absorbShort(_ segments: [ChordSegment], beatsPerBar: Int) -> [ChordSegment] {
  let minBeats = max(2, beatsPerBar / 2)
  var working = segments
  var out: [ChordSegment] = []
  var i = 0
  while i < working.count {
    let seg = working[i]
    let beats = (seg.endBeat ?? 0) - (seg.startBeat ?? 0)
    if seg.chord.root >= 0 && beats > 0 && beats < minBeats {
      // A quick passing chord joins whichever neighbour is playing: the hand
      // simply stays put through it.
      if let last = out.indices.last, out[last].chord.root >= 0 {
        out[last].end = seg.end
        out[last].endBeat = seg.endBeat
        out[last].endIndex = seg.endIndex
        i += 1
        continue
      }
      if i + 1 < working.count, working[i + 1].chord.root >= 0 {
        working[i + 1].start = seg.start
        working[i + 1].startBeat = seg.startBeat
        working[i + 1].startIndex = seg.startIndex
        i += 1
        continue
      }
    }
    out.append(seg)
    i += 1
  }
  return out
}

/// Chord-change count, the thing the easy level exists to lower.
private func changeCount(_ tab: SongTab) -> Int {
  tab.events.filter { $0.chord != nil }.count
}

private func paletteIds(_ tab: SongTab) -> String {
  tab.palette
    .map { "\($0.shapeChord.root):\($0.shapeChord.quality.rawValue)" }
    .sorted()
    .joined(separator: ",")
}

/// Which levels are worth showing for this song.
///
/// `standard` is always on offer. `easy` earns its place by removing chords or
/// shrinking the palette; `faithful` by actually differing from the beginner
/// shapes. A three-way switch where two answers are identical is noise.
public func levelsWorthOffering(easy: SongTab, standard: SongTab, faithful: SongTab) -> [TabLevel] {
  var levels: [TabLevel] = []
  let easierPalette = easy.palette.count < standard.palette.count
  let fewerChanges = Double(changeCount(easy)) <= Double(changeCount(standard)) * 0.9
  if easierPalette || fewerChanges { levels.append(.easy) }
  levels.append(.standard)
  if paletteIds(faithful) != paletteIds(standard) { levels.append(.faithful) }
  return levels
}
