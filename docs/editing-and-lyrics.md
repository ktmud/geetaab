# Phase two: fixing the tab, and singing along

The transcription is a machine listening to a room. It is right most of the
time and wrong some of the time, and the person holding the guitar can hear
which is which. Phase two is about letting them say so — and about the other
half of playing a song, which is knowing which words go over which chord.

## The one decision everything else follows from

**An edit is an overlay, not a rewrite.**

The obvious design is to let someone change a chord and save the result. It is
wrong for two separate reasons, and both of them bite later rather than now.

**The tab is derived, not stored.** What the app holds is a list of sounding
chords over time. Everything on screen — the capo, the shapes, the
substitutions, the three difficulty levels, the bar layout — is computed from
that list on the way out. So an edit that changed the *printed* tab would be
attached to the wrong thing: change the capo afterwards and the correction is
either lost or nonsense. A correction has to say "the recording has a D here",
never "print a D here", and then the arrangement machinery re-derives what to
print exactly as it does for every other chord.

**The analysis is versioned on purpose.** `ANALYSIS_VERSION` exists so that an
accuracy fix reaches songs a player already has: a stale song is re-analysed
from its own audio the next time it is opened. That is only a good deal if
re-analysing is safe. If corrections lived inside the analysis, every
improvement to the engine would silently destroy them, and improving the
engine would become a punishment for having used the app.

So: `SongEdits` is a separate structure, applied on the way out by
`applyingEdits`, and the analysis underneath it is never touched.

### Anchored in seconds, never in beats

A better tempo estimate renumbers every beat in the song. Bar 34 beat 2 is not
a place; it is a place *according to one particular reading of the rhythm*, and
that reading is exactly what a re-analysis is allowed to change.

Seconds are not. The moment four minutes and twelve seconds into the recording
is the same moment whatever the app later decides about the tempo. Every edit —
chord corrections, lyric lines, section marks — is stored in seconds and
resolved to beats at read time.

`EditOverlayTests.testEditsSurviveAChangedBeatGrid` is the test that holds this
up: it applies the same correction to two analyses with different beat grids
and asserts the correction stayed at five seconds in both, while asserting that
the beat numbering really did move underneath it.

### Corrections retire themselves

An overlay that only ever grows is its own kind of trap. A correction made in
2026 keeps overriding an engine that has since learned to get that bar right,
and the player never sees the improvement they were promised.

So `pruned` runs after every re-analysis: any correction the new analysis
already agrees with is dropped. What survives is only the disagreement.

One exception, deliberately: an edit to "nothing is played here" is never
pruned. Silence is a judgement the analysis cannot make for itself, so it never
counts as having caught up.

## Fixing a chord

The editing screen lists what was heard, one row per detected chord, with the
time it starts and how many beats it lasts. Tapping a row opens a picker: a
root wheel, the seven qualities as a segmented control, and the resulting shape
drawn underneath so the choice is made against a diagram rather than a name.

Three things this does that a plainer version would not:

- **"No chord" is a first-class answer**, not the absence of one. A player
  correcting a fade-in or an applause break needs to say "there is nothing
  here", and the analysis by construction can only offer its best guess.
- **Overlapping edits are allowed, last one wins.** Someone poking at a tab
  produces overlapping corrections — an edit across a whole verse, then a
  smaller one inside it. The overlay is applied by intervals rather than by
  patching the segment list, so all of that behaves the same way without
  special cases.
- **Every correction is listed and individually revertible.** A correction is a
  claim; a player should be able to see what they have claimed and take it
  back one at a time.

The edit's time range is arbitrary, so the screen can offer per-segment editing
today and per-bar or per-beat later without the stored data changing shape.

## Lyrics

### Writing them

One text box, one line per line. Nobody wants to type a song a line at a time
into forty separate fields, and everyone has the words on a clipboard already.

Re-editing the block keeps the timing of any line whose text is unchanged, so
fixing a typo in verse three does not cost the whole song's timing.

### Binding them

Play the recording. One enormous button. Tap at the start of each line; the
line about to be bound is shown large above the button, because the whole
interaction happens while looking at the words rather than at the button.

The alternative — dragging handles on a waveform — is forty precise operations
against one pass in real time, and people are already practised at tapping
along to music because they do it every time they sing.

### Tidying them, which is where the interesting problem is

People tap late. Reaction time is around a fifth of a second and it is a
*bias*, not noise: every line in the song ends up uniformly behind the music.

The obvious fix is to snap each tap to the nearest beat, since sung lines start
on or near a beat and the analysis already knows where the beats are. **The
obvious fix is worse than nothing at a quick tempo.** At 120 BPM a line aimed
at beat 2.0 and tapped two tenths late lands at 2.2, whose nearest beat is 2.5
— so naive snapping would push it a further three tenths in the wrong
direction.

So the lag comes off first. It is measured from where the taps sit *within*
their beat, which clusters because the bias is systematic, as a circular mean —
the same trick the tuning estimator uses on cents, and for the same reason: the
quantity wraps, so a handful of taps a hair early would otherwise average
against a handful a hair late and cancel to nothing. Only then is each line
pulled onto a beat, and only if it is close enough to one.

Two asymmetries make this safe:

- **The lag correction applies to every line.** It is a correction to the
  measuring instrument — a human finger — and the same finger placed all of
  them.
- **Snapping applies only where it is safe.** A line still far from any beat
  after correction keeps its own time. That is not a mistimed tap, it is a
  pickup, a held entry or a rubato phrase, and pulling it onto a beat would be
  overruling the player.

The measured lag is shown rather than silently applied. Someone who learns they
tap a fifth of a second late will tap differently next time, and that is worth
more than the correction.

Running the tidy twice changes nothing: once the lines are on the grid the
measured lag is zero, so the correction stops applying.

### Playing with them

The practice screen shows the current line beside the current chord. That is
the whole feature, and it is the whole point: a guitarist singing needs to know
which words go over which change, and nothing finer.

## Deliberately not in phase two

- **Word-level highlighting.** The data model carries `syllables` because
  retrofitting it later would be a migration, but nothing writes them. Karaoke
  polish is not what a guitarist is short of.
- **Editing the beat grid by hand.** A tempo override and a metre override
  exist; moving individual beats does not. The grid is either roughly right, in
  which case the overrides fix it, or the piece is free-time, in which case the
  analysis already says so and decodes off the harmony instead.
- **Sharing edits between people.** Everything is on-device by design, and a
  sharing story is a privacy story, not a feature.
- **Section marks in the interface.** `SectionMark` is in the model and the app
  can already find the repeating four-bar unit; naming those is worth doing,
  and it is worth doing after the two above have been used by someone.

## State of play

Built and tested:

- The overlay model, `applyingEdits`, `pruned`, and the lyric timing functions
  live in `GeetaabCore` — pure logic, no platform, tested on Linux alongside
  the rest of the engine.
- The three editing surfaces exist in the iOS app: `ChordEditorView`,
  `LyricsEditorView` (write / bind / adjust), and the practice screen's lyric
  line.

Not built:

- The web app has none of this yet. The model is deliberately platform-free, so
  it ports as a data structure and four functions rather than as a design
  decision to be made again — and it should be ported before a song edited on
  one and opened on the other can diverge.
