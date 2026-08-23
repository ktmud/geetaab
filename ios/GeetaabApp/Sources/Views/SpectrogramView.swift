import CoreGraphics
import GeetaabCore
import SwiftUI

/// The take so far, painted behind the recording screen.
///
/// One pixel column per capture chunk, one row per semitone. Kept as a raw
/// pixel buffer rather than redrawn as shapes: a three-minute take is nearly
/// two thousand columns of seventy-six bins, and asking a `Canvas` to fill a
/// hundred and forty thousand rectangles ten times a second would cost more
/// than the analysis it is decorating. Appending a column here writes
/// seventy-six pixels.
@MainActor
final class SpectrogramImage {
  private let maxColumns: Int
  private let rows = SPECTRO_BINS
  private var pixels: [UInt8]
  private(set) var columns = 0

  init(maxColumns: Int = RecordingModel.maxColumns) {
    self.maxColumns = maxColumns
    self.pixels = [UInt8](repeating: 0, count: maxColumns * SPECTRO_BINS * 4)
  }

  func reset() {
    columns = 0
    for i in pixels.indices { pixels[i] = 0 }
  }

  func append(_ column: [Float]) {
    guard columns < maxColumns, column.count >= rows else { return }
    let x = columns
    let stride = maxColumns * 4
    for row in 0..<rows {
      // Row 0 is the top of the image, so the highest semitone is drawn first
      // and pitch runs the way a stave does.
      let value = Double(column[rows - 1 - row])
      let (r, g, b, a) = Self.colour(for: value, bin: rows - 1 - row)
      let offset = row * stride + x * 4
      pixels[offset] = r
      pixels[offset + 1] = g
      pixels[offset + 2] = b
      pixels[offset + 3] = a
    }
    columns += 1
  }

  /// Pitch-class colour at an intensity, so a held chord reads as bands of one
  /// hue climbing the octaves rather than as an undifferentiated smear.
  private static func colour(for value: Double, bin: Int) -> (UInt8, UInt8, UInt8, UInt8) {
    let v = min(1, max(0, value))
    if v < 0.02 { return (0, 0, 0, 0) }
    let pc = (SPECTRO_MIN_MIDI + bin) % 12
    let hue = pitchClassHue(pc) / 360
    let colour = UIColor(hue: hue, saturation: 0.55, brightness: 0.55 + 0.45 * v, alpha: 1)
    var r: CGFloat = 0
    var g: CGFloat = 0
    var b: CGFloat = 0
    var a: CGFloat = 0
    colour.getRed(&r, green: &g, blue: &b, alpha: &a)
    let alpha = UInt8(min(255, max(0, v * 210)))
    // Premultiplied, which is what CGImage wants for this pixel format.
    let scale = Double(alpha) / 255
    return (
      UInt8(Double(r) * 255 * scale), UInt8(Double(g) * 255 * scale),
      UInt8(Double(b) * 255 * scale), alpha
    )
  }

  func makeImage() -> CGImage? {
    guard columns > 0 else { return nil }
    let bytesPerRow = maxColumns * 4
    return pixels.withUnsafeBufferPointer { buffer -> CGImage? in
      guard let provider = CGDataProvider(data: Data(buffer: buffer) as CFData) else { return nil }
      return CGImage(
        width: columns, height: rows, bitsPerComponent: 8, bitsPerPixel: 32,
        bytesPerRow: bytesPerRow, space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
        provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent)
    }
  }
}

struct SpectrogramView: View {
  let image: CGImage?

  var body: some View {
    GeometryReader { geometry in
      if let image {
        Image(decorative: image, scale: 1, orientation: .up)
          .resizable()
          .interpolation(.medium)
          .frame(width: geometry.size.width, height: geometry.size.height)
          .blur(radius: 0.5)
      }
    }
    .allowsHitTesting(false)
  }
}
