import Foundation
import SwiftUI

enum Language: String, CaseIterable, Codable {
  case en, zh

  var label: String { self == .en ? "EN" : "中" }

  /// The language the phone is set to, if the app speaks it.
  static var preferred: Language {
    let codes = Locale.preferredLanguages
    for code in codes {
      if code.hasPrefix("zh") { return .zh }
      if code.hasPrefix("en") { return .en }
    }
    return .en
  }
}

/// The app's words, in both languages it reads.
///
/// A dictionary rather than a `.strings` file because several of these take
/// arguments and a few are lists, and because keeping both languages side by
/// side in one place is what stops one of them quietly falling behind.
struct Strings {
  let language: Language
  private let en: Bool

  init(_ language: Language) {
    self.language = language
    self.en = language == .en
  }

  private func pick(_ english: String, _ chinese: String) -> String { en ? english : chinese }

  // Shell
  var appName: String { "geetaab" }
  var tagline: String {
    pick(
      "Play a song near your microphone and get a guitar tab a beginner can actually play.",
      "对着麦克风放一首歌，它给你一份你真弹得下来的吉他谱。")
  }
  var back: String { pick("Back", "返回") }
  var backHome: String { pick("Back to start", "回到开始") }
  var cancel: String { pick("Cancel", "取消") }
  var done: String { pick("Done", "完成") }
  var save: String { pick("Save", "保存") }
  var delete: String { pick("Delete", "删除") }
  var workingText: String { pick("Working…", "处理中…") }
  var edit: String { pick("Edit", "编辑") }

  // Home
  var listen: String { pick("Listen to a song", "听一首歌") }
  var importFile: String { pick("Open an audio file", "打开音频文件") }
  var tryDemo: String { pick("Try the demo track", "试试示范曲") }
  var chordLibrary: String { pick("Chord library", "和弦库") }
  var yourSongs: String { pick("Your songs", "你的谱") }
  var noSongsYet: String {
    pick("Nothing here yet. Play something at it.", "还什么都没有。放首歌给它听听。")
  }
  var storedLocally: String {
    pick(
      "Everything stays on this iPhone. No account, no upload, no server.",
      "所有内容都留在这台 iPhone 上。不需要账号，不上传，没有服务器。")
  }
  func storageUsed(_ text: String) -> String {
    pick("\(text) on this device", "本机占用 \(text)")
  }

  // File import
  var fileBetterThanMic: String {
    pick(
      "An audio file reads better than a microphone: the bass a phone speaker cannot produce is where every chord's root lives.",
      "音频文件比麦克风准得多——手机扬声器放不出的低频，正是每个和弦根音所在的地方。")
  }
  var protectedTrack: String {
    pick(
      "That track is copy-protected. Apple Music and other subscription catalogues cannot be read by any app.",
      "这首是有版权保护的。Apple Music 这类订阅曲库，任何 app 都读不到它的音频。")
  }
  func couldNotOpen(_ reason: String) -> String {
    pick("Could not open that file. \(reason)", "打不开这个文件。\(reason)")
  }

  // Listening
  var waitingForSong: String { pick("Waiting for the song", "等歌开始") }
  var recording: String { pick("Recording", "正在录音") }
  var hearingNow: String { pick("hearing now", "此刻听到") }
  var noMusicDetected: String { pick("No music detected", "没听到音乐") }
  var tooLoud: String {
    pick("Too loud — move further from the speaker.", "太响了，离音箱远一点。")
  }
  var veryQuiet: String {
    pick("Very quiet. Move closer, or turn the song up.", "声音太小了。靠近一点，或者把歌放大声些。")
  }
  var hearRoom: String {
    pick(
      "I can hear the room, but not a song yet. Recording starts on its own when the music does.",
      "能听见房间里的动静，但还不是歌。音乐一响，录音会自己开始。")
  }
  var playTheSong: String { pick("Play the song — I'll start with it", "放歌吧，我跟着一起开始") }
  var recordAnyway: String { pick("Record anyway", "直接开录") }
  func keepGoing(_ seconds: Int) -> String { pick("Keep going… \(seconds)s", "再录 \(seconds) 秒…") }
  var stopBuildTab: String { pick("Stop and build the tab", "停止并生成谱") }
  var discardTake: String { pick("Discard this take", "丢掉这一条") }
  var microphoneNeeded: String {
    pick(
      "geetaab needs the microphone to hear the song. You can turn it on in Settings.",
      "geetaab 需要麦克风才能听到歌。可以在「设置」里打开。")
  }
  var openSettings: String { pick("Open Settings", "打开设置") }

  // Capture conditions — the honest warnings a native build can give
  var headphonesWarning: String {
    pick(
      "Sound is going to your headphones, so the microphone will only hear the room. Play the song out loud on a speaker.",
      "声音正走耳机，麦克风只听得到房间。请用音箱把歌外放。")
  }
  var ownSpeakerWarning: String {
    pick(
      "Recording this phone's own speaker works, but its bass is thin, and the bass is where chord roots live. An external speaker or an audio file reads better.",
      "录这台手机自己的外放是可以的，但它低频很弱，而和弦根音正好在低频。外接音箱或直接导入音频文件会准得多。")
  }
  var interruptedNotice: String {
    pick(
      "Something took the microphone. The take is safe; recording picks up when it comes back.",
      "有别的东西占用了麦克风。已录的部分没丢，等它放开后会自动接着录。")
  }
  func resumedNotice(_ seconds: Int) -> String {
    pick(
      "Back. The \(seconds)s that were missed are marked as a gap rather than pretended away.",
      "回来了。中断的 \(seconds) 秒被标成断口，而不是当作没发生。")
  }
  var stalledNotice: String {
    pick("The microphone has gone quiet at the system level. Try stopping and starting again.",
      "系统层面上麦克风没有再送数据了。可以停下来重新开始。")
  }
  var voiceProcessingStuck: String {
    pick(
      "This device insists on processing the microphone for speech, which removes most of the music. Recording would not be worth trusting.",
      "这台设备坚持对麦克风做语音处理，会把音乐里的大部分内容削掉。这样录出来的结果不值得相信。")
  }
  var recordingTips: [String] {
    pick(
      [
        "Point the phone at the speaker, about an arm's length away.",
        "Six seconds is enough. A whole verse is better.",
        "A song built on guitar or piano reads best.",
      ],
      [
        "手机对着音箱，大约一臂远。",
        "六秒就够，一整段主歌更好。",
        "以吉他或钢琴为主的歌最好认。",
      ]
    ) as [String]
  }

  // Analysing
  func analysing(_ stage: String) -> String {
    guard !en else { return stage }
    switch stage {
    case "resampling": return "重采样"
    case "finding the beat": return "找拍子"
    case "listening for chords": return "听和弦"
    case "working out the changes": return "推和弦走向"
    case "naming the key": return "定调"
    default: return "处理中"
    }
  }
  var tooShort: String {
    pick("That was too short to work with. Six seconds is the minimum.", "太短了，没法分析。至少要六秒。")
  }
  var analysisFailed: String { pick("The analysis could not finish.", "分析没能完成。") }

  // Tab
  var capo: String { pick("Capo", "变调夹") }
  var noCapo: String { pick("No capo", "不夹") }
  func fret(_ n: Int) -> String { pick("Fret \(n)", "第 \(n) 品") }
  var key: String { pick("Key", "调") }
  var tempo: String { pick("Tempo", "速度") }
  var strum: String { pick("Strum", "扫弦") }
  var practise: String { pick("Practise", "练习") }
  var theLoop: String { pick("The loop", "循环段") }
  func loopExplains(_ percent: Int) -> String {
    pick("These bars are \(percent)% of the song.", "这几小节占了全曲的 \(percent)%。")
  }
  var freeTime: String { pick("Free time — no steady pulse", "散板 — 没有稳定节拍") }
  var levelEasy: String { pick("Easy", "简单") }
  var levelStandard: String { pick("Standard", "标准") }
  var levelFaithful: String { pick("Full", "完整") }
  func substitutedFrom(_ original: String) -> String {
    pick("stands in for \(original)", "替代 \(original)")
  }
  var noChordHere: String { pick("N.C.", "无和弦") }

  // Practice
  var play: String { pick("Play", "播放") }
  var pause: String { pick("Pause", "暂停") }
  var speed: String { pick("Speed", "速度") }
  var click: String { pick("Click", "节拍器") }
  var countIn: String { pick("Count in", "预备拍") }
  var rotateForPractice: String {
    pick("Turn the phone sideways to practise.", "把手机横过来练习。")
  }

  // Editing (phase two)
  var editChords: String { pick("Fix the chords", "改和弦") }
  var editLyrics: String { pick("Add lyrics", "加歌词") }
  var tapToBind: String {
    pick("Play the song and tap at the start of each line.", "放歌，在每句开始时点一下。")
  }
  var pasteLyrics: String { pick("Paste the words, one line each", "把歌词贴进来，一行一句") }
  var unbound: String { pick("not placed yet", "还没定位") }
  var rebind: String { pick("Redo timing", "重新对时") }
  var editsKept: String {
    pick(
      "Your corrections are kept apart from what was heard, so improving the analysis never overwrites them.",
      "你的修改和机器听到的分开存放，所以分析变准了也不会覆盖掉它们。")
  }
  func editedCount(_ n: Int) -> String {
    pick("\(n) edited", "改过 \(n) 处")
  }
  var tidyTiming: String { pick("Tidy the timing", "对齐到拍") }
  var tidyTimingWhy: String {
    pick(
      "Pulls each line onto the beat it was aimed at.",
      "把每一句挪到它本来瞄准的那一拍上。")
  }
  func tapLagNotice(_ milliseconds: Int, late: Bool) -> String {
    if late {
      return pick(
        "Your taps ran about \(milliseconds)ms behind the beat — everyone's do. Tidying takes that off.",
        "你的点拍平均慢了大约 \(milliseconds) 毫秒——所有人都这样。对齐会把它减掉。")
    }
    return pick(
      "Your taps ran about \(milliseconds)ms ahead of the beat. Tidying evens that out.",
      "你的点拍平均快了大约 \(milliseconds) 毫秒。对齐会把它抹平。")
  }
}

private struct StringsKey: EnvironmentKey {
  static let defaultValue = Strings(.en)
}

extension EnvironmentValues {
  var strings: Strings {
    get { self[StringsKey.self] }
    set { self[StringsKey.self] = newValue }
  }
}
