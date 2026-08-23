import GeetaabCore
import SwiftUI

/// The palette, defined once so light and dark are decided in one place rather
/// than argued about per view.
enum Palette {
  static let background = Color(light: .init(white: 0.98), dark: .init(white: 0.07))
  static let surface = Color(light: .init(white: 1.0), dark: .init(white: 0.12))
  static let text = Color(light: .init(white: 0.11), dark: .init(white: 0.95))
  static let subtle = Color(light: .init(white: 0.42), dark: .init(white: 0.62))
  static let hairline = Color(light: .init(white: 0.87), dark: .init(white: 0.22))
  static let accent = Color(red: 0.85, green: 0.42, blue: 0.16)
  static let track = Color(light: .init(white: 0.90), dark: .init(white: 0.20))
  static let warn = Color(red: 0.78, green: 0.55, blue: 0.10)
  static let danger = Color(red: 0.80, green: 0.24, blue: 0.20)
}

extension Color {
  /// A colour that resolves per appearance without a colour asset for each one.
  init(light: UIColor, dark: UIColor) {
    self.init(
      uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark ? dark : light
      })
  }
}

/// Hue for a pitch class, so a chord keeps its colour everywhere it appears.
///
/// Walking the circle of fifths rather than the chromatic scale: neighbouring
/// hues then belong to chords that actually sit next to each other in a song,
/// which is what makes a progression read as a gradient rather than as noise.
func pitchClassHue(_ pc: Int) -> Double {
  let fifths = ((pc * 7) % 12 + 12) % 12
  return Double(fifths) * 30
}

func pitchColor(_ pc: Int, saturation: Double = 0.55, brightness: Double = 0.85) -> Color {
  Color(hue: pitchClassHue(pc) / 360, saturation: saturation, brightness: brightness)
}

extension View {
  func cardStyle() -> some View {
    self
      .padding(16)
      .background(Palette.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
      .overlay(
        RoundedRectangle(cornerRadius: 16, style: .continuous)
          .strokeBorder(Palette.hairline, lineWidth: 0.5))
  }
}

/// A large, unmistakable primary action. The recording screen has exactly one
/// at a time, and it is always in the same place.
struct PrimaryButtonStyle: ButtonStyle {
  var tint: Color = Palette.accent

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.headline)
      .foregroundStyle(.white)
      .frame(maxWidth: .infinity)
      .padding(.vertical, 16)
      .background(tint.opacity(configuration.isPressed ? 0.8 : 1), in: Capsule())
      .contentShape(Capsule())
  }
}

struct QuietButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.subheadline.weight(.medium))
      .foregroundStyle(Palette.subtle)
      .padding(.vertical, 10)
      .padding(.horizontal, 16)
      .background(configuration.isPressed ? Palette.track : .clear, in: Capsule())
      .contentShape(Capsule())
  }
}
