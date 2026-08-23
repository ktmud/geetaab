import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Language = 'en' | 'zh';

export const dictionary = {
  en: {
    // Topbar and navigation
    chords: 'Chords',
    home: 'Home',
    language: 'EN',

    // Home screen
    eyebrowGuitarTabs: 'Guitar tabs, by ear',
    h1PlayNearMic: 'Play a song near your mic.',
    h1GetTab: 'Get a tab you can actually play.',
    ledeParagraph: 'geetaab works out the chords, the key and the tempo, then rewrites the song in shapes a beginner already knows — capo included. Then you practise it karaoke-style, sideways, at whatever speed you can keep up with.',
    listenWithMic: 'Listen with the mic',
    orText: 'or ',
    blocksMicrophone: 'Your browser blocks microphone access — ',
    openAudioFile: 'open an audio file',
    tryDemo: 'try the demo',
    yourSongs: 'Your songs',
    storedOnDevice: 'Stored on this device only.',
    deleteLabel: (title: string) => `Delete ${title}`,
    deleteTitle: 'Delete',
    capoText: (capo: number) => `capo ${capo}`,
    noCapo: 'no capo',
    whatComesOut: 'What comes out',
    everyExampleReal: 'Every example below is real output, not a mock-up.',
    shapesYouKnow: 'Shapes you already know',
    shapesDescription: 'A song in E♭ has four barre chords in it. geetaab puts a capo on the third fret and hands you C, G, Am and an Fmaj7 instead.',
    loopNotWhole: 'The loop, not the whole song',
    loopDescription: 'Most songs are one progression repeated. geetaab finds it and tells you how much of the track it covers, so you learn four bars instead of three minutes.',
    practiceSideways: 'Practise sideways',
    sidewaysDescription: 'Turn the phone landscape and the chords scroll past a playhead, with a count-in, a click, section looping and slow-down that keeps the pitch.',
    howItWorks: 'How it works',
    noServerDownload: 'No server, no model download. It all happens in this tab.',
    listens: 'It listens',
    listensDescription: 'Twelve pitch classes are measured several times a second, with the recording\'s own tuning worked out first — so a song mastered slightly sharp still reads correctly.',
    findsThePulse: 'It finds the pulse',
    findsDescription: 'Note onsets give the tempo, and a beat tracker lays a grid over the whole recording so chord changes land on beats instead of between them.',
    picksChords: 'It picks the chords',
    picksDescription: 'Each beat is matched against chord templates that model real overtones, then smoothed into the handful of changes a player would write down.',
    rewritesHands: 'It rewrites for your hands',
    rewritesDescription: 'A capo goes wherever it puts the most of the song on open shapes, and what is left gets the substitutions a teacher would make.',
    everythingRunsBrowser: 'Everything runs in this browser tab: no audio is uploaded, and your songs are stored on this device only. The chords are a machine transcription — trust your ears over them.',
    geetaabOpenSource: 'geetaab is open source',

    // Listening screen
    waitingForSong: 'Waiting for the song',
    recording: 'Recording',
    hearingNow: 'hearing now',
    tooLoud: 'Too loud — move further from the speaker.',
    veryQuiet: 'Very quiet. Move closer, or turn the song up.',
    hearRoom: 'I can hear the room, but not a song yet. Recording starts on its own when the music does.',
    playTheSong: 'Play the song — I\'ll start with it',
    recordAnyway: 'Record anyway',
    workingText: 'Working…',
    keepGoing: (seconds: number) => `Keep going… ${seconds}s`,
    stopBuildTab: 'Stop and build the tab',
    microphone: 'Microphone did not open',
    recordingTips: [
      'Recording waits for the music, so start the song whenever you are ready.',
      'Point the phone at the speaker, about an arm\'s length away.',
      'Catch a chorus. Thirty seconds of the part you want to play is plenty.',
      'Quiet room, no singing along — voices confuse the harmony.',
      'Songs built on a guitar or piano read best; heavy production reads worst.',
    ],
    cancel: 'Cancel',
    back: 'Back',

    // TabView screen
    songTitle: 'Song title',
    nameThisSong: 'Name this song',
    confirmTitle: 'Confirm the title',
    capo: 'Capo',
    strumming: 'Strumming',
    level: 'Level',
    easy: 'Easy',
    standard: 'Standard',
    faithful: 'Faithful',
    easyHint: 'Fewer, plainer changes — extensions and quick passing chords folded away.',
    standardHint: 'Every change the song makes, on shapes a beginner can finger.',
    faithfulHint: 'Exactly what the recording plays — sevenths, suspensions and all.',
    fretNth: (fret: number) => `Fret ${fret}`,
    tempoReading: 'Tempo reading',
    halfTime: 'Half time',
    doubleTime: 'Double time',
    chordsYouNeed: 'Chords you need',
    makeItFitHands: 'Make it fit your hands',
    subbedFor: (chord: string) => `easier stand-in for ${chord}`,
    soundsAs: (chord: string) => `sounds as ${chord}`,
    stillNeeds: (chords: string, count: number) => `${chords} ${count === 1 ? 'still needs' : 'still need'} a barre. Try another capo position below, or play just the top four strings until the shape settles.`,
    suggested: '— suggested',
    capoPlay: (fret: number, key: string) => `Capo ${fret} · play in ${key}`,
    noCapoText: 'No capo',
    wholeLoop: (bars: number, coverage: number) => `This ${bars}-bar loop covers ${Math.round(coverage * 100)}% of what you recorded. Learn it once and you have most of the song.`,
    learnOnce: 'Learn it once and you have most of the song.',
    openShapes: (ratio: number) => `Open shapes already cover ${Math.round(ratio * 100)}% of this song, so a capo would not buy you much.`,
    withCapo: (fret: number, key: string, ratio: number) => `With the capo on fret ${fret} you finger the shapes of ${key}, and the room hears ${translateKeyName(key, 'en')}. ${Math.round(ratio * 100)}% of the song lands on open chords.`,
    chordChart: 'Chord chart',
    wholeSong: 'Whole song',
    justLoop: 'Just the loop',
    tablature: 'Tablature',
    printTab: 'Print the tab',
    copyTab: 'Copy the whole tab as text',
    copied: 'Copied',
    practiseThis: 'Practise this',
    lowConfidence: 'The harmony came through faintly, so these chords are a rough guess. A cleaner recording — or an audio file instead of a room recording — will do much better.',
    freeTime: 'This one plays freely — there was no steady pulse to lock onto, so the tempo and bar grid are approximate. The chord sequence itself is what to trust.',
    theWholeSong: 'The whole song, mostly',

    // ChordLibrary
    chordLibrary: 'Chord library',
    everyChordStart: 'Every chord, and where to start',
    tapChordHear: 'Tap any chord to hear exactly the notes its diagram shows. Dots are fingers, numbers say which one.',
    howToReadBox: 'How to read a chord box',
    cMajorExample: 'C major, as an example',
    legendDescriptions: [
      'Six vertical lines are the strings — low E on the left, like looking at your own guitar stood upright.',
      'Horizontal lines are frets; the thick top line is the nut. A number beside the box means the diagram starts at that fret.',
      'Dots are fingertips, numbered index 1 to pinky 4. A long bar is one finger laid flat across the strings — a barre.',
      'Above the box, ○ means let that string ring open, ✕ means don\'t play it.',
    ],
    startWithEight: 'Start with these eight',
    learnThemOrder: 'Learn them in this order, two at a time — and practise the switch, not the shape: four slow beats on one chord, four on the next, around and around. Every open-position song is some subset of these.',
    everyChordBook: 'Every chord in the book',
    anyRoot: 'Any root',
    noBarre: 'No barre',
    barreOnly: 'Barre only',
    anyHands: 'Any hands',
    allChordQualities: 'All',
    majorQuality: 'Major',
    minorQuality: 'Minor',
    dom7Quality: '7',
    min7Quality: 'm7',
    maj7Quality: 'maj7',
    sus4Quality: 'sus4',
    sus2Quality: 'sus2',
    qualityBlurbs: {
      maj: 'Bright and settled — the home base most songs return to.',
      min: 'The third drops a fret and the mood drops with it.',
      dom7: 'A major chord plus a flat seventh: bluesy tension that wants to resolve home.',
      min7: 'A minor chord with the edges sanded off — softer than plain minor.',
      maj7: 'Dreamy and unhurried; the bossa nova and bedroom-pop chord.',
      sus4: 'The third is swapped for the note above it, and the ear waits for it to land.',
      sus2: 'Open and airy — neither major nor minor until you decide.',
    },
    wholeVocabulary: 'Seven qualities on twelve roots — the whole vocabulary the transcriber can hear.',
    shownCount: (count: number) => `${count} shown`,
    starterTips: [
      'Two fingers, every string rings. The first chord.',
      'The Em fingers, moved over one string.',
      'A little triangle. Strum the top four strings only.',
      'A stretch at first — let the wrist come forward.',
      'Skip the low E, and arch fingers so strings ring.',
      'Em plus one finger. Bright and full.',
      'Three fingers squeezed into one fret line.',
      'The moody one. Top four strings again.',
    ],
    openFirstWeek: 'open · first-week friendly',
    openPractice: 'open · takes some practice',
    fullBarre: 'full barre',
    levelText: (note: string | null, difficulty: number): string => {
      if (note) return note;
      if (difficulty === 1) return 'open · first-week friendly';
      if (difficulty === 2) return 'open · takes some practice';
      return 'full barre';
    },
    whenShapeFights: 'When a shape still fights you',
    shapeTips: [
      'Press just behind the fret wire, not on top of it — half the pressure, twice the ring.',
      'Arch the fingers and land on the very tips, so they stop touching the strings below.',
      'A dead note is information: pluck the strings one at a time and fix the one that buzzes.',
      'Barres come months in, not days. Until then the capo and the easier stand-ins on the tab screen exist exactly for this.',
    ],
    playChord: (name: string) => `Play ${name}`,

    // Practice screen
    turnPhoneSideways: 'Turn your phone sideways',
    sidewaysNeeded: 'Practice mode scrolls the chords past a playhead, and that needs the long edge of the screen.',
    exit: 'Exit',
    next: 'next',
    nextChord: (name: string) => `${name}, the next chord`,
    lastChord: 'last chord',
    nextIn: (beats: number) => ` · in ${beats}`,
    howThisWorks: 'How this screen works',
    practiceHints: [
      (beatsPerBar: number) => `Press play for a ${beatsPerBar}-beat count-in, then change chords as each block reaches the amber line.`,
      'The bar below scrubs the song, and ±10 jumps around it. The loop button repeats the section you are in.',
      'Speed already starts where the changes are playable, and slows the song without changing its pitch. Volume sits behind the speaker button.',
      'Space plays and pauses · ← → skip five seconds.',
    ],
    gotIt: 'Got it',
    backToTab: 'Back to the tab',
    backStart: 'Back to the start',
    backTenSeconds: 'Back ten seconds',
    play: 'Play',
    pause: 'Pause',
    forwardTenSeconds: 'Forward ten seconds',
    loopSection: 'Loop this section',
    metronome: 'Metronome',
    songPosition: 'Song position',
    practiceSpeed: 'Practice speed',
    playbackVolume: 'Playback volume',
    strum: 'strum',
    barOf: (current: number, total: number) => `Bar ${current} of ${total}`,
    analyzeProgress: (stage: string) => `${stage}…`,
    workingItOut: 'Working it out',
    allRunsDevice: 'All of this runs on your device. Nothing is uploaded.',
    thatDidNotWork: 'That did not work',
    startOver: 'Start over',
    readingFile: 'reading the file',
    couldNotDecode: 'That file could not be decoded. Try an MP3, M4A, WAV or OGG.',
    recordingTooShort: 'That recording was too short to work with.',
    analysisFailed: 'The analysis failed.',

    // Format functions
    daysAgo: (days: number): string => {
      if (days <= 0) return 'today';
      if (days === 1) return 'yesterday';
      if (days < 30) return `${days} days ago`;
      return '';
    },
  },

  zh: {
    // Topbar and navigation
    chords: '和弦',
    home: '主页',
    language: '中文',

    // Home screen
    eyebrowGuitarTabs: '凭听觉识谱',
    h1PlayNearMic: '在麦克风前弹一首歌。',
    h1GetTab: '得到初学者能演奏的谱。',
    ledeParagraph: 'geetaab 识别和弦、调性和速度，然后改写成初学者已知的和弦形状——包括变调夹。你可以像唱卡拉OK一样练习它，可以横放手机，还可以选择任意速度。',
    listenWithMic: '用麦克风听',
    orText: '或者 ',
    blocksMicrophone: '你的浏览器阻止了麦克风访问——',
    openAudioFile: '打开音频文件',
    tryDemo: '试试演示',
    yourSongs: '你的歌曲',
    storedOnDevice: '仅保存在此设备上。',
    deleteLabel: (title: string) => `删除 ${title}`,
    deleteTitle: '删除',
    capoText: (capo: number) => `变调夹 ${capo}`,
    noCapo: '无变调夹',
    whatComesOut: '输出示例',
    everyExampleReal: '下面的每个示例都是真实输出，不是模型。',
    shapesYouKnow: '你已经掌握的指法',
    shapesDescription: '一首 E♭ 的歌里有四个横按和弦。geetaab 在第三品放上变调夹，给你 C、G、Am 和 Fmaj7。',
    loopNotWhole: '循环段，而不是整首歌',
    loopDescription: '大多数歌都是一个进行重复。geetaab 找到它，告诉你它覆盖多少音轨，这样你学四小节而不是三分钟。',
    practiceSideways: '横放手机练习',
    sidewaysDescription: '把手机横放，和弦会在回放指针下滚动，还有预备拍、节拍器、循环段和不改变音高的减速。',
    howItWorks: '它是如何工作的',
    noServerDownload: '无服务器，无模型下载。一切都在这个标签页中进行。',
    listens: '它在听',
    listensDescription: '每秒多次测量十二个音高级，首先计算出录音自身的音准——所以一首音频略微升调的歌也能正确识别。',
    findsThePulse: '它找到节奏',
    findsDescription: '从音符起音点获得速度，节拍器在整个录音上铺设网格，和弦变化落在拍子上而不是拍子之间。',
    picksChords: '它选择和弦',
    picksDescription: '每个拍子与建模真实泛音的和弦模板匹配，然后平滑为演奏者会记下的几个变化。',
    rewritesHands: '它为你的手重新改写',
    rewritesDescription: '变调夹放在最能把歌放在开放和弦上的地方，其余的用老师会用的替代品。',
    everythingRunsBrowser: '一切都在这个浏览器标签页中运行：没有音频被上传，你的歌曲只保存在这个设备上。和弦是机器识别——相信你的耳朵。',
    geetaabOpenSource: 'geetaab 是开源的',

    // Listening screen
    waitingForSong: '等待歌曲',
    recording: '正在录音',
    hearingNow: '正在听',
    tooLoud: '太响——远离扬声器。',
    veryQuiet: '很安静。靠近一点，或者开大音量。',
    hearRoom: '能听到房间声音，但还没有歌曲。当音乐开始时录音会自动开始。',
    playTheSong: '播放歌曲——我会跟上',
    recordAnyway: '仍然录音',
    workingText: '处理中…',
    keepGoing: (seconds: number) => `继续… ${seconds}秒`,
    stopBuildTab: '停止并生成指法',
    microphone: '麦克风未打开',
    recordingTips: [
      '录音会等待音乐，所以随时播放歌曲。',
      '把手机对着扬声器，大约一臂长的距离。',
      '录下一个副歌。三十秒的你想弹的部分就足够了。',
      '安静的房间，不要跟唱——声音会混淆和声。',
      '用吉他或钢琴演奏的歌效果最好；重度制作的歌效果最差。',
    ],
    cancel: '取消',
    back: '返回',

    // TabView screen
    songTitle: '歌曲标题',
    nameThisSong: '给这首歌命名',
    confirmTitle: '确认标题',
    capo: '变调夹',
    strumming: '扫弦',
    level: '难度',
    easy: '简单',
    standard: '标准',
    faithful: '精确',
    easyHint: '较少、较简单的变化——扩展和快速经过的和弦被省略。',
    standardHint: '歌曲的每个变化，用初学者能指的和弦。',
    faithfulHint: '录音中正确的所有内容——七和弦、挂留和弦等。',
    fretNth: (fret: number) => `第 ${fret} 品`,
    tempoReading: '速度读数',
    halfTime: '半速',
    doubleTime: '倍速',
    chordsYouNeed: '你需要的和弦',
    makeItFitHands: '让它适合你的手',
    subbedFor: (chord: string) => `${chord} 的简易替代`,
    soundsAs: (chord: string) => `听起来像 ${chord}`,
    stillNeeds: (chords: string, count: number) => `${chords} ${count === 1 ? '仍需要' : '仍需要'} 横按。下面试试另一个变调夹位置，或者只弹前四根弦，直到和弦稳定。`,
    suggested: '——推荐',
    capoPlay: (fret: number, key: string) => `变调夹 ${fret} · 弹 ${key}`,
    noCapoText: '无变调夹',
    wholeLoop: (bars: number, coverage: number) => `这个 ${bars} 小节循环覆盖了你录音的 ${Math.round(coverage * 100)}%。学一次，你就有了大部分歌。`,
    learnOnce: '学一次，你就有了大部分歌。',
    openShapes: (ratio: number) => `开放和弦已覆盖本歌的 ${Math.round(ratio * 100)}%，所以变调夹不会有太大帮助。`,
    withCapo: (fret: number, key: string, ratio: number) => `变调夹在第 ${fret} 品时，你指的是 ${key} 的形状，房间听起来是 ${translateKeyName(key, 'zh')}。${Math.round(ratio * 100)}% 的歌落在开放和弦上。`,
    chordChart: '和弦谱',
    wholeSong: '整首歌',
    justLoop: '仅循环段',
    tablature: '六线谱',
    printTab: '打印指法',
    copyTab: '复制整个指法为文本',
    copied: '已复制',
    practiseThis: '练习这个',
    lowConfidence: '和声很弱，所以这些和弦是粗略猜测。更清晰的录音——或音频文件而不是房间录音——效果会好得多。',
    freeTime: '这首歌自由演奏——没有稳定的节奏可锁定，所以速度和小节网格是近似的。和弦序列才是可信的。',
    theWholeSong: '整首歌，大部分',

    // ChordLibrary
    chordLibrary: '和弦库',
    everyChordStart: '每个和弦，以及从哪里开始',
    tapChordHear: '点击任何和弦可听到其图表显示的确切音符。点是手指，数字说是哪一个。',
    howToReadBox: '如何读懂和弦框',
    cMajorExample: 'C 大调，作为示例',
    legendDescriptions: [
      '六条竖线是琴弦——左边是低 E，就像看自己立着的吉他。',
      '水平线是品数；粗上线是琴头。盒子旁的数字表示图表从那个品开始。',
      '点是指尖，从食指 1 到小指 4 编号。长条是一根手指平放在琴弦上——横按。',
      '盒子上方，○ 表示让那根弦开放，✕ 表示不弹它。',
    ],
    startWithEight: '从这八个开始',
    learnThemOrder: '按这个顺序学它们，两个两个——练习转换，不是形状：在一个和弦上四拍，下一个四拍，反复。每首开放位置歌都是这些的某个子集。',
    everyChordBook: '书中的每个和弦',
    anyRoot: '任何根音',
    noBarre: '无横按',
    barreOnly: '仅横按',
    anyHands: '任何手',
    allChordQualities: '全部',
    majorQuality: '大调',
    minorQuality: '小调',
    dom7Quality: '7',
    min7Quality: '小7',
    maj7Quality: '大7',
    sus4Quality: '挂4',
    sus2Quality: '挂2',
    qualityBlurbs: {
      maj: '明亮而稳定——大多数歌都回到的家。',
      min: '第三音下降一个半音，情绪也随之下降。',
      dom7: '大调和弦加平七度：忧郁的张力，想要回家。',
      min7: '小调和弦但边缘圆滑——比普通小调柔和。',
      maj7: '梦幻而不匆忙；波萨诺瓦和卧室流行和弦。',
      sus4: '第三音换成上面的音，耳朵等它落下来。',
      sus2: '开放而通透——既不是大调也不是小调，由你决定。',
    },
    wholeVocabulary: '七个质量乘以十二个根音——识别器能听到的整个词汇。',
    shownCount: (count: number) => `显示 ${count} 个`,
    starterTips: [
      '两个手指，每根弦都响。第一个和弦。',
      'Em 的手指，移过一根弦。',
      '一个小三角形。仅弹前四根弦。',
      '起初有难度——让手腕向前。',
      '跳过低 E，手指拱起以至于不触及下面的弦。',
      'Em 加一个手指。明亮而饱满。',
      '三个手指紧挤在一个品位线上。',
      '忧郁的那个。前四根弦。',
    ],
    openFirstWeek: '开放 · 第一周友好',
    openPractice: '开放 · 需要练习',
    fullBarre: '完全横按',
    levelText: (note: string | null, difficulty: number): string => {
      if (note) return note;
      if (difficulty === 1) return '开放 · 第一周友好';
      if (difficulty === 2) return '开放 · 需要练习';
      return '完全横按';
    },
    whenShapeFights: '当和弦形状仍然困难时',
    shapeTips: [
      '按在品线后面，不是上面——一半的压力，两倍的响度。',
      '手指拱起，落在尖端，这样它们不会接触下面的弦。',
      '死音是信息：逐根弹琴弦，修复嗡嗡声的那根。',
      '横按需要几个月，不是几天。在那之前，变调夹和指法屏幕上的简易替代存在正是为了这个。',
    ],
    playChord: (name: string) => `演奏 ${name}`,

    // Practice screen
    turnPhoneSideways: '把你的手机横放',
    sidewaysNeeded: '练习模式在回放指针下滚动和弦，这需要屏幕的长边。',
    exit: '退出',
    next: '下一个',
    nextChord: (name: string) => `${name}，下一个和弦`,
    lastChord: '最后的和弦',
    nextIn: (beats: number) => ` · 在 ${beats} 拍`,
    howThisWorks: '这个屏幕如何工作',
    practiceHints: [
      (beatsPerBar: number) => `按播放进行 ${beatsPerBar} 拍预备拍，然后当每个块到达琥珀线时改变和弦。`,
      '下面的条拖动歌曲，±10 在周围跳跃。循环按钮重复你所在的部分。',
      '速度已经在能演奏的地方开始，并以不改变音高的方式减速歌曲。音量在扬声器按钮后面。',
      '空格播放和暂停 · ← → 跳过五秒。',
    ],
    gotIt: '明白了',
    backToTab: '返回指法',
    backStart: '返回开始',
    backTenSeconds: '后退十秒',
    play: '播放',
    pause: '暂停',
    forwardTenSeconds: '前进十秒',
    loopSection: '循环此部分',
    metronome: '节拍器',
    songPosition: '歌曲位置',
    practiceSpeed: '练习速度',
    playbackVolume: '播放音量',
    strum: '扫弦',
    barOf: (current: number, total: number) => `第 ${current}/${total} 小节`,
    analyzeProgress: (stage: string) => `${stage}…`,
    workingItOut: '处理中',
    allRunsDevice: '所有这些都在您的设备上运行。没有上传任何内容。',
    thatDidNotWork: '这不起作用',
    startOver: '重新开始',
    readingFile: '读取文件',
    couldNotDecode: '该文件无法解码。请尝试 MP3、M4A、WAV 或 OGG。',
    recordingTooShort: '该录音太短。',
    analysisFailed: '分析失败。',

    // Format functions
    daysAgo: (days: number): string => {
      if (days <= 0) return '今天';
      if (days === 1) return '昨天';
      if (days < 30) return `${days} 天前`;
      return '';
    },
  },
} as const;

type Dictionary = typeof dictionary;

interface LanguageContextType {
  lang: Language;
  setLang: (lang: Language) => void;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(() => {
    // Try to get from localStorage first
    try {
      const stored = localStorage.getItem('geetaab-lang');
      if (stored === 'zh' || stored === 'en') {
        return stored;
      }
    } catch {
      // localStorage access blocked
    }

    // Fall back to navigator language
    if (typeof navigator !== 'undefined' && navigator.language.startsWith('zh')) {
      return 'zh';
    }

    return 'en';
  });

  const setLang = (newLang: Language) => {
    setLangState(newLang);
    try {
      localStorage.setItem('geetaab-lang', newLang);
    } catch {
      // localStorage access blocked
    }
    document.documentElement.lang = newLang === 'zh' ? 'zh-CN' : 'en';
  };

  // Set initial document lang
  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  }, [lang]);

  return (
    <LanguageContext.Provider value={{ lang, setLang }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): [Language, (lang: Language) => void] {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within LanguageProvider');
  }
  return [context.lang, context.setLang];
}

export function useT(): Dictionary[Language] {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useT must be used within LanguageProvider');
  }
  return dictionary[context.lang];
}

// Helper to translate key names
export function translateKeyName(name: string, lang: Language): string {
  return lang === 'zh' ? name.replace(' major', ' 大调').replace(' minor', ' 小调') : name;
}
