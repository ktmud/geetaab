# Geetaab

Play a song near your microphone and get a guitar tab a beginner can actually play,
then practise it karaoke-style, either way up you hold the phone.

Everything runs in the browser. No audio leaves the device, there is no server, and
there is no model download — the chord recognition is a few hundred lines of signal
processing that ship with the page.

## 简介

对着麦克风放一首歌，它给你一份你真弹得下来的吉他谱，然后像唱卡拉 OK 那样跟着练——手机横着竖着都行。

所有事情都在浏览器里做完：录音不上传，没有服务器，也不下载任何模型——所谓和弦识别，就是跟
着网页一起加载的那几百行信号处理代码。

它不会一按下就开始录，而是等到真的听见音乐才动手，同时把整段录音的频谱铺在屏幕背后。接着
算出速度、拍号、调性，以及每一拍上的和弦。有些地方听得见声音却听不出和声，比如前奏的渐入、
掌声、纯管弦乐的段落，它会老老实实标成 N.C.，而不是硬塞一个最像的和弦。碰上压根没有稳定
节奏的曲子，比如散板、某些指弹曲，它会直说这首是自由节奏，然后干脆从和声本身划分和弦的起止，
不去套一条假的小节线。

拿到和弦之后，它再按你的手来改编：变调夹放在哪一品，取决于哪个位置能让最多的和弦落在开放
把位上；剩下那些还是别扭的，就换成老师会教的替代指法，比如 F 换 Fmaj7、Bm 换 Bm7。碰上复杂
的歌，最多给三档谱：简单版把七和弦、挂留音和一闪而过的经过和弦都收掉，标准版是默认读法，
完整版一个和弦色彩都不丢。三档如果没有实质区别，这个选项根本不会出现。

右手也可以选：除了扫弦，还有几条指弹型。指弹型不是印一串固定的弦号，而是从和弦的按法反推
拇指该落在哪根弦上——C 从五弦起，G 从六弦，D 从四弦——每一下都写清楚弦号和手指（p i m a），
六线谱上也只在拨到的那根弦上标品位。初学者不管什么和弦都从六弦开始，就是因为一张印死的弦号
表没法告诉你这件事。

六线谱有两个版本，因为它们各干各的事。屏幕上和打印出来的是排版过的：六条连续的弦线、品位
数字嵌在线上、小节线画在小节该在的地方，每一下的横向位置按它在小节里的时值来定——所以一小节
八下扫弦看起来就是比四下密，而不是比四下宽。「复制」按钮给的仍然是大家熟悉的等宽字符谱，
因为能贴进论坛帖子的只有那一种。

界面中英文都有，第一次打开时按浏览器语言自动选，顶栏随时可切，选完会记住。

准确率我们用两把尺子量，因为只用宽的那把会骗人。宽尺子问「认出的和弦在不在这首歌的和弦
表里」：十五首有正式出版谱的歌（华语流行、民谣、Taylor Swift、电影配乐）按时长加权平均
**96%**。但它看不见位置——四个和弦顺序全打乱照样满分。严尺子用 GuitarSet（360 段逐秒标注
和弦的原声吉他录音，CC BY 4.0）在 10 毫秒网格上逐刻对答案：这才是「对的时刻弹对的和弦」。
在我们提交的 36 段代表性子集上，伴奏类录音平均 **70%**，其中民谣弹唱类（最贴近本应用的
场景）**84%**；即兴独奏类只有 19%——单音旋律本来就不该拿和弦识别去读。两把尺子的差距
本身就是旧口径夸大了多少的度量，两个数都印在回归报告里。已知的硬骨头照旧写在下面的
「Honest limits」一节，没有藏着。

```bash
npm install
npm run dev        # 打开 http://localhost:5173
```

## What it does

1. **Listens.** Record through the microphone, drop in an audio file, or try the
   built-in demo track. The recorder holds until it actually hears music — the
   shuffling before the song never makes it into the take — and paints the whole
   take so far as a spectrogram behind the screen while it runs.
2. **Works out the music.** Tempo, beat grid, key, and a chord per beat. Passages
   that are audible but prove nothing — fade-ins, applause, orchestral interludes —
   come back as N.C. rather than the nearest guess, and when a piece has no steady
   pulse at all the analysis says so and reads the chord boundaries off the harmony
   itself instead of a meaningless grid.
3. **Rewrites it for your hands.** Picks a capo position that puts as much of the
   song as possible on open shapes, and swaps the chords that are still awkward for
   the stand-ins a teacher would suggest — F becomes Fmaj7, Bm becomes Bm7. A busy
   song comes at up to three levels — easy folds sevenths, suspensions and quick
   passing chords away, standard is the beginner reading, faithful keeps every
   extension — and the lower rungs are offered only when they actually differ.
4. **Teaches it to you.** Chord diagrams, a bar-by-bar chart, engraved six-line
   tablature of the whole song — on screen and as a printable sheet — the repeating
   loop the song is built on, and a practice screen where the chords scroll past a
   playhead with a
   count-in, a metronome, a live right-hand guide, the next chord previewed beside the
   current one, section looping, slow-down that keeps the pitch, a scrubbable
   position bar with ten-second skips, and a volume control tucked behind a button.
   Opening it takes the full screen where the platform allows that, requested
   inside the tap so the browser still counts it as a gesture; iOS Safari has no
   Fullscreen API outside `<video>` and refuses. The screen has a layout for
   either way up. Sideways it is a chord panel beside a wide lane; upright the
   two swap axes — the chord you are on becomes the hero and takes the height
   going spare, and the lane becomes a strip under it, because a timeline wants
   width and that is what an upright phone has none of. It used to lock the
   orientation to landscape and show anyone it could not a screen asking them to
   turn the phone over; that is gone, because overriding how someone is holding
   their phone is a poor price for a lane that is merely wider.
   The chord library is the same idea without a song: how to read a box, the
   eight shapes worth learning first, and the whole vocabulary underneath. It
   also has a bench — a capo, a right-hand pattern and a tempo — and every
   chord box on the page plays through it, so the difference between knowing a
   shape and being able to use it can be heard without recording anything. Off
   by default, because someone looking a shape up should get the shape.

   The right-hand patterns include fingerpicking as well as strumming. A picking
   pattern names the string and the finger for every pluck, and the thumb's string
   is worked out from the chord shape rather than printed once — the fifth string
   for C, the sixth for G, the fourth for D — which is the one thing a fixed row of
   string numbers cannot tell you, and the reason beginners start every chord from
   the sixth string.

   The tablature exists in two forms, because they are for different things. What
   the screen and the printable sheet draw is engraved: continuous string lines
   with the fret numbers set into them, bar lines where the bars are, and columns
   spaced by when they actually fall in the bar, so eight strums to a bar look
   twice as busy as four instead of merely wider. What the Copy button produces is
   the monospace tab everyone already knows, because that is the version that
   survives being pasted into a forum post.
5. **Keeps a chord library.** Every chord the transcriber can hear, as a browsable
   page: how to read a chord box, the eight shapes to learn first and in what
   order, and the full vocabulary filterable by quality, root and whether it needs
   a barre — every diagram playable aloud with the exact voicing it draws.

## Two languages

The interface reads in English or Simplified Chinese. It opens in whichever one the
browser asks for and a switch in the top bar overrides that, remembered per visitor.
Chord symbols, note names and tempo figures are notation rather than prose, so they
stay put; key names are spelled the way each language writes them (G major / G 大调).
A test holds the two dictionaries to the same key set, so a string cannot be added to
one language and forgotten in the other.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests, no browser needed
npm run build      # static bundle in dist/
npm run smoke      # drives the built app in a real browser
```

## Checking the transcription against real songs

`scripts/regress.mjs` runs a whole corpus through the analysis and compares
every song against a saved baseline, so a change to `src/core/` can be held to
the same standard as the unit tests: no song may go backwards.

The corpus is real music with published tabs, so **none of it is in this
repository** — the audio and the chord sheets belong to their authors. Point
the script at a directory of your own instead:

```bash
ffmpeg -i song.m4a -ac 1 -ar 22050 -f f32le corpus/song.f32   # once per song
export GEETAAB_CORPUS=/path/to/corpus
npx vite-node scripts/regress.mjs --save-baseline              # record where you are
npx vite-node scripts/regress.mjs                              # after a change
```

Where a song has more than one published transcription, list it twice with
different reference vocabularies. That measures what a single reference cannot:
how much of a score belongs to the recording and how much to whoever wrote the
sheet. On the one song here with two editions, agreement on root and major/minor
moves by a point between them while the exact-symbol figure moves by twenty —
the first is a property of the analysis, the second largely is not.

The directory holds a `corpus.json` naming each song, its reference chords,
and any assertions to hold (that a rubato piece keeps coming back free-time,
say); the format is documented at the top of the script. Alongside the scores,
the report gives the median chord length in beats and the count of one-chord
sandwiches between two runs of the same neighbour — the numbers that say
whether a chart is chopped into more changes than the music has. It exits
non-zero if any song loses more than half a point, or if an assertion fails.

A reference can be one of three strengths, and the report scores the strongest
reading each supports, weakest first:

- a chord **vocabulary** (`ref`) only supports "is this chord anywhere in the
  song" — the `family` column. It cannot see position: the right four chords
  in a scrambled order still score 100%, which is why this number always
  reads high and is never quoted alone.
- an **ordered sheet** (`sheet`, extracted from a published tab PDF by
  `scripts/sheets.mjs`) adds playing order — the `order` column — and a free
  tempo-octave check: `bars` is the median count of detected bars per matched
  sheet bar, ~1 on a correct grid and ~2 when the tempo ran double.
- **time-aligned chords** (`refTimeline`, Harte labels as in GuitarSet's
  .jams) support the strictest number: the `recall` column is chord symbol
  recall on a 10 ms grid — the right chord at the right instant.

### The GuitarSet subset

The repository carries a second, freely-licensed corpus in `guitarset/`:
36 recordings from **GuitarSet** (Xi, Bittner, Pauwels, Ye & Bello, ISMIR
2018, CC BY 4.0, <https://doi.org/10.5281/zenodo.3371780>), the only corpus
here with time-aligned chord annotations and annotated tempi. The subset
covers every one of GuitarSet's 30 progression variants once in comping form
(all five styles, all keys, 68–200 BPM, six players round-robin) plus one
improvised solo per player as a stress case. The reference timelines and
tempi, derived from the plain chord annotation of each .jams, are committed
in `guitarset/corpus.json`; the audio is not — 36 recordings are ~70 MB,
which is no size for a git history — so a script fetches exactly the members
it needs from Zenodo (HTTP range requests into the 657 MB archive) and
decodes them with the app's own resampler, no external tools:

```bash
npx vite-node scripts/guitarset.mjs        # ~68 MB download into guitarset/data/
npx vite-node scripts/regress.mjs --corpus guitarset   # ~1 minute
```

On this subset the honest numbers are: aligned family recall **70%** on the
comping recordings (84% on the singer-songwriter style closest to this app's
repertoire, worse on jazz and funk whose harmony leaves the app's seven
qualities), **19%** on improvised single-note solos, against a vocabulary
figure of 87%/50% for the same files — the gap is what the vocabulary metric
flatters. Tempo lands on the annotated value for 25 of 36.

### Reading order out of a published sheet

`scripts/sheets.mjs` recovers the ordered, bar-positioned chord sequence from
an engraved tab PDF (`pdftotext -bbox`, then the layout heuristics documented
in the script — glyph-height bands to tell a chord symbol from a lyric, the
left-edge x of the bar numbers, the metadata header), writing a small JSON the
scorers consume via `sheet`. A PDF laid out some other way fails loudly rather
than guessing at it.

`scripts/score.mjs` scores one song (all three reference strengths), and
`scripts/analyze.mjs` prints what the analysis heard, segment by segment.

`npm run smoke` is the end-to-end check: it serves `dist/`, runs the demo track
through the worker, exercises the practice transport, and feeds a synthesized song
into Chromium's fake microphone to verify the capture path all the way to a finished
tab. It needs a Chromium — either one Playwright installed, or `PLAYWRIGHT_CHROMIUM`
pointing at an executable.

The whole app is static. `npm run build` output can be served from any file host,
including from a sub-path — asset URLs are relative, so the same build works at a
domain root, under `/<repo>/` on GitHub Pages, and behind a custom domain.

Pushing to `main` builds and force-pushes `dist/` to the `gh-pages` branch as a
single commit. Point Pages at that branch to publish.

The custom domain lives in `public/CNAME`, which Vite copies into the build.
GitHub stores a Pages domain as a CNAME file on the publishing branch, and this
workflow replaces that branch wholesale on every deploy — a domain set only in
the repository settings is wiped by the next push, which looks like the setting
reverting itself.

Microphone capture needs a secure context, so use `localhost` or HTTPS.

## How the analysis works

The pipeline lives in `src/core/` and is plain TypeScript with no dependencies, so it
runs the same in the browser, in a Web Worker, and in the test suite.

**Chromagram** (`chroma.ts`). The signal is resampled to 11 025 Hz and transformed
with an 8192-point FFT, then folded onto one bin per semitone by a Gaussian weight map
in log frequency. Two chroma vectors come out of each frame: a treble one that decides
chord quality and a bass one that decides the root.

Before any of that, `estimateTuning` measures how far the recording sits from A440 by
histogramming interpolated spectral peaks against the nearest semitone and taking a
circular mean. Recordings made off a speaker, and songs mastered a little sharp, are
routinely tens of cents out; without the correction their energy straddles two chroma
bins and every chord reads as ambiguous.

**Hearing music at all** (`music.ts`). The recording screen refuses to start the
take until the live chroma analysis says a song is actually playing: enough level,
energy gathered onto a few pitch classes, harmony that holds still on the timescale
of a beat, an energy envelope that breathes, and a passable chord-template match.
Each impostor fails at least one — noise spreads across all twelve pitch classes,
speech glides off its pitch every syllable, and a mains hum (tonal, steady, and
shaped like a perfect fifth) never breathes. A voice-activity model would be the
obvious tool and the wrong one: VADs are trained to *reject* music, and shipping
model weights would break the promise that nothing but the page downloads.

**Chord templates** (`chords.ts`). Each of the 84 chords in the vocabulary
(major, minor, 7, m7, maj7, sus4, sus2 on twelve roots) has a template built from its
chord tones *plus their first six harmonics*. Modelling the overtones matters: the
root's fifth harmonic puts major-third energy under every minor chord, and a template
that does not expect it reads that energy as evidence for the wrong quality.

The templates are then centred on zero. Chroma from a real recording sits on a broad
noise floor, and against uncentred templates that floor is free score for whichever
chord has the most notes — which is what makes every triad drift toward being read as
a seventh. Centring was worth more than any other single change in this pipeline.

**Beats** (`beats.ts`). Spectral flux on log magnitudes gives an onset envelope;
autocorrelation with a log-normal prior around 120 BPM gives a tempo; and an Ellis-style
dynamic-programming beat tracker lays a grid that survives missing and syncopated onsets.
The autocorrelation peak is read through parabolic interpolation rather than at lag
resolution, and the BPM reported is the median interval of the grid the tracker actually
laid down. Onset periodicity is also measured against the envelope's variance: when it is
too weak to mean anything the analysis flags the piece as free-time, decodes the chords on
a fixed half-second grid instead of the beats, and marks tempo and bars as approximate.

**Decoding** (`analyze.ts`). Chroma is median-aggregated per beat, scored against every
template, and decoded with Viterbi over the chord lattice. Frame-wise argmax flickers
many times a second; the transition cost turns that into the handful of sustained
changes a player would write down. "No chord" competes in the same lattice with a graded
score of its own — calibrated between what broadband noise reaches and what real chords
score — so a chord has to earn its place on the page. Each segment is then re-checked
using only its interior beats, because the analysis window is long enough that the last
beat of a chord already contains the next one.

**Key** (`key.ts`) comes from Krumhansl-Kessler profiles correlated against a
duration-weighted histogram of the detected chord tones.

## The one thing it cannot decide alone

Tempo has an octave ambiguity that no amount of signal processing removes: the same
strumming pattern at 72 BPM and at 144 BPM produces an identical onset envelope. We
measured every tie-break we could think of on GuitarSet's 360 annotated tempi —
beat-to-beat accent alternation (upstrokes carry as much spectral flux as downbeats,
full-band and bass-band alike), empty subdivision midpoints (also true of quarter-note
swing comping, which the rule would wrongly halve), harmonic-rhythm thresholds (the
overlap between doubled ballads and genuinely fast songs is total) — and none of them
separates the octaves without breaking more songs than it fixes; the numbers live in
the comments of `beats.ts` and `analyze.ts`. What did survive measurement: the tempo
prior's width (narrowed 0.9 → 0.6 octaves, +21 songs on GuitarSet at no cost
elsewhere), and the conservative harmony tie-break, kept exactly because every
relaxation measured worse. A style-conditioned prior would be worth another 13 points
if the style were known — with oracle style labels GuitarSet reaches 80% — but
predicting the style from audio measured only 37%, which gave the whole gain back.
So the honest state is: most octave calls are right, the wrong ones are genuinely
undecidable from the signal alone, and the tab screen has half-time and double-time
buttons for exactly those.

## Honest limits

- Dense production, heavy distortion, and prominent vocals all hurt accuracy. A song
  built on a guitar or piano reads best.
- Only triads, sevenths and suspensions are in the vocabulary. Slash chords, added
  ninths, diminished and augmented chords come back as the nearest thing in the set.
- The tab is a machine transcription. Trust your ears over it.

## Layout

```
scripts/      browser smoke test, and the transcription eval tools
guitarset/    the CC BY 4.0 evaluation subset: manifest + baseline (audio is fetched)
src/core/     analysis: fft, dsp, chroma, chords, beats, key, analyze; reference scoring
src/music/    arrangement: chord shapes, capo, strumming, tab model, text export
src/audio/    microphone, file decode, WAV encoding, transport, metronome, synth
src/worker/   the analysis worker and its client
src/ui/       screens and components
src/store/    IndexedDB song library
golden/       reference outputs of every analysis stage, for ports to check against
```

Accuracy is measured against references of three grades, and the corpus itself
lives outside this repository. A bare chord **vocabulary** supports only "is
this chord anywhere in the song" — position-blind, so a scrambled order still
scores full marks. An **ordered sheet** adds order recall and its precision:
`scripts/sheets.mjs` extracts one from an engraved PDF, and
`scripts/tabsheet.mjs` from a plain-text tab, which has no bar lines at all —
those sheets carry the order and say so, and the tempo-octave column is left
empty rather than computed from spacing the extractor invented.
**Time-aligned** chords support the strictest number, chord symbol recall on a
10 ms grid.

The engine carries a `major.minor.patch` version of its own, separate from the
app's. **Major** means the result's shape changed, so a stored analysis cannot
be read as it stands and a port has to move in the same commit. **Minor** means
the numbers changed: stored songs are worked out again from their audio the
next time they are opened, so an accuracy fix reaches tabs a player already
has, and `golden/golden.json` is regenerated. **Patch** means nothing
observable changed — no recompute, no fixture. It is the minor that costs a
player a minute of their phone, which is the whole reason the three parts are
worth telling apart.

The chord shape database is verified by tests rather than by eye: every shape must
sound the chord it claims, keep the root in the bass, and stay inside four fingers
and three frets.
