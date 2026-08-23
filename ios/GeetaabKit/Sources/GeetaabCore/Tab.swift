public struct TabEvent: Sendable, Codable, Hashable {
  /// Nil for a stretch with no detectable chord.
  public var chord: PlayableChord?
  public var startBeat: Int
  public var endBeat: Int
  public var startTime: Double
  public var endTime: Double
  public var numeral: String?
}

public struct TabSlot: Sendable, Codable, Hashable {
  public var eventIndex: Int
  public var offsetBeats: Int
  public var beats: Int
}

public struct TabBar: Sendable, Codable, Hashable {
  public var index: Int
  public var startBeat: Int
  public var beats: Int
  public var startTime: Double
  public var endTime: Double
  /// Events overlapping this bar, clipped to it.
  public var slots: [TabSlot]
  public var signature: String
}

public struct SongLoop: Sendable, Codable, Hashable {
  /// Chord labels of one time through the loop, one entry per bar.
  public var bars: [String]
  public var length: Int
  /// Fraction of the song this loop accounts for.
  public var coverage: Double
}

public struct SongTab: Sendable, Codable, Hashable {
  public var key: KeyEstimate
  public var capo: Int
  public var capoOpenRatio: Double
  public var shapeKeyName: String
  public var tempo: Double
  public var beatsPerBar: Int
  public var strum: StrumPattern
  public var events: [TabEvent]
  public var bars: [TabBar]
  public var palette: [PlayableChord]
  public var loop: SongLoop?
  public var duration: Double
  public var confidence: Double
}

public struct BuildTabOptions {
  /// Override the chosen capo fret.
  public var capo: Int?
  public var simplify: Bool
  public var strum: StrumPattern?

  public init(capo: Int? = nil, simplify: Bool = true, strum: StrumPattern? = nil) {
    self.capo = capo
    self.simplify = simplify
    self.strum = strum
  }
}

/// Time of a beat index, extrapolating past the end of the tracked grid.
public func beatTime(_ beats: [Double], _ index: Int) -> Double {
  if beats.isEmpty { return 0 }
  if index < 0 { return beats[0] + Double(index) * beatPeriod(beats) }
  if index < beats.count { return beats[index] }
  return beats[beats.count - 1] + Double(index - beats.count + 1) * beatPeriod(beats)
}

private func beatPeriod(_ beats: [Double]) -> Double {
  if beats.count < 2 { return 0.5 }
  return (beats[beats.count - 1] - beats[0]) / Double(beats.count - 1)
}

/// Turn a raw analysis into something a beginner can read and play.
///
/// This is where the app stops describing the recording and starts making
/// choices for the player: which capo, which shapes, which strum.
public func buildTab(_ analysis: AnalysisResult, options: BuildTabOptions = BuildTabOptions()) -> SongTab {
  let key = analysis.key
  let beats = analysis.beats
  let beatsPerBar = analysis.beatsPerBar
  let simplify = options.simplify
  let capoChoice = chooseCapo(
    segments: analysis.segments, key: key, options: CapoOptions(simplify: simplify))
  let capo = options.capo ?? capoChoice.fret

  let allEvents: [TabEvent] = analysis.segments.map { seg in
    let chord =
      seg.chord.isNoChord
      ? nil
      : toPlayableChord(seg.chord, options: SimplifyOptions(capo: capo, key: key, simplify: simplify))
    return TabEvent(
      chord: chord,
      startBeat: seg.startBeat ?? 0,
      endBeat: seg.endBeat ?? ((seg.startBeat ?? 0) + 1),
      startTime: seg.start,
      endTime: seg.end,
      numeral: seg.chord.isNoChord ? nil : romanNumeral(root: seg.chord.root, key: key))
  }

  // Silence before the first chord and after the last is not part of the song;
  // leaving it in adds empty bars the player would have to count through.
  let events = trimSilentEdges(allEvents)
  let strum = options.strum ?? suggestStrum(tempo: analysis.tempo, beatsPerBar: beatsPerBar)
  let bars = layOutBars(
    events: events, beats: beats, beatsPerBar: beatsPerBar, barPhase: analysis.barPhase)
  let palette = buildPalette(events)
  let loop = findLoop(bars)

  let shapeKeyName =
    (options.capo == nil || options.capo == capoChoice.fret)
    ? capoChoice.shapeKeyName : shiftedKeyName(key: key, capo: capo)

  return SongTab(
    key: key, capo: capo, capoOpenRatio: capoChoice.openRatio, shapeKeyName: shapeKeyName,
    tempo: analysis.tempo, beatsPerBar: beatsPerBar, strum: strum, events: events, bars: bars,
    palette: palette, loop: loop, duration: analysis.duration, confidence: analysis.confidence)
}

private func trimSilentEdges(_ events: [TabEvent]) -> [TabEvent] {
  var first = 0
  while first < events.count && events[first].chord == nil { first += 1 }
  var last = events.count - 1
  while last >= first && events[last].chord == nil { last -= 1 }
  return first <= last ? Array(events[first...last]) : events
}

private func shiftedKeyName(key: KeyEstimate, capo: Int) -> String {
  let tonic = ((key.tonic - capo) % 12 + 12) % 12
  let names = key.useFlats ? FLAT_NAMES : SHARP_NAMES
  return "\(names[tonic]) \(key.mode.rawValue)"
}

private func layOutBars(
  events: [TabEvent], beats: [Double], beatsPerBar: Int, barPhase: Int
) -> [TabBar] {
  if events.isEmpty { return [] }
  let lastBeat = events[events.count - 1].endBeat
  var bars: [TabBar] = []
  // The first bar is short when the recording starts mid-bar; keeping that
  // pickup as its own bar is what makes every later downbeat land correctly.
  var start = barPhase > 0 ? barPhase - beatsPerBar : 0
  var index = 0
  while start < lastBeat {
    let barStart = max(0, start)
    let barEnd = min(lastBeat, start + beatsPerBar)
    if barEnd > barStart {
      var slots: [TabSlot] = []
      for (i, event) in events.enumerated() {
        let from = max(event.startBeat, barStart)
        let to = min(event.endBeat, barEnd)
        if to > from { slots.append(TabSlot(eventIndex: i, offsetBeats: from - barStart, beats: to - from)) }
      }
      bars.append(
        TabBar(
          index: index, startBeat: barStart, beats: barEnd - barStart,
          startTime: beatTime(beats, barStart), endTime: beatTime(beats, barEnd), slots: slots,
          signature: slots.map { events[$0.eventIndex].chord?.label ?? "N.C." }.joined(separator: " ")))
      index += 1
    }
    start += beatsPerBar
  }
  // A recording that opens or closes on silence leaves bars with nothing in
  // them; numbering those would have the player counting through empty air.
  var first = 0
  while first < bars.count && bars[first].slots.isEmpty { first += 1 }
  var last = bars.count - 1
  while last >= first && bars[last].slots.isEmpty { last -= 1 }
  guard first <= last else { return [] }
  return bars[first...last].enumerated().map { i, bar in
    var b = bar
    b.index = i
    return b
  }
}

private func buildPalette(_ events: [TabEvent]) -> [PlayableChord] {
  var seen = Set<ChordSymbol>()
  var out: [PlayableChord] = []
  for event in events {
    guard let chord = event.chord else { continue }
    if seen.insert(chord.shapeChord).inserted { out.append(chord) }
  }
  return out
}

/// The repeating progression the song is built on.
///
/// Beginners do not learn a three-minute song; they learn its four-bar loop and
/// then play it twenty times. Surfacing that loop is most of the value of the
/// whole tab.
public func findLoop(_ bars: [TabBar]) -> SongLoop? {
  let signatures = bars.map(\.signature).filter { !$0.isEmpty }
  if signatures.count < 4 { return nil }

  var best: (loop: SongLoop, repeatRatio: Double)?
  for length in [4, 2, 8] {
    // Two bars past the pattern is the least that can confirm it repeats.
    if signatures.count < length + 2 { continue }

    // First-seen order is kept because the winner of a count tie is the window
    // that appeared first, which a hash table would otherwise decide at random.
    var seenOrder: [String] = []
    var firstSeen: [String: Int] = [:]
    var counts: [String: Int] = [:]
    for i in 0...(signatures.count - length) {
      let key = signatures[i..<(i + length)].joined(separator: " | ")
      counts[key, default: 0] += 1
      if firstSeen[key] == nil {
        firstSeen[key] = i
        seenOrder.append(key)
      }
    }
    var topKey = ""
    var topCount = 0
    for k in seenOrder where counts[k]! > topCount {
      topCount = counts[k]!
      topKey = k
    }
    if topKey.isEmpty { continue }

    let start = firstSeen[topKey] ?? 0
    // Recovered from where the window was first seen rather than by splitting
    // the key back apart, which keeps the core free of Foundation and free of
    // any assumption about what a chord label may contain.
    let pattern = Array(signatures[start..<(start + length)])
    func predicts(_ i: Int) -> Bool {
      signatures[i] == pattern[(((i - start) % length) + length) % length]
    }

    // Score the pattern only on the bars it did not come from. Any window
    // trivially matches itself, so counting those would let a song that never
    // repeats at all report a loop, and would let an eight-bar window outscore
    // the four-bar loop it is simply made of.
    var outside = 0
    var outsideMatches = 0
    var total = 0
    for i in signatures.indices {
      if predicts(i) { total += 1 }
      if i >= start && i < start + length { continue }
      outside += 1
      if predicts(i) { outsideMatches += 1 }
    }
    if outside == 0 { continue }
    let repeatRatio = Double(outsideMatches) / Double(outside)

    // Prefer the shortest loop that explains the song; a four-bar answer beats
    // an eight-bar one that is just the same thing said twice.
    let score = repeatRatio + (length == 4 ? 0.05 : 0)
    let bestScore = best.map { $0.repeatRatio + ($0.loop.length == 4 ? 0.05 : 0) } ?? -1
    if score > bestScore {
      best = (
        SongLoop(
          bars: pattern, length: length,
          coverage: Double(total) / Double(signatures.count)), repeatRatio
      )
    }
  }
  guard let best, best.repeatRatio >= 0.6 else { return nil }
  return best.loop
}

/// Six-line tablature rows for one chord shape under a strumming pattern.
public struct TabStrumColumn: Sendable, Hashable {
  public var beat: Double
  public var direction: StrumDirection
  public var accent: Bool
  /// Fret per string, low E first; nil for a string that is not struck.
  public var frets: [Int?]
}

public func strumColumns(chord: PlayableChord, strum: StrumPattern) -> [TabStrumColumn] {
  strum.steps.map { step in
    TabStrumColumn(
      beat: step.beat, direction: step.direction, accent: step.accent,
      frets: chord.shape.frets.map { $0 < 0 ? nil : $0 })
  }
}
