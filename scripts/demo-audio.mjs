/* Render the demo track once, as the file the app ships.

     npx vite-node scripts/demo-audio.mjs            # write public/demo.m4a
     npx vite-node scripts/demo-audio.mjs --check    # verify, write nothing

   The demo used to be synthesized in the browser on every tap. That is a few
   hundred milliseconds of two-stage Karplus-Strong and a room convolution on
   the main thread before the screen so much as changes, and it re-derives an
   identical result every time. This renders it once, here, and commits the
   audio.

   Rendering it ahead of time also makes it a fixed thing rather than a
   moving one. The demo is the only render whose transcription the app shows
   back to the listener, and the beat tracker's phase on a syncopated,
   percussionless strum is a near-run thing — it turns on where the first
   strum falls within a beat. As a file, that question is settled once, here,
   by the check below, instead of every time the voice is touched.

   Encoding needs a tool this repo does not vendor: afconvert (macOS, part of
   the OS) or ffmpeg. Both are only needed to regenerate the file, never to
   build or run the app.
*/
import { execFile } from 'node:child_process';
import { readFile, writeFile, unlink, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderDemoTrack, DEMO_PROGRESSION } from '../src/audio/synth.ts';
import { STRUM_PATTERNS } from '../src/music/arrange.ts';
import { encodeWav } from '../src/audio/wav.ts';
import { analyzeAudio } from '../src/core/analyze.ts';
import { chordName, isNoChord } from '../src/core/chordTypes.ts';

const run = promisify(execFile);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(repoRoot, 'public', 'demo.m4a');

/* What the app asks for. Kept here rather than imported so that changing the
   demo means regenerating the file, and the mismatch is loud if it does not. */
export const DEMO = { bpm: 96, seed: 20240, leadInBeats: 1.2, patternId: 'classic', sampleRate: 44100 };
const EXPECTED = ['G', 'D', 'Am', 'C', 'G', 'D', 'Am', 'C', 'G', 'D', 'Am', 'C', 'G', 'D', 'Am', 'C'];

function decodeWav16(buf) {
  let p = 12;
  let fmt = null;
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') {
      fmt = { channels: buf.readUInt16LE(p + 10), rate: buf.readUInt32LE(p + 12), bits: buf.readUInt16LE(p + 22) };
    } else if (id === 'data') {
      const frames = Math.floor(size / 2 / fmt.channels);
      const out = new Float32Array(frames);
      for (let i = 0; i < frames; i++) out[i] = buf.readInt16LE(p + 8 + i * fmt.channels * 2) / 32768;
      return { samples: out, rate: fmt.rate };
    }
    p += 8 + size + (size & 1);
  }
  throw new Error('no data chunk');
}

/** Encode to AAC with whatever this machine has. */
async function encodeAac(wavPath, outPath) {
  const attempts = [
    ['afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '96000', '-q', '127', '-s', '3', wavPath, outPath]],
    ['ffmpeg', ['-y', '-i', wavPath, '-c:a', 'aac', '-b:a', '96k', '-ac', '1', outPath]],
  ];
  for (const [cmd, args] of attempts) {
    try {
      await run(cmd, args);
      return cmd;
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw new Error(`${cmd} failed: ${error.stderr || error.message}`);
    }
  }
  throw new Error('need afconvert (macOS) or ffmpeg on PATH to encode the demo');
}

/** Decode back, so the check hears what a browser will hear. */
async function decodeAac(path, wavPath) {
  const attempts = [
    ['afconvert', ['-f', 'WAVE', '-d', 'LEI16', path, wavPath]],
    ['ffmpeg', ['-y', '-i', path, '-c:a', 'pcm_s16le', wavPath]],
  ];
  for (const [cmd, args] of attempts) {
    try {
      await run(cmd, args);
      return decodeWav16(await readFile(wavPath));
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw new Error(`${cmd} failed: ${error.stderr || error.message}`);
    }
  }
  throw new Error('need afconvert (macOS) or ffmpeg on PATH to decode the demo');
}

/**
 * The check that matters: after encoding and decoding, does the app's own
 * analyzer still hear the chords that were played, where they were played?
 *
 * AAC is not sample-aligned with its input — the encoder prepends priming
 * samples and the decoder is supposed to drop them — so this is the step that
 * would catch a shift, and a lossy codec smearing the strum transients is
 * exactly the sort of thing a beat tracker notices.
 */
function verify(samples, rate, label) {
  const beat = 60 / DEMO.bpm;
  const result = analyzeAudio(samples, rate);
  const heard = result.segments.filter((s) => !isNoChord(s.chord));
  const names = heard.map((s) => chordName(s.chord));
  const problems = [];
  if (names.join(' ') !== EXPECTED.join(' ')) problems.push(`chords: ${names.join(' ')}`);
  if (result.key.name !== 'G major') problems.push(`key: ${result.key.name}`);
  if (Math.abs(result.tempo - DEMO.bpm) > 4) problems.push(`tempo: ${result.tempo.toFixed(1)}`);
  let worst = 0;
  let t = DEMO.leadInBeats * beat;
  for (const [i, chord] of [...DEMO_PROGRESSION, ...DEMO_PROGRESSION].entries()) {
    if (heard[i]) worst = Math.max(worst, Math.abs(heard[i].start - t));
    t += chord.beats * beat;
  }
  if (worst > beat / 4) problems.push(`chord changes up to ${(worst * 1000).toFixed(0)} ms out (${(worst / beat).toFixed(2)} beat)`);
  console.log(
    `  ${label.padEnd(18)} ${names.length} chords, ${result.key.name}, ${result.tempo.toFixed(1)} BPM, worst change ${(worst * 1000).toFixed(0)} ms (${(worst / beat).toFixed(2)} beat)`,
  );
  return problems;
}

const pattern = STRUM_PATTERNS.find((p) => p.id === DEMO.patternId);
const samples = renderDemoTrack([...DEMO_PROGRESSION, ...DEMO_PROGRESSION], pattern, DEMO);
console.log(`rendered ${(samples.length / DEMO.sampleRate).toFixed(1)}s`);

const tmpWav = join(repoRoot, 'public', '.demo-tmp.wav');
const tmpBack = join(repoRoot, 'public', '.demo-back.wav');
await writeFile(tmpWav, Buffer.from(await encodeWav(samples, DEMO.sampleRate).arrayBuffer()));

const check = process.argv.includes('--check');
const target = check ? join(repoRoot, 'public', '.demo-check.m4a') : OUT;
const tool = await encodeAac(tmpWav, target);
const encoded = (await stat(target)).size;
const decoded = await decodeAac(target, tmpBack);
await Promise.all([unlink(tmpWav), unlink(tmpBack)].map((p) => p.catch(() => undefined)));

console.log(`encoded with ${tool}: ${(encoded / 1024).toFixed(0)} KB (${((encoded / (samples.length * 2)) * 100).toFixed(1)}% of the WAV)`);
const problems = [...verify(samples, DEMO.sampleRate, 'as rendered'), ...verify(decoded.samples, decoded.rate, 'encoded + decoded')];

if (check) await unlink(target).catch(() => undefined);
if (problems.length) {
  console.error(`\nthe demo file does not transcribe correctly:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(check ? '\nchecks pass; nothing written' : `\nwrote ${OUT}`);
