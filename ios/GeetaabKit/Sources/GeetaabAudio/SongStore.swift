#if canImport(AVFoundation)
import AVFoundation
import Foundation
import GeetaabCore

public enum SongSource: String, Sendable, Codable {
  case microphone, file, demo
}

/// Everything the app knows about one song, minus the audio itself.
public struct StoredSong: Sendable, Codable, Identifiable {
  public var id: String
  public var title: String
  public var createdAt: Date
  public var analysis: AnalysisResult
  /// ``ANALYSIS_VERSION`` at the time the tab was worked out. A song saved
  /// under an older number is re-analysed from its audio the next time it is
  /// opened, so an accuracy fix reaches songs a player already has.
  public var analysisVersion: Int
  public var capo: Int?
  public var strumId: String?
  public var simplify: Bool?
  public var level: TabLevel?
  public var source: SongSource
  public var hasAudio: Bool
  public var gaps: [TakeGap]
  /// Player edits, kept apart from the analysis so re-analysing cannot destroy
  /// them. Empty until the editing screens land.
  public var edits: SongEdits

  public init(
    id: String, title: String, createdAt: Date, analysis: AnalysisResult, analysisVersion: Int,
    source: SongSource, hasAudio: Bool, capo: Int? = nil, strumId: String? = nil,
    simplify: Bool? = nil, level: TabLevel? = nil, gaps: [TakeGap] = [],
    edits: SongEdits = SongEdits()
  ) {
    self.id = id
    self.title = title
    self.createdAt = createdAt
    self.analysis = analysis
    self.analysisVersion = analysisVersion
    self.source = source
    self.hasAudio = hasAudio
    self.capo = capo
    self.strumId = strumId
    self.simplify = simplify
    self.level = level
    self.gaps = gaps
    self.edits = edits
  }

  public var isStale: Bool { analysisVersion < ANALYSIS_VERSION }
}

public struct SongSummary: Sendable, Identifiable, Hashable {
  public var id: String
  public var title: String
  public var createdAt: Date
  public var tempo: Double
  public var keyName: String
  public var capo: Int
  public var duration: Double
  public var source: SongSource
  public var hasAudio: Bool
  public var edited: Bool
}

/// The song library, entirely on this device.
///
/// Songs live in Application Support rather than Documents so they do not
/// appear in the Files app as loose folders, are marked as excluded from
/// backup, and carry file protection so they are unreadable while the phone is
/// locked. Nothing here is uploaded, mirrored, or shared: there is no network
/// code in this app at all, and a recording of someone's living room should
/// not become someone else's problem to secure.
public final class SongStore: @unchecked Sendable {
  public static let shared = SongStore()

  private let root: URL
  private let queue = DispatchQueue(label: "geetaab.store")
  private let encoder: JSONEncoder = {
    let e = JSONEncoder()
    e.dateEncodingStrategy = .secondsSince1970
    return e
  }()
  private let decoder: JSONDecoder = {
    let d = JSONDecoder()
    d.dateDecodingStrategy = .secondsSince1970
    return d
  }()

  public init(root: URL? = nil) {
    let base =
      root
      ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("Songs", isDirectory: true)
    self.root = base
    try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true, attributes: [
      .protectionKey: FileProtectionType.completeUntilFirstUserAuthentication
    ])
    excludeFromBackup(base)
  }

  private func excludeFromBackup(_ url: URL) {
    var target = url
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try? target.setResourceValues(values)
  }

  private func folder(_ id: String) -> URL {
    root.appendingPathComponent(id, isDirectory: true)
  }

  public func metadataURL(_ id: String) -> URL {
    folder(id).appendingPathComponent("song.json")
  }

  public func audioURL(_ id: String) -> URL {
    folder(id).appendingPathComponent("audio.m4a")
  }

  // MARK: - Reading and writing

  public func save(_ song: StoredSong) throws {
    try queue.sync {
      let dir = folder(song.id)
      try FileManager.default.createDirectory(
        at: dir, withIntermediateDirectories: true,
        attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
      let data = try encoder.encode(song)
      // Written atomically so an interrupted save leaves the previous version
      // in place rather than half of the new one.
      try data.write(to: metadataURL(song.id), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
  }

  public func load(_ id: String) throws -> StoredSong {
    try queue.sync {
      let data = try Data(contentsOf: metadataURL(id))
      return try decoder.decode(StoredSong.self, from: data)
    }
  }

  public func delete(_ id: String) {
    queue.sync { try? FileManager.default.removeItem(at: folder(id)) }
  }

  public func list() -> [SongSummary] {
    queue.sync {
      let contents =
        (try? FileManager.default.contentsOfDirectory(
          at: root, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles])) ?? []
      var out: [SongSummary] = []
      for dir in contents {
        guard let data = try? Data(contentsOf: dir.appendingPathComponent("song.json")),
          let song = try? decoder.decode(StoredSong.self, from: data)
        else { continue }
        out.append(
          SongSummary(
            id: song.id, title: song.title, createdAt: song.createdAt, tempo: song.analysis.tempo,
            keyName: song.analysis.key.name, capo: song.capo ?? 0,
            duration: song.analysis.duration, source: song.source, hasAudio: song.hasAudio,
            edited: !song.edits.isEmpty))
      }
      return out.sorted { $0.createdAt > $1.createdAt }
    }
  }

  public func newId() -> String {
    "song-\(Int(Date().timeIntervalSince1970 * 1000))-\(UInt32.random(in: 0..<0xFFFFFF))"
  }

  // MARK: - Audio

  /// Store a take as mono AAC.
  ///
  /// Kept compressed because a three-minute take is thirty megabytes of raw
  /// float and a library of them would fill a phone. The analysis has already
  /// run on the raw samples by the time this is called; what is kept is for
  /// playing along with, and for re-analysing when the pipeline improves — a
  /// job that already survives a phone microphone in a room, so it survives
  /// 128 kbit AAC without noticing.
  public func writeAudio(_ samples: [Float], sampleRate: Double, for id: String) throws {
    let dir = folder(id)
    try FileManager.default.createDirectory(
      at: dir, withIntermediateDirectories: true,
      attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
    let url = audioURL(id)
    try? FileManager.default.removeItem(at: url)

    guard
      let processing = AVAudioFormat(
        commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 1, interleaved: false)
    else { throw AudioLoadError.unreadable("could not describe the take's format") }

    let settings: [String: Any] = [
      AVFormatIDKey: kAudioFormatMPEG4AAC,
      AVSampleRateKey: sampleRate,
      AVNumberOfChannelsKey: 1,
      AVEncoderBitRateKey: 128_000,
    ]
    let file = try AVAudioFile(forWriting: url, settings: settings)

    let chunk = 32768
    var offset = 0
    while offset < samples.count {
      let n = min(chunk, samples.count - offset)
      guard
        let buffer = AVAudioPCMBuffer(pcmFormat: processing, frameCapacity: AVAudioFrameCount(n))
      else { break }
      buffer.frameLength = AVAudioFrameCount(n)
      samples.withUnsafeBufferPointer { src in
        buffer.floatChannelData![0].update(from: src.baseAddress! + offset, count: n)
      }
      try file.write(from: buffer)
      offset += n
    }
    excludeFromBackup(url)
  }

  public func readAudio(for id: String) throws -> DecodedAudio? {
    let url = audioURL(id)
    guard FileManager.default.fileExists(atPath: url.path) else { return nil }
    let file = try AVAudioFile(forReading: url)
    let format = file.processingFormat
    let frames = AVAudioFrameCount(file.length)
    guard frames > 0, let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames)
    else { return nil }
    try file.read(into: buffer)
    let count = Int(buffer.frameLength)
    var samples = [Float](repeating: 0, count: count)
    if let data = buffer.floatChannelData {
      let channels = Int(format.channelCount)
      if channels == 1 {
        samples.withUnsafeMutableBufferPointer { $0.baseAddress!.update(from: data[0], count: count) }
      } else {
        samples.withUnsafeMutableBufferPointer { out in
          for c in 0..<channels {
            for i in 0..<count { out[i] += data[c][i] }
          }
          let scale = 1 / Float(channels)
          for i in 0..<count { out[i] *= scale }
        }
      }
    }
    return DecodedAudio(
      samples: samples, sampleRate: format.sampleRate,
      duration: Double(count) / format.sampleRate, title: nil)
  }

  /// Bytes the library is using, for the settings screen to be honest about.
  public func storageBytes() -> Int64 {
    queue.sync {
      guard
        let enumerator = FileManager.default.enumerator(
          at: root, includingPropertiesForKeys: [.fileSizeKey])
      else { return 0 }
      var total: Int64 = 0
      for case let url as URL in enumerator {
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        total += Int64(size)
      }
      return total
    }
  }
}
#endif
