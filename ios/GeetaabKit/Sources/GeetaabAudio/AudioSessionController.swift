#if canImport(AVFoundation)
import AVFoundation
import Foundation

/// Where the microphone signal is coming from.
public enum InputRoute: String, Sendable {
  case builtInMic, headsetMic, usb, bluetooth, other, none
}

/// Where sound is going, which decides whether the phone can record itself.
public enum OutputRoute: String, Sendable {
  case builtInSpeaker, builtInReceiver, headphones, bluetooth, usb, airPlay, other
}

/// What the app can honestly tell the player about this take before it starts.
public struct CaptureConditions: Sendable, Equatable {
  public var input: InputRoute
  public var output: OutputRoute
  /// True when the system is applying echo cancellation, gain riding or noise
  /// suppression to the input. All three fight the analysis, so the recorder
  /// refuses to leave it on rather than quietly producing worse tabs.
  public var voiceProcessingOn: Bool
  /// Another app is playing. Harmless — the session mixes rather than
  /// interrupting — but it is what makes "hold the phone near the speaker"
  /// pointless when that speaker is a pair of headphones.
  public var otherAudioPlaying: Bool
  public var sampleRate: Double
  public var inputLatency: TimeInterval

  /// Nothing the microphone can hear will contain the phone's own playback.
  ///
  /// Only the built-in speaker puts the phone's audio into the room. On
  /// headphones or a Bluetooth output the take will contain the room and
  /// nothing else, which is worth saying before six seconds are spent on it.
  public var phoneCannotHearItself: Bool {
    output != .builtInSpeaker
  }
}

public enum AudioSessionEvent: Sendable {
  /// A phone call, Siri, or another app took the input away.
  case interrupted
  /// The interruption ended. `shouldResume` is the system's hint that the app
  /// may pick up where it left off.
  case interruptionEnded(shouldResume: Bool)
  /// Headphones in or out, a device arriving or leaving, the category changing.
  case routeChanged(CaptureConditions)
  /// The audio server restarted. Every engine and buffer is now invalid.
  case mediaServicesReset
}

/// Owns the process-wide audio session and reports what it is doing.
///
/// The configuration here is the whole reason a native build hears more than
/// the web one. `.measurement` is the mode that turns off the system's
/// speech-oriented signal chain: echo cancellation would subtract the phone's
/// own speaker out of the microphone signal, automatic gain control would pump
/// the noise floor up between strums, and noise suppression carves holes in
/// sustained chords. A browser gives none of that a switch.
///
/// `.mixWithOthers` is what lets the player keep a song playing in Spotify
/// while this records it; without it, activating the session pauses them.
/// `.defaultToSpeaker` is what keeps that playback out of the earpiece, which
/// is where `.playAndRecord` otherwise sends it.
public final class AudioSessionController: @unchecked Sendable {
  public static let shared = AudioSessionController()

  private let queue = DispatchQueue(label: "geetaab.session")
  private var observers: [NSObjectProtocol] = []
  private var handlers: [UUID: @Sendable (AudioSessionEvent) -> Void] = [:]

  private init() {}

  // MARK: - Permission

  public enum PermissionState: Sendable {
    case granted, denied, undetermined
  }

  public var recordPermission: PermissionState {
    #if os(iOS) || os(visionOS)
    switch AVAudioApplication.shared.recordPermission {
    case .granted: return .granted
    case .denied: return .denied
    default: return .undetermined
    }
    #else
    return .granted
    #endif
  }

  public func requestRecordPermission() async -> Bool {
    #if os(iOS) || os(visionOS)
    await AVAudioApplication.requestRecordPermission()
    #else
    true
    #endif
  }

  // MARK: - Configuration

  /// Configure for capture and make the session active.
  ///
  /// Called before the engine is built, because an inactive session reports a
  /// sample rate of zero and the engine would then be wired for a format the
  /// hardware never produces.
  public func beginCapture(preferredBufferDuration: TimeInterval = 0.01) throws {
    #if os(iOS) || os(visionOS)
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(
      .playAndRecord,
      mode: .measurement,
      options: [.mixWithOthers, .defaultToSpeaker])
    // A preference, not a demand: the system may hand back something else, and
    // every downstream stage reads the rate it actually got.
    try? session.setPreferredSampleRate(48000)
    try? session.setPreferredIOBufferDuration(preferredBufferDuration)
    try session.setActive(true, options: [])
    startObserving()
    #endif
  }

  /// Configure for playback only — practice mode, the demo track, the chord
  /// library's strums. Deactivating between uses would interrupt other audio
  /// on every screen change, so the session simply changes category.
  public func beginPlayback() throws {
    #if os(iOS) || os(visionOS)
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
    try session.setActive(true, options: [])
    startObserving()
    #endif
  }

  /// Hand the audio hardware back, letting anything the app interrupted resume.
  public func end() {
    #if os(iOS) || os(visionOS)
    try? AVAudioSession.sharedInstance().setActive(
      false, options: [.notifyOthersOnDeactivation])
    #endif
  }

  // MARK: - Conditions

  public func conditions(voiceProcessingOn: Bool = false) -> CaptureConditions {
    #if os(iOS) || os(visionOS)
    let session = AVAudioSession.sharedInstance()
    let route = session.currentRoute
    return CaptureConditions(
      input: Self.classify(input: route.inputs.first?.portType),
      output: Self.classify(output: route.outputs.first?.portType),
      voiceProcessingOn: voiceProcessingOn,
      otherAudioPlaying: session.isOtherAudioPlaying,
      sampleRate: session.sampleRate,
      inputLatency: session.inputLatency)
    #else
    return CaptureConditions(
      input: .builtInMic, output: .builtInSpeaker, voiceProcessingOn: voiceProcessingOn,
      otherAudioPlaying: false, sampleRate: 48000, inputLatency: 0)
    #endif
  }

  #if os(iOS) || os(visionOS)
  private static func classify(input port: AVAudioSession.Port?) -> InputRoute {
    guard let port else { return .none }
    switch port {
    case .builtInMic: return .builtInMic
    case .headsetMic: return .headsetMic
    case .usbAudio: return .usb
    case .bluetoothHFP: return .bluetooth
    default: return .other
    }
  }

  private static func classify(output port: AVAudioSession.Port?) -> OutputRoute {
    guard let port else { return .other }
    switch port {
    case .builtInSpeaker: return .builtInSpeaker
    case .builtInReceiver: return .builtInReceiver
    case .headphones: return .headphones
    case .bluetoothA2DP, .bluetoothLE, .bluetoothHFP: return .bluetooth
    case .usbAudio: return .usb
    case .airPlay: return .airPlay
    default: return .other
    }
  }
  #endif

  // MARK: - Events

  /// Subscribe to session events. The returned token unsubscribes when dropped.
  public func observe(_ handler: @escaping @Sendable (AudioSessionEvent) -> Void) -> ObservationToken {
    let id = UUID()
    queue.sync { handlers[id] = handler }
    return ObservationToken { [weak self] in
      self?.queue.sync { self?.handlers[id] = nil }
    }
  }

  public final class ObservationToken {
    private let cancel: () -> Void
    init(_ cancel: @escaping () -> Void) { self.cancel = cancel }
    deinit { cancel() }
  }

  private func emit(_ event: AudioSessionEvent) {
    let snapshot = queue.sync { Array(handlers.values) }
    for handler in snapshot { handler(event) }
  }

  private func startObserving() {
    #if os(iOS) || os(visionOS)
    guard observers.isEmpty else { return }
    let centre = NotificationCenter.default
    observers.append(
      centre.addObserver(
        forName: AVAudioSession.interruptionNotification, object: nil, queue: nil
      ) { [weak self] note in
        guard let self,
          let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
          let type = AVAudioSession.InterruptionType(rawValue: raw)
        else { return }
        switch type {
        case .began:
          self.emit(.interrupted)
        case .ended:
          let options = (note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt)
            .map(AVAudioSession.InterruptionOptions.init(rawValue:)) ?? []
          self.emit(.interruptionEnded(shouldResume: options.contains(.shouldResume)))
        @unknown default:
          break
        }
      })
    observers.append(
      centre.addObserver(
        forName: AVAudioSession.routeChangeNotification, object: nil, queue: nil
      ) { [weak self] _ in
        guard let self else { return }
        self.emit(.routeChanged(self.conditions()))
      })
    observers.append(
      centre.addObserver(
        forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: nil
      ) { [weak self] _ in
        self?.emit(.mediaServicesReset)
      })
    #endif
  }
}
#endif
