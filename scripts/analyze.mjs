/* Run the analysis pipeline over a decoded audio file, printing what it heard.
   Useful for checking the transcription against a published tab without a
   browser in the loop.

     ffmpeg -i song.m4a -ac 1 -ar 22050 -f f32le song.f32
     npx vite-node scripts/analyze.mjs song.f32 22050
*/
import { readFile } from 'node:fs/promises';
import { analyzeAudio } from '../src/core/analyze.ts';
import { chordName } from '../src/core/chordTypes.ts';

const path = process.argv[2];
const sampleRate = Number(process.argv[3] ?? 22050);
if (!path) {
  console.error('usage: vite-node scripts/analyze.mjs <file.f32> [sampleRate]');
  process.exit(1);
}
const buf = await readFile(path);
const samples = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
console.log(`${path}: ${(samples.length / sampleRate).toFixed(1)}s at ${sampleRate}Hz`);

const started = Date.now();
const res = analyzeAudio(samples, sampleRate);
console.log(`analysis took ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(
  JSON.stringify(
    {
      key: res.key.name,
      tempo: Math.round(res.tempo * 10) / 10,
      meter: `${res.beatsPerBar}/4`,
      tuningCents: Math.round(res.tuning * 100),
      confidence: Math.round(res.confidence * 1000) / 1000,
    },
    null,
    2,
  ),
);

const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
console.log('\nsegments:');
for (const seg of res.segments) {
  console.log(`  ${fmt(seg.start)}–${fmt(seg.end)}  ${chordName(seg.chord)}`);
}

const hist = new Map();
for (const seg of res.segments) {
  const name = chordName(seg.chord);
  hist.set(name, (hist.get(name) ?? 0) + (seg.end - seg.start));
}
const total = [...hist.values()].reduce((a, b) => a + b, 0) || 1;
console.log('\ntime share by chord:');
for (const [name, dur] of [...hist.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${name.padEnd(8)} ${((dur / total) * 100).toFixed(1)}%`);
}
