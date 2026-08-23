#if canImport(AVFoundation)
import AVFoundation
import Foundation
import GeetaabCore

public enum AudioLoadError: LocalizedError, Sendable {
  /// Apple Music and every other subscription catalogue. There is no supported
  /// way to read the samples, and no amount of retrying changes that.
  case protectedContent
  case noAudioTrack
  case unreadable(String)
  case empty

  public var errorDescription: String? {
    switch self {
    case .protectedContent:
      return "This track is copy-protected, so its audio cannot be read."
    case .noAudioTrack:
      return "That file has no audio in it."
    case .unreadable(let reason):
      return reason
    case .empty:
      return "That file decoded to nothing."
    }
  }
}

public struct DecodedAudio: Sendable {
  public var samples: [Float]
  public var sampleRate: Double
  public var duration: Double
  public var title: String?
}

/// Decodes a file into the mono float samples the analysis wants.
///
/// This is the path worth preferring over the microphone wherever it is
/// available: the samples are the recording rather than a room's impression of
/// it, and the bass register the phone's own speaker cannot reproduce is all
/// still there, which is exactly where the root of every chord lives.
public enum AudioFileLoader {
  /// Decode at the file's own sample rate.
  ///
  /// The decoder could resample on the way out, and it would be marginally
  /// faster, but then a song imported on the phone and the same song analysed
  /// in the browser would go through different filters and could disagree about
  /// a chord. Same input, same answer, on both.
  public static func load(url: URL) async throws -> DecodedAudio {
    let scoped = url.startAccessingSecurityScopedResource()
    defer { if scoped { url.stopAccessingSecurityScopedResource() } }

    let asset = AVURLAsset(url: url, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])

    if let protected = try? await asset.load(.hasProtectedContent), protected {
      throw AudioLoadError.protectedContent
    }

    let tracks: [AVAssetTrack]
    do {
      tracks = try await asset.loadTracks(withMediaType: .audio)
    } catch {
      throw AudioLoadError.unreadable(error.localizedDescription)
    }
    guard let track = tracks.first else { throw AudioLoadError.noAudioTrack }

    let nativeRate: Double = await {
      guard let descriptions = try? await track.load(.formatDescriptions) else { return 44100 }
      for description in descriptions {
        if let basic = CMAudioFormatDescriptionGetStreamBasicDescription(description),
          basic.pointee.mSampleRate > 0
        {
          return basic.pointee.mSampleRate
        }
      }
      return 44100
    }()

    let reader: AVAssetReader
    do {
      reader = try AVAssetReader(asset: asset)
    } catch {
      throw AudioLoadError.unreadable(error.localizedDescription)
    }

    let settings: [String: Any] = [
      AVFormatIDKey: kAudioFormatLinearPCM,
      AVLinearPCMBitDepthKey: 32,
      AVLinearPCMIsFloatKey: true,
      AVLinearPCMIsBigEndianKey: false,
      AVLinearPCMIsNonInterleaved: false,
      AVNumberOfChannelsKey: 1,
      AVSampleRateKey: nativeRate,
    ]
    let output = AVAssetReaderTrackOutput(track: track, outputSettings: settings)
    output.alwaysCopiesSampleData = false
    guard reader.canAdd(output) else {
      throw AudioLoadError.unreadable("That file's audio could not be decoded.")
    }
    reader.add(output)
    guard reader.startReading() else {
      throw AudioLoadError.unreadable(reader.error?.localizedDescription ?? "The file could not be read.")
    }

    var samples: [Float] = []
    if let duration = try? await asset.load(.duration), duration.isNumeric {
      samples.reserveCapacity(Int(CMTimeGetSeconds(duration) * nativeRate) + 1024)
    }

    while let sample = output.copyNextSampleBuffer() {
      defer { CMSampleBufferInvalidate(sample) }
      guard let block = CMSampleBufferGetDataBuffer(sample) else { continue }
      var length = 0
      var pointer: UnsafeMutablePointer<Int8>?
      guard
        CMBlockBufferGetDataPointer(
          block, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &length,
          dataPointerOut: &pointer) == kCMBlockBufferNoErr,
        let pointer, length > 0
      else { continue }
      pointer.withMemoryRebound(to: Float.self, capacity: length / MemoryLayout<Float>.size) { floats in
        samples.append(
          contentsOf: UnsafeBufferPointer(start: floats, count: length / MemoryLayout<Float>.size))
      }
    }

    if reader.status == .failed {
      // A protected asset that slipped past the check above lands here.
      throw AudioLoadError.unreadable(reader.error?.localizedDescription ?? "Decoding stopped early.")
    }
    guard !samples.isEmpty else { throw AudioLoadError.empty }

    let title = await metadataTitle(of: asset) ?? url.deletingPathExtension().lastPathComponent
    return DecodedAudio(
      samples: samples, sampleRate: nativeRate,
      duration: Double(samples.count) / nativeRate, title: title)
  }

  private static func metadataTitle(of asset: AVAsset) async -> String? {
    guard let items = try? await asset.load(.commonMetadata) else { return nil }
    for item in items where item.commonKey == .commonKeyTitle {
      if let value = try? await item.load(.stringValue), !value.isEmpty { return value }
    }
    return nil
  }
}
#endif
