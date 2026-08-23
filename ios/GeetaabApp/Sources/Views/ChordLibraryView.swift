import AVFoundation
import GeetaabAudio
import GeetaabCore
import SwiftUI

/// Every shape the app can print, with a strum of the exact fingering behind
/// each one — the same frets the diagram shows, in the same octaves, so a
/// learner checking their own hand against it hears what they are looking at.
struct ChordLibraryView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.strings) private var t
  @State private var root = 0
  @State private var player = PracticePlayer()

  private let qualities: [ChordQuality] = QUALITIES

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 18) {
          Picker("", selection: $root) {
            ForEach(0..<12, id: \.self) { pc in Text(SHARP_NAMES[pc]).tag(pc) }
          }
          .pickerStyle(.segmented)

          LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(), spacing: 14), count: 3), spacing: 20
          ) {
            ForEach(qualities, id: \.self) { quality in
              let chord = ChordSymbol(root: root, quality: quality)
              if let shape = easiestShape(chord) {
                Button {
                  play(shape)
                } label: {
                  VStack(spacing: 4) {
                    ChordDiagramView(shape: shape, label: chord.name())
                    if let note = shape.note { Text(hint(note)).font(.system(size: 9)).foregroundStyle(Palette.subtle) }
                  }
                }
                .buttonStyle(.plain)
              }
            }
          }
        }
        .padding(20)
      }
      .background(Palette.background)
      .navigationTitle(t.chordLibrary)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarLeading) {
          Button { model.screen = .home } label: { Image(systemName: "chevron.left") }
        }
      }
    }
    .onDisappear { player.teardown() }
  }

  private func hint(_ note: ShapeNote) -> String {
    let en = t.language == .en
    switch note {
    case .fourStringF:
      return en ? "four strings, no barre" : "只按四根弦，不用横按"
    case .barre(let family, let fret):
      return en ? "\(family)-shape barre at \(fret)" : "\(family) 型横按，\(fret) 品"
    }
  }

  private func play(_ shape: ChordShape) {
    let samples = renderShapeStrum(frets: shape.frets, sampleRate: 44100)
    try? player.load(samples: samples, sampleRate: 44100)
    player.seek(to: 0)
    try? player.play()
  }
}
