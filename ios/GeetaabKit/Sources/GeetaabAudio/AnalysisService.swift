#if canImport(AVFoundation)
import Foundation
import GeetaabCore

/// Runs the analysis off the main thread, with progress and cancellation.
///
/// A three-minute recording is a few seconds of arithmetic even at native
/// speed. On the main thread that freezes the interface, including the
/// progress indicator that exists to explain the wait.
public enum AnalysisService {
  public struct Progress: Sendable {
    public var stage: String
    public var fraction: Double
  }

  public static func analyze(
    samples: [Float], sampleRate: Double, tempoHint: Double? = nil, beatsPerBar: Int? = nil,
    onProgress: (@Sendable (Progress) -> Void)? = nil
  ) async throws -> AnalysisResult {
    try await withCheckedThrowingContinuation { continuation in
      DispatchQueue.global(qos: .userInitiated).async {
        if Task.isCancelled {
          continuation.resume(throwing: CancellationError())
          return
        }
        let result = analyzeAudio(
          samples: samples, sampleRate: sampleRate,
          options: AnalyzeOptions(
            onProgress: { stage, fraction in
              onProgress?(Progress(stage: stage, fraction: fraction))
            },
            tempoHint: tempoHint, beatsPerBar: beatsPerBar))
        continuation.resume(returning: result)
      }
    }
  }
}
#endif
