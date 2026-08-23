/* Fetch and prepare the GuitarSet subset that guitarset/corpus.json lists.

     npx vite-node scripts/guitarset.mjs            # into guitarset/data/
     NODE_USE_ENV_PROXY=1 npx vite-node scripts/guitarset.mjs   # behind a proxy

   GuitarSet (Xi, Bittner, Pauwels, Ye & Bello, ISMIR 2018) is CC BY 4.0:
   https://doi.org/10.5281/zenodo.3371780 — see guitarset/corpus.json for the
   full citation. The audio COULD legally be committed, but 36 recordings are
   ~70 MB of f32 and the full archive is 657 MB, which has no business in a
   git history; the annotations-derived reference timelines are small and are
   committed instead, and this script materialises just the audio.

   It downloads only the needed members of audio_mono-mic.zip via HTTP range
   requests (central directory first, then each file's compressed bytes,
   ~2 MB apiece), inflates them with node's zlib, decodes the 44.1 kHz PCM16
   WAV, and resamples to the 22050 Hz mono f32 format the whole harness uses —
   with the app's own band-limited resampler, so what the harness hears is
   exactly what the app would hear. No external tools needed.

   Idempotent: files already in guitarset/data/ are skipped. */
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resample } from '../src/core/dsp.ts';

const ZIP_URL = 'https://zenodo.org/records/3371780/files/audio_mono-mic.zip?download=1';
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const gsDir = join(repoRoot, 'guitarset');
const dataDir = join(gsDir, 'data');

const manifest = JSON.parse(await readFile(join(gsDir, 'corpus.json'), 'utf8'));
await mkdir(dataDir, { recursive: true });

async function fetchRange(start, end) {
  const res = await fetch(ZIP_URL, { headers: { Range: `bytes=${start}-${end}` } });
  if (res.status !== 206) {
    throw new Error(
      `range request came back ${res.status} — Zenodo normally supports ranges; ` +
        `behind a proxy, retry with NODE_USE_ENV_PROXY=1`,
    );
  }
  return Buffer.from(await res.arrayBuffer());
}

async function contentLength() {
  const res = await fetch(ZIP_URL, { method: 'HEAD' });
  const len = Number(res.headers.get('content-length'));
  if (!len) throw new Error(`no content-length (status ${res.status})`);
  return len;
}

/** Central directory of the remote zip: name -> { offset, compressedSize, method }. */
async function readDirectory() {
  const total = await contentLength();
  const tailLen = Math.min(total, 66000);
  const tail = await fetchRange(total - tailLen, total - 1);
  const eocd = tail.lastIndexOf(Buffer.from('PK\x05\x06', 'binary'));
  if (eocd < 0) throw new Error('end-of-central-directory not found');
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOffset = tail.readUInt32LE(eocd + 16);
  const cd = await fetchRange(cdOffset, cdOffset + cdSize - 1);
  const entries = new Map();
  let p = 0;
  while (p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50) {
    const method = cd.readUInt16LE(p + 10);
    const compressedSize = cd.readUInt32LE(p + 20);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    const offset = cd.readUInt32LE(p + 42);
    const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name, { offset, compressedSize, method });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** One member's decompressed bytes, via two range requests. */
async function readMember(entry) {
  const head = await fetchRange(entry.offset, entry.offset + 29);
  if (head.readUInt32LE(0) !== 0x04034b50) throw new Error('bad local header');
  const nameLen = head.readUInt16LE(26);
  const extraLen = head.readUInt16LE(28);
  const dataStart = entry.offset + 30 + nameLen + extraLen;
  const raw = await fetchRange(dataStart, dataStart + entry.compressedSize - 1);
  if (entry.method === 0) return raw;
  if (entry.method === 8) return inflateRawSync(raw);
  throw new Error(`unsupported compression method ${entry.method}`);
}

/** 16-bit PCM mono WAV -> Float32Array plus its sample rate. */
function decodeWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }
  let p = 12;
  let fmt = null;
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') {
      fmt = {
        format: buf.readUInt16LE(p + 8),
        channels: buf.readUInt16LE(p + 10),
        rate: buf.readUInt32LE(p + 12),
        bits: buf.readUInt16LE(p + 22),
      };
    } else if (id === 'data') {
      if (!fmt || fmt.format !== 1 || fmt.channels !== 1 || fmt.bits !== 16) {
        throw new Error(`unexpected WAV format ${JSON.stringify(fmt)}`);
      }
      const n = Math.floor(size / 2);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(p + 8 + i * 2) / 32768;
      return { samples: out, rate: fmt.rate };
    }
    p += 8 + size + (size & 1);
  }
  throw new Error('no data chunk');
}

const wanted = [];
for (const song of manifest.songs) {
  const out = join(gsDir, song.file);
  const exists = await stat(out).then(() => true, () => false);
  if (!exists) wanted.push({ id: song.id, out });
}
if (wanted.length === 0) {
  console.log(`all ${manifest.songs.length} files already in ${dataDir}`);
  process.exit(0);
}
console.log(`${wanted.length} of ${manifest.songs.length} files to fetch from ${ZIP_URL}`);
console.log(manifest.attribution);

const directory = await readDirectory();
let bytes = 0;
for (const { id, out } of wanted) {
  const member = `${id}_mic.wav`;
  const entry = directory.get(member);
  if (!entry) throw new Error(`${member} not in archive`);
  const wav = decodeWav(await readMember(entry));
  const mono22 = resample(wav.samples, wav.rate, 22050);
  await writeFile(out, Buffer.from(mono22.buffer, mono22.byteOffset, mono22.byteLength));
  bytes += entry.compressedSize;
  console.log(`  ${id}  ${(entry.compressedSize / 1e6).toFixed(1)} MB fetched -> ${(mono22.length / 22050).toFixed(0)}s f32`);
}
console.log(`done: ${(bytes / 1e6).toFixed(0)} MB downloaded, audio in ${dataDir}`);
console.log('score it with: npx vite-node scripts/regress.mjs --corpus guitarset');
