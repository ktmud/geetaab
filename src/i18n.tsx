import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { ShapeNote } from './music/shapes';

export type Language = 'en' | 'zh';

export const dictionary = {
  en: {
    // Topbar and navigation
    chords: 'Chords',
    home: 'Home',
    language: 'Language',
    lightTheme: 'Light',
    darkTheme: 'Dark',
    switchToLight: 'Switch to the light theme',
    switchToDark: 'Switch to the dark theme',

    // Home screen
    eyebrowGuitarTabs: 'Guitar tabs, by ear',
    h1PlayNearMic: 'Play a song near your mic.',
    h1GetTab: 'Get a tab you can actually play.',
    ledeParagraph: 'Geetaab works out the chords, the key and the tempo, then rewrites the song in shapes a beginner already knows — capo included. Then you practise it karaoke-style, either way up you hold the phone, at whatever speed you can keep up with.',
    heroHears: 'hears',
    heroWrites: 'writes',
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
    whatComesOut: 'What comes out',
    everyExampleReal: 'Every example below is real output, not a mock-up.',
    shapesYouKnow: 'Shapes you already know',
    shapesDescription: 'A song in E♭ has four barre chords in it. Geetaab puts a capo on the third fret and hands you C, G, Am and an Fmaj7 instead.',
    loopNotWhole: 'The loop, not the whole song',
    loopDescription: 'Most songs are one progression repeated. Geetaab finds it and tells you how much of the track it covers, so you learn four bars instead of three minutes.',
    practiceAlong: 'Practise along',
    practiceAlongDescription: 'The chords scroll past a playhead, with a count-in, a click, section looping and slow-down that keeps the pitch. Either way up you hold the phone — sideways is the wider view.',
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
    privacyLink: 'Privacy',
    privacyEyebrow: 'Privacy',
    privacyTitle: 'Nothing you record leaves this device',
    privacyLede:
      'That is the whole policy. What follows is the detail behind it, written so you can check the claim rather than take it on trust — and everything here is a fact about this build, not a statement of intent.',
    privacySections: [
      {
        title: 'What happens to a recording',
        body: [
          'When you record through the microphone, or open an audio file, the audio is held in the memory of this browser tab. It is turned into chords by a few hundred lines of signal processing that were downloaded with the page and run inside it. There is no server in this app to send anything to: it makes no network requests of any kind after the page has loaded — no upload, no API call, no analytics beacon, nothing.',
          'The microphone is asked for at the moment you press record, and the browser decides whether to grant it. Nothing listens before that, and the stream is released when the take ends.',
        ],
      },
      {
        title: 'What is kept, and where',
        body: [
          'Songs you finish are saved in this browser, on this device, in its own database. Nobody else can read it — not the site, not another site, not us. A saved song holds its title, the chords and key and tempo that were worked out, your capo and strumming choices, and the recording itself when it is small enough to be worth keeping.',
        ],
        points: [
          'Three preferences: the theme, the language, and whether the practice screen has already explained itself.',
          'Deleting a song from the library deletes it, including its audio.',
          'Clearing this site\'s data in your browser removes all of it at once, and the app starts as though it were new.',
          'Nothing is synchronised. A song saved on your phone is not on your laptop, because there is nowhere in between.',
        ],
      },
      {
        title: 'What the host can see',
        body: [
          'The files that make up this page are served by a static host, which — like every web server — sees the request for them: an IP address, a browser version, a time. That is the ordinary record of a page being fetched, and it is all it can be, because the page asks it for nothing afterwards. There are no cookies, no trackers, no third-party scripts, and no fonts or images loaded from anywhere else; the typefaces and the icon ship with the page.',
        ],
      },
      {
        title: 'Music you did not write',
        body: [
          'A tab worked out from a recording is a machine transcription of what it heard, and the recording may well be of something someone else owns. What you do with either is between you and whoever holds the rights — this app has no view on it and no way to have one, since it never sees what you played.',
        ],
      },
    ],
    privacyClosing:
      'If any of this stops being true, it stops being true in the open: the code is public, and this page is part of the change.',



    // Listening screen
    waitingForSong: 'Waiting for the song',
    recording: 'Recording',
    hearingNow: 'hearing now',
    noMusicDetected: 'No music detected',
    tooLoud: 'Too loud — move further from the speaker.',
    veryQuiet: 'Very quiet. Move closer, or turn the song up.',
    /**
     * Shown under the "very quiet" line, one at a time.
     *
     * The first is the one people need and never think of: on a phone, sound
     * played by the phone itself does not reach the page. The microphone hears
     * the room, and a song playing through the same handset is not in the room.
     * Someone holding a silent-looking meter has usually done exactly that.
     */
    quietAsides: [
      'The web app cannot pick up music this phone is playing.',
      'Point the phone at the speaker, about an arm\'s length away.',
    ],
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

    // Things that went wrong mid-take, and are worth saying while they do
    takeInterrupted: 'Something took the microphone. What you have is safe — recording picks up when it comes back.',
    takeResumed: (seconds: number) =>
      `Back. The ${seconds}s that were missed are marked as a gap, not pretended away.`,
    takeStalled: 'No audio is arriving. Stopping and starting again usually fixes it.',
    deviceLost: 'The microphone was disconnected. Stop here and the take is still yours.',
    /** Shown instead of processedInput when it is specifically cancellation that
     * is on, because that one has a consequence a player has to know before
     * spending a verse on a take: the device's own output is subtracted. */
    micCancelsOwnOutput:
      'This browser cancels its own output from the microphone, so music played on this device will not be captured. Play the song on something else.',
    processedInput: 'This browser is processing the microphone for speech, which removes some of the music. The tab will be rougher than it could be. A native app, or opening the audio file directly, avoids it.',

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
    numeralOfKey: (numeral: string, key: string) => `${numeral} of ${key}`,
    stillNeeds: (chords: string, count: number) => `${chords} ${count === 1 ? 'still needs' : 'still need'} a barre. Try another capo position below, or play just the top four strings until the shape settles.`,
    suggested: '— suggested',
    capoPlay: (fret: number, key: string) => `Capo ${fret} · play in ${key}`,
    noCapoText: 'No capo',
    tuningTitle: 'Measured tuning of the recording',
    tuningChip: (cents: number) => `${cents > 0 ? '+' : ''}${cents}¢ off A440`,
    barBeats: (beats: number) => `${beats} beats`,
    copyTabPrompt: 'Copy the tab:',
    systemBars: (from: number, to: number) => `Bars ${from}–${to}`,
    systemBar: (bar: number) => `Bar ${bar}`,
    /* Keyed by strum pattern id, so the patterns themselves stay free of
       display strings. */
    strumNames: {
      held: 'One per bar',
      quarters: 'Down on every beat',
      eighths: 'Down-up eighths',
      classic: 'D · D U · U D U',
      ballad: 'Slow ballad',
      waltz: 'Waltz',
      'pick-simple': 'Thumb and three',
      'pick-53231323': 'The eight-note pattern',
      'pick-alternating': 'Alternating bass',
    } as Record<string, string>,
    strumDescriptions: {
      held: 'A single strum on beat 1. Start here if changing chords is the hard part.',
      quarters: 'Four even downstrokes. Steady, and it fits almost anything.',
      eighths: 'Keep your hand moving the whole bar. The engine room of pop guitar.',
      classic: 'The one that unlocks a few hundred songs. Miss the strum on beat 3.',
      ballad: 'Let each chord ring for half a bar. Room to breathe between changes.',
      waltz: 'Three to a bar: one strong, two light.',
      'pick-simple':
        'One string per beat, straight up the chord. The thumb finds the bass, and it moves with the chord — the fifth string for C, the sixth for G, the fourth for D.',
      'pick-53231323':
        'Bass, then the trebles woven around the third string. The pattern most Chinese songbooks open with.',
      'pick-alternating':
        'The thumb rocks between two bass strings while the fingers answer. The folk and country engine.',
    } as Record<string, string>,
    shapeNoteFourStringF: 'The four-string F that gets you past the barre',
    shapeNoteBarre: (family: string, fret: number) => `${family}-shape barre at fret ${fret}`,
    capoChip: (fret: number) => `Capo ${fret}`,
    capoPlayIn: (fret: number, key: string) => `Capo ${fret} · play in ${key}`,
    printCapo: (fret: number, key: string) => `capo on fret ${fret}, shapes read in ${key}`,
    printNoCapo: 'no capo',
    printKeyLabel: 'Key',
    printUntitled: 'Untitled song',
    printSubFor: (label: string) => `for ${label}`,
    printSoundsAs: (label: string) => `sounds as ${label}`,
    printLoopLine: (percent: number) => `The loop, ${percent}% of the song:`,
    printStrumLine: (name: string, marks: string) => `${name}: ${marks}`,
    printChordChart: 'Chord chart',
    printTablature: 'Tablature',
    printFoot: 'Geetaab — a machine transcription. Trust your ears over it.',
    chordDiagramTitle: (label: string) => `${label} chord diagram`,
    chordDiagram: 'Chord diagram',
    wholeLoop: (bars: number, coverage: number) => `This ${bars}-bar loop covers ${Math.round(coverage * 100)}% of what you recorded. Learn it once and you have most of the song.`,
    learnOnce: 'Learn it once and you have most of the song.',
    openShapes: (ratio: number) => `Open shapes already cover ${Math.round(ratio * 100)}% of this song, so a capo would not buy you much.`,
    withCapo: (fret: number, shapeKey: string, soundingKey: string, ratio: number) => `With the capo on fret ${fret} you finger the shapes of ${shapeKey}, and the room hears ${soundingKey}. ${Math.round(ratio * 100)}% of the song lands on open chords.`,
    chordChart: 'Chord chart',
    wholeSong: 'Whole song',
    justLoop: 'Just the loop',
    tablature: 'Tablature',
    printTab: 'Print the tab',
    copyTab: 'Copy the whole tab as text',
    copied: 'Copied',
    practiseThis: 'Practise this',
    showTabAnyway: 'Show the tab anyway',
    heardNoChords: 'No chords came through this recording — most of it read as no harmony at all. If this was music, the microphone may have been too far away, or picking up the room rather than the song; opening the audio file itself works far better.',
    lowConfidence: 'The harmony came through faintly, so these chords are a rough guess. A cleaner recording — or an audio file instead of a room recording — will do much better.',
    freeTime: 'This one plays freely — there was no steady pulse to lock onto, so the tempo and bar grid are approximate. The chord sequence itself is what to trust.',
    theWholeSong: 'The whole song, mostly',

    // ChordLibrary
    chordLibrary: 'Chord library',
    everyChordStart: 'Every chord, and where to start',
    tapChordHear: 'Tap any chord to hear exactly the notes its diagram shows. Dots are fingers, numbers say which one.',
    playItLikeASong: 'Play it like a song',
    benchBlurb:
      'A chord box says where the fingers go. Turn this on and every chord on the page is played with a capo, a strumming pattern and a tempo instead — which is the part you actually have to get used to.',
    benchOn: 'On',
    benchOff: 'Off',
    tempoLabel: 'Tempo',
    tempoAmbiguous: 'More than one count fits this recording. They put the chords in the same places — pick the one you would tap your foot to.',
    bpmValue: (bpm: number) => `${bpm} BPM`,
    capoSoundsUp: (fret: number, sounding: string) =>
      `With the capo on fret ${fret}, a C shape sounds ${sounding} — the shapes stay the ones you know.`,
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
    exit: 'Exit',
    next: 'next',
    nextChord: (name: string) => `${name}, the next chord`,
    lastChord: 'last chord',
    nextIn: (beats: number) => ` · in ${beats}`,
    howThisWorks: 'How this screen works',
    practiceHints: [
      (beatsPerBar: number) => `Press play for a ${beatsPerBar}-beat count-in, then change chords as each block reaches the amber line. The filled block is the chord now; the one outlined in green is the one coming.`,
      'The bar below scrubs the song, and ±5 jumps around it. The loop button repeats the section you are in.',
      'Speed already starts where the changes are playable, and slows the song without changing its pitch. Volume sits behind the speaker button.',
      'With a keyboard: space plays and pauses · ← → skip five seconds.',
    ],
    gotIt: 'Got it',
    backStart: 'Back to the start',
    backSeconds: (n: number) => `Back ${n} seconds`,
    play: 'Play',
    pause: 'Pause',
    forwardSeconds: (n: number) => `Forward ${n} seconds`,
    loopSection: (bars: number) => `Loop these ${bars} bars`,
    loopingSection: (bars: number) => `Looping ${bars} bars — press again to play on`,
    metronome: 'Metronome',
    songPosition: 'Song position',
    seekPosition: (at: string, total: string) => `${at} of ${total}`,
    practiceSpeed: 'Practice speed',
    speedLabel: 'Speed',
    close: 'Close',
    volume: 'Volume',
    playbackVolume: 'Playback volume',
    strum: 'strum',
    pick: 'Pick',
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
    micRecordingTitle: (when: string) => `Recording ${when}`,
    demoTitle: 'Demo — four chords',

    /* Headings for the plain-text tab on the clipboard. It is prose a person
       reads, not a file format, so it follows the interface language. */
    tabText: {
      colon: ': ',
      key: 'Key',
      tempo: 'Tempo',
      capo: 'Capo',
      capoFret: (fret: number, key: string) => `fret ${fret} (play in ${key})`,
      capoNone: 'none',
      strum: 'Strum',
      chordsYouNeed: 'Chords you need',
      inPlaceOf: (chord: string) => `(in place of ${chord})`,
      loop: (bars: number, percent: number) => `The loop (${bars} bars, ${percent}% of the song)`,
      chordChart: 'Chord chart',
      tablature: 'Tablature (one time through)',
      foot: 'Generated by Geetaab. Chords are a machine transcription — trust your ears over them.',
    },

    // How chords are recognized (the explainer page)
    howChordsRecognized: 'How chords are recognized',
    hwEyebrow: 'Inside the analysis',
    hwTitle: 'How Chords Are Recognized',
    hwLede:
      'Turn a guitar recording into a chord chart you can actually play — what is going on inside?',
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
    hwCircleTitle: 'One shape, under four decisions',
    hwCircleIntro:
      'The circle of fifths never appears in this code by name. There is no module called anything like it, and no stage above is "the circle of fifths stage". It is the shape four separate decisions are already standing on, and it is worth drawing once rather than explaining from scratch four times.',
    hwCircleAria:
      'Diagram: the circle of fifths. Twelve major keys around a ring, C at the top, each a fifth clockwise of the last; their relative minors on an inner ring. The five keys whose open chord shapes a beginner already knows — C, G, D, A and E — sit next to each other on one arc, which is highlighted. A line marks where the spelling flips from sharps to flats, and an arrow shows one step anticlockwise, which is a dominant resolving to its tonic.',
    hwCircleCaption:
      'Twelve major keys on the outer ring, each a fifth clockwise of the last, with its relative minor inside it. Neighbours here are neighbours in sound: two keys side by side differ by one note, and two chords side by side share two of their three. The five open shapes a beginner has in their hands are not scattered around this ring — they are one unbroken arc of it, which is the entire reason a capo is worth owning.',
    hwCircleInner: ['neighbours share', 'two notes of three'],
    hwCircleStep: 'V → I',
    hwCircleSharps: 'sharps →',
    hwCircleFlats: '← flats',
    hwCircleUses: [
      {
        where: 'Deciding which chords are neighbours. ',
        what: 'The decoder charges for every chord change, so a flicker cannot become a chord — but it discounts the charge in proportion to how many notes the two chords share. Two of three is one step around this ring; none is the far side. Nothing computes an angle: counting shared notes gets there on its own.',
      },
      {
        where: 'Refereeing the key. ',
        what: 'Correlating a song against the twelve key profiles separates a key from its own dominant weakly — they share six of seven notes. So the estimate is refereed by cadences: how often a chord one step clockwise falls to the chord it is beside, which is a V resolving to its I. That single step is what breaks the tie.',
      },
      {
        where: 'Spelling the answer. ',
        what: 'A key gets sharps or flats depending on which side of the ring it sits, and the app writes A♯ or B♭ from that alone. The two are the same pitch; only one of them is what a player expects to read.',
      },
      {
        where: 'Choosing the capo. ',
        what: 'The five open shapes are one arc. So the capo question is only ever "how far round do I have to move this song to land on that arc, and is it worth the move" — which is what the arranger scores, fret by fret, against how hard the shapes come out.',
      },
    ],
    hwCircleNote:
      'And once more outside the app: when its key estimates are marked against annotations, a miss by one step either way is scored apart from a miss to the far side, because those are the two mistakes a key estimator actually makes.',
    hwNodes: ['Listen', 'FFT', 'Chroma', 'Match', 'Smooth', 'Tempo', 'Key', 'Adapt', 'Chart'],
    hwLegend: ['Measuring', 'Deciding', 'Rewriting for your hands'],
    hwOverviewAria:
      'Diagram: the nine-stage signal path from raw audio to a finished chord chart, coloured in three runs — verdigris while the app is only measuring, brass once it commits to an answer, copper once that answer is rewritten for a beginner.',
    hwOverviewCaption:
      'The complete signal path, in three runs of colour. Stages 1–4 only measure — nothing is committed to yet. From stage 5 the flicker is smoothed into answers the app will stand behind. The last two stages leave the recording behind entirely and ask a different question: what should your hands do?',

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
    hwS5P3:
      'The charge is not the same for every change, though. Two chords that share notes are cheap to move between, and the discount is in proportion: C and Am share two of their three notes, so hearing one where the other is really playing costs the path very little, while C and F# share none and the path will not go there without real evidence. This is the circle of fifths doing its work without ever being named — see below.',
    hwS5P4:
      'One more pass runs after the path is chosen, on the bass alone. The decoder works from the whole spectrum, which cannot tell G from G with a B underneath it; a separate look at the low end can, so a chord whose bass is clearly a note other than its root is written as a slash chord. It is deliberately shy: on the reference sheets it recovers about a quarter of the printed inversions, because a wrong guess here spoils a chord that was already right.',
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
    hwS7P2:
      'Correlation alone is not enough to finish on, though. A song leaning on its dominant scores nearly as well a fifth up, and a major key and its relative minor share every note in the scale — so the profiles put those pairs within a whisker of each other. The tie is broken by evidence the fingerprint cannot see: which chord the song opens and ends on, how much of the track the candidate tonic chord actually occupies, and how often a V falls to its I. The number reported as confidence stays the raw correlation, so it says how clear the fingerprint was rather than how sure the referee is.',
    hwS7SongChroma: 'Song\'s chroma',
    hwS7Candidates: 'Key candidates',
    hwS7Best: 'best',
    hwS7RunnerUpKey: 'G maj',
    hwS7BestKey: 'C maj',
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

    hwDeepChromaTitle: 'Go deeper: why twelve numbers and not the whole spectrum',
    hwDeepChromaP1:
      'A guitar playing one note does not produce one frequency. It produces that note plus a stack of overtones above it, and the loudest of those overtones is an octave up — the same letter name. Every other instrument in the mix is doing the same thing at the same time. Read the raw spectrum and a single C major chord looks like dozens of peaks scattered across ten octaves.',
    hwDeepChromaP2:
      'Folding octaves together throws away which C it was and keeps only that it was a C, which is exactly the part a chord name cares about. Twelve numbers is not a simplification of the spectrum so much as a translation of it into the alphabet chords are written in. The cost is real and worth naming: the app can no longer tell a chord from its own inversion, which is why a slash chord like G/B comes back as plain G.',

    hwDeepCentreTitle: 'Go deeper: why every template has its average subtracted',
    hwDeepCentreP1:
      'Real recordings never give twelve clean numbers. Cymbals, room noise, a singer\'s breath and the tail of the previous chord all put a little energy into every one of the twelve bins, so the measured fingerprint sits on a raised floor. Compare that against templates made of ones and zeros and the floor is free score — and it is worth more to whichever template has more ones in it.',
    hwDeepCentreP2:
      'That is why an uncentred version of this app read almost every plain triad as a seventh chord: a seventh has four notes to collect noise with, a triad only three. Subtracting each template\'s own average makes its non-chord tones count against it, so a flat noise floor scores zero everywhere and only real structure moves the number. It was the single largest accuracy gain in this pipeline, and it is one line of arithmetic.',

    hwDeepViterbiTitle: 'Go deeper: why not just take the best chord in each frame',
    hwDeepViterbiP1:
      'Because the best chord in each frame changes several times a second. Frames land in the gap between strums, on a passing bass note, on the vocal\'s vibrato — and each of those makes some other chord fit slightly better for a twentieth of a second. Written down literally, a four-chord song becomes hundreds of changes, and no human wrote it that way.',
    hwDeepViterbiP2:
      'Viterbi scores whole paths instead of single frames, charging a fixed cost for every change. A better-fitting chord has to be better by more than that cost, and stay better, before it is worth switching to. What survives is the handful of sustained changes a player would actually write on the page. The cost is the whole trade: too low and the chart is confetti, too high and real changes are absorbed into their neighbours — this app\'s value was chosen by measuring both failures against time-aligned annotations, not by eye.',

    hwDeepOctaveTitle: 'Go deeper: why 70 BPM and 140 BPM are the same recording',
    hwDeepOctaveP1:
      'Tempo is read from where the loudness peaks repeat. But a bar of down-up strumming at 70 BPM puts a peak in exactly the places a bar at 140 BPM would: the eighth notes of the slow reading are the quarter notes of the fast one. The onset curve is identical. Nothing in the audio distinguishes them, in the same way nothing in a photograph of a spinning wheel tells you which way it is turning.',
    hwDeepOctaveP2:
      'What could break the tie is context a listener has and a signal does not — that this is a ballad, that a foot would tap here and not there. Every mechanical substitute we could think of was measured against 360 recordings with annotated tempi, and each one broke more songs than it fixed. So the app makes its best call, says what it chose, and puts half-time and double-time buttons on the tab screen for when you disagree.',

    hwLimitsTitle: 'Honest Limits',
    hwLimitsIntro:
      'This app is measured two ways: against independently-published tabs for real songs (Chinese pop ballads, a Taylor Swift song, a film score) and against GuitarSet, a research corpus of acoustic-guitar recordings labelled second by second. It is good, not perfect. Worth knowing:',
    hwLimitTerms: [
      'Accuracy: two different rulers',
      'Genuine hard problems',
      'Only 84 chord qualities modeled',
    ],
    hwLimitAccuracyLead:
      ' comes as two numbers, because the generous one flatters. Ask only "is this chord somewhere in the song" and fifteen songs with published tabs average ',
    hwLimitAccuracyMid:
      '. Ask instead "is the right chord sounding at this very instant" — the strict reading, checked on a 10 ms grid against second-by-second annotations — and accompaniment recordings average ',
    hwLimitAccuracyTail:
      ', rising to 84% on the singer-songwriter style closest to what this app gets used for. The distance between the two numbers is exactly how much the generous one flatters, which is why both are published.',
    hwLimitHardIntro: ' (not bugs) were found and honestly disclosed:',
    hwLimitHardItems: [
      'A chord quality differing by one note one semitone away (like Em vs Esus2) is fundamentally the hardest pair to tell from a 12-number fingerprint, especially in fingerpicked passages where notes don\'t sound at once.',
      'Telling a song\'s home key (I) from its dominant (V) — the two are harmonic cousins — is a known hard problem for this style of key detection.',
      'Whether a song is at 70 BPM or 140 BPM is genuinely undecidable from the signal: the same strumming produces the same onset pattern either way. Every tie-break we could think of was measured on 360 annotated recordings and each broke more songs than it fixed, so the tab screen simply offers half-time and double-time buttons.',
    ],
    hwLimitVocab:
      ' (no add9, no diminished, no augmented) — a chord outside this vocabulary comes back as the closest thing inside it.',
    hwClosing:
      'So next time someone asks "how does a machine hear chords?", now you know: it starts by listening for music, runs the audio through Fourier and chroma and templates, smooths frame-by-frame flicker into sustained decisions, finds the beat and the key, and adapts the result for beginner hands. Simple is hard.',

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
    home: '首页',
    language: '语言',
    lightTheme: '浅色',
    darkTheme: '深色',
    switchToLight: '切换到浅色模式',
    switchToDark: '切换到深色模式',

    // Home screen
    eyebrowGuitarTabs: '听歌扒谱',
    // The owner's own line. It is not a translation of the English headline and
    // is not meant to become one.
    h1PlayNearMic: '随听随弹，',
    h1GetTab: '跟唱跟学。',
    ledeParagraph: 'Geetaab 会听出和弦、调性和速度，再把整首歌改写成你已经会按的那几个指法——变调夹夹几品也一并算好。接着像唱卡拉 OK 那样跟着练，横着竖着都行，跟不上就调慢。',
    heroHears: '听到',
    heroWrites: '写下',
    listenWithMic: '用麦克风听歌',
    orText: '或者',
    blocksMicrophone: '浏览器不让网页用麦克风，你可以',
    openAudioFile: '打开音频文件',
    tryDemo: '试试示例曲',
    dropToOpen: '松手，就用这个音频开始',
    yourSongs: '你的歌',
    storedOnDevice: '只存在这台设备里。',
    deleteLabel: (title: string) => `删除「${title}」`,
    deleteTitle: '删除',
    whatComesOut: '它会给你什么',
    everyExampleReal: '下面几个例子都是它真算出来的，不是效果图。',
    shapesYouKnow: '你已经会按的和弦',
    shapesDescription: 'E♭ 的歌里有四个横按。Geetaab 把变调夹夹到第 3 品，换给你 C、G、Am 和 Fmaj7。',
    loopNotWhole: '循环段，不是整首歌',
    loopDescription: '大多数歌就是一段和弦进行反复。Geetaab 把它找出来，告诉你它占了全曲多少，于是你练的是四小节，不是三分钟。',
    practiceAlong: '跟着练',
    practiceAlongDescription: '和弦顺着播放头往前走；预备拍、节拍器、分段循环，还有变速不变调的慢放，都在里面。手机横着竖着都能练，横过来视野更宽。',
    howItWorks: '它是怎么做到的',
    noServerDownload: '没有服务器，也不下载模型，全部在这个网页里跑完。',
    listens: '它先听',
    listensDescription: '一秒钟量好几次十二个音级，量之前先估出这份录音本身的音准——所以整体偏高一点点的歌，读出来也不会错。',
    findsThePulse: '它找拍子',
    findsDescription: '从每个音的起音算出速度，再给整段录音铺一层节拍网格，让和弦的变化落在拍上，而不是掉进两拍中间。',
    picksChords: '它挑和弦',
    picksDescription: '每一拍都拿去跟带泛音的和弦模板比对，再把结果抹平，收成弹琴的人真会写下来的那几次变化。',
    rewritesHands: '它照着你的手改',
    rewritesDescription: '变调夹夹在哪一品，看哪个位置能让最多的和弦变成开放和弦；剩下那些别扭的，换成老师会教的替代指法。',
    everythingRunsBrowser: '所有事情都在这个网页里做完：录音不上传，歌只存在这台设备上。和弦是机器扒出来的——真弹的时候，还是以你的耳朵为准。',
    privacyLink: '隐私',
    privacyEyebrow: '隐私',
    privacyTitle: '你录的东西不会离开这台设备',
    privacyLede:
      '整份政策就这一句。下面是它背后的细节——写出来是为了让你能自己核对，而不是只能选择相信。这里每一条都是对当前这个版本的陈述，不是承诺。',
    privacySections: [
      {
        title: '录音去了哪里',
        body: [
          '你用麦克风录，或者打开一个音频文件，声音就留在这个浏览器标签页的内存里。把它变成和弦的，是跟网页一起下载下来、在网页里跑的那几百行信号处理代码。这个 app 里根本没有服务器可以发给它：页面加载完之后，它不发起任何网络请求——不上传，不调接口，不打点，什么都没有。',
          '麦克风是在你按下录音的那一刻才申请的，给不给由浏览器决定。在那之前没有任何东西在听，一段录完，流就释放掉了。',
        ],
      },
      {
        title: '存了什么，存在哪',
        body: [
          '扒完的曲子存在这个浏览器里、这台设备上，用它自己的一个数据库。别人读不到——网站读不到，别的网站读不到，我们也读不到。一首存下来的曲子里有：标题，算出来的和弦、调性和速度，你选的变调夹和节奏型，以及录音本身（小到值得留的时候）。',
        ],
        points: [
          '三项偏好：主题、语言，以及练习界面的说明是不是已经看过了。',
          '在曲库里删掉一首，就是真的删掉，连同它的录音。',
          '在浏览器里清除本站数据，这些会一次全部消失，app 回到全新的样子。',
          '不做任何同步。手机上存的曲子不会出现在电脑上——中间没有任何东西。',
        ],
      },
      {
        title: '托管方能看到什么',
        body: [
          '构成这个页面的文件由一个静态托管服务分发，它和所有 web 服务器一样，能看到这次请求本身：一个 IP、一个浏览器版本、一个时间。这就是「一个页面被取走」留下的普通记录，也只能是这些——因为页面之后再没向它要过任何东西。没有 cookie，没有追踪器，没有第三方脚本，也没有从别处加载的字体或图片；字体和图标都是跟页面一起打包的。',
        ],
      },
      {
        title: '不是你写的歌',
        body: [
          '从录音里扒出来的谱，是机器对它听到的东西的转写，而那段录音很可能是别人的作品。你怎么用这两样东西，是你和权利人之间的事——这个 app 对此没有立场，也没法有立场，因为它从来没见过你弹的是什么。',
        ],
      },
    ],
    privacyClosing:
      '如果哪一条不再成立，它会在明面上不再成立：代码是公开的，而这个页面就是那次改动的一部分。',



    // Listening screen
    waitingForSong: '等歌开始',
    recording: '正在录音',
    hearingNow: '此刻听到',
    noMusicDetected: '没听到音乐',
    tooLoud: '太响了，离音箱远一点。',
    veryQuiet: '声音太小了。靠近一点，或者把歌放大声些。',
    quietAsides: [
      '网页版无法读取手机自身播放的音乐。',
      '手机对着音箱，隔一臂远就好。',
    ],
    hearRoom: '能听见房间里的动静，但还不是歌。音乐一响，录音会自己开始。',
    playTheSong: '放歌吧，我跟着一起开始',
    recordAnyway: '直接开录',
    workingText: '处理中…',
    keepGoing: (seconds: number) => `再录 ${seconds} 秒…`,
    stopBuildTab: '停下来，生成谱子',
    microphone: '麦克风没打开',
    recordingTips: [
      '录音会等音乐响起来，所以什么时候放歌都行。',
      '手机对着音箱，隔一臂远就好。',
      '录一段副歌。想弹的那部分，三十秒就够了。',
      '房间安静些，别跟着唱——人声会搅乱和声。',
      '吉他或钢琴弹出来的歌最好认；编曲堆得越满越难认。',
    ],
    discardTake: '删掉重录',
    backHome: '回首页',
    back: '返回',

    // Things that went wrong mid-take, and are worth saying while they do
    takeInterrupted: '有别的东西占用了麦克风。已经录到的没丢，等它放开会自己接着录。',
    takeResumed: (seconds: number) => `回来了。中断的 ${seconds} 秒标成了断口，不会当作没发生。`,
    takeStalled: '没有音频进来了。停下来重新开始通常就好。',
    deviceLost: '麦克风断开了。现在停下，已经录到的还是你的。',
    micCancelsOwnOutput:
      '这个浏览器会把自己的输出从麦克风里消掉，所以本机播放的音乐根本采不到。请用另一台设备放歌。',
    processedInput: '这个浏览器在按语音处理麦克风，会削掉音乐里的一部分。谱子会比本来该有的粗糙一些。用原生 app，或者直接打开音频文件，就没有这个问题。',

    // TabView screen
    songTitle: '歌曲名',
    nameThisSong: '给这首歌起个名字',
    confirmTitle: '确认名字',
    capo: '变调夹',
    strumming: '扫弦节奏',
    level: '难度',
    easy: '简单',
    standard: '标准',
    faithful: '完整',
    easyHint: '和弦更少、更朴素——扩展音和一闪而过的经过和弦都收掉了。',
    standardHint: '歌里每一次变化都在，指法都按得下来。',
    faithfulHint: '录音里怎么弹就怎么写——七和弦、挂留和弦一个不落。',
    fretNth: (fret: number) => `第 ${fret} 品`,
    tempoReading: '速度判断',
    halfTime: '减半',
    doubleTime: '加倍',
    chordsYouNeed: '要用到的和弦',
    makeItFitHands: '调成你顺手的样子',
    subbedFor: (chord: string) => `代替 ${chord}，更好按`,
    soundsAs: (chord: string) => `实际发声 ${chord}`,
    numeralOfKey: (numeral: string, key: string) => `${key} 的 ${numeral} 级`,
    // Chinese does not inflect for number, so the count the English needs for
    // its verb is deliberately unused here rather than faked into the sentence.
    stillNeeds: (chords: string, _count: number) => `${chords} 还是得横按。可以在下面换一个变调夹位置，或者先只弹高音的四根弦，等手熟了再补齐。`,
    suggested: '（推荐）',
    capoPlay: (fret: number, key: string) => `变调夹 ${fret} 品 · 按 ${key} 弹`,
    noCapoText: '不用变调夹',
    tuningTitle: '实测的录音音准',
    tuningChip: (cents: number) => `比 A=440 Hz ${cents > 0 ? '高' : '低'} ${Math.abs(cents)} 音分`,
    barBeats: (beats: number) => `${beats} 拍`,
    copyTabPrompt: '复制这份谱：',
    systemBars: (from: number, to: number) => `第 ${from}–${to} 小节`,
    systemBar: (bar: number) => `第 ${bar} 小节`,
    strumNames: {
      held: '一小节一下',
      quarters: '每拍一下',
      eighths: '八分音符下上扫',
      classic: 'D · D U · U D U',
      ballad: '慢板抒情',
      waltz: '华尔兹',
      'pick-simple': '拇指加三指',
      'pick-53231323': '五三二三一三二三',
      'pick-alternating': '交替低音',
    } as Record<string, string>,
    strumDescriptions: {
      held: '每小节只在第一拍扫一下。要是换和弦本身就够你忙的，从这里开始。',
      quarters: '四下均匀的下扫。稳，而且几乎什么歌都配得上。',
      eighths: '整小节手都不停。流行吉他的发动机。',
      classic: '学会这一条，几百首歌就能弹。要点是第三拍那下空过去。',
      ballad: '让每个和弦响满半小节，换和弦之间留出呼吸。',
      waltz: '一小节三下：一强两轻。',
      'pick-simple':
        '一拍一根弦，从低音往高音走。拇指负责低音，而低音弦是跟着和弦走的——C 从五弦起，G 从六弦，D 从四弦。',
      'pick-53231323':
        '先低音，再让高音在三弦上来回穿。中文谱最常见的开篇型。',
      'pick-alternating':
        '拇指在两根低音弦之间来回换，手指在中间应答。民谣和乡村的骨架。',
    } as Record<string, string>,
    shapeNoteFourStringF: '不用横按的四弦 F，先靠它过关',
    // Hard spaces inside 「第 N 品」: in a narrow tile it would otherwise wrap
    // between the number and the measure word.
    shapeNoteBarre: (family: string, fret: number) => `${family} 型大横按 · 第 ${fret} 品`,
    capoChip: (fret: number) => `变调夹 ${fret} 品`,
    capoPlayIn: (fret: number, key: string) => `变调夹 ${fret} 品 · 按 ${key} 指法`,
    printCapo: (fret: number, key: string) => `变调夹夹在第 ${fret} 品，按 ${key} 的指法`,
    printNoCapo: '不用变调夹',
    printKeyLabel: '调性',
    printUntitled: '未命名',
    printSubFor: (label: string) => `代替 ${label}`,
    printSoundsAs: (label: string) => `实际发声 ${label}`,
    printLoopLine: (percent: number) => `循环段，占全曲 ${percent}%：`,
    printStrumLine: (name: string, marks: string) => `${name}：${marks}`,
    printChordChart: '和弦谱',
    printTablature: '六线谱',
    printFoot: 'Geetaab 生成的机器转谱，请以自己的耳朵为准。',
    chordDiagramTitle: (label: string) => `${label} 和弦图`,
    chordDiagram: '和弦图',
    wholeLoop: (bars: number, coverage: number) => `这段 ${bars} 小节的循环，占了你这段录音的 ${Math.round(coverage * 100)}%。学会它，整首歌基本就到手了。`,
    learnOnce: '学会它，整首歌基本就到手了。',
    openShapes: (ratio: number) => `这首歌已经有 ${Math.round(ratio * 100)}% 落在开放和弦上，再加变调夹也帮不上什么忙。`,
    withCapo: (fret: number, shapeKey: string, soundingKey: string, ratio: number) => `变调夹夹在第 ${fret} 品，你按的是 ${shapeKey} 的指法，听众听到的还是 ${soundingKey}。全曲有 ${Math.round(ratio * 100)}% 落在开放和弦上。`,
    chordChart: '和弦谱',
    wholeSong: '整首歌',
    justLoop: '只看循环段',
    tablature: '六线谱',
    printTab: '打印谱子',
    copyTab: '复制整份谱（文本）',
    copied: '已复制',
    practiseThis: '开始练这首',
    showTabAnyway: '还是想看这份谱',
    heardNoChords: '这段录音里没听出和弦——绝大部分都不成和声。如果确实是音乐，多半是麦克风离得太远，录进来的是房间而不是歌；直接打开音频文件会好得多。',
    lowConfidence: '和声听得不太真切，这些和弦只能算大概。换一段更干净的录音——或者干脆别在房间里录，直接用音频文件——结果会好很多。',
    freeTime: '这首是自由节奏——没有稳定的拍子可以对齐，所以速度和小节线都只是大概。真正可信的，是和弦的顺序。',
    theWholeSong: '几乎就是整首歌',

    // ChordLibrary
    chordLibrary: '和弦库',
    everyChordStart: '所有和弦，以及先学哪几个',
    tapChordHear: '点一下任意和弦，就能听到图上画的那几个音。圆点是手指，数字是第几根手指。',
    playItLikeASong: '按歌里的样子弹',
    benchBlurb:
      '和弦图告诉你手指按在哪。打开这个，页面上每个和弦就改成带变调夹、按节奏型、按速度弹给你听——真正要练顺的是这部分。',
    benchOn: '开',
    benchOff: '关',
    tempoLabel: '速度',
    tempoAmbiguous: '这段录音不止一种数法说得通。它们把和弦放在同样的位置上——选你会跟着打拍子的那个。',
    bpmValue: (bpm: number) => `${bpm} BPM`,
    capoSoundsUp: (fret: number, sounding: string) =>
      `变调夹夹第 ${fret} 品时，C 的指法实际发声是 ${sounding}——手上按的还是你会的那几个。`,
    howToReadBox: '怎么看和弦图',
    cMajorExample: '以 C 和弦为例',
    legendDescriptions: [
      '六条竖线是六根弦——最左边是低音 E 弦，就像把吉他立起来，正对着自己看。',
      '横线是品丝，最上面那根粗线是琴枕。图旁边写着数字，说明这张图是从第几品开始画的。',
      '圆点是指尖，从食指 1 数到小指 4。一道长条是一根手指平压住好几根弦，也就是横按。',
      '图上方的 ○ 表示这根弦空弦弹响，✕ 表示这根弦不弹。',
    ],
    startWithEight: '先学这八个',
    learnThemOrder: '按这个顺序学，一次两个——要练的是换和弦，不是按和弦：慢慢数四拍按住一个，再四拍换到下一个，来回换。开放把位的歌，用到的都跳不出这八个。',
    everyChordBook: '全部和弦',
    anyRoot: '全部根音',
    noBarre: '不用横按',
    barreOnly: '只看横按',
    anyHands: '不限难度',
    allChordQualities: '全部',
    majorQuality: '大三',
    minorQuality: '小三',
    dom7Quality: '7',
    min7Quality: 'm7',
    maj7Quality: 'maj7',
    sus4Quality: 'sus4',
    sus2Quality: 'sus2',
    qualityBlurbs: {
      maj: '明亮、安稳——大多数歌兜一圈都要回到它。',
      min: '三音往下挪一品，情绪也跟着往下掉。',
      dom7: '大三和弦加一个降七度：带点布鲁斯味的紧张感，急着要回家。',
      min7: '把小三和弦的棱角磨掉——比干干净净的小三柔和。',
      maj7: '迷离、不慌不忙；波萨诺瓦和卧室流行最爱用的和弦。',
      sus4: '三音换成上面那个音，听感一直悬着，等它落下来。',
      sus2: '空旷、透气——是大是小，看你后面接什么。',
    },
    wholeVocabulary: '七种和弦性质配十二个根音——它能听出来的和弦，全在这里了。',
    shownCount: (count: number) => `共 ${count} 个`,
    starterTips: [
      '两根手指，六根弦全响。第一个和弦就学它。',
      '把 Em 的手指整体挪一根弦。',
      '一个小三角。只扫高音的四根弦。',
      '一开始会觉得撑——把手腕往前送一点。',
      '低音 E 弦不弹，手指立起来，弦才响得干净。',
      'Em 再加一根手指。明亮、饱满。',
      '三根手指挤在同一品里。',
      '忧郁的那个。同样只弹高音四根弦。',
    ],
    openFirstWeek: '开放和弦 · 好上手',
    openPractice: '开放和弦 · 得练一练',
    fullBarre: '大横按',
    levelText: (note: string | null, difficulty: number): string => {
      if (note) return note;
      if (difficulty === 1) return '开放和弦 · 好上手';
      if (difficulty === 2) return '开放和弦 · 得练一练';
      return '大横按';
    },
    whenShapeFights: '和弦还是按不响时',
    shapeTips: [
      '按在品丝后面一点，别压在品丝上——力气省一半，声音亮一倍。',
      '手指拱起来，用指尖去按，才不会碰到旁边的弦。',
      '按不响不是坏事，是线索：一根一根拨过去，找出打品的那根，单独修它。',
      '横按是几个月的事，不是几天的事。在那之前，变调夹和谱面上的简易替代，就是专门为这一刻准备的。',
    ],
    playChord: (name: string) => `试听 ${name}`,

    // Practice screen
    exit: '退出',
    next: '下一个',
    nextChord: (name: string) => `下一个和弦：${name}`,
    lastChord: '最后一个和弦',
    nextIn: (beats: number) => ` · ${beats} 拍后`,
    howThisWorks: '这个界面怎么用',
    practiceHints: [
      (beatsPerBar: number) => `按下播放，会先打 ${beatsPerBar} 拍预备拍；之后每个色块走到那条琥珀色线上，就换和弦。填满的那块是现在弹的和弦，绿色描边的那块是下一个。`,
      '下面那条进度条可以拖，±5 是前后各跳五秒。循环键会把你现在这一段反复播放。',
      '速度一开始就调到了换得过来的位置，放慢也不会跑调。音量藏在喇叭按钮里。',
      '用键盘的话：空格播放／暂停 · ← → 前后各五秒。',
    ],
    gotIt: '知道了',
    backStart: '回到开头',
    backSeconds: (n: number) => `后退 ${n} 秒`,
    play: '播放',
    pause: '暂停',
    forwardSeconds: (n: number) => `前进 ${n} 秒`,
    loopSection: (bars: number) => `循环这 ${bars} 小节`,
    loopingSection: (bars: number) => `正在循环 ${bars} 小节，再按一下继续往下播`,
    metronome: '节拍器',
    songPosition: '播放进度',
    seekPosition: (at: string, total: string) => `${at} / 共 ${total}`,
    practiceSpeed: '练习速度',
    speedLabel: '速度',
    close: '关闭',
    volume: '音量',
    playbackVolume: '播放音量',
    strum: '扫弦',
    pick: '拨弦',
    barOf: (current: number, total: number) => `第 ${current}/${total} 小节`,
    analyzeProgress: (stage: string) => `${stage}…`,
    workingItOut: '正在分析',
    allRunsDevice: '这些都在你自己的设备上跑，什么都不会上传。',
    thatDidNotWork: '出了点问题',
    startOver: '重新来过',
    readingFile: '读取文件',
    stages: {
      'getting started': '正在准备',
      'reading the file': '读取文件',
      resampling: '重采样',
      'finding the beat': '寻找拍点',
      'listening for chords': '听辨和弦',
      'working out the changes': '理出和弦走向',
      'naming the key': '判断调性',
      done: '完成',
    } as Record<string, string>,
    couldNotDecode: '这个文件打不开。换个 MP3、M4A、WAV 或 OGG 试试。',
    recordingTooShort: '这段录音太短了，分析不出什么来。',
    analysisFailed: '这次没能分析出来。',
    micRecordingTitle: (when: string) => `录音 ${when}`,
    demoTitle: '示例曲 · 四个和弦',

    tabText: {
      colon: '：',
      key: '调性',
      tempo: '速度',
      capo: '变调夹',
      capoFret: (fret: number, key: string) => `第 ${fret} 品（按 ${key} 的指法）`,
      capoNone: '不用',
      strum: '扫弦',
      chordsYouNeed: '要用到的和弦',
      inPlaceOf: (chord: string) => `（代替 ${chord}）`,
      loop: (bars: number, percent: number) => `循环段（${bars} 小节，占全曲 ${percent}%）`,
      chordChart: '和弦谱',
      tablature: '六线谱（走一遍）',
      foot: '由 Geetaab 生成。和弦是机器扒出来的，请以自己的耳朵为准。',
    },

    // How chords are recognized (the explainer page)
    howChordsRecognized: '和弦是怎么听出来的',
    hwEyebrow: '算法内部',
    hwTitle: '和弦是怎么听出来的',
    hwLede: '一段吉他弹唱，怎么变成一张能照着弹的和弦谱？这中间的每一步，都摊开在下面。',
    hwStepsLabel: '阶段导航',
    hwSteps: ['总览', '检测', 'FFT', '色度', '匹配', '平滑', '节拍', '调性', '成谱'],
    hwOverview: '总览',
    hwStageLabel: (n: number) => `第 ${n} 阶段`,
    hwStages89: '第 8、9 阶段',
    hwCircleTitle: '同一个图形，撑着四个决定',
    hwCircleIntro:
      '五度圈在这份代码里从没出现过名字。没有哪个模块叫这个，上面也没有哪个阶段是「五度圈阶段」。它是四个各不相干的决定共同站着的那个图形——画一次，比分别从头讲四遍划算。',
    hwCircleAria:
      '示意图：五度圈。十二个大调排成一圈，C 在正上方，顺时针每走一步升高五度；内圈是各自的关系小调。初学者已经会按的五个开放和弦调——C、G、D、A、E——彼此相邻，连成高亮的一段弧。一条线标出记号从升号翻成降号的位置，一个箭头表示逆时针走一步，也就是属和弦解决到主和弦。',
    hwCircleCaption:
      '外圈是十二个大调，顺时针每走一步升高五度；内圈是各自的关系小调。圈上的邻居就是听感上的邻居：相邻两个调只差一个音，相邻两个和弦共用三个音里的两个。初学者手上那五个开放指法不是散落在圈上的——它们是连续的一整段弧，这就是变调夹值得买的全部理由。',
    hwCircleInner: ['相邻两个和弦', '三个音里共用两个'],
    hwCircleStep: 'V → I',
    hwCircleSharps: '升号 →',
    hwCircleFlats: '← 降号',
    hwCircleUses: [
      {
        where: '判断哪些和弦算邻居。',
        what: '解码器给每一次换和弦都记一笔账，好让逐帧的抖动变不成和弦；但两个和弦共用的音越多，这笔账打的折就越狠。共用三分之二，就是圈上相邻一步；一个都不共用，就是圈的对面。代码里没有算任何角度——数共用音自己就走到了这里。',
      },
      {
        where: '给调性做裁判。',
        what: '拿十二条调性模板去套一首歌，很难把一个调和它自己的属调分开——两者七个音里有六个是一样的。所以估计结果要交给终止式来裁判：顺时针走一步的那个和弦，落到它旁边那个和弦，出现了多少次——那就是 V 到 I。就是这一步打破了平局。',
      },
      {
        where: '决定怎么写。',
        what: '一个调用升号还是降号，取决于它落在圈的哪一侧，A♯ 还是 B♭ 就是这么定下来的。两者音高完全一样，但只有一个是弹的人预期读到的那个。',
      },
      {
        where: '选变调夹。',
        what: '五个开放指法连成一段弧。所以变调夹的问题从头到尾只有一个：这首歌要挪多远才落到那段弧上，挪过去值不值。改编器就是逐品去算这件事——拿挪过去之后指法有多好按来算。',
      },
    ],
    hwCircleNote:
      '还有一处在 app 之外：拿它估的调性去对标注打分时，差一步（不论哪个方向）和差到圈的对面是分开算的——因为这正是调性估计真正会犯的两种错。',
    hwNodes: ['检测', 'FFT', '色度', '匹配', '平滑', '节拍', '调性', '改编', '成谱'],
    hwLegend: ['测量', '判断', '改写成你弹得下来的样子'],
    hwOverviewAria:
      '示意图：从原始音频到成品和弦谱的九个阶段，按三段上色——青色是只在测量的阶段，琥珀色是已经拿定主意的阶段，深铜色是把结论改写成初学者弹法的阶段。',
    hwOverviewCaption:
      '整条信号通路，颜色分三段。第 1 到 4 阶段只做测量，还没下任何结论；从第 5 阶段起，逐帧的抖动被收成可以写进谱子的答案；最后两个阶段离开录音本身，改问另一个问题：你的手该怎么放。',

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
      '五关必须同时通过，而且要连着通过好几次，录音才真正开始。听着简单，做起来很难：现成的语音活动检测器看似正合适，可它们生来是为语音服务的，训练目标恰恰是',
    hwS1P3Em: '排除',
    hwS1P3b:
      '音乐，拿来用只会适得其反。何况下载任何模型都会违背这个应用的承诺——除了页面本身，什么都不会从网上取。所以这道关卡纯靠信号分析，不含任何机器学习。',
    hwS1Cols: ['响度', '集中', '稳定', '起伏', '和弦'],
    hwS1Rows: ['音乐', '噪声', '人声', '嗡声'],
    hwS1Aria:
      '示意图：音乐关卡的五项检查——响度、音高集中度、稳定度、起伏、和弦匹配。四类声音里只有音乐能五项全过。',
    hwS1Caption: '四类声音在五项检查下的表现。只有五项全是琥珀色实心点，应用才相信真的有音乐在响。',

    hwS2Title: '傅里叶变换：把声音拆成一条条频率',
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
    hwS5P3:
      '不过这笔账不是每次都一样贵。两个和弦共用的音越多，来回走就越便宜，而且折扣是按比例给的：C 和 Am 三个音里共用两个，所以在其中一个真正响着的时候听成另一个，路径几乎不用付代价；而 C 和 F# 一个音都不共用，没有真凭实据路径就不会往那边走。这就是五度圈在起作用——只是它从没被叫过名字，往下看。',
    hwS5P4:
      '路径定下来之后还有一道单跑低音的处理。解码器看的是整个频谱，分不出 G 和「底下垫了个 B 的 G」；单独盯着低频那一段就能分得出来，于是低音明显不是根音的和弦会写成斜杠和弦。这一步故意做得保守：对照曲谱，印出来的转位它只认回四分之一左右——因为在这里瞎猜，会把本来已经对了的和弦弄坏。',
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
      '应用另外还盯着响度随时间的起伏（一条「起音」曲线），从峰与峰之间找反复出现的间隔——那个间隔就是一拍。它同时会检查这种反复靠不靠得住：有些曲子（散板的民谣、自由些的指弹改编）从头到尾就没有稳定的脉搏，硬套一张节拍网格，只是说得笃定的谎话。节奏弱到不可信的时候，应用会老实说这首歌是自由节奏，不再用网格，直接从和声本身读出和弦的边界。',
    hwS6Onset: '起音曲线',
    hwS6BeatInterval: '一拍',
    hwS6Aria: '示意图：一条响度包络曲线，峰下方是一排刻度，相邻刻度之间均匀的间隔就是一拍。',
    hwS6Caption: '响度随时间的起伏。曲线上的每一个峰就是一个拍点，相邻两个拍点之间的距离，决定了这首歌的速度。',

    hwS7Title: '调性：找到这首歌的家',
    hwS7P1:
      '还是那十二个数，这次是整首歌累积起来的，按每个和弦响了多久加权。应用拿它去和 24 张模板指纹做相关——大调小调各 12 个——挑出最贴合的一张。就像自己哼一遍音阶，听哪一个「像回到家」。',
    hwS7P2:
      '不过光靠相关性还收不了尾。一首歌如果偏重属和弦，往上五度那个调的分数几乎一样高；而大调和它的关系小调，音阶里的音是完全一样的——模板把这两对拉得极近。打破平局要靠指纹看不见的证据：这首歌从哪个和弦开始、在哪个和弦结束，候选主和弦到底占了全曲多少时间，以及 V 落到 I 出现了多少次。报出来的置信度仍然是原始的相关性——它说的是这枚指纹有多清楚，而不是裁判有多确定。',
    hwS7SongChroma: '全曲色度',
    hwS7Candidates: '候选调',
    hwS7Best: '最像',
    hwS7RunnerUpKey: 'G 大调',
    hwS7BestKey: 'C 大调',
    hwS7Aria: '示意图：整首歌累积出的色度指纹与几张候选调性模板对比，最贴合的一个被高亮。',
    hwS7Caption: '整首歌累积的色度（上）与调性模板做相关。最贴合的那一个（琥珀色）就是这首歌的调。',

    hwS89Title: '改写成你的手弹得下来的谱',
    hwS89P1: '最后一步，是把和弦序列改写成手上弹得顺的样子：',
    hwS89Terms: ['挑变调夹位置', '换掉难和弦', '给出几档难度'],
    hwS89Descs: [
      '——挑一个品位，让尽量多的和弦落在开放把位上。',
      '——真正难按的和弦，换成老师会推荐的简单替代：F 换成 Fmaj7，Bm 换成 Bm7。',
      '——变化密集的歌最多给三个版本：简单版（收掉七音、挂留音和一带而过的经过和弦）、标准版（默认读法）、完整版（保留每一个扩展音）。只有当三者确实不同时才会给。',
    ],
    hwS89Final: '成品',
    hwS89Strum: 'v 表示下扫弦',
    hwS89Aria: '示意图：演奏者最后拿到的一小段和弦谱，和弦名在上，扫弦记号在下。',
    hwS89Caption:
      '最后一步的产出：一张读得懂的和弦谱，已经按手指够得着的方式调整过。和弦名标在每小节上方，下方是扫弦方向。',

    hwDeepChromaTitle: '想深一点：为什么是十二个数，而不是整张频谱',
    hwDeepChromaP1:
      '吉他弹一个音，出来的从来不是一个频率，而是这个音加上它上面一整摞泛音，其中最响的那个正好高八度——名字还是同一个字母。合奏里每件乐器都在同时干这件事。所以直接看频谱，一个 C 大三和弦会摊成几十个峰，散落在十个八度里。',
    hwDeepChromaP2:
      '把八度折叠起来，就是扔掉「这是第几个 C」，只留下「这是个 C」——而和弦名在意的恰好只有后面这半句。十二个数与其说是把频谱简化了，不如说是把它翻译成了和弦本来就在用的那套字母。代价是实打实的，也得说清楚：这样一来就分不出和弦和它自己的转位，所以 G/B 这类斜杠和弦回来时只剩一个 G。',

    hwDeepCentreTitle: '想深一点：为什么每张模板都要减去自己的平均值',
    hwDeepCentreP1:
      '真实录音永远给不出干干净净的十二个数。镲片、房间噪声、歌手的换气、上一个和弦没散尽的尾音，都会往这十二个格子里各塞一点能量，于是量出来的指纹是架在一层地板上的。拿它去比对一张只有 0 和 1 的模板，这层地板就成了白送的分——而且谁的 1 多，谁白拿得多。',
    hwDeepCentreP2:
      '这正是这个应用没做中心化那会儿，几乎把每个三和弦都读成七和弦的原因：七和弦有四个音去接噪声，三和弦只有三个。把每张模板减去它自己的平均值之后，非和弦音就开始扣分了——一层平坦的噪声在哪张模板上都得零分，只有真正的结构才推得动数字。这是整条流水线上单项收益最大的一次改动，而它只是一句算术。',

    hwDeepViterbiTitle: '想深一点：为什么不能每一帧直接取最像的和弦',
    hwDeepViterbiP1:
      '因为「每一帧最像的和弦」一秒钟要换好几次。有的帧正好落在两下扫弦之间，有的落在一个经过低音上，有的落在人声的颤音里——每一种都会让另一个和弦在那二十分之一秒里贴合得稍微好一点。照字面写下来，一首四个和弦的歌会变成几百次变化，而没有人是那样记谱的。',
    hwDeepViterbiP2:
      'Viterbi 算的不是单帧，而是整条路径的总分，每换一次和弦就固定扣一笔。一个更贴合的和弦必须好过这笔代价，而且要一直好下去，才值得换过去。留下来的，就是演奏者真会写在谱上的那几次持续变化。这笔代价本身就是全部的取舍：定低了，谱面碎成纸屑；定高了，真实的变化被并进旁边的和弦——这个应用里的取值是拿逐秒标注的录音把两种失败都量过之后定的，不是看着顺眼定的。',

    hwDeepOctaveTitle: '想深一点：为什么 70 BPM 和 140 BPM 是同一段录音',
    hwDeepOctaveP1:
      '速度是从响度峰值多久重复一次读出来的。可是 70 BPM 的一小节下上扫弦，峰值出现的位置，和 140 BPM 的一小节完全重合：慢的那种读法里的八分音符，正是快的那种读法里的四分音符。起音曲线一模一样。音频里没有任何东西能把两者分开，就像一张车轮的照片说不出它在往哪边转。',
    hwDeepOctaveP2:
      '真正能打破这个平局的，是听的人有、而信号里没有的那些背景：这是一首抒情歌、脚会在这里点而不是在那里点。我们能想到的机械替代办法，都在 360 段有标注速度的录音上量过，每一种弄坏的歌都比修好的多。所以这个应用给出它最有把握的那个答案，明说自己选了哪个，再在曲谱页放上减半和加倍两个按钮——你不同意的时候按一下就行。',

    hwLimitsTitle: '它做不到什么',
    hwLimitsIntro:
      '这个应用用两套材料检验过：一套是别人独立发布的真实吉他谱（华语流行民谣、一首 Taylor Swift、一段电影配乐），一套是 GuitarSet——逐秒标注了和弦的原声吉他研究语料。它好用，但不完美。有几件事得先说清楚：',
    hwLimitTerms: ['准确率：两把尺子', '真正的难题', '只建模了 84 种和弦'],
    hwLimitAccuracyLead:
      '。宽的那把只问「这个和弦在不在这首歌里」，十五首有正式出版谱的歌平均 ',
    hwLimitAccuracyMid:
      '。严的那把问「这一刻响的是不是对的和弦」，在 10 毫秒的网格上逐刻对答案，伴奏类录音平均 ',
    hwLimitAccuracyTail:
      '，其中最贴近本应用使用场景的民谣弹唱是 84%。两个数之间的差，就是宽口径夸大了多少——所以两个我们都写出来。',
    hwLimitHardIntro: '有两处，都不是 bug，而是这套方法本身的极限：',
    hwLimitHardItems: [
      '只差一个音、而且这个音只差半音的两种和弦性质（比如 Em 和 Esus2），是十二数指纹最难分辨的一对——尤其在指弹段落，音本来就不是同时响的。',
      '分不分得清一首歌的主调（I）和属调（V）——这两个是和声上的近亲——是这类调性检测公认的难题。',
      '一首歌到底是 70 BPM 还是 140 BPM，从信号本身真的定不下来：同一套扫弦，两种记法产生的起音包络一模一样。我们能想到的判别办法都在 360 段有标注速度的录音上量过，每一种弄坏的歌都比修好的多，所以曲谱页干脆给了减半和加倍两个按钮。',
    ],
    hwLimitVocab: '（没有 add9，没有减和弦，没有增和弦）——词汇表之外的和弦，会用表里最接近的那个顶上。',
    hwClosing:
      '所以，下次有人问「机器是怎么听出和弦的」，你已经可以回答了：先听出有没有音乐，再让声音穿过傅里叶、色度和模板，把逐帧的抖动收成站得住的判断，找出拍子和调，最后改写成手上弹得顺的样子。把事情做简单，从来都不简单。',

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

/** The hint a shape carries as data, written out in the reader's language. */
export function shapeNoteText(
  note: ShapeNote | undefined,
  t: Dictionary[Language],
): string | null {
  if (!note) return null;
  return note.kind === 'fourStringF'
    ? t.shapeNoteFourStringF
    : t.shapeNoteBarre(note.family, note.fret);
}
