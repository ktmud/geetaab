import GeetaabCore
import SwiftUI

/// Fix a chord the app got wrong.
///
/// The list is what was heard; a change writes an entry into the overlay rather
/// than into the analysis, so a better pipeline later can be applied to this
/// song without throwing the correction away — and, when the pipeline catches
/// up, the correction retires itself.
struct ChordEditorView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.strings) private var t
  @State private var editing: TabEvent?

  private var song: LoadedSong? { model.current }
  private var tab: SongTab? { song?.tab }

  var body: some View {
    NavigationStack {
      List {
        Section {
          ForEach(Array((tab?.events ?? []).enumerated()), id: \.offset) { _, event in
            Button { editing = event } label: {
              HStack {
                Text(clock(event.startTime))
                  .font(.system(.caption, design: .monospaced))
                  .foregroundStyle(Palette.subtle)
                  .frame(width: 52, alignment: .leading)
                Text(event.chord?.label ?? t.noChordHere)
                  .font(.body.weight(.medium))
                  .foregroundStyle(Palette.text)
                if isEdited(event) {
                  Image(systemName: "pencil").font(.caption2).foregroundStyle(Palette.accent)
                }
                Spacer()
                Text("\(event.endBeat - event.startBeat)♩")
                  .font(.caption).foregroundStyle(Palette.subtle)
              }
            }
          }
        } footer: {
          Text(t.editsKept).font(.caption)
        }

        if let edits = song?.stored.edits, !edits.chords.isEmpty {
          Section {
            ForEach(edits.chords) { edit in
              HStack {
                Text(clock(edit.start))
                  .font(.system(.caption, design: .monospaced))
                  .foregroundStyle(Palette.subtle)
                Text(edit.chord?.name() ?? t.noChordHere)
                Spacer()
                Button(role: .destructive) {
                  model.applyEdits { $0.chords.removeAll { $0.id == edit.id } }
                } label: {
                  Image(systemName: "arrow.uturn.backward")
                }
                .buttonStyle(.borderless)
              }
            }
          } header: {
            Text(t.editedCount(edits.chords.count))
          }
        }
      }
      .listStyle(.insetGrouped)
      .scrollContentBackground(.hidden)
      .background(Palette.background)
      .navigationTitle(t.editChords)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarLeading) {
          Button(t.done) { model.screen = .tab }
        }
      }
      .sheet(item: $editing) { event in
        ChordPicker(event: event) { chord in
          model.applyEdits { edits in
            edits.chords.append(
              ChordEdit(
                id: UUID().uuidString, start: event.startTime, end: event.endTime, chord: chord,
                replaced: event.chord?.sounding))
          }
          editing = nil
        }
      }
    }
  }

  private func isEdited(_ event: TabEvent) -> Bool {
    guard let edits = song?.stored.edits.chords else { return false }
    let middle = (event.startTime + event.endTime) / 2
    return edits.contains { $0.start <= middle && middle < $0.end }
  }

  private func clock(_ time: Double) -> String {
    String(format: "%d:%02d", Int(time) / 60, Int(time) % 60)
  }
}

extension TabEvent: Identifiable {
  public var id: String { "\(startBeat)-\(endBeat)-\(startTime)" }
}

private struct ChordPicker: View {
  @Environment(\.strings) private var t
  @Environment(\.dismiss) private var dismiss
  let event: TabEvent
  let choose: (ChordSymbol?) -> Void

  @State private var root = 0
  @State private var quality: ChordQuality = .maj

  var body: some View {
    NavigationStack {
      VStack(spacing: 20) {
        Picker("", selection: $root) {
          ForEach(0..<12, id: \.self) { pc in Text(SHARP_NAMES[pc]).tag(pc) }
        }
        .pickerStyle(.wheel)
        .frame(height: 110)

        Picker("", selection: $quality) {
          ForEach(QUALITIES, id: \.self) { q in
            Text(ChordSymbol(root: root, quality: q).name()).tag(q)
          }
        }
        .pickerStyle(.segmented)

        if let shape = easiestShape(ChordSymbol(root: root, quality: quality)) {
          ChordDiagramView(shape: shape, label: ChordSymbol(root: root, quality: quality).name())
            .frame(width: 110)
        }

        Spacer()

        Button(t.save) { choose(ChordSymbol(root: root, quality: quality)) }
          .buttonStyle(PrimaryButtonStyle())
        // "Nothing is played here" is a judgement the analysis cannot make for
        // itself, so it needs its own way in.
        Button(t.noChordHere) { choose(nil) }
          .buttonStyle(QuietButtonStyle())
      }
      .padding(20)
      .background(Palette.background)
      .navigationTitle(t.editChords)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarLeading) { Button(t.cancel) { dismiss() } }
      }
      .onAppear {
        if let sounding = event.chord?.sounding, sounding.root >= 0 {
          root = sounding.root
          quality = sounding.quality
        }
      }
    }
    .presentationDetents([.medium, .large])
  }
}
