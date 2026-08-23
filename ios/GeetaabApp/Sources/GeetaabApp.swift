import GeetaabCore
import SwiftUI

@main
struct GeetaabApp: App {
  @State private var model = AppModel()

  var body: some Scene {
    WindowGroup {
      RootView()
        .environment(model)
        .environment(\.strings, model.strings)
        .tint(Palette.accent)
    }
  }
}

struct RootView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.strings) private var t

  var body: some View {
    @Bindable var model = model
    ZStack {
      Palette.background.ignoresSafeArea()
      switch model.screen {
      case .home:
        HomeView()
      case .listening:
        ListeningView()
      case .analyzing(let stage, let fraction):
        AnalyzingView(stage: stage, fraction: fraction)
      case .tab:
        TabScreen()
      case .practice:
        PracticeView()
      case .chords:
        ChordLibraryView()
      case .editChords:
        ChordEditorView()
      case .editLyrics:
        LyricsEditorView()
      }
    }
    .animation(.snappy(duration: 0.25), value: model.screen)
    .alert(item: $model.alert) { alert in
      switch alert {
      case .message(let text):
        return Alert(title: Text(text), dismissButton: .default(Text(t.done)))
      case .microphoneDenied:
        return Alert(
          title: Text(t.microphoneNeeded),
          primaryButton: .default(Text(t.openSettings)) { openSettings() },
          secondaryButton: .cancel(Text(t.cancel)))
      }
    }
  }

  private func openSettings() {
    #if os(iOS)
    if let url = URL(string: UIApplication.openSettingsURLString) {
      UIApplication.shared.open(url)
    }
    #endif
  }
}
