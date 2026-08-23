import GeetaabAudio
import GeetaabCore
import SwiftUI

/// Play along with the recording, with the chord you are on kept large and the
/// next one already in sight.
///
/// Timing comes from the player's own clock rather than from a timer running
/// alongside it. A separate timer drifts against the audio within a minute,
/// and a chord cursor that is half a beat late is worse than no cursor.
struct PracticeView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.strings) private var t
  @State private var player = PracticePlayer()
  @State private var loaded = false
  @State private var loadError: String?
  @State private var rate: Double = 1
  @State private var click = false

  private var song: LoadedSong? { model.current }
  private var tab: SongTab? { song?.tab }

  var body: some View {
    ZStack {
      Palette.background.ignoresSafeArea()
      if let tab {
        TimelineView(.animation(minimumInterval: 1.0 / 30)) { _ in
          content(tab: tab, time: player.currentTime)
        }
      }
      if let loadError {
        VStack(spacing: 14) {
          Text(loadError).multilineTextAlignment(.center).foregroundStyle(Palette.text)
          Button(t.back) { model.screen = .tab }.buttonStyle(PrimaryButtonStyle())
        }
        .padding(28).cardStyle().padding(30)
      }
    }
    .task { await load() }
    .onDisappear { player.teardown() }
    .statusBarHidden()
  }

  private func content(tab: SongTab, time: Double) -> some View {
    let events = tab.events
    let index = events.lastIndex { $0.startTime <= time } ?? 0
    let current = events.indices.contains(index) ? events[index] : nil
    let next = events.indices.contains(index + 1) ? events[index + 1] : nil
    let lyric = lyricLine(at: time, in: song?.stored.edits.lyrics ?? [])

    return VStack(spacing: 0) {
      HStack {
        Button { model.screen = .tab } label: { Image(systemName: "chevron.left") }
          .buttonStyle(QuietButtonStyle())
        Spacer()
        Text(clock(time)).font(.system(.footnote, design: .monospaced))
          .foregroundStyle(Palette.subtle)
      }
      .padding(.horizontal, 16)

      Spacer(minLength: 0)

      HStack(alignment: .center, spacing: 28) {
        if let chord = current?.chord {
          VStack(spacing: 8) {
            ChordDiagramView(shape: chord.shape, label: chord.shapeLabel)
              .frame(width: 150)
            if let numeral = current?.numeral {
              Text(numeral).font(.caption).foregroundStyle(Palette.subtle)
            }
          }
        } else {
          Text(t.noChordHere).font(.largeTitle).foregroundStyle(Palette.subtle).frame(width: 150)
        }

        VStack(alignment: .leading, spacing: 14) {
          if let lyric {
            Text(lyric.text)
              .font(.title2.weight(.medium))
              .foregroundStyle(Palette.text)
              .lineLimit(2)
              .minimumScaleFactor(0.6)
          }
          if let next {
            HStack(spacing: 8) {
              Text("→").foregroundStyle(Palette.subtle)
              if let chord = next.chord {
                ChordDiagramView(shape: chord.shape, label: chord.shapeLabel, compact: true)
                  .frame(width: 62)
              } else {
                Text(t.noChordHere).font(.caption).foregroundStyle(Palette.subtle)
              }
              Text(countdown(to: next.startTime, from: time, tab: tab))
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(Palette.subtle)
            }
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      .padding(.horizontal, 28)

      Spacer(minLength: 0)

      ChordStrip(events: events, time: time, duration: tab.duration) { player.seek(to: $0) }
        .frame(height: 44)
        .padding(.horizontal, 16)

      transport
        .padding(.horizontal, 16)
        .padding(.bottom, 10)
    }
    .padding(.top, 8)
  }

  private var transport: some View {
    HStack(spacing: 18) {
      Button {
        if player.isPlaying { player.pause() } else { try? player.play() }
      } label: {
        Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
          .font(.title2)
          .frame(width: 52, height: 52)
          .background(Palette.accent, in: Circle())
          .foregroundStyle(.white)
      }

      VStack(alignment: .leading, spacing: 2) {
        Text("\(t.speed) \(Int(rate * 100))%")
          .font(.caption2).foregroundStyle(Palette.subtle)
        Slider(value: $rate, in: 0.5...1.0, step: 0.05)
          .onChange(of: rate) { _, value in player.rate = Float(value) }
      }
      .frame(maxWidth: 220)

      Toggle(isOn: $click) { Text(t.click).font(.caption) }
        .toggleStyle(.button)
        .onChange(of: click) { _, value in player.clickEnabled = value }
    }
  }

  private func load() async {
    guard let song, !loaded else { return }
    loaded = true
    var samples = song.samples
    var rate = song.sampleRate
    if samples == nil {
      if let audio = try? SongStore.shared.readAudio(for: song.stored.id), let audio {
        samples = audio.samples
        rate = audio.sampleRate
      }
    }
    guard let samples else {
      loadError = t.analysisFailed
      return
    }
    do {
      try player.load(samples: samples, sampleRate: rate)
      player.beats = song.stored.analysis.beats
      player.beatsPerBar = song.stored.analysis.beatsPerBar
      player.barPhase = song.stored.analysis.barPhase
      try player.play()
    } catch {
      loadError = error.localizedDescription
    }
  }

  private func clock(_ time: Double) -> String {
    String(format: "%d:%02d", Int(time) / 60, Int(time) % 60)
  }

  /// How long until the change, counted in beats rather than seconds — that is
  /// the unit a player is already counting in.
  private func countdown(to target: Double, from time: Double, tab: SongTab) -> String {
    let beatSeconds = 60 / max(1, tab.tempo)
    let beats = max(0, (target - time) / beatSeconds)
    return beats < 0.5 ? "now" : String(format: "%.0f", beats.rounded())
  }
}

/// The whole song as a bar of chords, with the playhead on it. Tapping seeks,
/// which is how someone drills one change twenty times.
private struct ChordStrip: View {
  let events: [TabEvent]
  let time: Double
  let duration: Double
  let seek: (Double) -> Void

  var body: some View {
    GeometryReader { geometry in
      let width = geometry.size.width
      ZStack(alignment: .leading) {
        ForEach(Array(events.enumerated()), id: \.offset) { _, event in
          let x = CGFloat(event.startTime / max(1, duration)) * width
          let w = max(2, CGFloat((event.endTime - event.startTime) / max(1, duration)) * width - 1)
          RoundedRectangle(cornerRadius: 3, style: .continuous)
            .fill(colour(for: event))
            .frame(width: w, height: 30)
            .overlay(alignment: .leading) {
              if w > 26, let label = event.chord?.shapeLabel {
                Text(label).font(.system(size: 9, weight: .medium)).foregroundStyle(Palette.text)
                  .padding(.leading, 3).lineLimit(1)
              }
            }
            .offset(x: x)
        }
        Rectangle()
          .fill(Palette.accent)
          .frame(width: 2, height: 40)
          .offset(x: CGFloat(time / max(1, duration)) * width)
      }
      .frame(height: 44)
      .contentShape(Rectangle())
      .gesture(
        DragGesture(minimumDistance: 0).onEnded { value in
          seek(Double(value.location.x / width) * duration)
        })
    }
  }

  private func colour(for event: TabEvent) -> Color {
    guard let root = event.chord?.sounding.root, root >= 0 else { return Palette.track }
    return pitchColor(root, saturation: 0.4, brightness: 0.9).opacity(0.65)
  }
}
