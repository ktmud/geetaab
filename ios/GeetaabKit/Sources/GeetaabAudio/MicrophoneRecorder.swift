#if canImport(AVFoundation)
import AVFoundation
import Foundation
import GeetaabCore

public enum RecorderStatus: String, Sendable {
  case waiting, recording, interrupted, stopped
}

public struct LiveFrame: Sendable {
  /// RMS level, 0..1, for the meter.
  public var level: Double
  /// Peak level over the window, for clipping warnings.
  public var peak: Double
  public var chroma: [Float]
  /// Chord lattice state of the current best guess.
  public var chordState: Int
  public var chordScore: Double
  /// Seconds of the take so far; zero while still waiting for music.
  public var seconds: Double
  public var status: RecorderStatus
}

/// A stretch the recorder could not capture, so the analysis is not told that
/// two sides of an interruption were adjacent in time.
public struct TakeGap: Sendable, Codable, Hashable {
  public var at: Double
  public var seconds: Double
}

public struct Take: Sendable {
  public var samples: [Float]
  public var sampleRate: Double
  public var gaps: [TakeGap]
  public var conditions: CaptureConditions
}

public enum RecorderError: Error, Sendable {
  case microphoneDenied
  case sessionFailed(String)
  case engineFailed(String)
  case noInput
  /// The system insisted on running its speech-processing chain, which would
  /// subtract the phone's own speaker out of the signal and pump the noise
  /// floor between strums. Better to say so than to hand back a bad take.
  case voiceProcessingStuckOn
}

public enum RecorderEvent: Sendable {
  case frame(LiveFrame)
  case spectrum([Float])
  /// The gate heard music and the take began.
  case began
  case conditions(CaptureConditions)
  case interrupted
  case resumed(gapSeconds: Double)
  /// Buffers stopped arriving while the recorder believed it was running.
  case stalled(TimeInterval)
  case maxReached
  case failed(RecorderError)
}

public struct RecorderOptions: Sendable {
  /// How often to run the live chord readout.
  public var liveInterval: TimeInterval = 0.25
  /// How much recent audio the live readout looks at.
  public var liveWindow: TimeInterval = 1.5
  public var maxSeconds: Double = 180
  /// Hold the take until the microphone actually hears music. The audio heard
  /// while holding is not kept — apart from the live window, which is flushed
  /// into the take when the music starts so the first strum is never clipped.
  public var waitForMusic: Bool = true
  public var emitSpectrum: Bool = true
  /// No buffer for this long, while recording, counts as a stall.
  public var stallAfter: TimeInterval = 1.0

  public init() {}
}

/// Microphone capture with a live chord readout.
///
/// Raw PCM is kept rather than an encoded stream because the analysis needs
/// uncompressed samples, and because the same buffer feeds the live readout
/// that tells the player the microphone is actually hearing the song.
///
/// The whole take is allocated once, up front, from `maxSeconds`. Growing an
/// array from the audio thread would allocate under a real-time deadline, and
/// the worst case here is thirty-five megabytes for a three-minute take — a
/// price worth paying to make the capture path allocation-free.
public final class MicrophoneRecorder: @unchecked Sendable {
  private let options: RecorderOptions
  private let handler: @Sendable (RecorderEvent) -> Void

  private let engine = AVAudioEngine()
  private let analysisQueue = DispatchQueue(label: "geetaab.recorder.analysis", qos: .userInitiated)
  private let controlQueue = DispatchQueue(label: "geetaab.recorder.control")

  // Written only by the audio thread, read by everyone else. A stale read
  // under-reports by at most one buffer, which costs the meter a frame and
  // costs the finished take nothing, because `stop` fences against the tap
  // being removed before it reads.
  private let takeCount: UnsafeMutablePointer<Int>
  private var take: UnsafeMutableBufferPointer<Float>
  private var ring: UnsafeMutableBufferPointer<Float>
  private let ringWrite: UnsafeMutablePointer<Int>
  private var ringFilled: UnsafeMutablePointer<Int>

  private var sampleRate: Double = 48000
  private var recording = false
  private var stopped = true
  private var interrupted = false
  private var gate: MusicGate?
  private var binner: SpectrogramBinner?
  private var gaps: [TakeGap] = []
  private var interruptedAt: Date?
  private var lastBufferAt: Date = .distantPast
  private var timer: DispatchSourceTimer?
  private var sessionToken: AudioSessionController.ObservationToken?
  private var conditions = CaptureConditions(
    input: .none, output: .other, voiceProcessingOn: false, otherAudioPlaying: false,
    sampleRate: 48000, inputLatency: 0)

  public init(options: RecorderOptions = RecorderOptions(), handler: @escaping @Sendable (RecorderEvent) -> Void) {
    self.options = options
    self.handler = handler
    // Sized for the highest rate the hardware is likely to hand back, so a
    // 48 kHz session and a 44.1 kHz one both fit without a second allocation.
    let capacity = Int(options.maxSeconds * 48000) + 48000
    take = UnsafeMutableBufferPointer<Float>.allocate(capacity: capacity)
    take.initialize(repeating: 0)
    let ringCapacity = Int(options.liveWindow * 48000) + 48000
    ring = UnsafeMutableBufferPointer<Float>.allocate(capacity: ringCapacity)
    ring.initialize(repeating: 0)
    takeCount = UnsafeMutablePointer<Int>.allocate(capacity: 1)
    takeCount.initialize(to: 0)
    ringWrite = UnsafeMutablePointer<Int>.allocate(capacity: 1)
    ringWrite.initialize(to: 0)
    ringFilled = UnsafeMutablePointer<Int>.allocate(capacity: 1)
    ringFilled.initialize(to: 0)
  }

  deinit {
    take.deallocate()
    ring.deallocate()
    takeCount.deallocate()
    ringWrite.deallocate()
    ringFilled.deallocate()
  }

  public var seconds: Double { Double(takeCount.pointee) / sampleRate }
  public var status: RecorderStatus {
    if stopped { return .stopped }
    if interrupted { return .interrupted }
    return recording ? .recording : .waiting
  }

  // MARK: - Lifecycle

  public func start() async throws {
    let session = AudioSessionController.shared
    if session.recordPermission != .granted {
      guard await session.requestRecordPermission() else { throw RecorderError.microphoneDenied }
    }
    do {
      try session.beginCapture()
    } catch {
      throw RecorderError.sessionFailed(error.localizedDescription)
    }

    let input = engine.inputNode
    // Explicitly off, and checked rather than assumed. `.measurement` mode
    // already asks the system not to process the input; this is the node-level
    // switch for the same thing, and a build that cannot turn it off should say
    // so instead of producing tabs from a signal with the music filtered out.
    try? input.setVoiceProcessingEnabled(false)
    if input.isVoiceProcessingEnabled { throw RecorderError.voiceProcessingStuckOn }

    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0 else { throw RecorderError.noInput }
    sampleRate = format.sampleRate

    stopped = false
    interrupted = false
    recording = !options.waitForMusic
    gaps = []
    takeCount.pointee = 0
    ringWrite.pointee = 0
    ringFilled.pointee = 0
    gate = options.waitForMusic ? MusicGate() : nil
    binner = options.emitSpectrum ? SpectrogramBinner(sampleRate: sampleRate) : nil
    conditions = session.conditions(voiceProcessingOn: input.isVoiceProcessingEnabled)
    handler(.conditions(conditions))

    // A buffer of about 100 ms: long enough that the tap is not woken
    // constantly, short enough that the meter still feels immediate.
    let bufferSize = AVAudioFrameCount(max(1024, min(16384, Int(sampleRate / 10))))
    input.installTap(onBus: 0, bufferSize: bufferSize, format: format) { [weak self] buffer, _ in
      self?.accept(buffer)
    }

    engine.prepare()
    do {
      try engine.start()
    } catch {
      input.removeTap(onBus: 0)
      throw RecorderError.engineFailed(error.localizedDescription)
    }

    lastBufferAt = Date()
    observeSession()
    startLiveTimer()
  }

  /// Start the take by hand, without waiting for the gate to hear music.
  public func startNow() {
    controlQueue.async { [weak self] in self?.beginRecording() }
  }

  /// Stop capture and hand back everything recorded.
  public func stop() -> Take {
    stopped = true
    timer?.cancel()
    timer = nil
    sessionToken = nil
    // Removing the tap first is what makes the count below final: no further
    // buffer can arrive once it returns.
    engine.inputNode.removeTap(onBus: 0)
    engine.stop()
    let count = takeCount.pointee
    let samples = Array(UnsafeBufferPointer(start: take.baseAddress!, count: count))
    AudioSessionController.shared.end()
    return Take(samples: samples, sampleRate: sampleRate, gaps: gaps, conditions: conditions)
  }

  /// Abandon the recording without returning it.
  public func cancel() {
    _ = stop()
    takeCount.pointee = 0
  }

  /// Throw this take away and wait for music again, without tearing the engine
  /// down. Someone who mistimed the start wants another go, not a permission
  /// prompt and a fresh session.
  public func discardTake() {
    controlQueue.sync {
      takeCount.pointee = 0
      ringWrite.pointee = 0
      ringFilled.pointee = 0
      gaps = []
      recording = !options.waitForMusic
    }
    // The gate and the binner are read from the audio thread and the analysis
    // queue, so they are emptied in place rather than replaced: swapping the
    // object out from under a reader is a race, and a race in a capture path
    // is the kind of bug that only shows up on someone else's phone.
    analysisQueue.async { [weak self] in
      self?.gate?.reset()
      self?.binner?.reset()
    }
  }

  // MARK: - Capture

  private func accept(_ buffer: AVAudioPCMBuffer) {
    guard !stopped, let channels = buffer.floatChannelData else { return }
    let frames = Int(buffer.frameLength)
    guard frames > 0 else { return }
    lastBufferAt = Date()

    let channelCount = Int(buffer.format.channelCount)
    // Mixed down here rather than downstream so the ring, the take and the
    // spectrogram all see one signal, and so the copy happens once.
    var mono = [Float](repeating: 0, count: frames)
    if channelCount == 1 {
      mono.withUnsafeMutableBufferPointer { $0.baseAddress!.update(from: channels[0], count: frames) }
    } else {
      let scale = 1 / Float(channelCount)
      mono.withUnsafeMutableBufferPointer { out in
        for c in 0..<channelCount {
          let src = channels[c]
          for i in 0..<frames { out[i] += src[i] }
        }
        for i in 0..<frames { out[i] *= scale }
      }
    }

    writeRing(mono)
    if recording && !interrupted { appendToTake(mono) }
  }

  private func writeRing(_ samples: [Float]) {
    let capacity = ring.count
    var write = ringWrite.pointee
    samples.withUnsafeBufferPointer { src in
      var offset = 0
      while offset < src.count {
        let room = capacity - write
        let take = min(room, src.count - offset)
        ring.baseAddress!.advanced(by: write).update(from: src.baseAddress! + offset, count: take)
        write = (write + take) % capacity
        offset += take
      }
    }
    ringWrite.pointee = write
    ringFilled.pointee = min(capacity, ringFilled.pointee + samples.count)
  }

  private func appendToTake(_ samples: [Float]) {
    let start = takeCount.pointee
    let room = take.count - start
    guard room > 0 else { return }
    let n = min(room, samples.count)
    samples.withUnsafeBufferPointer { src in
      take.baseAddress!.advanced(by: start).update(from: src.baseAddress!, count: n)
    }
    takeCount.pointee = start + n
    if let binner, options.emitSpectrum {
      let chunk = Array(samples.prefix(n))
      analysisQueue.async { [weak self] in
        guard let self, !self.stopped else { return }
        self.handler(.spectrum(binner.column(chunk)))
      }
    }
    if Double(start + n) / sampleRate >= options.maxSeconds { handler(.maxReached) }
  }

  /// The live window becomes the head of the take: the gate needs most of a
  /// second to be sure, and that second contains the song's first strum.
  private func beginRecording() {
    guard !recording, !stopped else { return }
    recording = true
    let pre = recentSamples(seconds: options.liveWindow)
    appendToTake(pre)
    handler(.began)
  }

  private func recentSamples(seconds: Double) -> [Float] {
    let want = min(Int(seconds * sampleRate), ringFilled.pointee)
    guard want > 0 else { return [] }
    var out = [Float](repeating: 0, count: want)
    let capacity = ring.count
    let write = ringWrite.pointee
    let start = ((write - want) % capacity + capacity) % capacity
    out.withUnsafeMutableBufferPointer { dst in
      let first = min(want, capacity - start)
      dst.baseAddress!.update(from: ring.baseAddress! + start, count: first)
      if first < want {
        dst.baseAddress!.advanced(by: first).update(from: ring.baseAddress!, count: want - first)
      }
    }
    return out
  }

  // MARK: - The live readout

  private func startLiveTimer() {
    let timer = DispatchSource.makeTimerSource(queue: analysisQueue)
    timer.schedule(deadline: .now() + options.liveInterval, repeating: options.liveInterval)
    timer.setEventHandler { [weak self] in self?.emitLiveFrame() }
    timer.resume()
    self.timer = timer
  }

  private func emitLiveFrame() {
    guard !stopped else { return }

    if recording && !interrupted {
      let silence = Date().timeIntervalSince(lastBufferAt)
      if silence > options.stallAfter { handler(.stalled(silence)) }
    }

    let recent = recentSamples(seconds: options.liveWindow)
    guard Double(recent.count) >= sampleRate * 0.3 else { return }

    var sum = 0.0
    var peak = 0.0
    for v in recent {
      let d = Double(v)
      sum += d * d
      let a = abs(d)
      if a > peak { peak = a }
    }
    let level = (sum / Double(recent.count)).squareRoot()

    let mono = resample(recent, from: sampleRate, to: CHROMA_SAMPLE_RATE)
    // A shorter window than the full analysis uses: responsiveness matters more
    // than frequency resolution when the readout is only reassurance.
    let chroma = computeChromagram(
      mono, sampleRate: CHROMA_SAMPLE_RATE, options: ChromaOptions(fftSize: 4096, hopSize: 1024))
    var treble = averageChroma(chroma.treble, frames: chroma.frames, weights: chroma.energy)
    var bass = averageChroma(chroma.bass, frames: chroma.frames, weights: chroma.energy)
    unitLength(&treble)
    unitLength(&bass)
    let best = bestChordForChroma(treble: treble, bass: bass)

    if let gate, !recording, !interrupted {
      // The gate reads the same analysis the readout just ran; hearing music
      // for a few windows in a row is what starts the take.
      if gate.push(musicFeatures(from: chroma, level: level, chordScore: best.score)) {
        controlQueue.sync { beginRecording() }
      }
    }

    handler(
      .frame(
        LiveFrame(
          level: level, peak: peak, chroma: treble, chordState: best.state,
          chordScore: best.score, seconds: seconds, status: status)))
  }

  // MARK: - Interruptions

  private func observeSession() {
    sessionToken = AudioSessionController.shared.observe { [weak self] event in
      guard let self else { return }
      switch event {
      case .interrupted:
        self.handleInterruption()
      case .interruptionEnded(let shouldResume):
        self.handleInterruptionEnded(shouldResume: shouldResume)
      case .routeChanged(let conditions):
        self.conditions = conditions
        self.handler(.conditions(conditions))
      case .mediaServicesReset:
        // Every engine, buffer and format the app is holding is now stale.
        // Whatever was recorded is still in our own memory and still good, so
        // the take survives even though the capture cannot.
        self.handleInterruption()
        self.handler(.failed(.engineFailed("the audio system restarted")))
      }
    }
  }

  private func handleInterruption() {
    guard !interrupted, !stopped else { return }
    interrupted = true
    interruptedAt = Date()
    engine.pause()
    handler(.interrupted)
    handler(.frame(idleFrame()))
  }

  private func handleInterruptionEnded(shouldResume: Bool) {
    guard interrupted, !stopped else { return }
    let gapSeconds = interruptedAt.map { Date().timeIntervalSince($0) } ?? 0
    interruptedAt = nil
    do {
      try AudioSessionController.shared.beginCapture()
      try engine.start()
      interrupted = false
      lastBufferAt = Date()
      // Recorded as a hole rather than stitched over, so nothing downstream
      // reads the two sides as adjacent in time and puts a chord change where
      // a phone call was.
      if recording && gapSeconds > 0.05 {
        gaps.append(TakeGap(at: seconds, seconds: gapSeconds))
      }
      handler(.resumed(gapSeconds: gapSeconds))
    } catch {
      handler(.failed(.engineFailed(error.localizedDescription)))
    }
  }

  private func idleFrame() -> LiveFrame {
    LiveFrame(
      level: 0, peak: 0, chroma: [Float](repeating: 0, count: 12), chordState: NC_STATE,
      chordScore: 0, seconds: seconds, status: status)
  }
}

private func unitLength(_ v: inout [Float]) {
  var sum = 0.0
  for x in v { sum += Double(x) * Double(x) }
  let n = sum.squareRoot()
  if n > 1e-9 { for i in v.indices { v[i] = Float(Double(v[i]) / n) } }
}
#endif
