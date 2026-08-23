#if canImport(AVFoundation)
import AVFoundation
import Foundation
import GeetaabCore

/// Playback for the practice screen: the take itself, slowed down if the player
/// wants it slower, with an optional click on the beat grid.
///
/// Rate changes go through `AVAudioUnitTimePitch` rather than through the
/// sample rate, so a song taken to half speed to learn a change stays in the
/// key the tab is written in. A pitch-shifted slowdown would make every chord
/// diagram on the screen a lie.
public final class PracticePlayer: @unchecked Sendable {
  private let engine = AVAudioEngine()
  private let player = AVAudioPlayerNode()
  private let click = AVAudioPlayerNode()
  private let timePitch = AVAudioUnitTimePitch()

  private var buffer: AVAudioPCMBuffer?
  private var clickBuffer: AVAudioPCMBuffer?
  private var clickAccent: AVAudioPCMBuffer?
  private var startOffset: Double = 0
  private var running = false
  private var sessionToken: AudioSessionController.ObservationToken?
  private var wasPlayingBeforeInterruption = false

  public private(set) var duration: Double = 0
  public var beats: [Double] = []
  public var beatsPerBar: Int = 4
  public var barPhase: Int = 0
  public var clickEnabled = false

  public init() {}

  public var rate: Float {
    get { timePitch.rate }
    set { timePitch.rate = min(2, max(0.25, newValue)) }
  }

  public var volume: Float {
    get { player.volume }
    set { player.volume = min(1, max(0, newValue)) }
  }

  public var isPlaying: Bool { player.isPlaying }

  /// Seconds into the recording, in the recording's own timeline — so a tab
  /// cursor reads the same at half speed as at full speed.
  public var currentTime: Double {
    guard let nodeTime = player.lastRenderTime,
      let playerTime = player.playerTime(forNodeTime: nodeTime)
    else { return startOffset }
    let elapsed = Double(playerTime.sampleTime) / playerTime.sampleRate
    return min(duration, max(0, startOffset + elapsed))
  }

  // MARK: - Loading

  public func load(samples: [Float], sampleRate: Double) throws {
    guard
      let format = AVAudioFormat(
        commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 1, interleaved: false),
      let buffer = AVAudioPCMBuffer(
        pcmFormat: format, frameCapacity: AVAudioFrameCount(max(1, samples.count)))
    else {
      throw RecorderError.engineFailed("could not make a playback buffer")
    }
    buffer.frameLength = AVAudioFrameCount(samples.count)
    samples.withUnsafeBufferPointer { src in
      buffer.floatChannelData![0].update(from: src.baseAddress!, count: samples.count)
    }
    self.buffer = buffer
    self.duration = Double(samples.count) / sampleRate
    self.clickBuffer = Self.makeClick(format: format, frequency: 1600, seconds: 0.035, amplitude: 0.35)
    self.clickAccent = Self.makeClick(format: format, frequency: 2200, seconds: 0.045, amplitude: 0.5)
    try build(format: format)
  }

  private func build(format: AVAudioFormat) throws {
    if running { teardown() }
    engine.attach(player)
    engine.attach(click)
    engine.attach(timePitch)
    engine.connect(player, to: timePitch, format: format)
    engine.connect(timePitch, to: engine.mainMixerNode, format: format)
    engine.connect(click, to: engine.mainMixerNode, format: format)
    try AudioSessionController.shared.beginPlayback()
    engine.prepare()
    try engine.start()
    running = true
    observeSession()
  }

  // MARK: - Transport

  public func play() throws {
    guard let buffer else { return }
    if !engine.isRunning { try engine.start() }
    schedule(from: startOffset, buffer: buffer)
    player.play()
    if clickEnabled { scheduleClicks(from: startOffset) }
  }

  public func pause() {
    startOffset = currentTime
    player.stop()
    click.stop()
  }

  public func seek(to seconds: Double) {
    let wasPlaying = player.isPlaying
    player.stop()
    click.stop()
    startOffset = min(duration, max(0, seconds))
    if wasPlaying { try? play() }
  }

  private func schedule(from seconds: Double, buffer: AVAudioPCMBuffer) {
    let rate = buffer.format.sampleRate
    let start = AVAudioFramePosition(seconds * rate)
    let remaining = AVAudioFrameCount(max(0, Int(buffer.frameLength) - Int(start)))
    guard remaining > 0 else { return }
    player.scheduleSegment(
      buffer, startingFrame: start, frameCount: remaining, at: nil, completionHandler: nil)
  }

  /// One click per beat from `seconds` onward, laid on the analysis's own grid
  /// rather than on a metronome of its own, so the click and the tab cursor
  /// cannot drift apart.
  private func scheduleClicks(from seconds: Double) {
    guard let plain = clickBuffer, let accent = clickAccent, !beats.isEmpty else { return }
    guard let start = player.lastRenderTime, start.isSampleTimeValid else { return }
    let rate = start.sampleRate
    click.play()
    for (index, beat) in beats.enumerated() where beat >= seconds {
      let ahead = (beat - seconds) / Double(max(0.01, timePitch.rate))
      let when = AVAudioTime(
        sampleTime: start.sampleTime + AVAudioFramePosition(ahead * rate), atRate: rate)
      let downbeat = beatsPerBar > 0 && (index - barPhase) % beatsPerBar == 0
      click.scheduleBuffer(downbeat ? accent : plain, at: when, options: [], completionHandler: nil)
    }
  }

  private static func makeClick(
    format: AVAudioFormat, frequency: Double, seconds: Double, amplitude: Double
  ) -> AVAudioPCMBuffer? {
    let frames = Int(seconds * format.sampleRate)
    guard frames > 0,
      let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frames))
    else { return nil }
    buffer.frameLength = AVAudioFrameCount(frames)
    let data = buffer.floatChannelData![0]
    for i in 0..<frames {
      let t = Double(i) / format.sampleRate
      // A short decaying sine: audible over a strummed guitar without the
      // click itself reading as part of the music.
      data[i] = Float(amplitude * exp(-t * 90) * sin(2 * Double.pi * frequency * t))
    }
    return buffer
  }

  // MARK: - Interruptions

  private func observeSession() {
    sessionToken = AudioSessionController.shared.observe { [weak self] event in
      guard let self else { return }
      switch event {
      case .interrupted:
        self.wasPlayingBeforeInterruption = self.player.isPlaying
        self.pause()
      case .interruptionEnded(let shouldResume):
        guard shouldResume, self.wasPlayingBeforeInterruption else { return }
        try? AudioSessionController.shared.beginPlayback()
        try? self.play()
      case .mediaServicesReset:
        // Nothing the engine holds survives this; the samples do.
        self.pause()
        if let buffer = self.buffer {
          try? self.build(format: buffer.format)
        }
      case .routeChanged:
        break
      }
    }
  }

  public func teardown() {
    player.stop()
    click.stop()
    engine.stop()
    for node in [player, click, timePitch] as [AVAudioNode] where engine.attachedNodes.contains(node) {
      engine.detach(node)
    }
    sessionToken = nil
    running = false
  }

  deinit { teardown() }
}
#endif
