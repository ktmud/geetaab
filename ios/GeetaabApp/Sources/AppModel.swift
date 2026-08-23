import Foundation
import GeetaabAudio
import GeetaabCore
import Observation
import SwiftUI

/// A song as the app is currently showing it: what was heard, what the player
/// has since corrected, and the three readings built from the two together.
struct LoadedSong {
  var stored: StoredSong
  /// The samples, kept for this session only. A song reopened from the library
  /// does not carry them until something needs them, because a three-minute
  /// take is thirty megabytes of float.
  var samples: [Float]?
  var sampleRate: Double = 44100
  var tabs: [TabLevel: SongTab] = [:]
  var levels: [TabLevel] = [.standard]

  var level: TabLevel {
    let asked = stored.level ?? .standard
    return levels.contains(asked) ? asked : .standard
  }

  var tab: SongTab? { tabs[level] ?? tabs[.standard] }
}

@MainActor
@Observable
final class AppModel {
  enum Screen: Equatable {
    case home
    case listening
    case analyzing(stage: String, fraction: Double)
    case tab
    case practice
    case chords
    case editChords
    case editLyrics
  }

  enum Alert: Identifiable, Equatable {
    case message(String)
    case microphoneDenied
    var id: String {
      switch self {
      case .message(let text): return text
      case .microphoneDenied: return "mic"
      }
    }
  }

  var screen: Screen = .home
  var language: Language {
    didSet { UserDefaults.standard.set(language.rawValue, forKey: "language") }
  }
  var strings: Strings { Strings(language) }

  var songs: [SongSummary] = []
  var current: LoadedSong?
  var alert: Alert?
  var storageBytes: Int64 = 0

  private let store = SongStore.shared

  init() {
    let saved = UserDefaults.standard.string(forKey: "language").flatMap(Language.init(rawValue:))
    self.language = saved ?? .preferred
    refreshLibrary()
  }

  func refreshLibrary() {
    songs = store.list()
    storageBytes = store.storageBytes()
  }

  // MARK: - Bringing a song in

  /// Analyse a take and open its tab.
  func analyse(samples: [Float], sampleRate: Double, title: String, source: SongSource, gaps: [TakeGap] = []) async {
    guard Double(samples.count) / sampleRate >= 6 else {
      screen = .home
      alert = .message(strings.tooShort)
      return
    }
    screen = .analyzing(stage: "resampling", fraction: 0.05)
    do {
      let analysis = try await AnalysisService.analyze(
        samples: samples, sampleRate: sampleRate,
        onProgress: { [weak self] progress in
          Task { @MainActor in
            self?.screen = .analyzing(stage: progress.stage, fraction: progress.fraction)
          }
        })
      let id = store.newId()
      let stored = StoredSong(
        id: id, title: title, createdAt: Date(), analysis: analysis,
        analysisVersion: ANALYSIS_VERSION, source: source, hasAudio: true, gaps: gaps)
      var loaded = LoadedSong(stored: stored, samples: samples, sampleRate: sampleRate)
      rebuild(&loaded)
      current = loaded
      screen = .tab
      persist(loaded, writingAudio: true)
    } catch {
      screen = .home
      alert = .message(strings.analysisFailed)
    }
  }

  func open(_ summary: SongSummary) {
    do {
      let stored = try store.load(summary.id)
      // A song saved before an accuracy fix is re-analysed from its own audio
      // rather than shown with a tab the app no longer stands behind.
      if stored.isStale, stored.hasAudio {
        Task { await reanalyse(stored) }
        return
      }
      var loaded = LoadedSong(stored: stored)
      rebuild(&loaded)
      current = loaded
      screen = .tab
    } catch {
      alert = .message(strings.analysisFailed)
    }
  }

  private func reanalyse(_ stored: StoredSong) async {
    guard let audio = try? store.readAudio(for: stored.id), let audio else {
      var loaded = LoadedSong(stored: stored)
      rebuild(&loaded)
      current = loaded
      screen = .tab
      return
    }
    screen = .analyzing(stage: "resampling", fraction: 0.05)
    do {
      let analysis = try await AnalysisService.analyze(
        samples: audio.samples, sampleRate: audio.sampleRate,
        onProgress: { [weak self] progress in
          Task { @MainActor in
            self?.screen = .analyzing(stage: progress.stage, fraction: progress.fraction)
          }
        })
      var updated = stored
      updated.analysis = analysis
      updated.analysisVersion = ANALYSIS_VERSION
      // Corrections the better analysis has caught up with retire here, so the
      // overlay does not hold the pipeline back forever.
      updated.edits = pruned(updated.edits, against: analysis)
      var loaded = LoadedSong(stored: updated, samples: audio.samples, sampleRate: audio.sampleRate)
      rebuild(&loaded)
      current = loaded
      screen = .tab
      persist(loaded, writingAudio: false)
    } catch {
      screen = .home
      alert = .message(strings.analysisFailed)
    }
  }

  func delete(_ summary: SongSummary) {
    store.delete(summary.id)
    if current?.stored.id == summary.id {
      current = nil
      screen = .home
    }
    refreshLibrary()
  }

  // MARK: - Tab options

  func setCapo(_ fret: Int?) { mutate { $0.stored.capo = fret } }
  func setSimplify(_ on: Bool) { mutate { $0.stored.simplify = on } }
  func setStrum(_ id: String) { mutate { $0.stored.strumId = id } }
  func setLevel(_ level: TabLevel) { mutate { $0.stored.level = level } }

  func setTitle(_ title: String) {
    mutate {
      $0.stored.title = title
      $0.stored.edits.title = title
      $0.stored.edits.touch()
    }
  }

  func applyEdits(_ change: (inout SongEdits) -> Void) {
    mutate {
      change(&$0.stored.edits)
      $0.stored.edits.touch()
    }
  }

  private func mutate(_ change: (inout LoadedSong) -> Void) {
    guard var loaded = current else { return }
    change(&loaded)
    rebuild(&loaded)
    current = loaded
    persist(loaded, writingAudio: false)
  }

  /// Rebuild all three readings from the analysis plus the overlay.
  ///
  /// Cheap enough to redo on every change — the arrangement is a few thousand
  /// comparisons over a list of segments, not a second pass over the audio.
  private func rebuild(_ loaded: inout LoadedSong) {
    let corrected = applyingEdits(loaded.stored.analysis, loaded.stored.edits)
    let simplify = loaded.stored.simplify ?? true
    let strum = loaded.stored.strumId.map(patternById)

    var easyAnalysis = corrected
    easyAnalysis.segments = reduceSegments(corrected.segments, beatsPerBar: corrected.beatsPerBar)

    let chosen = BuildTabOptions(capo: loaded.stored.capo, simplify: simplify, strum: strum)
    let literal = BuildTabOptions(capo: loaded.stored.capo, simplify: false, strum: strum)
    let easy = buildTab(easyAnalysis, options: chosen)
    let standard = buildTab(corrected, options: chosen)
    let faithful = buildTab(corrected, options: literal)

    loaded.tabs = [.easy: easy, .standard: standard, .faithful: faithful]
    loaded.levels = levelsWorthOffering(easy: easy, standard: standard, faithful: faithful)
  }

  private func persist(_ loaded: LoadedSong, writingAudio: Bool) {
    let stored = loaded.stored
    let samples = loaded.samples
    let rate = loaded.sampleRate
    Task.detached(priority: .utility) { [store] in
      if writingAudio, let samples {
        try? store.writeAudio(samples, sampleRate: rate, for: stored.id)
      }
      try? store.save(stored)
      await MainActor.run { [weak self] in self?.refreshLibrary() }
    }
  }

  // MARK: - Demo

  func loadDemo() async {
    let samples = renderProgression(
      DEMO_PROGRESSION, options: SynthOptions(sampleRate: 44100, noise: 0.002))
    await analyse(
      samples: samples, sampleRate: 44100,
      title: language == .en ? "Demo track" : "示范曲", source: .demo)
  }

  func importFile(at url: URL) async {
    do {
      let audio = try await AudioFileLoader.load(url: url)
      await analyse(
        samples: audio.samples, sampleRate: audio.sampleRate,
        title: audio.title ?? url.deletingPathExtension().lastPathComponent, source: .file)
    } catch let error as AudioLoadError {
      switch error {
      case .protectedContent:
        alert = .message(strings.protectedTrack)
      default:
        alert = .message(strings.couldNotOpen(error.localizedDescription))
      }
    } catch {
      alert = .message(strings.couldNotOpen(error.localizedDescription))
    }
  }
}
