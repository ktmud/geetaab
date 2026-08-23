import Foundation
import GeetaabAudio
import GeetaabCore
import Observation
import SwiftUI

/// The recording screen's state, driven by ``MicrophoneRecorder``.
///
/// Every event the recorder can report has somewhere to go here. An
/// interruption, a route change, a stall and a device that will not turn its
/// speech processing off are all things that happen on a phone, and a recorder
/// that says nothing when they do produces a mystery instead of a tab.
@MainActor
@Observable
final class RecordingModel {
  enum Notice: Equatable {
    case none
    case tooLoud
    case veryQuiet
    case hearingRoom
    case headphones
    case ownSpeaker
    case interrupted
    case resumed(seconds: Int)
    case stalled
  }

  var status: RecorderStatus = .waiting
  var level: Double = 0
  var peak: Double = 0
  var chroma: [Float] = Array(repeating: 0, count: 12)
  var chordState: Int = NC_STATE
  var chordScore: Double = 0
  var seconds: Double = 0
  var conditions: CaptureConditions?
  var notice: Notice = .none
  var fatal: String?
  var columns: [[Float]] = []

  /// The last chroma heard while there really was music.
  ///
  /// Bars that keep dancing while nothing musical is being heard read as though
  /// the analysis has found something. When it has not, the last musical
  /// reading is held instead, so the meter stops making a claim it cannot
  /// support.
  private var heldChroma: [Float] = Array(repeating: 0, count: 12)

  private var recorder: MicrophoneRecorder?
  private var onFinished: ((Take) -> Void)?

  let minimumSeconds: Double = 6
  let maximumSeconds: Double = 180
  /// Matches ``SpectrogramImage``'s own cap, so the two cannot disagree.
  static let maxColumns = 4096

  var ready: Bool { seconds >= minimumSeconds }
  var waiting: Bool { status == .waiting }

  /// Whether this instant is worth naming a chord over.
  ///
  /// The floor is ``MUSIC_CHORD_FLOOR`` — the same calibrated cut the music
  /// gate applies to this exact number. The score alone is not enough: a mains
  /// hum is literally a perfect fifth and scores well, and only the gate, which
  /// also watches whether the loudness breathes, knows it is not a song.
  var believable: Bool {
    chordState != NC_STATE && chordScore >= MUSIC_CHORD_FLOOR && status != .waiting
  }

  var displayChroma: [Float] { believable ? chroma : heldChroma }

  var chordLabel: String {
    believable ? stateToChord(chordState).name() : "···"
  }

  func start(onFinished: @escaping (Take) -> Void) async {
    self.onFinished = onFinished
    reset()
    var options = RecorderOptions()
    options.maxSeconds = maximumSeconds
    let recorder = MicrophoneRecorder(options: options) { [weak self] event in
      Task { @MainActor in self?.handle(event) }
    }
    self.recorder = recorder
    do {
      try await recorder.start()
    } catch RecorderError.microphoneDenied {
      fatal = "denied"
    } catch RecorderError.voiceProcessingStuckOn {
      fatal = "voiceProcessing"
    } catch {
      fatal = error.localizedDescription
    }
  }

  func startNow() { recorder?.startNow() }

  /// Throw this take away without leaving the screen.
  ///
  /// Someone who mistimed the start wants another go, not the home screen and
  /// not a second permission prompt, so the engine keeps running and only the
  /// take, the gate and the spectrogram are rebuilt.
  func discard() {
    recorder?.discardTake()
    reset()
  }

  func finish() {
    guard let recorder else { return }
    let take = recorder.stop()
    self.recorder = nil
    onFinished?(take)
  }

  func cancel() {
    recorder?.cancel()
    recorder = nil
    reset()
  }

  private func reset() {
    status = .waiting
    level = 0
    peak = 0
    seconds = 0
    chroma = Array(repeating: 0, count: 12)
    heldChroma = Array(repeating: 0, count: 12)
    chordState = NC_STATE
    chordScore = 0
    notice = .none
    columns = []
  }

  private func handle(_ event: RecorderEvent) {
    switch event {
    case .frame(let frame):
      status = frame.status
      level = frame.level
      peak = frame.peak
      chroma = frame.chroma
      chordState = frame.chordState
      chordScore = frame.chordScore
      seconds = frame.seconds
      if believable { heldChroma = frame.chroma }
      updateNotice()

    case .spectrum(let column):
      // Bounded, but from the end rather than the front: the backdrop tracks
      // how many columns it has already drawn, and dropping the oldest would
      // put that count past the end of the array and freeze the picture for
      // the rest of the take. The longest take this app allows produces well
      // under the cap; past it the backdrop simply stops growing.
      if columns.count < Self.maxColumns { columns.append(column) }

    case .began:
      status = .recording

    case .conditions(let conditions):
      self.conditions = conditions
      updateNotice()

    case .interrupted:
      status = .interrupted
      notice = .interrupted

    case .resumed(let gap):
      status = seconds > 0 ? .recording : .waiting
      notice = .resumed(seconds: Int(gap.rounded()))

    case .stalled:
      notice = .stalled

    case .maxReached:
      finish()

    case .failed(let error):
      switch error {
      case .voiceProcessingStuckOn: fatal = "voiceProcessing"
      case .microphoneDenied: fatal = "denied"
      default: fatal = "\(error)"
      }
    }
  }

  /// One notice at a time, most urgent first.
  ///
  /// Stacking them would bury the one that matters: a player whose headphones
  /// are in does not need to be told the room is quiet as well.
  private func updateNotice() {
    if case .interrupted = notice, status == .interrupted { return }
    if case .resumed = notice { return }
    if case .stalled = notice { return }

    if let conditions {
      if conditions.output == .headphones || conditions.output == .bluetooth {
        notice = .headphones
        return
      }
      if conditions.otherAudioPlaying && conditions.output == .builtInSpeaker {
        notice = .ownSpeaker
        return
      }
    }
    if peak > 0.985 {
      notice = .tooLoud
    } else if level < 0.004 {
      notice = .veryQuiet
    } else if waiting {
      notice = .hearingRoom
    } else {
      notice = .none
    }
  }
}
