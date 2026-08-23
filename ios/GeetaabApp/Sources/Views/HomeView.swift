import GeetaabCore
import SwiftUI
import UniformTypeIdentifiers

struct HomeView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.strings) private var t
  @State private var importing = false
  @State private var pendingDelete: SongSummary?

  var body: some View {
    NavigationStack {
      List {
        Section {
          Button {
            model.screen = .listening
          } label: {
            ActionRow(icon: "waveform", title: t.listen, subtitle: t.tagline)
          }
          Button {
            importing = true
          } label: {
            ActionRow(icon: "doc.badge.plus", title: t.importFile, subtitle: t.fileBetterThanMic)
          }
          Button {
            Task { await model.loadDemo() }
          } label: {
            ActionRow(icon: "play.circle", title: t.tryDemo, subtitle: nil)
          }
          Button {
            model.screen = .chords
          } label: {
            ActionRow(icon: "guitars", title: t.chordLibrary, subtitle: nil)
          }
        }

        Section {
          if model.songs.isEmpty {
            Text(t.noSongsYet)
              .font(.subheadline)
              .foregroundStyle(Palette.subtle)
              .padding(.vertical, 8)
          }
          ForEach(model.songs) { song in
            Button { model.open(song) } label: { SongRow(song: song) }
              .swipeActions(edge: .trailing) {
                Button(role: .destructive) { pendingDelete = song } label: {
                  Label(t.delete, systemImage: "trash")
                }
              }
          }
        } header: {
          Text(t.yourSongs)
        } footer: {
          // Said plainly and in the place it matters, because "on device" is a
          // claim people are right to be sceptical of.
          VStack(alignment: .leading, spacing: 4) {
            Text(t.storedLocally)
            if model.storageBytes > 0 {
              Text(t.storageUsed(formatted(model.storageBytes)))
            }
          }
          .font(.caption)
        }
      }
      .listStyle(.insetGrouped)
      .scrollContentBackground(.hidden)
      .background(Palette.background)
      .navigationTitle(t.appName)
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Button {
            model.language = model.language == .en ? .zh : .en
          } label: {
            Text(model.language == .en ? "中" : "EN").font(.subheadline.weight(.semibold))
          }
          .accessibilityLabel(model.language == .en ? "切换到中文" : "Switch to English")
        }
      }
    }
    .fileImporter(isPresented: $importing, allowedContentTypes: [.audio], allowsMultipleSelection: false) { result in
      guard case .success(let urls) = result, let url = urls.first else { return }
      Task { await model.importFile(at: url) }
    }
    .confirmationDialog(
      pendingDelete?.title ?? "", isPresented: .init(
        get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } })
    ) {
      Button(t.delete, role: .destructive) {
        if let pendingDelete { model.delete(pendingDelete) }
        pendingDelete = nil
      }
      Button(t.cancel, role: .cancel) { pendingDelete = nil }
    }
    .onAppear { model.refreshLibrary() }
  }

  private func formatted(_ bytes: Int64) -> String {
    let formatter = ByteCountFormatter()
    formatter.countStyle = .file
    return formatter.string(fromByteCount: bytes)
  }
}

private struct ActionRow: View {
  let icon: String
  let title: String
  let subtitle: String?

  var body: some View {
    HStack(alignment: .top, spacing: 14) {
      Image(systemName: icon)
        .font(.title3)
        .foregroundStyle(Palette.accent)
        .frame(width: 28)
      VStack(alignment: .leading, spacing: 3) {
        Text(title).font(.body.weight(.medium)).foregroundStyle(Palette.text)
        if let subtitle {
          Text(subtitle).font(.caption).foregroundStyle(Palette.subtle)
            .fixedSize(horizontal: false, vertical: true)
        }
      }
      Spacer(minLength: 0)
    }
    .padding(.vertical, 4)
  }
}

private struct SongRow: View {
  @Environment(\.strings) private var t
  let song: SongSummary

  var body: some View {
    HStack(spacing: 12) {
      VStack(alignment: .leading, spacing: 3) {
        HStack(spacing: 6) {
          Text(song.title).font(.body.weight(.medium)).foregroundStyle(Palette.text).lineLimit(1)
          if song.edited {
            Image(systemName: "pencil").font(.caption2).foregroundStyle(Palette.accent)
          }
        }
        Text(detail).font(.caption).foregroundStyle(Palette.subtle)
      }
      Spacer(minLength: 0)
      Image(systemName: icon).font(.caption).foregroundStyle(Palette.subtle)
    }
    .padding(.vertical, 2)
  }

  private var detail: String {
    var parts = [song.keyName, "\(Int(song.tempo.rounded())) BPM"]
    if song.capo > 0 { parts.append(t.fret(song.capo)) }
    parts.append(duration)
    return parts.joined(separator: " · ")
  }

  private var duration: String {
    let total = Int(song.duration.rounded())
    return String(format: "%d:%02d", total / 60, total % 60)
  }

  private var icon: String {
    switch song.source {
    case .microphone: return "mic"
    case .file: return "doc"
    case .demo: return "sparkles"
    }
  }
}
