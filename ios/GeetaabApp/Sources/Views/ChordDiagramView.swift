import GeetaabCore
import SwiftUI

/// One chord shape, drawn the way a songbook draws it.
///
/// Six strings, four frets, dots where the fingers go and the finger number in
/// each dot — the number is the part a beginner actually needs and the part
/// most apps leave out. A shape that sits up the neck is drawn from its own
/// lowest fret with that fret's number beside it, rather than squeezed onto a
/// diagram that always starts at the nut.
struct ChordDiagramView: View {
  let shape: ChordShape
  var label: String?
  var compact = false

  private var strings: Int { 6 }
  private var frets: Int { 4 }

  /// The fret the diagram starts at. Open shapes start at the nut; anything
  /// higher starts where the hand actually is.
  private var baseFret: Int {
    let lowest = lowestFret(shape)
    let highest = highestFret(shape)
    return highest <= frets ? 1 : max(1, lowest)
  }

  var body: some View {
    VStack(spacing: compact ? 4 : 6) {
      if let label {
        Text(label)
          .font(compact ? .caption.weight(.semibold) : .headline)
          .foregroundStyle(Palette.text)
          .lineLimit(1)
          .minimumScaleFactor(0.6)
      }
      Canvas { context, size in draw(context: context, size: size) }
        .aspectRatio(0.82, contentMode: .fit)
        .accessibilityHidden(true)
      if baseFret > 1 {
        Text("\(baseFret)fr")
          .font(.caption2.monospacedDigit())
          .foregroundStyle(Palette.subtle)
      }
    }
  }

  private func draw(context: GraphicsContext, size: CGSize) {
    let top = size.height * 0.13
    let bottom = size.height * 0.97
    let left = size.width * 0.16
    let right = size.width * 0.92
    let stringGap = (right - left) / CGFloat(strings - 1)
    let fretGap = (bottom - top) / CGFloat(frets)

    // The nut is a thick bar; a diagram that starts up the neck gets a hairline
    // instead, which is the difference between "put your finger at the top of
    // the neck" and "put it wherever this says".
    var nut = Path()
    nut.move(to: CGPoint(x: left, y: top))
    nut.addLine(to: CGPoint(x: right, y: top))
    context.stroke(
      nut, with: .color(Palette.text),
      lineWidth: baseFret == 1 ? max(3, size.height * 0.022) : 1)

    for f in 1...frets {
      var path = Path()
      let y = top + fretGap * CGFloat(f)
      path.move(to: CGPoint(x: left, y: y))
      path.addLine(to: CGPoint(x: right, y: y))
      context.stroke(path, with: .color(Palette.hairline), lineWidth: 1)
    }
    for s in 0..<strings {
      var path = Path()
      let x = left + stringGap * CGFloat(s)
      path.move(to: CGPoint(x: x, y: top))
      path.addLine(to: CGPoint(x: x, y: bottom))
      context.stroke(path, with: .color(Palette.hairline), lineWidth: 1)
    }

    if let barre = shape.barre {
      let offset = barre.fret - baseFret
      if offset >= 0 && offset < frets {
        let y = top + fretGap * (CGFloat(offset) + 0.5)
        let x1 = left + stringGap * CGFloat(barre.from)
        let x2 = left + stringGap * CGFloat(barre.to)
        let rect = CGRect(
          x: x1 - stringGap * 0.28, y: y - fretGap * 0.28,
          width: (x2 - x1) + stringGap * 0.56, height: fretGap * 0.56)
        context.fill(
          Path(roundedRect: rect, cornerRadius: rect.height / 2), with: .color(Palette.text))
      }
    }

    let dotRadius = min(stringGap, fretGap) * 0.33
    for (index, fret) in shape.frets.enumerated() {
      let x = left + stringGap * CGFloat(index)
      if fret < 0 {
        // A muted string is an X above the nut, never a dot: the two mean
        // opposite things and a learner reading fast will not stop to check.
        let r = dotRadius * 0.7
        var cross = Path()
        cross.move(to: CGPoint(x: x - r, y: top - r * 2))
        cross.addLine(to: CGPoint(x: x + r, y: top - r * 0.4))
        cross.move(to: CGPoint(x: x + r, y: top - r * 2))
        cross.addLine(to: CGPoint(x: x - r, y: top - r * 0.4))
        context.stroke(cross, with: .color(Palette.subtle), lineWidth: 1.6)
        continue
      }
      if fret == 0 {
        let r = dotRadius * 0.62
        let rect = CGRect(x: x - r, y: top - r * 2.4, width: r * 2, height: r * 2)
        context.stroke(Path(ellipseIn: rect), with: .color(Palette.subtle), lineWidth: 1.6)
        continue
      }
      let offset = fret - baseFret
      guard offset >= 0 && offset < frets else { continue }
      if let barre = shape.barre, barre.fret == fret, index >= barre.from, index <= barre.to {
        continue  // already drawn as part of the bar
      }
      let y = top + fretGap * (CGFloat(offset) + 0.5)
      let rect = CGRect(
        x: x - dotRadius, y: y - dotRadius, width: dotRadius * 2, height: dotRadius * 2)
      context.fill(Path(ellipseIn: rect), with: .color(Palette.text))
      let finger = shape.fingers.indices.contains(index) ? shape.fingers[index] : 0
      if finger > 0 && !compact {
        context.draw(
          Text("\(finger)")
            .font(.system(size: dotRadius * 1.35, weight: .bold, design: .rounded))
            .foregroundColor(Palette.surface),
          at: CGPoint(x: x, y: y))
      }
    }
  }
}
