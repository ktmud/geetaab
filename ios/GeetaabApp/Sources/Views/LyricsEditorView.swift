import GeetaabAudio
import GeetaabCore
import SwiftUI

/// Words first, timing second.
///
/// The two arrive separately in real life: someone pastes a whole song's lyrics
/// in one go, then plays the recording and taps at the start of each line. So
/// the screen is in those two halves rather than asking for a time next to
/// every line, which nobody can supply by typing.
///
/// Timings are seconds into the recording, like every other edit, so a later
/// and better beat grid cannot slide the words off the music.
struct LyricsEditorView: View {
  enum Mode: String, CaseIterable { case write, bind, adjust }

  @Environment(AppModel.self) private var model
  @Environment(\.strings) private var t
  @State private var mode: Mode = .write
  @State private var draft = ""
  @State private var player = PracticePlayer()
  @State private var loaded = false

  private var song: LoadedSong? { model.current }
  private var lines: [LyricLine] { orderedLyrics(song?.stored.edits.lyrics ?? []) }
  private var nextUnbound: LyricLine? { lines.first { !$0.isBound } }

  var body: some View {
    NavigationStack {
      VStack(spacing: 0) {
        Picker("", selection: $mode) {
          Text(t.pasteLyrics).tag(Mode.write)
          Text(t.tapToBind).tag(Mode.bind)
          Text(t.rebind).tag(Mode.adjust)
        }
        .pickerStyle(.segmented)
        .padding(16)

        switch mode {
        case .write: writer
        case .bind: binder
        case .adjust: adjuster
        }
      }
      .background(Palette.background)
      .navigationTitle(t.editLyrics)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarLeading) {
          Button(t.done) {
            commitDraft()
            player.teardown()
            model.screen = .tab
          }
        }
      }
      .onAppear {
        draft = lines.map(\.text).joined(separator: "\n")
      }
      .onChange(of: mode) { _, new in
        if new == .write { draft = lines.map(\.text).joined(separator: "\n") } else { commitDraft() }
        if new != .write { Task { await ensurePlayer() } }
      }
      .onDisappear { player.teardown() }
    }
  }

  // MARK: - Write

  private var writer: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text(t.pasteLyrics).font(.caption).foregroundStyle(Palette.subtle).padding(.horizontal, 16)
      TextEditor(text: $draft)
        .font(.body)
        .scrollContentBackground(.hidden)
        .padding(12)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .padding(.horizontal, 16)
      Spacer(minLength: 0)
    }
    .padding(.bottom, 16)
  }

  /// Turn the pasted block into lines, keeping the timing of any line whose
  /// text is unchanged. Retyping a typo should not cost the whole song's
  /// timing, and it does not here.
  private func commitDraft() {
    let texts = draft.split(separator: "\n", omittingEmptySubsequences: false)
      .map { $0.trimmingCharacters(in: .whitespaces) }
      .filter { !$0.isEmpty }
    guard !texts.isEmpty || !lines.isEmpty else { return }

    var remaining = song?.stored.edits.lyrics ?? []
    var rebuilt: [LyricLine] = []
    for text in texts {
      if let index = remaining.firstIndex(where: { $0.text == text }) {
        rebuilt.append(remaining.remove(at: index))
      } else {
        rebuilt.append(LyricLine(id: UUID().uuidString, text: text))
      }
    }
    guard rebuilt.map(\.text) != lines.map(\.text) || rebuilt.count != lines.count else { return }
    model.applyEdits { $0.lyrics = rebuilt }
  }

  // MARK: - Bind

  private var binder: some View {
    VStack(spacing: 18) {
      TimelineView(.animation(minimumInterval: 1.0 / 20)) { _ in
        VStack(spacing: 6) {
          Text(clock(player.currentTime))
            .font(.system(.title3, design: .monospaced)).foregroundStyle(Palette.subtle)
          if let current = lyricLine(at: player.currentTime, in: lines) {
            Text(current.text).font(.headline).foregroundStyle(Palette.subtle).lineLimit(1)
          }
        }
      }

      Text(nextUnbound?.text ?? "—")
        .font(.title.weight(.medium))
        .multilineTextAlignment(.center)
        .foregroundStyle(nextUnbound == nil ? Palette.subtle : Palette.text)
        .frame(maxWidth: .infinity, minHeight: 90)
        .padding(.horizontal, 20)

      Text(t.tapToBind).font(.caption).foregroundStyle(Palette.subtle)

      // One enormous target, because the whole interaction is done while
      // looking at the words rather than at the button.
      Button {
        bindNext()
      } label: {
        Image(systemName: "hand.tap.fill")
          .font(.system(size: 34))
          .frame(maxWidth: .infinity)
          .frame(height: 110)
      }
      .buttonStyle(PrimaryButtonStyle())
      .disabled(nextUnbound == nil)
      .opacity(nextUnbound == nil ? 0.4 : 1)
      .padding(.horizontal, 20)

      HStack(spacing: 14) {
        Button {
          if player.isPlaying { player.pause() } else { try? player.play() }
        } label: {
          Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
        }
        .buttonStyle(.bordered)
        Button { player.seek(to: max(0, player.currentTime - 5)) } label: {
          Image(systemName: "gobackward.5")
        }
        .buttonStyle(.bordered)
        Button { player.seek(to: 0) } label: { Image(systemName: "backward.end.fill") }
          .buttonStyle(.bordered)
      }
      Spacer(minLength: 0)
    }
    .padding(.vertical, 12)
  }

  private func bindNext() {
    guard let next = nextUnbound else { return }
    let at = player.currentTime
    model.applyEdits { edits in
      if let index = edits.lyrics.firstIndex(where: { $0.id == next.id }) {
        edits.lyrics[index].at = at
      }
    }
  }

  // MARK: - Adjust

  private var adjuster: some View {
    List {
      ForEach(lines) { line in
        HStack(spacing: 10) {
          Text(line.at.map(clock) ?? t.unbound)
            .font(.system(.caption, design: .monospaced))
            .foregroundStyle(line.isBound ? Palette.accent : Palette.subtle)
            .frame(width: 62, alignment: .leading)
          Text(line.text).font(.subheadline).foregroundStyle(Palette.text).lineLimit(1)
          Spacer(minLength: 0)
          if line.isBound {
            Button { nudge(line, by: -0.15) } label: { Image(systemName: "minus") }
              .buttonStyle(.borderless)
            Button { nudge(line, by: 0.15) } label: { Image(systemName: "plus") }
              .buttonStyle(.borderless)
            Button { player.seek(to: max(0, (line.at ?? 0) - 1)) } label: {
              Image(systemName: "play.circle")
            }
            .buttonStyle(.borderless)
          }
        }
        .swipeActions(edge: .trailing) {
          Button(role: .destructive) { unbind(line) } label: {
            Label(t.rebind, systemImage: "arrow.uturn.backward")
          }
        }
      }
    }
    .listStyle(.plain)
    .scrollContentBackground(.hidden)
  }

  private func nudge(_ line: LyricLine, by delta: Double) {
    model.applyEdits { edits in
      guard let index = edits.lyrics.firstIndex(where: { $0.id == line.id }),
        let at = edits.lyrics[index].at
      else { return }
      edits.lyrics[index].at = max(0, at + delta)
    }
  }

  private func unbind(_ line: LyricLine) {
    model.applyEdits { edits in
      guard let index = edits.lyrics.firstIndex(where: { $0.id == line.id }) else { return }
      edits.lyrics[index].at = nil
    }
  }

  // MARK: - Audio

  private func ensurePlayer() async {
    guard let song, !loaded else { return }
    loaded = true
    var samples = song.samples
    var rate = song.sampleRate
    if samples == nil, let audio = try? SongStore.shared.readAudio(for: song.stored.id), let audio {
      samples = audio.samples
      rate = audio.sampleRate
    }
    guard let samples else { return }
    try? player.load(samples: samples, sampleRate: rate)
  }

  private func clock(_ time: Double) -> String {
    String(format: "%d:%02d.%01d", Int(time) / 60, Int(time) % 60, Int((time * 10).truncatingRemainder(dividingBy: 10)))
  }
}
