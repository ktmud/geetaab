import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Language = 'en' | 'zh';

export const dictionary = {
  en: {
    // Topbar and navigation
    chords: 'Chords',
    home: 'Home',
    language: 'EN',
    lightTheme: 'Light',
    darkTheme: 'Dark',
    switchToLight: 'Switch to the light theme',
    switchToDark: 'Switch to the dark theme',

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
    dropToOpen: 'Drop the audio file to open it',
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
    noMusicDetected: 'No music detected',
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
    discardTake: 'Discard this take',
    backHome: 'Back to home',
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
    capoChip: (fret: number) => `Capo ${fret}`,
    capoPlayIn: (fret: number, key: string) => `Capo ${fret} · play in ${key}`,
    printCapo: (fret: number, key: string) => `capo on fret ${fret}, shapes read in ${key}`,
    printNoCapo: 'no capo',
    printKeyLabel: 'Key',
    printUntitled: 'Untitled song',
    printSubFor: (label: string) => `for ${label}`,
    printSoundsAs: (label: string) => `sounds as ${label}`,
    printLoopLine: (percent: number) => `The loop, ${percent}% of the song:`,
    printChordChart: 'Chord chart',
    printTablature: 'Tablature',
    printFoot: 'geetaab — a machine transcription. Trust your ears over it.',
    printDiagramTitle: (label: string) => `${label} chord diagram`,
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
    /* Keyed by the stage name the worker reports, so the analysis stays free of
       display strings. */
    stages: {
      'getting started': 'getting started',
      'reading the file': 'reading the file',
      resampling: 'resampling',
      'finding the beat': 'finding the beat',
      'listening for chords': 'listening for chords',
      'working out the changes': 'working out the changes',
      'naming the key': 'naming the key',
      done: 'done',
    } as Record<string, string>,
    couldNotDecode: 'That file could not be decoded. Try an MP3, M4A, WAV or OGG.',
    recordingTooShort: 'That recording was too short to work with.',
    analysisFailed: 'The analysis failed.',

    // How chords are recognized (the explainer page)
    howChordsRecognized: 'How chords are recognized',
    hwEyebrow: 'Inside the analysis',
    hwTitle: 'How Chords Are Recognized',
    hwLede:
      'Turn a guitar recording into a chord chart you can actually play — what\'s the computer doing inside?',
    hwStepsLabel: 'Stage navigation',
    hwSteps: [
      'Overview',
      'Listen',
      'FFT',
      'Chroma',
      'Match',
      'Smooth',
      'Tempo',
      'Key',
      'Chart',
    ],
    hwOverview: 'Overview',
    hwStageLabel: (n: number) => `Stage ${n}`,
    hwStages89: 'Stages 8–9',
    hwNodes: ['Listen', 'FFT', 'Chroma', 'Match', 'Smooth', 'Tempo', 'Key', 'Adapt', 'Chart'],
    hwOverviewAria:
      'Diagram: the nine-stage signal path from raw audio to a finished chord chart, teal for raw measurement turning amber at the point a chord is decided.',
    hwOverviewCaption:
      'The complete signal path from raw audio to final chord chart. Teal indicates raw measurement; copper indicates final decisions. From stage 5 onward, raw measurements become trustworthy answers.',

    hwS1Title: 'Listen Before Recording',
    hwS1P1:
      'The microphone is always listening, but the app won\'t start recording unless it\'s confident real music is playing. Without this gate, every take would begin with three seconds of rustling as you pull your phone from your pocket.',
    hwS1P2: 'Every fraction of a second, the app checks five things:',
    hwS1Terms: ['Loudness', 'Tonality', 'Steadiness', 'Activity', 'Chord shape'],
    hwS1Descs: [
      ' — louder than room noise?',
      ' — is energy concentrated on a few pitch classes, or smeared across all twelve? (Broadband noise fails this.)',
      ' — does the harmony hold still for about a quarter-second? (A gliding voice fails this.)',
      ' — does loudness breathe and change over time? (A steady electrical hum fails this.)',
      ' — does it roughly match a chord template?',
    ],
    hwS1P3a:
      'All five must clear at once, for several ticks in a row, before recording truly begins. This sounds simple, but it\'s genuinely tricky — a real voice-activity detector sounds like the obvious tool, except they\'re trained to ',
    hwS1P3Em: 'reject',
    hwS1P3b:
      ' music (they\'re built for speech), so using one would backfire. Plus downloading any model would violate the app\'s core promise: "nothing but the page itself ever downloads." So this gate is pure signal processing, no machine learning.',
    hwS1Cols: ['Loud', 'Tonal', 'Steady', 'Breathe', 'Chord'],
    hwS1Rows: ['Music', 'Noise', 'Speech', 'Hum'],
    hwS1Aria:
      'Diagram: the five checks the music gate applies — level, tonality, steadiness, activity and chord match — all of which must pass at once before recording starts.',
    hwS1Caption:
      'The five checks compared. Only when all five pass (all copper circles) does the app trust that real music is playing.',

    hwS2Title: 'FFT: Breaking Sound Into Frequencies',
    hwS2P1:
      'Any real sound is many pure tones layered together. An FFT takes a short slice of the waveform (roughly a tenth of a second) and re-expresses it as: how much energy is at each individual frequency? The output looks like a bar chart — tall spikes where strings are ringing, nearly zero everywhere else.',
    hwS2Waveform: 'Waveform',
    hwS2Spectrum: 'Spectrum',
    hwS2Low: 'Low',
    hwS2High: 'High',
    hwS2RealString: 'Real string',
    hwS2Harmonics: 'Harmonics',
    hwS2Aria:
      'Diagram: a waveform on the left transformed by FFT into a bar spectrum on the right, where a few tall bars mark the frequencies of strings actually ringing.',
    hwS2Caption:
      'A waveform (left) transforms into a frequency bar chart (right) via FFT. Each bar is one frequency\'s energy. Real notes spike; silence stays near zero. The tallest spike is a string\'s own pitch, and the shorter ones beside it are its overtones.',

    hwS3Title: 'Chroma: Folding Into 12 Pitch Classes',
    hwS3P1a: 'For chords, a low E and a high E an octave up are "the same note" — a chord is a ',
    hwS3P1Em: 'set',
    hwS3P1b:
      ' of note names, not exact pitches. So every spike from the FFT gets folded: all C\'s (at any octave) add energy into one C bucket; same for C#, D, up to B. The result is always exactly 12 numbers, regardless of how the guitar was voiced.',
    hwS3P2:
      'Before folding, the app measures how far the recording sits from "standard tuning" (A=440 Hz). Recordings made off a speaker, or a guitar tuned slightly flat, are often 20–40 cents off — enough that energy splits across two neighbouring buckets and every chord reads as ambiguous. The app automatically corrects for this tuning shift.',
    hwS3LowC: 'Low C',
    hwS3MidC: 'Mid C',
    hwS3HighC: 'High C',
    hwS3Chroma: 'Chroma',
    hwS3Buckets: 'One bucket per note name',
    hwS3Aria:
      'Diagram: the same note name at several octaves, each folded by an arrow into a single one of twelve pitch-class buckets labelled C through B.',
    hwS3Caption:
      'All C\'s at any octave fold into one bucket, so energy from every octave merges into the same twelve numbers. This chroma fingerprint is enough for chord recognition.',

    hwS4Title: 'Template Matching: Finding the Best Fit',
    hwS4P1:
      'The app holds 84 template fingerprints — 12 roots × 7 chord qualities (maj, min, dom7, min7, maj7, sus4, sus2). Each template isn\'t just the chord\'s bare notes; it also includes each note\'s first several harmonics, because a plucked string\'s energy isn\'t only at its pitch, it rings with a whole ladder of overtones. A template that didn\'t expect those overtones would mistake them for extra notes that aren\'t there.',
    hwS4P2:
      'The 12-number fingerprint from stage 3 is now compared against all 84 templates. Each gets a similarity score — think of it as 84 small bar charts laid side by side, with the tallest bar being the best-matching chord at this instant.',
    hwS4Measured: 'Measured',
    hwS4BestMatch: 'best match',
    hwS4Aria:
      'Diagram: the measured twelve-number chroma fingerprint compared against candidate chord templates, with the closest match highlighted.',
    hwS4Caption:
      'The measured 12-number fingerprint (top) against 84 chord templates. The best-matching template (copper highlight) is the most likely chord at this moment.',

    hwS5Title: 'Viterbi Smoothing: From Flicker to Flow',
    hwS5P1:
      'If the app chose the highest-scoring chord independently frame-by-frame, the answer would flicker — jumping several times a second, because decaying strum and normal noise wobble the scores moment to moment. But real players don\'t change chords eight times per second.',
    hwS5P2a: 'So instead of picking each frame\'s winner independently, the app finds the single best ',
    hwS5P2Em: 'path',
    hwS5P2b:
      ' through time that balances "matches what was heard" against "changing chords costs something" — like autocorrect for a sentence, keeping the same word unless the evidence is overwhelming. This turns frame-by-frame flicker into a clean, confident chart with one or two chord changes per bar.',
    hwS5Raw: 'Raw',
    hwS5RawSub: 'frame-by-frame',
    hwS5Smoothed: 'Smoothed',
    hwS5SmoothedSub: 'Viterbi',
    hwS5Aria:
      'Diagram: raw per-instant chord guesses flickering between several chords on the top row, and below on the same time axis the Viterbi-smoothed result holding one chord per bar.',
    hwS5Caption:
      'Raw frame-by-frame guesses (top) jump wildly. Viterbi (bottom) finds the best path through time, making chord changes meaningful and smooth.',

    hwS6Title: 'Tempo and Free Time',
    hwS6P1:
      'The app separately tracks how loudness rises and falls over time (an "onset" curve) and looks for repeating gaps between peaks — that gap is the beat. But it also checks whether that repetition is actually reliable: some songs (tender ballads, fingerstyle arrangements) never lock into steady pulse, and forcing a grid onto them is just a confident lie. When rhythm is too weak to trust, the app says honestly "this song is free-time," stops using the beat grid, and reads chord boundaries straight from the harmony instead.',
    hwS6Onset: 'Onset curve',
    hwS6BeatInterval: 'beat interval',
    hwS6Aria:
      'Diagram: a loudness envelope with tick marks under its peaks, the even gap between adjacent ticks marking the beat.',
    hwS6Caption:
      'Loudness over time. Peaks in the curve mark beats. The distance between adjacent beats tells us the song\'s speed.',

    hwS7Title: 'Key: Finding Home',
    hwS7P1:
      'Using the same 12-number idea (this time built up over the whole song, weighted by how long each chord rang), the app correlates against 24 template fingerprints — one per major and minor key — and picks the best match. Like humming a scale to yourself and noticing which one "feels like home."',
    hwS7SongChroma: 'Song\'s chroma',
    hwS7Candidates: 'Key candidates',
    hwS7Best: 'best',
    hwS7Aria:
      'Diagram: the whole song\'s accumulated chroma fingerprint compared against several candidate key profiles, with the best-matching key highlighted.',
    hwS7Caption:
      'The song\'s accumulated chroma (top) correlated against key templates. The best match (copper) is the key.',

    hwS89Title: 'Arranging for Beginner Hands',
    hwS89P1: 'Finally, the raw chord sequence is adapted for a beginner\'s hands:',
    hwS89Terms: ['Choose capo', 'Swap hard chords', 'Multiple levels'],
    hwS89Descs: [
      ' — pick a capo position that puts as many chords as possible on easy open shapes.',
      ' — replace genuinely hard chords with the easy stand-ins a teacher would suggest. F becomes Fmaj7, Bm becomes Bm7.',
      ' — for busy songs, offer up to three versions: easy (sevenths and suspensions folded away), standard (beginner reading), faithful (every extension kept). Only when they actually differ.',
    ],
    hwS89Final: 'Final output',
    hwS89Strum: 'v = down-strum',
    hwS89Aria:
      'Diagram: a short chord chart as the player finally receives it, chord names above simple strum marks.',
    hwS89Caption:
      'The final step\'s output: a readable chord chart, already adjusted for beginner fingers. Chord names sit above each bar, strumming direction below.',

    hwLimitsTitle: 'Honest Limits',
    hwLimitsIntro:
      'This app has been tested against real, independently-published guitar tabs across many genres (Chinese pop ballads, a Taylor Swift song, a film score). It is good, not perfect. Worth knowing:',
    hwLimitTerms: [
      'Accuracy: 94% average',
      'Genuine hard problems',
      'Only 84 chord qualities modeled',
    ],
    hwLimitAccuracyLead:
      ' Across seven real songs against published tabs, root-and-major/minor-family agreement averaged ',
    hwLimitAccuracyTail:
      ', ranging 87%–99%. The algorithm puts a beginner\'s hand on the right basic chord shape the overwhelming majority of the time.',
    hwLimitHardIntro: ' (not bugs) were found and honestly disclosed:',
    hwLimitHardItems: [
      'A chord quality differing by one note one semitone away (like Em vs Esus2) is fundamentally the hardest pair to tell from a 12-number fingerprint, especially in fingerpicked passages where notes don\'t sound at once.',
      'Telling a song\'s home key (I) from its dominant (V) — the two are harmonic cousins — is a known hard problem for this style of key detection, similar to the "is this 70 BPM or 140 BPM" tempo octave ambiguity that no signal analysis fully resolves.',
    ],
    hwLimitVocab:
      ' (no add9, no diminished, no augmented) — a chord outside this vocabulary comes back as the closest thing inside it.',
    hwClosing:
      'So next time someone asks "how does the computer hear chords?", now you know: it starts by listening for music, runs the audio through Fourier and chroma and templates, smooths frame-by-frame flicker into sustained decisions, finds the beat and the key, and adapts the result for beginner hands. Simple is hard.',
    hwClosingLink: 'geetaab is open source · view it on GitHub',

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
    lightTheme: '浅色',
    darkTheme: '深色',
    switchToLight: '切换到浅色主题',
    switchToDark: '切换到深色主题',

    // Home screen
    eyebrowGuitarTabs: '凭听觉识谱',
    h1PlayNearMic: '随听随弹，',
    h1GetTab: '跟唱跟学。',
    ledeParagraph: 'geetaab 可以根据录音识别和弦、调性和速度，再改写成顺手的和弦指法——连变调夹的位置也替你选好。横过手机，像唱卡拉 OK 一样跟着练，快慢由你。',
    listenWithMic: '用麦克风听',
    orText: '或者 ',
    blocksMicrophone: '你的浏览器阻止了麦克风访问——',
    openAudioFile: '打开音频文件',
    tryDemo: '试试演示',
    dropToOpen: '松开，就用这个音频开始',
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
    noMusicDetected: '没有识别到音乐',
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
    discardTake: '放弃这一遍，重录',
    backHome: '回主页',
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
    capoChip: (fret: number) => `变调夹第 ${fret} 品`,
    capoPlayIn: (fret: number, key: string) => `变调夹第 ${fret} 品 · 按 ${key} 的指法`,
    printCapo: (fret: number, key: string) => `变调夹夹第 ${fret} 品，按 ${key} 的指法`,
    printNoCapo: '不用变调夹',
    printKeyLabel: '调',
    printUntitled: '未命名',
    printSubFor: (label: string) => `代替 ${label}`,
    printSoundsAs: (label: string) => `实际发声 ${label}`,
    printLoopLine: (percent: number) => `循环段，占全曲 ${percent}%：`,
    printChordChart: '和弦谱',
    printTablature: '六线谱',
    printFoot: 'geetaab —— 机器转谱，请以你的耳朵为准。',
    printDiagramTitle: (label: string) => `${label} 和弦图`,
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
    stages: {
      'getting started': '准备开始',
      'reading the file': '读取文件',
      resampling: '重采样',
      'finding the beat': '找出拍子',
      'listening for chords': '听出和弦',
      'working out the changes': '理出和弦变化',
      'naming the key': '判断调性',
      done: '完成',
    } as Record<string, string>,
    couldNotDecode: '该文件无法解码。请尝试 MP3、M4A、WAV 或 OGG。',
    recordingTooShort: '该录音太短。',
    analysisFailed: '分析失败。',

    // How chords are recognized (the explainer page)
    howChordsRecognized: '和弦是怎么听出来的',
    hwEyebrow: '算法内部',
    hwTitle: '和弦是怎么听出来的',
    hwLede: '一段吉他弹唱，怎么变成一张能照着弹的和弦谱？下面是电脑在这中间做的每一件事。',
    hwStepsLabel: '阶段导航',
    hwSteps: ['总览', '检测', 'FFT', '色度', '匹配', '平滑', '节拍', '调性', '成谱'],
    hwOverview: '总览',
    hwStageLabel: (n: number) => `第 ${n} 阶段`,
    hwStages89: '第 8、9 阶段',
    hwNodes: ['检测', 'FFT', '色度', '匹配', '平滑', '节拍', '调性', '改编', '成谱'],
    hwOverviewAria:
      '示意图：从原始音频到成品和弦谱的九个阶段。青色代表尚未定论的测量，进入决策阶段后转为琥珀色。',
    hwOverviewCaption:
      '整条信号通路。青色是还在测量的部分，琥珀色是已经拿定主意的部分；从第 5 阶段起，逐帧的测量变成了可以写进谱子的答案。',

    hwS1Title: '先听懂，再开录',
    hwS1P1:
      '麦克风一直开着，但只有确认真的有音乐在响，应用才会开始录。少了这道关卡，每一条录音的头三秒都是把手机从口袋里掏出来的窸窣声。',
    hwS1P2: '每隔几十毫秒，应用会同时问五个问题：',
    hwS1Terms: ['响度', '音高集中度', '稳定度', '起伏', '和弦形状'],
    hwS1Descs: [
      '——比房间底噪更响吗？',
      '——能量是聚在少数几个音级上，还是摊平在十二个音上？宽带噪声过不了这一关。',
      '——这份和声能稳住大约四分之一秒吗？滑来滑去的人声过不了这一关。',
      '——响度会随时间起伏吗？稳定的电流嗡声过不了这一关。',
      '——它大致对得上某一张和弦模板吗？',
    ],
    hwS1P3a:
      '五关必须同时通过，而且要连着通过好几拍，录音才真正开始。听着简单，做起来很难：现成的语音活动检测器看似正合适，可它们生来是为语音服务的，训练目标恰恰是',
    hwS1P3Em: '排除',
    hwS1P3b:
      '音乐，拿来用只会适得其反。何况下载任何模型都会违背这个应用的承诺——除了页面本身，什么都不会从网上取。所以这道关卡纯靠信号分析，不含任何机器学习。',
    hwS1Cols: ['响度', '集中', '稳定', '起伏', '和弦'],
    hwS1Rows: ['音乐', '噪声', '人声', '嗡声'],
    hwS1Aria:
      '示意图：音乐关卡的五项检查——响度、音高集中度、稳定度、起伏和和弦匹配。四类声音里只有音乐能五项全过。',
    hwS1Caption: '四类声音在五项检查下的表现。只有五项全是琥珀色实心点，应用才相信真的有音乐在响。',

    hwS2Title: '傅里叶变换：把声音拆成一根根音高',
    hwS2P1:
      '真实的声音都是许多纯音叠在一起。傅里叶变换（FFT）取波形的一小段——大约十分之一秒——换一种方式表达：每一个频率上各有多少能量。结果像一排高低不齐的柱子，正在响的弦是高高的尖峰，其余地方几乎贴着零。',
    hwS2Waveform: '波形',
    hwS2Spectrum: '频谱',
    hwS2Low: '低频',
    hwS2High: '高频',
    hwS2RealString: '基音',
    hwS2Harmonics: '泛音',
    hwS2Aria: '示意图：左边的波形经 FFT 变成右边的柱状频谱，几根高柱标出真正在响的弦的频率。',
    hwS2Caption:
      '波形（左）经傅里叶变换成为频谱（右）。每根柱子是一个频率上的能量：真正在响的音会冒尖，静默处贴近零。最高的那根是弦本身的音高，旁边几根矮一些的是它的泛音。',

    hwS3Title: '色度：把音高折进十二个格子',
    hwS3P1a: '对和弦来说，低八度的 E 和高八度的 E 就是「同一个音」——和弦是一',
    hwS3P1Em: '组',
    hwS3P1b:
      '音名，而不是一组精确的频率。所以 FFT 里的每一根尖峰都会被折叠：所有八度上的 C 都把能量加进同一个 C 桶，C#、D 一直到 B 也各有一个桶。不管吉他按的是什么把位，结果永远是十二个数。',
    hwS3P2:
      '折叠之前，应用还会先量一量这份录音离标准音（A=440 Hz）有多远。对着音箱录的、或者吉他调得偏低的歌，常常差上 20 到 40 音分——足以让能量劈在相邻两个桶之间，让每个和弦都读得模棱两可。这个偏移会被自动校正掉。',
    hwS3LowC: '低音 C',
    hwS3MidC: '中音 C',
    hwS3HighC: '高音 C',
    hwS3Chroma: '色度',
    hwS3Buckets: '每个音名一个桶',
    hwS3Aria: '示意图：同一个音名在三个八度上，各由一支箭头折进十二个音名桶中的同一个，桶从 C 排到 B。',
    hwS3Caption:
      '任何八度上的 C 都折进同一个桶，各八度的能量最终汇成同样的十二个数。这份色度指纹，已经够用来认和弦了。',

    hwS4Title: '模板比对：找最像的那一张',
    hwS4P1:
      '应用备着 84 张模板指纹：12 个根音乘以 7 种和弦性质（大三、小三、属七、小七、大七、挂四、挂二）。模板里不只有和弦本身的音，还带上每个音的前几个泛音——真实的拨弦不会只在基频上出力，而是连着一整串泛音一起响。不把泛音算进去的模板，会把它们错当成多出来的音。',
    hwS4P2:
      '第 3 阶段量出的十二个数，现在要和这 84 张模板逐一比对，各得一个相似度分数。可以想成 84 根并排的柱子，最高的那根就是此刻最像的和弦。',
    hwS4Measured: '实测',
    hwS4BestMatch: '最像',
    hwS4Aria: '示意图：实测的十二数色度指纹与候选和弦模板逐一比对，最接近的一张被高亮。',
    hwS4Caption: '实测的十二个数（上）对上 84 张和弦模板。最接近的那一张（琥珀色高亮）就是这一刻最可能的和弦。',

    hwS5Title: '维特比平滑：从抖动到流畅',
    hwS5P1:
      '如果每一帧都各自挑分数最高的和弦，答案会不停抖动，一秒里跳好几次——衰减中的扫弦和寻常噪声，足以让分数上下晃动。可真正的弹奏者不会一秒换八次和弦。',
    hwS5P2a: '所以应用不逐帧挑赢家，而是在整条时间轴上找一条最好的',
    hwS5P2Em: '路径',
    hwS5P2b:
      '，同时权衡两件事：这条路径有多贴合听到的声音，以及换和弦本身要付出的代价。就像打字时的自动纠错——证据不够压倒性，就先按住不改。逐帧的抖动因此收成一张干净、笃定的谱子，每小节只有一两次变化。',
    hwS5Raw: '未平滑',
    hwS5RawSub: '逐帧猜测',
    hwS5Smoothed: '平滑后',
    hwS5SmoothedSub: '维特比',
    hwS5Aria:
      '示意图：上排是逐帧的原始猜测，在几个和弦之间乱跳；下排在同一条时间轴上，是维特比平滑后的结果，一小节稳住一个和弦。',
    hwS5Caption:
      '上排的逐帧猜测每几十毫秒就换一次；维特比（下排）在整条时间轴上找出最好的一条路，让和弦的变化既平稳又有意义。',

    hwS6Title: '节拍，以及自由节奏',
    hwS6P1:
      '应用另外还盯着响度随时间的起伏（一条「起音」曲线），从峰与峰之间找反复出现的间隔——那个间隔就是一拍。它同时会检查这种反复靠不靠得住：有些歌（深情的民谣、指弹改编）从来没有稳定的脉搏，硬套一张节拍网格，只是说得笃定的谎话。节奏弱到不可信的时候，应用会老实说这首歌是自由节奏，不再用网格，直接从和声本身读出和弦的边界。',
    hwS6Onset: '起音曲线',
    hwS6BeatInterval: '一拍',
    hwS6Aria: '示意图：一条响度包络曲线，峰下方是一排刻度，相邻刻度之间均匀的间隔就是一拍。',
    hwS6Caption: '响度随时间的起伏。曲线的峰就是一次击点，相邻两击之间的距离，就是这首歌的速度。',

    hwS7Title: '调性：找到这首歌的家',
    hwS7P1:
      '还是那十二个数，这次是整首歌累积起来的，按每个和弦响了多久加权。应用拿它去和 24 张模板指纹做相关——大调小调各 12 个——挑出最贴合的一张。就像自己哼一遍音阶，听哪一个「像回到家」。',
    hwS7SongChroma: '全曲色度',
    hwS7Candidates: '候选调',
    hwS7Best: '最像',
    hwS7Aria: '示意图：整首歌累积出的色度指纹与几张候选调性模板对比，最贴合的一个被高亮。',
    hwS7Caption: '整首歌累积的色度（上）与调性模板做相关。最贴合的那一个（琥珀色）就是这首歌的调。',

    hwS89Title: '改写成初学者的手能弹的谱',
    hwS89P1: '最后一步，是把原始的和弦序列改写给初学者的手：',
    hwS89Terms: ['挑变调夹位置', '换掉难和弦', '给出几档难度'],
    hwS89Descs: [
      '——找一个能让尽量多的和弦落在开放把位上的品位。',
      '——真正难按的和弦，换成老师会推荐的简单替代：F 换成 Fmaj7，Bm 换成 Bm7。',
      '——变化密集的歌最多给三个版本：简单版（收掉七音、挂留音和一带而过的经过和弦）、标准版（初学者的读法）、忠实版（保留每一个扩展音）。只有当三者确实不同时才会给。',
    ],
    hwS89Final: '成品',
    hwS89Strum: 'v 表示下扫弦',
    hwS89Aria: '示意图：演奏者最后拿到的一小段和弦谱，和弦名在上，扫弦记号在下。',
    hwS89Caption:
      '最后一步的产出：一张读得懂的和弦谱，已经为初学者的手指调整过。和弦名标在每小节上方，下方是扫弦方向。',

    hwLimitsTitle: '诚实的边界',
    hwLimitsIntro:
      '这个应用在多种曲风上做过检验，对照的是别人独立发布的真实吉他谱（华语流行民谣、一首 Taylor Swift、一段电影配乐）。它好用，但不完美。有几件事值得先知道：',
    hwLimitTerms: ['平均准确率 94%', '真正的难题', '只建模了 84 种和弦'],
    hwLimitAccuracyLead: '：七首真实歌曲对照已发布的谱，根音加大三／小三族的一致率平均为 ',
    hwLimitAccuracyTail: '，区间是 87% 到 99%。也就是说，绝大多数时候，它都能把初学者的手放在对的基本把位上。',
    hwLimitHardIntro: '（不是 bug）有两个，应用如实公开：',
    hwLimitHardItems: [
      '只差一个音、而且这个音只差半音的两种和弦性质（比如 Em 和 Esus2），是十二数指纹最难分辨的一对——尤其在指弹段落，音本来就不是同时响的。',
      '分不分得清一首歌的主调（I）和属调（V）——这两个是和声上的近亲——是这类调性检测公认的难题，性质上类似「这首歌到底是 70 BPM 还是 140 BPM」的速度八度歧义，任何信号分析都无法彻底解决。',
    ],
    hwLimitVocab: '（没有 add9，没有减和弦，没有增和弦）——词汇表之外的和弦，会以表内最接近的那一个回传。',
    hwClosing:
      '所以，下次有人问「电脑是怎么听出和弦的」，你已经可以回答了：先听出有没有音乐，再让声音穿过傅里叶、色度和模板，把逐帧的抖动收成站得住的判断，找出拍子和调，最后改写成初学者的手能弹的样子。把事情做简单，从来都不简单。',
    hwClosingLink: 'geetaab 是开源的 · 在 GitHub 上查看',

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
