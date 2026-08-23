import GeetaabAudio
import GeetaabCore
import SwiftUI

struct ListeningView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.strings) private var t
  @State private var recorder = RecordingModel()
  @State private var backdrop = SpectrogramImage()
  @State private var backdropImage: CGImage?
  @State private var drawnColumns = 0
  @State private var stopping = false

  var body: some View {
    ZStack {
      SpectrogramView(image: backdropImage)
        .opacity(recorder.waiting ? 0 : 0.5)
        .animation(.easeInOut(duration: 0.6), value: recorder.waiting)
        .ignoresSafeArea()

      if let fatal = recorder.fatal {
        FatalNotice(kind: fatal) { model.screen = .home }
      } else {
        content
      }
    }
    .task {
      await recorder.start { take in
        stopping = true
        Task {
          await model.analyse(
            samples: take.samples, sampleRate: take.sampleRate,
            title: defaultTitle(), source: .microphone, gaps: take.gaps)
        }
      }
    }
    .onDisappear { recorder.cancel() }
    .onChange(of: recorder.columns.count) { _, count in
      guard count > drawnColumns else { return }
      for column in recorder.columns[drawnColumns..<count] { backdrop.append(column) }
      drawnColumns = count
      backdropImage = backdrop.makeImage()
    }
  }

  private var content: some View {
    VStack(spacing: 20) {
      Text(recorder.waiting ? t.waitingForSong : t.recording)
        .font(.footnote.weight(.semibold))
        .textCase(.uppercase)
        .kerning(1.2)
        .foregroundStyle(Palette.subtle)

      LevelRing(level: displayLevel, label: recorder.chordLabel, sub: t.hearingNow)
        .frame(width: 220, height: 220)
        .opacity(recorder.waiting ? 0.7 : 1)

      ChromaMeter(values: recorder.displayChroma, dimmed: !recorder.believable)
        .frame(height: 74)
        .overlay {
          if !recorder.believable {
            Text(t.noMusicDetected)
              .font(.footnote.weight(.medium))
              .foregroundStyle(Palette.subtle)
              .padding(.horizontal, 12)
              .padding(.vertical, 6)
              .background(.regularMaterial, in: Capsule())
              .allowsHitTesting(false)
          }
        }

      Timer(seconds: recorder.seconds, live: !recorder.waiting)

      if let notice = noticeText {
        Text(notice)
          .font(.footnote)
          .multilineTextAlignment(.center)
          .foregroundStyle(noticeIsWarning ? Palette.warn : Palette.subtle)
          .padding(.horizontal, 20)
          .frame(maxWidth: 420)
          .transition(.opacity)
      }

      Spacer(minLength: 0)

      controls
        .padding(.horizontal, 24)
    }
    .padding(.top, 24)
    .padding(.bottom, 16)
    .animation(.easeInOut(duration: 0.2), value: recorder.notice)
  }

  @ViewBuilder
  private var controls: some View {
    VStack(spacing: 10) {
      if recorder.waiting {
        Button(t.playTheSong) {}
          .buttonStyle(PrimaryButtonStyle())
          .disabled(true)
          .opacity(0.55)
        Button(t.recordAnyway) { recorder.startNow() }
          .buttonStyle(QuietButtonStyle())
      } else {
        Button {
          stopping = true
          recorder.finish()
        } label: {
          Label(
            stopping
              ? t.workingText
              : (recorder.ready
                ? t.stopBuildTab : t.keepGoing(Int(recorder.minimumSeconds - recorder.seconds))),
            systemImage: "stop.fill")
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(!recorder.ready || stopping)
        .opacity(recorder.ready && !stopping ? 1 : 0.55)
      }

      // Two ways out, deliberately unalike. Throwing the take away only exists
      // while there is something to throw away; leaving is always in the same
      // place.
      HStack(spacing: 8) {
        if !recorder.waiting {
          Button {
            recorder.discard()
            backdrop.reset()
            backdropImage = nil
            drawnColumns = 0
          } label: {
            Label(t.discardTake, systemImage: "trash")
          }
          .buttonStyle(QuietButtonStyle())
          .foregroundStyle(Palette.danger)
          .disabled(stopping)
        }
        Button {
          recorder.cancel()
          model.screen = .home
        } label: {
          Label(t.backHome, systemImage: "chevron.left")
        }
        .buttonStyle(QuietButtonStyle())
      }
    }
  }

  private var displayLevel: Double {
    min(1, (recorder.level * 6).squareRoot())
  }

  private var noticeIsWarning: Bool {
    switch recorder.notice {
    case .tooLoud, .headphones, .interrupted, .stalled: return true
    default: return false
    }
  }

  private var noticeText: String? {
    switch recorder.notice {
    case .none: return nil
    case .tooLoud: return t.tooLoud
    case .veryQuiet: return t.veryQuiet
    case .hearingRoom: return t.hearRoom
    case .headphones: return t.headphonesWarning
    case .ownSpeaker: return t.ownSpeakerWarning
    case .interrupted: return t.interruptedNotice
    case .resumed(let seconds): return t.resumedNotice(seconds)
    case .stalled: return t.stalledNotice
    }
  }

  private func defaultTitle() -> String {
    let formatter = DateFormatter()
    formatter.dateStyle = .medium
    formatter.timeStyle = .short
    return formatter.string(from: Date())
  }
}

/// The input level as a ring, with what the app believes it is hearing inside.
private struct LevelRing: View {
  let level: Double
  let label: String
  let sub: String

  var body: some View {
    ZStack {
      Circle().strokeBorder(Palette.track, lineWidth: 8)
      Circle()
        .trim(from: 0, to: max(0.001, level))
        .stroke(Palette.accent, style: StrokeStyle(lineWidth: 8, lineCap: .round))
        .rotationEffect(.degrees(-90))
        .animation(.linear(duration: 0.12), value: level)
      VStack(spacing: 4) {
        Text(label)
          .font(.system(size: fontSize, weight: .semibold, design: .rounded))
          .monospacedDigit()
          .minimumScaleFactor(0.5)
          .lineLimit(1)
          .foregroundStyle(Palette.text)
        Text(sub)
          .font(.caption2)
          .textCase(.lowercase)
          .foregroundStyle(Palette.subtle)
      }
      .padding(.horizontal, 28)
    }
  }

  /// The vocabulary is twelve roots against seven suffixes, so names run one to
  /// six characters. The longest of them has to fit the ring without the ring
  /// growing, which is what the steps here are for.
  private var fontSize: CGFloat {
    switch label.count {
    case 0...3: return 46
    case 4: return 38
    case 5: return 32
    default: return 27
    }
  }
}

private struct ChromaMeter: View {
  let values: [Float]
  let dimmed: Bool

  var body: some View {
    VStack(spacing: 6) {
      HStack(alignment: .bottom, spacing: 4) {
        ForEach(0..<12, id: \.self) { index in
          let value = Double(values.indices.contains(index) ? values[index] : 0)
          RoundedRectangle(cornerRadius: 2, style: .continuous)
            .fill(pitchColor(index).opacity(value > 0.32 ? 1 : 0.35))
            .frame(height: max(3, min(46, value * 110)))
            .animation(.easeOut(duration: 0.12), value: value)
        }
      }
      .frame(height: 46, alignment: .bottom)

      HStack(spacing: 4) {
        ForEach(0..<12, id: \.self) { index in
          Text(SHARP_NAMES[index])
            .font(.system(size: 9, weight: .medium, design: .rounded))
            .foregroundStyle(
              Double(values.indices.contains(index) ? values[index] : 0) > 0.32
                ? pitchColor(index) : Palette.subtle.opacity(0.5)
            )
            .frame(maxWidth: .infinity)
        }
      }
    }
    .padding(.horizontal, 24)
    .opacity(dimmed ? 0.45 : 1)
  }
}

private struct Timer: View {
  let seconds: Double
  let live: Bool

  var body: some View {
    HStack(spacing: 8) {
      if live {
        Circle().fill(Palette.danger).frame(width: 8, height: 8)
          .opacity(0.9)
          .symbolEffect(.pulse)
      }
      Text(String(format: "%02d:%02d", Int(seconds) / 60, Int(seconds) % 60))
        .font(.system(.title3, design: .monospaced))
        .foregroundStyle(live ? Palette.text : Palette.subtle)
    }
  }
}

private struct FatalNotice: View {
  @Environment(\.strings) private var t
  let kind: String
  let dismiss: () -> Void

  var body: some View {
    VStack(spacing: 16) {
      Image(systemName: "mic.slash").font(.largeTitle).foregroundStyle(Palette.subtle)
      Text(message).multilineTextAlignment(.center).font(.body).foregroundStyle(Palette.text)
      Button(t.backHome, action: dismiss).buttonStyle(PrimaryButtonStyle())
    }
    .padding(28)
    .cardStyle()
    .padding(24)
  }

  private var message: String {
    switch kind {
    case "denied": return t.microphoneNeeded
    case "voiceProcessing": return t.voiceProcessingStuck
    default: return kind
    }
  }
}
