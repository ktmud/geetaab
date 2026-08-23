import GeetaabCore
import SwiftUI

struct TabScreen: View {
  @Environment(AppModel.self) private var model
  @Environment(\.strings) private var t
  @State private var renaming = false
  @State private var draftTitle = ""

  private var song: LoadedSong? { model.current }
  private var tab: SongTab? { song?.tab }

  var body: some View {
    NavigationStack {
      ScrollView {
        if let song, let tab {
          VStack(alignment: .leading, spacing: 18) {
            facts(tab)
            if song.levels.count > 1 { levelPicker(song) }
            if let loop = tab.loop { loopCard(loop, tab: tab) }
            barsGrid(tab)
            palette(tab)
            capoPicker(tab)
            strumPicker(tab)
            actions
            Text(t.editsKept)
              .font(.caption)
              .foregroundStyle(Palette.subtle)
              .fixedSize(horizontal: false, vertical: true)
          }
          .padding(20)
        }
      }
      .background(Palette.background)
      .navigationTitle(song?.stored.title ?? "")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarLeading) {
          Button { model.screen = .home } label: { Image(systemName: "chevron.left") }
        }
        ToolbarItem(placement: .topBarTrailing) {
          Button {
            draftTitle = song?.stored.title ?? ""
            renaming = true
          } label: {
            Image(systemName: "square.and.pencil")
          }
        }
      }
      .alert(t.edit, isPresented: $renaming) {
        TextField("", text: $draftTitle)
        Button(t.save) { model.setTitle(draftTitle) }
        Button(t.cancel, role: .cancel) {}
      }
    }
  }

  // MARK: - Pieces

  private func facts(_ tab: SongTab) -> some View {
    HStack(spacing: 0) {
      Fact(label: t.key, value: tab.key.name)
      Divider().frame(height: 30)
      Fact(label: t.tempo, value: "\(Int(tab.tempo.rounded()))")
      Divider().frame(height: 30)
      Fact(label: t.capo, value: tab.capo == 0 ? t.noCapo : "\(tab.capo)")
    }
    .frame(maxWidth: .infinity)
    .cardStyle()
  }

  private func levelPicker(_ song: LoadedSong) -> some View {
    Picker("", selection: Binding(get: { song.level }, set: { model.setLevel($0) })) {
      ForEach(song.levels, id: \.self) { level in
        Text(name(for: level)).tag(level)
      }
    }
    .pickerStyle(.segmented)
  }

  private func name(for level: TabLevel) -> String {
    switch level {
    case .easy: return t.levelEasy
    case .standard: return t.levelStandard
    case .faithful: return t.levelFaithful
    }
  }

  private func loopCard(_ loop: SongLoop, tab: SongTab) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      Text(t.theLoop).font(.footnote.weight(.semibold)).foregroundStyle(Palette.subtle)
      HStack(spacing: 8) {
        ForEach(Array(loop.bars.enumerated()), id: \.offset) { _, bar in
          Text(bar)
            .font(.system(.subheadline, design: .rounded).weight(.semibold))
            .foregroundStyle(Palette.text)
            .frame(maxWidth: .infinity, minHeight: 40)
            .background(Palette.track, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
      }
      Text(t.loopExplains(Int((loop.coverage * 100).rounded())))
        .font(.caption).foregroundStyle(Palette.subtle)
    }
    .cardStyle()
  }

  private func barsGrid(_ tab: SongTab) -> some View {
    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
      ForEach(tab.bars, id: \.index) { bar in
        VStack(spacing: 2) {
          Text(bar.signature.isEmpty ? t.noChordHere : bar.signature)
            .font(.system(.footnote, design: .rounded).weight(.medium))
            .foregroundStyle(Palette.text)
            .lineLimit(1)
            .minimumScaleFactor(0.6)
          Text("\(bar.index + 1)")
            .font(.system(size: 9, design: .monospaced))
            .foregroundStyle(Palette.subtle)
        }
        .frame(maxWidth: .infinity, minHeight: 44)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
          RoundedRectangle(cornerRadius: 8, style: .continuous)
            .strokeBorder(Palette.hairline, lineWidth: 0.5))
      }
    }
  }

  private func palette(_ tab: SongTab) -> some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(alignment: .top, spacing: 14) {
        ForEach(Array(tab.palette.enumerated()), id: \.offset) { _, chord in
          VStack(spacing: 4) {
            ChordDiagramView(shape: chord.shape, label: chord.shapeLabel)
              .frame(width: 78)
            if let original = chord.substitutedFrom {
              Text(t.substitutedFrom(original.name(useFlats: tab.key.useFlats)))
                .font(.system(size: 9))
                .foregroundStyle(Palette.subtle)
                .multilineTextAlignment(.center)
            }
          }
          .frame(width: 86)
        }
      }
      .padding(.vertical, 4)
    }
  }

  private func capoPicker(_ tab: SongTab) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(t.capo).font(.footnote.weight(.semibold)).foregroundStyle(Palette.subtle)
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 8) {
          ForEach(0...7, id: \.self) { fret in
            Button {
              model.setCapo(fret)
            } label: {
              Text(fret == 0 ? t.noCapo : "\(fret)")
                .font(.subheadline.weight(.medium))
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(
                  fret == tab.capo ? Palette.accent : Palette.track,
                  in: Capsule()
                )
                .foregroundStyle(fret == tab.capo ? .white : Palette.text)
            }
          }
        }
      }
    }
  }

  private func strumPicker(_ tab: SongTab) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(t.strum).font(.footnote.weight(.semibold)).foregroundStyle(Palette.subtle)
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 8) {
          ForEach(patternsFor(beatsPerBar: tab.beatsPerBar), id: \.id) { pattern in
            Button {
              model.setStrum(pattern.id)
            } label: {
              VStack(spacing: 3) {
                StrumGlyph(pattern: pattern)
                Text(StrumNames.name(pattern.id, language: t.language))
                  .font(.system(size: 10))
              }
              .padding(.horizontal, 12)
              .padding(.vertical, 8)
              .background(
                pattern.id == tab.strum.id ? Palette.accent.opacity(0.15) : Palette.track,
                in: RoundedRectangle(cornerRadius: 10, style: .continuous)
              )
              .foregroundStyle(Palette.text)
            }
          }
        }
      }
    }
  }

  private var actions: some View {
    VStack(spacing: 10) {
      Button { model.screen = .practice } label: {
        Label(t.practise, systemImage: "play.fill")
      }
      .buttonStyle(PrimaryButtonStyle())

      HStack(spacing: 10) {
        Button { model.screen = .editChords } label: {
          Label(t.editChords, systemImage: "slider.horizontal.3")
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
        Button { model.screen = .editLyrics } label: {
          Label(t.editLyrics, systemImage: "text.quote")
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
      }
    }
  }
}

private struct Fact: View {
  let label: String
  let value: String

  var body: some View {
    VStack(spacing: 2) {
      Text(value).font(.headline).foregroundStyle(Palette.text).lineLimit(1).minimumScaleFactor(0.6)
      Text(label).font(.caption2).foregroundStyle(Palette.subtle)
    }
    .frame(maxWidth: .infinity)
  }
}

/// The pattern as arrows on a bar, which is how it is read on paper.
struct StrumGlyph: View {
  let pattern: StrumPattern

  var body: some View {
    HStack(spacing: 2) {
      ForEach(0..<slots, id: \.self) { slot in
        let beat = Double(slot) / 2
        if let step = pattern.steps.first(where: { abs($0.beat - beat) < 1e-6 }) {
          Image(systemName: step.direction == .down ? "arrow.down" : "arrow.up")
            .font(.system(size: step.accent ? 11 : 9, weight: step.accent ? .bold : .regular))
        } else {
          Text("·").font(.system(size: 9)).foregroundStyle(Palette.subtle)
        }
      }
    }
    .frame(height: 14)
  }

  private var slots: Int { pattern.beatsPerBar * 2 }
}

/// Pattern names, kept out of the engine so the patterns themselves stay free
/// of any one language.
enum StrumNames {
  static func name(_ id: String, language: Language) -> String {
    let en = language == .en
    switch id {
    case "held": return en ? "One per bar" : "一小节一下"
    case "quarters": return en ? "Down on every beat" : "每拍下扫"
    case "eighths": return en ? "Down-up eighths" : "八分下上"
    case "classic": return en ? "D · D U · U D U" : "经典扫弦"
    case "ballad": return en ? "Slow ballad" : "慢抒情"
    case "waltz": return en ? "Waltz" : "华尔兹"
    case "pick-simple": return en ? "Thumb and three" : "拇指加三指"
    case "pick-53231323": return en ? "Eight-note pattern" : "五三二三一三二三"
    case "pick-alternating": return en ? "Alternating bass" : "交替低音"
    default: return id
    }
  }
}
