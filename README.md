# geetaab

Play a song near your microphone and get a guitar tab a beginner can actually play,
then practise it karaoke-style on a landscape screen.

Everything runs in the browser. No audio leaves the device, there is no server, and
there is no model download — the chord recognition is a few hundred lines of signal
processing that ship with the page.

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
4. **Teaches it to you.** Chord diagrams, a bar-by-bar chart, six-line tablature of
   the whole song — on screen and as a printable sheet — the repeating loop the song
   is built on, and a practice screen where the chords scroll past a playhead with a
   count-in, a metronome, a live strumming guide, the next chord previewed beside the
   current one, section looping, slow-down that keeps the pitch, a scrubbable
   position bar with ten-second skips, and a volume control tucked behind a button.
5. **Keeps a chord library.** Every chord the transcriber can hear, as a browsable
   page: how to read a chord box, the eight shapes to learn first and in what
   order, and the full vocabulary filterable by quality, root and whether it needs
   a barre — every diagram playable aloud with the exact voicing it draws.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 38 unit tests, no browser needed
npm run build      # static bundle in dist/
npm run smoke      # drives the built app in a real browser
```

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
strumming pattern at 72 BPM and at 144 BPM produces an identical onset envelope. The
detector breaks the tie with the harmony — chords that never change faster than every
eighth bar mean the grid is counting twice as fast as the player — and the tab screen
has half-time and double-time buttons for when that guess is wrong.

## Honest limits

- Dense production, heavy distortion, and prominent vocals all hurt accuracy. A song
  built on a guitar or piano reads best.
- Only triads, sevenths and suspensions are in the vocabulary. Slash chords, added
  ninths, diminished and augmented chords come back as the nearest thing in the set.
- The tab is a machine transcription. Trust your ears over it.

## Layout

```
scripts/      browser smoke test
src/core/     analysis: fft, dsp, chroma, chords, beats, key, analyze
src/music/    arrangement: chord shapes, capo, strumming, tab model, text export
src/audio/    microphone, file decode, WAV encoding, transport, metronome, synth
src/worker/   the analysis worker and its client
src/ui/       screens and components
src/store/    IndexedDB song library
```

The chord shape database is verified by tests rather than by eye: every shape must
sound the chord it claims, keep the root in the bass, and stay inside four fingers
and three frets.
