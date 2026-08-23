import SwiftUI

struct AnalyzingView: View {
  @Environment(\.strings) private var t
  let stage: String
  let fraction: Double

  var body: some View {
    VStack(spacing: 22) {
      ProgressView(value: min(1, max(0, fraction)))
        .progressViewStyle(.linear)
        .tint(Palette.accent)
        .frame(maxWidth: 260)
      Text(t.analysing(stage))
        .font(.body.weight(.medium))
        .foregroundStyle(Palette.text)
        .contentTransition(.opacity)
        .animation(.easeInOut, value: stage)
    }
    .padding(32)
  }
}
