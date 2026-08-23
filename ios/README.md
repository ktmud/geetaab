# geetaab for iPhone

A native build of the same app. Same analysis, same arrangement, same answers —
but with the microphone configured the way a browser cannot configure it, and
with a path that skips the microphone altogether.

```
ios/
  GeetaabKit/        a Swift package
    GeetaabCore      the engine. No Apple framework, no I/O, no UI.
    GeetaabAudio     capture, decode, playback, storage.
  GeetaabApp/        the SwiftUI app
```

## Building

```bash
brew install xcodegen
cd ios/GeetaabApp && xcodegen generate && open Geetaab.xcodeproj
```

The Xcode project is generated from `project.yml` rather than committed: a
derived file in version control is a merge conflict waiting to happen. Set your
own team in Signing & Capabilities and run on a device — the simulator has no
useful microphone, and every interesting thing about this app happens at the
microphone.

## Why native at all

Not for system audio. iOS has no supported way for an app to record what
another app is playing: `ReplayKit`'s broadcast extension is the only route to
system audio, and DRM content — which is to say Apple Music and Spotify — is
muted at the system level before it reaches any extension. That door is closed
and this app does not knock on it.

What native buys is the other two things:

**A microphone that is actually recording music.** Safari's `getUserMedia` runs
the input through a speech chain by default, and `echoCancellation: false` is a
request iOS does not honour. Echo cancellation subtracts the phone's own
speaker out of the signal; automatic gain control pumps the noise floor up
between strums; noise suppression carves holes in sustained chords. All three
fight the analysis. `AVAudioSession` with `.measurement` mode turns the whole
chain off, and `MicrophoneRecorder` verifies it is off rather than assuming so.

**A file path that skips the room.** `AVAssetReader` gives the recording
itself, not a room's impression of it. That matters more than it sounds: the
`bass` chromagram works between 65 Hz and 196 Hz (`Chroma.swift`), and a phone
speaker produces almost nothing down there, which is exactly where every
chord's root lives. An imported file reads better than any microphone take, on
any device.

Everything else follows from being a real app: recording survives the player
switching to a music app to press play, an interruption is recorded as a gap
rather than silently stitched over, and the take is thirty megabytes of
preallocated float rather than a growing array on the audio thread.

## Everything stays on the phone

There is no network code in this app. No account, no sync, no analytics, no
crash reporter. Songs live in Application Support, marked
`isExcludedFromBackup` so they do not go to iCloud either, with file protection
set so they are unreadable while the phone is locked. A recording of someone's
living room should not become someone else's problem to secure.

## How the port is held to the web build

Two implementations of one algorithm is a liability unless something holds them
together. `scripts/golden.mjs` runs the TypeScript pipeline over a synthesized
recording and writes what it produced at every stage to
`GeetaabKit/Tests/GeetaabCoreTests/Golden/golden.json`. The Swift tests rebuild
the same recording — the PRNG is 32-bit integer arithmetic, so it is
byte-identical across the two languages — and check every stage against it.

```bash
npx vite-node scripts/golden.mjs      # regenerate, after an intended change
cd ios/GeetaabKit && swift test       # runs on Linux too; no Xcode needed
```

They currently agree to **1.0e-7 relative**, which is the last bit of single
precision, and everything discrete matches exactly: the chord sequence, the
decoded lattice path, the capo, the shape table, the bar signatures, the loop.
Nudging one decoder prior by half a percent fails fifteen tests.

`GeetaabCore` depends on no Apple framework precisely so those tests can run
anywhere. Accelerate backs the FFT where it exists and a portable radix-2 does
where it does not; `usesAcceleratedFFT` says which.

## What has and has not been run

- `GeetaabCore` — built and tested on Linux. 37 tests.
- `GeetaabAudio`, `GeetaabApp` — written and syntax-checked, **not compiled**:
  they need the iOS SDK. Expect to fix a few API details on the first build.

## Edits are an overlay

The analysis is a measurement; a player's corrections are not. They are stored
separately (`Edits.swift`) and anchored in **seconds**, never in beats or bar
numbers, so that re-analysing a song under a better pipeline — which the
version stamp exists to force — cannot slide someone's work off the music. When
a later analysis agrees with a correction, `pruned` retires it, so improving
the engine is never held back by a note about a bug that is fixed.
