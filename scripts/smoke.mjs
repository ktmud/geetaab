/**
 * End-to-end smoke test against a real browser.
 *
 * The unit tests cover the analysis in isolation; this covers the parts they
 * cannot reach — the worker, the audio graph, the microphone path and the
 * practice transport — by driving the built app the way a person would.
 *
 *   npm run build && npm run smoke
 *
 * Needs a Chromium: either one Playwright installed, or PLAYWRIGHT_CHROMIUM
 * pointing at an executable.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const PORT = Number(process.env.SMOKE_PORT ?? 4178);
const ORIGIN = `http://localhost:${PORT}`;
const failures = [];

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}: ${JSON.stringify(actual)}`);
  if (!ok) failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function checkThat(label, ok, detail) {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures.push(label);
}

/** Everything the recording screen is currently saying, read out of the DOM. */
function listenState() {
  const canvas = document.querySelector('.listen-spectro');
  let painted = 0;
  if (canvas && canvas.width > 0) {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 12) painted++;
  }
  const overlay = document.querySelector('.listen-nomusic');
  return {
    onScreen: Boolean(document.querySelector('.listen')),
    eyebrow: document.querySelector('.eyebrow')?.textContent.trim() ?? null,
    chord: document.querySelector('.listen-chord')?.textContent.trim() ?? null,
    timer: document.querySelector('.listen-timer')?.textContent.trim() ?? null,
    spectroOn: Boolean(canvas?.classList.contains('on')),
    painted,
    overlay: overlay ? overlay.textContent.trim() : null,
    overlayBlocks: overlay ? getComputedStyle(overlay).pointerEvents !== 'none' : false,
    // Share of the viewport the overlay covers: it belongs over the meter, not
    // over the screen.
    overlayShare: overlay
      ? +(
          (overlay.getBoundingClientRect().width * overlay.getBoundingClientRect().height) /
          (innerWidth * innerHeight)
        ).toFixed(3)
      : 0,
    still: Boolean(document.querySelector('.chroma-bars.still')),
    bars: [...document.querySelectorAll('.chroma-bar')].map((bar) => bar.style.height).join(' '),
  };
}

async function waitForServer(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Preview server never came up at ${url}`);
}

/** A synthesized song in Eb, written to disk so it can drive the fake mic. */
async function writeFixture(dir) {
  const { renderProgression } = await import('../src/audio/synth.ts');
  const { encodeWav } = await import('../src/audio/wav.ts');
  const progression = [
    { root: 3, quality: 'maj', beats: 4 },
    { root: 10, quality: 'maj', beats: 4 },
    { root: 0, quality: 'min', beats: 4 },
    { root: 8, quality: 'maj', beats: 4 },
  ];
  const samples = renderProgression([...progression, ...progression, ...progression], {
    sampleRate: 44100,
    bpm: 108,
    seed: 99,
  });
  const path = join(dir, 'eb-song.wav');
  await writeFile(path, Buffer.from(await encodeWav(samples, 44100).arrayBuffer()));
  return path;
}

/** Twenty seconds of room tone: plainly audible, but never a song. */
async function writeRoomTone(dir) {
  const { encodeWav } = await import('../src/audio/wav.ts');
  const sampleRate = 44100;
  const samples = new Float32Array(sampleRate * 20);
  let seed = 4242;
  let acc = 0;
  for (let i = 0; i < samples.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    // Tilted towards the low end rather than white, the way a room is, and loud
    // enough (RMS around 0.05) that the gate has to turn it down on tonality,
    // steadiness and activity rather than on silence. Measured through the live
    // readout's own pipeline, its best chord score peaks at 0.061 — under the
    // 0.08 floor the readout believes, with room to spare.
    acc = 0.9 * acc + (seed / 4294967296 - 0.5) * 0.4;
    samples[i] = Math.max(-1, Math.min(1, acc * 0.2));
  }
  const path = join(dir, 'room-tone.wav');
  await writeFile(path, Buffer.from(await encodeWav(samples, sampleRate).arrayBuffer()));
  return path;
}

const dir = await mkdtemp(join(tmpdir(), 'geetaab-smoke-'));
const fixture = await writeFixture(dir);
const roomTone = await writeRoomTone(dir);

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
  detached: true,
});
let browser;
let quietBrowser;
try {
  await waitForServer(ORIGIN);

  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${fixture}%noloop`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const context = await browser.newContext({
    permissions: ['microphone'],
    viewport: { width: 900, height: 420 },
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('pageerror', (error) => consoleErrors.push(String(error.message)));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  console.log('\n0. the chord library');
  await page.goto(ORIGIN, { waitUntil: 'networkidle' });
  // Exact: the footer now carries a "How chords are recognized" button too.
  await page.getByRole('button', { name: 'Chords', exact: true }).click();
  const library = await page.evaluate(() => ({
    legend: Boolean(document.querySelector('.legend-grid .diagram')),
    starters: document.querySelectorAll('.palette .chord-tile').length,
    total: document.querySelectorAll('.library-grid .chord-tile').length,
  }));
  checkThat(
    'a legend, eight starters and the whole vocabulary',
    library.legend && library.starters === 8 && library.total === 84,
    `${library.starters} starters, ${library.total} chords`,
  );
  await page.getByRole('button', { name: 'Minor', exact: true }).click();
  await page.getByRole('button', { name: 'Barre only' }).click();
  const minors = await page.evaluate(() =>
    [...document.querySelectorAll('.library-grid .diagram-name')].map((el) => el.textContent.trim()),
  );
  checkThat(
    'filters compose: minor × barre-only',
    minors.length > 0 && minors.every((name) => name.endsWith('m')),
    minors.join(' '),
  );
  await page.getByRole('button', { name: 'Play Bm', exact: true }).click();
  await page.waitForTimeout(200);
  // Eighty-four shapes one to a row is eighty-four screens to scroll past, and
  // that is what the narrowest phone used to get.
  await page.getByRole('button', { name: 'All', exact: true }).click();
  const grids = [];
  for (const width of [320, 375, 430]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(250);
    const seen = await page.evaluate(() => {
      const grid = document.querySelector('.library-grid');
      const tiles = [...grid.querySelectorAll('.diagram-card')];
      const box = tiles[0]?.getBoundingClientRect();
      const drawing = tiles[0]?.querySelector('.diagram')?.getBoundingClientRect();
      return {
        columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
        fill: box && drawing ? drawing.width / box.width : 0,
        spilling: tiles.filter((t) => t.scrollWidth > t.clientWidth + 1).length,
        wider: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });
    grids.push(`${width}:${seen.columns}`);
    checkThat(
      `at ${width} points the vocabulary sits at least two to a row`,
      seen.columns >= 2 && seen.fill > 0.6 && seen.spilling === 0 && !seen.wider,
      JSON.stringify(seen),
    );
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(250);
  checkThat(
    'and a desktop lays out many more of them',
    (await page.evaluate(
      () => getComputedStyle(document.querySelector('.library-grid')).gridTemplateColumns.split(' ').length,
    )) >= 6,
    grids.join(' '),
  );

  console.log('\n1. demo track through the worker');
  await page.goto(ORIGIN, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'try the demo' }).click();
  await page.getByText('Chords you need').waitFor({ timeout: 90000 });
  const demo = await page.evaluate(() => ({
    chips: [...document.querySelectorAll('.tab-header .chip')].map((c) => c.textContent.trim()),
    loop: [...document.querySelectorAll('.loop-chord')].map((c) => c.textContent.trim()),
    palette: [...document.querySelectorAll('.diagram-name')].map((c) => c.textContent.trim()),
  }));
  check('key, tempo, metre, capo', demo.chips, ['G major', '96 BPM', '4/4', 'No capo']);
  check('four-bar loop', demo.loop, ['G', 'D', 'Am', 'C']);
  check('chord palette', demo.palette, ['G', 'D', 'Am', 'C']);

  console.log('\n1b. the whole-song tab and the printable sheet');
  // Neither copy of the tablature is built before something needs it: the
  // staves on screen arrive as they come into view, and the printable sheet is
  // not in the document until something is about to print it. On a five-minute
  // song those two together were thirty-five thousand DOM nodes in the commit
  // that first shows the tab.
  const heightAtTop = await page.evaluate(() => document.documentElement.scrollHeight);
  const beforeLooking = await page.evaluate(() => ({
    slots: document.querySelectorAll('.tab-sys').length,
    sheet: document.querySelectorAll('.print-sheet').length,
  }));
  checkThat(
    'the tablature covers the whole song',
    beforeLooking.slots >= 4,
    `${beforeLooking.slots} systems on screen`,
  );
  checkThat(
    'and the sheet nobody has asked to print is not in the page at all',
    beforeLooking.sheet === 0,
    `${beforeLooking.sheet} sheets in the document`,
  );
  await page.evaluate(() => document.querySelector('.tab-sys')?.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(500);
  const heightAtTab = await page.evaluate(() => document.documentElement.scrollHeight);
  checkThat(
    'a staff arriving into view reserves its space first, so the page never jumps',
    heightAtTop === heightAtTab,
    `${heightAtTop}px before, ${heightAtTab}px after`,
  );
  checkThat(
    'and looking at them is what draws them',
    (await page.evaluate(() => document.querySelectorAll('.tab-sys .tab-staff').length)) > 0,
  );
  // The tab is engraved, not typed: six drawn string lines with the numbers
  // sitting on them. The plain-text version still exists behind Copy, which is
  // what a forum post needs, but nothing on the page or the sheet is a <pre>.
  const staff = await page.evaluate(() => {
    const svg = document.querySelector('.tab-sys .tab-staff');
    if (!svg) return null;
    const label = svg.getAttribute('aria-label') ?? '';
    return {
      strings: svg.querySelectorAll('.tab-staff-string').length,
      barlines: svg.querySelectorAll('.tab-staff-barline').length,
      frets: svg.querySelectorAll('.tab-staff-fret').length,
      names: [...svg.querySelectorAll('.tab-staff-name')].map((n) => n.textContent),
      clefs: [...svg.querySelectorAll('.tab-staff-clef')].map((n) => n.textContent).join(''),
      boxes: svg.querySelectorAll('.tab-box').length,
      dots: svg.querySelectorAll('.tab-box-dot').length,
      label,
      bars: svg.querySelectorAll('.tab-staff-barline').length,
      leftoverPre: document.querySelectorAll('.tab-sys pre, .print-sheet pre').length,
    };
  });
  checkThat(
    'the tablature is drawn on a six-line staff, not typed out of hyphens',
    Boolean(staff) && staff.strings === 6 && staff.barlines >= 2 && staff.frets > 0 && staff.leftoverPre === 0,
    JSON.stringify(staff && { ...staff, names: staff.names.length }),
  );
  checkThat('marked TAB down the left, the way printed tablature marks itself', staff?.clefs === 'TAB', staff?.clefs);
  checkThat(
    'every chord is announced by name and by the box that shows how to hold it',
    staff?.names.length > 0 && staff.boxes === staff.names.length && staff.dots > 0,
    `${staff?.names.join(' ')} · ${staff?.boxes} boxes, ${staff?.dots} dots`,
  );
  checkThat(
    'a line holds more than a couple of bars',
    staff?.bars >= 3 && Boolean(staff.label),
    `${staff?.bars} bar lines · "${staff?.label}"`,
  );
  // Safari has not always fired beforeprint, so the sheet also watches the
  // print media query; this is that path, and the one Playwright can drive.
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(300);
  const sheet = await page.evaluate(() => ({
    systems: document.querySelectorAll('.print-sheet .print-sys').length,
    diagrams: document.querySelectorAll('.print-sheet .diagram').length,
    bars: document.querySelectorAll('.print-sheet .print-bar').length,
    staves: document.querySelectorAll('.print-sheet .print-sys .tab-staff').length,
    shown: getComputedStyle(document.querySelector('.print-sheet')).display !== 'none',
    cards: getComputedStyle(document.querySelector('.card')).display === 'none',
    topbar: getComputedStyle(document.querySelector('.topbar')).display === 'none',
  }));
  checkThat(
    'printing builds the sheet, with diagrams, chart and every bar of tab',
    sheet.systems >= 4 && sheet.diagrams >= 4 && sheet.bars >= 8 && sheet.staves >= 2,
    `${sheet.systems} systems, ${sheet.diagrams} diagrams, ${sheet.bars} chart bars, ${sheet.staves} staves`,
  );
  checkThat(
    'and print media swaps the dark screen for it',
    sheet.shown && sheet.cards && sheet.topbar,
    JSON.stringify({ shown: sheet.shown, cards: sheet.cards, topbar: sheet.topbar }),
  );
  await page.emulateMedia({ media: 'screen' });
  await page.waitForTimeout(300);
  checkThat(
    'the sheet leaves again once the printing is over',
    await page.evaluate(() => document.querySelector('.print-sheet') === null),
  );
  // The Print button has to have the sheet in the document before it calls
  // print(), not in a render that print() would never wait for.
  const buttonPath = await page.evaluate(async () => {
    const original = window.print;
    let sheetAtCall = null;
    window.print = () => {
      sheetAtCall = document.querySelectorAll('.print-sheet .print-sys').length;
    };
    document.querySelector('.tab-actions-print')?.click();
    await new Promise((r) => setTimeout(r, 200));
    window.print = original;
    return sheetAtCall;
  });
  checkThat(
    'and the Print button has it there before it asks to print',
    buttonPath !== null && buttonPath >= 4,
    `${buttonPath} systems in the document when print() was called`,
  );
  await page.evaluate(() => window.scrollTo(0, 0));

  console.log('\n1bb. the Practise button gets out of the way at the foot of the page');
  await page.setViewportSize({ width: 430, height: 932 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  const ctaAt = () =>
    page.evaluate(() => {
      const cta = document.querySelector('.sticky-cta');
      const footer = document.querySelector('.app-footer');
      if (!cta || !footer) return null;
      const c = cta.getBoundingClientRect();
      const f = footer.getBoundingClientRect();
      const style = getComputedStyle(cta);
      const hidden = style.opacity === '0' || style.visibility === 'hidden';
      // Does the button's box overlap the footer's, on screen?
      const overlaps = !hidden && c.bottom > f.top && c.top < f.bottom;
      return { hidden, overlaps };
    });
  const ctaTop = await ctaAt();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(600);
  const ctaBottom = await ctaAt();
  checkThat(
    'it is there while there is still page to reach past, and gone once there is not',
    ctaTop && ctaBottom && !ctaTop.hidden && ctaBottom.hidden && !ctaBottom.overlaps,
    `top of page ${JSON.stringify(ctaTop)}, foot of page ${JSON.stringify(ctaBottom)}`,
  );

  // Two chord boxes to a row at the very least, on the narrowest phone there
  // is. One to a row put a box drawn at 92 points in the middle of a card
  // three hundred and fifty wide, all the way down the page.
  const palette = async () =>
    page.evaluate(() => {
      const pal = document.querySelector('.palette');
      const tiles = [...pal.querySelectorAll('.diagram-card')];
      const box = tiles[0]?.getBoundingClientRect();
      const drawing = tiles[0]?.querySelector('.diagram')?.getBoundingClientRect();
      const heights = new Set(tiles.map((t) => Math.round(t.getBoundingClientRect().height)));
      return {
        columns: getComputedStyle(pal).gridTemplateColumns.split(' ').length,
        // The drawing should use the card it is given, not sit small in it.
        fill: box && drawing ? drawing.width / box.width : 0,
        // Nothing may push its own track wider than the grid gave it.
        spilling: tiles.filter((t) => t.scrollWidth > t.clientWidth + 1).length,
        ragged: heights.size > 1,
        wider: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });
  const palettes = [];
  for (const width of [320, 375, 430]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(250);
    const seen = await palette();
    palettes.push(`${width}: ${seen.columns} cols, ${Math.round(seen.fill * 100)}% filled`);
    checkThat(
      `at ${width} points the chords sit at least two to a row, filling their cards`,
      seen.columns >= 2 && seen.fill > 0.6 && seen.spilling === 0 && !seen.ragged && !seen.wider,
      JSON.stringify(seen),
    );
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(250);
  checkThat(
    'and a desktop spends its width on more of them rather than on bigger ones',
    (await palette()).columns >= 4,
    palettes.join(' · '),
  );
  await page.evaluate(() => window.scrollTo(0, 0));

  console.log('\n1c. dropping an audio file onto the home screen');
  await page.goto(ORIGIN, { waitUntil: 'networkidle' });
  const droppedWav = await readFile(await writeFixture(dir));
  const dragState = await page.evaluate(async (bytes) => {
    const file = new File([new Uint8Array(bytes)], 'dropped-song.wav', { type: 'audio/wav' });
    const dt = new DataTransfer();
    dt.items.add(file);
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
    await new Promise((r) => setTimeout(r, 150));
    const veil = document.querySelector('.drop-veil');
    const shown = Boolean(veil) && veil.textContent.includes('Drop the audio file');
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
    return { shown };
  }, [...droppedWav]);
  checkThat('a file dragged over the page raises the drop veil', dragState.shown);
  await page.getByText('Chords you need').waitFor({ timeout: 90000 });
  const droppedTitle = await page.evaluate(
    () => document.querySelector('.tab-title-input')?.value ?? '',
  );
  checkThat(
    'and dropping it runs the whole pipeline to a tab',
    String(droppedTitle).includes('dropped-song'),
    JSON.stringify(droppedTitle),
  );
  // Section 2 continues from the demo tab, so put that exact state back.
  await page.getByRole('button', { name: 'Home' }).click();
  await page.getByRole('button', { name: 'try the demo' }).click();
  await page.getByText('Chords you need').waitFor({ timeout: 90000 });

  console.log('\n2. practice transport');
  await page.getByRole('button', { name: /Practise this/ }).click();
  await page.waitForTimeout(400);
  const hintShown = await page.evaluate(() => Boolean(document.querySelector('.practice-hint')));
  checkThat('the first visit explains the screen', hintShown);
  await page.getByRole('button', { name: 'Got it' }).click();
  const hintGone = await page.evaluate(() => document.querySelector('.practice-hint') === null);
  checkThat('and the hint dismisses', hintGone);
  // OK does not leave the player to find the play button: it rolls straight
  // into the count-in.
  await page.waitForTimeout(600);
  const counting = await page.evaluate(() => document.querySelector('.countin')?.textContent ?? null);
  checkThat('and rolls straight into the count-in', counting !== null, `showed ${counting}`);
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.waitForTimeout(2500);
  const clock = () => page.evaluate(() => document.querySelector('.seek-time')?.textContent.trim());
  const clockAfterCancel = await clock();
  checkThat(
    'pausing during the count-in does not start playback',
    clockAfterCancel.startsWith('0:00'),
    clockAfterCancel,
  );
  const laneBefore = await page.evaluate(() => document.querySelector('.lane-inner')?.style.transform);

  console.log('\n2a. changing the arrangement without leaving the song');
  // Deciding the strum is wrong happens while playing along, not before, and
  // used to cost a trip back to the tab screen.
  await page.getByRole('button', { name: 'Play' }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: /Make it fit your hands|调成你顺手的样子/ }).click();
  await page.waitForTimeout(300);
  const sheet2 = await page.evaluate(() => ({
    open: Boolean(document.querySelector('.practice-sheet')),
    paused: document.querySelector('.countin') === null,
    capo: document.querySelector('.practice-sheet #capo')?.value ?? null,
    strum: document.querySelector('.practice-sheet #strum')?.value ?? null,
  }));
  checkThat(
    'the practice screen opens the arrangement controls, and pauses to do it',
    sheet2.open && sheet2.paused && sheet2.capo !== null && sheet2.strum !== null,
    JSON.stringify(sheet2),
  );
  const before2 = await page.evaluate(
    () => document.querySelector('.strum-strip-label')?.textContent ?? '',
  );
  await page.locator('.practice-sheet #strum').selectOption({ label: 'The eight-note pattern' });
  await page.waitForTimeout(400);
  const after2 = await page.evaluate(() => ({
    label: document.querySelector('.strum-strip-label')?.textContent ?? '',
    plucks: document.querySelectorAll('.strum-cell.pluck').length,
  }));
  checkThat(
    'and the change reaches the player behind it',
    after2.label !== before2 && after2.plucks > 0,
    `${before2} -> ${after2.label}, ${after2.plucks} plucked steps`,
  );
  await page.locator('.practice-sheet #strum').selectOption({ label: 'Down-up eighths' });
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Close' }).click();
  await page.waitForTimeout(200);
  checkThat(
    'closing it puts the player back',
    await page.evaluate(() => document.querySelector('.practice-sheet') === null),
  );

  console.log('\n2b. seeking');
  await page.getByRole('button', { name: 'Forward ten seconds' }).click();
  check('the +10 button jumps ahead', await clock(), '0:10');
  await page.getByRole('button', { name: 'Back ten seconds' }).click();
  check('the -10 button comes back, clamped at zero', await clock(), '0:00');
  const bar = await page.locator('.seekbar').boundingBox();
  await page.mouse.move(bar.x + bar.width * 0.55, bar.y + bar.height / 2);
  await page.mouse.down();
  await page.mouse.move(bar.x + bar.width * 0.7, bar.y + bar.height / 2, { steps: 4 });
  await page.mouse.up();
  const afterDrag = await clock();
  checkThat('dragging the bar scrubs the song', afterDrag !== '0:00', `now at ${afterDrag}`);
  await page.getByRole('button', { name: 'Volume' }).click();
  await page.getByRole('slider', { name: 'Playback volume' }).fill('0.5');
  const volume = await page.evaluate(() => document.querySelector('.volume-value')?.textContent.trim());
  check('the tucked-away volume control', volume, '50%');
  await page.getByRole('button', { name: 'Volume' }).click();
  await page.getByRole('button', { name: 'Back to the start' }).click();
  check('back to the start', await clock(), '0:00');
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.keyboard.press('Space');
  await page.waitForTimeout(400);
  const countingViaKey = await page.evaluate(() => document.querySelector('.countin')?.textContent ?? null);
  checkThat('space starts the count-in', countingViaKey !== null, `showed ${countingViaKey}`);
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  checkThat('space again pauses', await page.evaluate(() => document.querySelector('.countin') === null));

  await page.getByRole('button', { name: 'Play' }).click();
  await page.waitForTimeout(6000);
  const laneAfter = await page.evaluate(() => document.querySelector('.lane-inner')?.style.transform);
  checkThat('the chord lane scrolls with the audio', laneBefore !== laneAfter, `${laneBefore} -> ${laneAfter}`);
  const guide = await page.evaluate(() => ({
    bar: document.querySelector('.strum-strip-bar')?.textContent.trim() ?? '',
    lit: document.querySelectorAll('.strum-cell.now').length,
    next: Boolean(document.querySelector('.practice-next')),
  }));
  checkThat('the strum guide follows the beat', /^Bar \d+ of \d+$/.test(guide.bar) && guide.lit === 1, guide.bar);
  checkThat('the next chord is previewed', guide.next);
  // The whole screen rests on one claim: the block sitting on the amber line is
  // the chord to play now. Sampled across several seconds of playback, because
  // a single frame could agree by luck.
  const sync = [];
  for (let i = 0; i < 5; i++) {
    sync.push(
      await page.evaluate(() => {
        const head = document.querySelector('.lane-playhead')?.getBoundingClientRect();
        if (!head) return null;
        const x = head.left + head.width / 2;
        const blocks = [...document.querySelectorAll('.lane-block')].map((el) => ({
          name: el.querySelector('.lane-block-name')?.textContent ?? '',
          left: el.getBoundingClientRect().left,
          right: el.getBoundingClientRect().right,
          active: el.classList.contains('active'),
        }));
        const under = blocks.find((b) => b.left <= x && x < b.right);
        const marked = blocks.find((b) => b.active);
        return { under: under?.name ?? null, marked: marked?.name ?? null };
      }),
    );
    await page.waitForTimeout(700);
  }
  const agreed = sync.filter((s) => s && s.under !== null && s.under === s.marked);
  checkThat(
    'the chord under the playhead is the one the screen calls current',
    agreed.length === sync.length,
    sync.map((s) => (s ? `${s.under}/${s.marked}` : 'none')).join(' '),
  );
  await page.getByRole('slider', { name: 'Practice speed' }).fill('0.6');
  const speed = await page.evaluate(() => document.querySelector('.speed-value')?.textContent.trim());
  check('slow-down control', speed, '60%');
  await page.getByRole('button', { name: /Exit/ }).click();

  console.log('\n2bb. the playhead keeps naming the chord it is standing on');
  // A phone resizes in the middle of playing — a rotation, or the address bar
  // collapsing. The blocks are laid out by React from the lane's width; the
  // lane is slid under the line by an animation frame. If those two ever use
  // different widths, the line sits over one chord while another is lit.
  const alignment = async () =>
    page.evaluate(() => {
      const head = document.querySelector('.lane-playhead')?.getBoundingClientRect();
      if (!head) return null;
      const x = head.left + head.width / 2;
      const blocks = [...document.querySelectorAll('.lane-block')].map((el) => {
        const r = el.getBoundingClientRect();
        return { name: el.querySelector('.lane-block-name')?.textContent ?? '', l: r.left, r: r.right,
                 active: el.classList.contains('active') };
      });
      const under = blocks.find((b) => b.l <= x && x < b.r);
      // No block under the line means the line is in the seam between two of
      // them, which is not a disagreement about anything.
      return { under: under?.name ?? null, lit: blocks.find((b) => b.active)?.name ?? null };
    });
  // The section above left the player; this one needs it running, because a
  // playhead that is not on screen agrees with everything. Opening the screen
  // rolls into the count-in by itself, so pressing play here would pause it.
  await page.getByRole('button', { name: /Practise this/ }).click();
  for (let i = 0; i < 40; i++) {
    if ((await clock()) !== '0:00') break;
    if (i === 20 && (await page.getByRole('button', { name: 'Play', exact: true }).count())) {
      await page.getByRole('button', { name: 'Play', exact: true }).click();
    }
    await page.waitForTimeout(300);
  }
  checkThat('the song is playing under the line', (await clock()) !== '0:00', `clock at ${await clock()}`);
  const misaligned = [];
  let compared = 0;
  for (const [w, h] of [[1280, 720], [1180, 720], [1280, 680], [1024, 720], [1280, 720]]) {
    await page.setViewportSize({ width: w, height: h });
    for (let k = 0; k < 3; k++) {
      const seen = await alignment();
      if (seen && seen.under) {
        compared++;
        if (seen.under !== seen.lit) misaligned.push(`${w}x${h}: ${seen.under} under, ${seen.lit} lit`);
      }
      await page.waitForTimeout(120);
    }
  }
  checkThat(
    'resizing mid-playback never leaves the line over one chord and the light on another',
    // Counted, because a line that is never over a block agrees with everything.
    misaligned.length === 0 && compared >= 10,
    misaligned.length ? misaligned.join('; ') : `aligned across ${compared} of 15 samples`,
  );
  if (await page.getByRole('button', { name: 'Pause' }).count()) {
    await page.getByRole('button', { name: 'Pause' }).click();
  }

  console.log('\n2bc. the same player, held upright');
  // Practice used to demand landscape and show a "turn your phone" screen to
  // anyone who would not. Upright is a layout now, so the check is that it is
  // the player and that all of it is on the screen: a transport hanging off
  // the bottom of a phone is the same failure as no transport at all.
  await page.setViewportSize({ width: 430, height: 932 });
  await page.waitForTimeout(400);
  const upright = await page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom) };
    };
    const stage = document.querySelector('.practice-stage');
    return {
      player: Boolean(document.querySelector('.practice.portrait')),
      prompt: Boolean(document.querySelector('.rotate-hint')),
      columns: stage ? getComputedStyle(stage).gridTemplateColumns.split(' ').length : 0,
      diagram: box('.practice-now > svg'),
      lane: box('.practice-lane'),
      dock: box('.practice-dock'),
      viewport: window.innerHeight,
    };
  });
  checkThat(
    'an upright phone gets the player, not a screen asking it to turn over',
    upright.player && !upright.prompt && upright.columns === 1,
    JSON.stringify({ player: upright.player, prompt: upright.prompt, columns: upright.columns }),
  );
  checkThat(
    'the transport stays on the screen rather than hanging off the bottom',
    upright.dock !== null && upright.dock.bottom <= upright.viewport,
    `dock ends at ${upright.dock?.bottom} of ${upright.viewport}`,
  );
  // The diagram takes whatever height the lane and transport leave, so its two
  // caps have to be written from one number — cap only the width and flex hands
  // it a taller box than the drawing fills.
  checkThat(
    'the chord is drawn large and in proportion',
    upright.diagram !== null &&
      upright.diagram.w >= 150 &&
      Math.abs(upright.diagram.h / upright.diagram.w - 1.18) < 0.03,
    JSON.stringify(upright.diagram),
  );
  checkThat(
    'and the lane is a strip under it, not the room the chord should have had',
    upright.lane !== null && upright.lane.h <= 220 && upright.lane.h < upright.diagram.h,
    `lane ${upright.lane?.h}px against a ${upright.diagram?.h}px diagram`,
  );
  // What is coming is worth a shape rather than a word, for the blocks on
  // screen — and only those, or a long song puts thousands of nodes in a lane
  // that shows five of them.
  const lane = await page.evaluate(() => {
    const blocks = [...document.querySelectorAll('.lane-block')];
    const drawn = blocks.filter((b) => b.querySelector('.diagram'));
    const box = drawn[0]?.querySelector('.diagram')?.getBoundingClientRect();
    return {
      blocks: blocks.length,
      drawn: drawn.length,
      width: box ? Math.round(box.width) : 0,
      inside: drawn.every((b) => {
        const outer = b.getBoundingClientRect();
        const inner = b.querySelector('.diagram').getBoundingClientRect();
        return inner.bottom <= outer.bottom + 1 && inner.right <= outer.right + 1;
      }),
    };
  });
  checkThat(
    'the lane draws the shape of what is coming, for the blocks on screen only',
    lane.drawn > 0 && lane.drawn <= 6 && lane.drawn < lane.blocks && lane.width >= 44 && lane.inside,
    `${lane.drawn} of ${lane.blocks} blocks, ${lane.width}px wide`,
  );
  // The transport wraps onto a second line; a third one comes out of the chord
  // above it, and on the commonest Android width it used to.
  const dockRows = async () =>
    page.evaluate(() => {
      const row = document.querySelector('.dock-row');
      if (!row) return null;
      // Cluster on the centre, not the top: the play button is bigger than the
      // ones beside it, so a row does not share a top edge.
      const centres = [...row.children]
        .filter((c) => c.getBoundingClientRect().height > 0)
        .map((c) => {
          const r = c.getBoundingClientRect();
          return r.top + r.height / 2;
        })
        .sort((a, b) => a - b);
      let rows = 0;
      let last = -Infinity;
      for (const y of centres) {
        if (y - last > 24) rows++;
        last = y;
      }
      return rows;
    });
  const widths = [];
  for (const width of [430, 393, 375, 360, 320]) {
    await page.setViewportSize({ width, height: 780 });
    await page.waitForTimeout(250);
    widths.push(`${width}:${await dockRows()}`);
  }
  checkThat(
    'and it stays two rows on every phone width, down to the narrowest',
    widths.every((w) => w.endsWith(':2')),
    widths.join(' '),
  );
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(400);
  checkThat(
    'turning it back gives the sidebar and the wide lane again',
    await page.evaluate(() => {
      const stage = document.querySelector('.practice-stage');
      return (
        !document.querySelector('.practice.portrait') &&
        stage !== null &&
        getComputedStyle(stage).gridTemplateColumns.split(' ').length === 2
      );
    }),
  );

  console.log('\n2c. fingerpicking tells you which string the thumb takes');
  await page.getByRole('button', { name: /Exit/ }).click();
  await page.getByText('Chords you need').waitFor({ timeout: 90000 });
  await (await page.locator('select').all())[1].selectOption({ label: 'The eight-note pattern' });
  await page.waitForTimeout(250);
  // Drawn on approach, so walk the page rather than asking from the top.
  await page.evaluate(async () => {
    const step = Math.round(window.innerHeight * 0.8);
    for (let y = 0; y <= document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 40));
    }
    // Back to the top: at the foot of the page the Practise button is tucked
    // away, and the checks below press it.
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(400);
  // The point of deriving the pattern rather than printing string numbers: the
  // bass moves with the chord. G is rooted on the sixth string, D on the fourth.
  const picked = await page.evaluate(() => {
    const staves = [...document.querySelectorAll('.tab-sys .tab-staff')];
    const strings = new Set();
    let columns = 0;
    let notes = 0;
    for (const svg of staves) {
      for (const text of svg.querySelectorAll('.tab-staff-fret')) {
        strings.add(Number(text.dataset.string));
      }
      columns += svg.querySelectorAll('.tab-staff-col').length;
      notes += svg.querySelectorAll('.tab-staff-fret').length;
    }
    return { strings: [...strings].sort((a, b) => a - b), columns, notes };
  });
  checkThat(
    'the tablature roots each chord on its own bass string',
    // The demo is G, D, Am, C: the sixth string for G and the fourth for D.
    picked.strings.includes(6) && picked.strings.includes(4),
    JSON.stringify(picked.strings),
  );
  checkThat(
    'and a picked column carries one string, not the whole chord',
    picked.columns > 0 && picked.notes === picked.columns,
    `${picked.notes} notes over ${picked.columns} columns`,
  );
  await page.getByRole('button', { name: /Practise this/ }).click();
  await page.waitForTimeout(400);
  const strip = await page.evaluate(() =>
    [...document.querySelectorAll('.strum-cell.pluck')]
      .map((c) => `${c.querySelector('b')?.textContent ?? ''}${c.querySelector('i')?.textContent ?? ''}`)
      .join(' '),
  );
  checkThat(
    'and the practice strip names a string and a finger per step',
    /^\d[pima]( \d[pima]){7}$/.test(strip) && strip.includes('3i') && strip.includes('1a'),
    strip,
  );
  await page.getByRole('button', { name: /Exit/ }).click();
  await page.getByText('Chords you need').waitFor({ timeout: 90000 });

  console.log('\n3. microphone capture');
  await page.setViewportSize({ width: 430, height: 932 });
  await page.getByRole('button', { name: 'Home' }).click();
  await page.getByRole('button', { name: 'Listen with the mic' }).click();
  await page.waitForTimeout(4000);
  const live = await page.evaluate(() => ({
    chord: document.querySelector('.listen-chord')?.textContent.trim(),
    lit: document.querySelectorAll('.chroma-bar.lit').length,
    eyebrow: document.querySelector('.eyebrow')?.textContent.trim(),
  }));
  checkThat('live chord readout while recording', live.chord !== '···', `heard ${live.chord}`);
  checkThat('chroma meter responds', live.lit > 0, `${live.lit} bars lit`);
  checkThat(
    'the take starts by itself once music is heard',
    live.eyebrow === 'Recording',
    `eyebrow says "${live.eyebrow}"`,
  );
  await page.waitForTimeout(9000);
  const spectro = await page.evaluate(() => {
    const canvas = document.querySelector('.listen-spectro');
    if (!canvas) return { on: false, lit: 0 };
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let lit = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 12) lit++;
    return { on: canvas.classList.contains('on'), lit };
  });
  checkThat('the whole-take spectrogram paints behind the screen', spectro.on && spectro.lit > 400, `${spectro.lit} px lit`);
  await page.getByRole('button', { name: /Stop and build the tab/ }).click();
  await page.getByText('Chords you need').waitFor({ timeout: 90000 });
  const mic = await page.evaluate(() => ({
    chips: [...document.querySelectorAll('.tab-header .chip')].map((c) => c.textContent.trim()),
    palette: [...document.querySelectorAll('.diagram-name')].map((c) => c.textContent.trim()),
  }));
  check('key and capo from the microphone', mic.chips, [
    'Eb major',
    '108 BPM',
    '4/4',
    'Capo 3 · play in C major',
  ]);
  check('shapes a beginner can play', mic.palette, ['C', 'G', 'Am', 'Fmaj7']);

  console.log('\n3c. a room that is not a song');
  // The fake capture device is a browser-level flag, so hearing something else
  // means launching a second browser to hear it with.
  quietBrowser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${roomTone}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const quietContext = await quietBrowser.newContext({
    permissions: ['microphone'],
    viewport: { width: 430, height: 932 },
  });
  const quiet = await quietContext.newPage();
  quiet.on('pageerror', (error) => consoleErrors.push(String(error.message)));
  quiet.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await quiet.goto(ORIGIN, { waitUntil: 'networkidle' });
  await quiet.getByRole('button', { name: 'Listen with the mic' }).click();
  await quiet.waitForTimeout(4000);
  const room = await quiet.evaluate(listenState);
  await quiet.waitForTimeout(1500);
  const roomLater = await quiet.evaluate(listenState);
  checkThat(
    'room tone never passes for a song',
    room.eyebrow === 'Waiting for the song' && roomLater.eyebrow === 'Waiting for the song',
    `eyebrow says "${roomLater.eyebrow}"`,
  );
  checkThat(
    'the meter is covered by a verdict instead of dancing',
    room.overlay === 'No music detected' && room.still,
    `overlay ${JSON.stringify(room.overlay)}`,
  );
  checkThat(
    'and the bars really are held still across a second and a half',
    room.bars === roomLater.bars && room.bars.length > 0,
    room.bars === roomLater.bars ? 'unchanged' : `${room.bars} -> ${roomLater.bars}`,
  );
  checkThat('no chord name is claimed over noise', roomLater.chord === '···', `readout shows ${roomLater.chord}`);
  checkThat(
    'the overlay sits on the meter, not on the screen, and takes no clicks',
    !room.overlayBlocks && room.overlayShare > 0 && room.overlayShare < 0.12,
    `${Math.round(room.overlayShare * 100)}% of the viewport`,
  );
  // Every name the readout can print has to sit inside the ring rather than on
  // it. The ring is r=46 with a 6-unit stroke in a 120-unit viewBox, so its
  // inner edge is 43/120 of the rendered width, and a name fits when all four
  // corners of its box are inside that radius. The size buckets mirror
  // nameSize() in src/ui/Listening.tsx.
  const measureFit = () =>
    quiet.evaluate(() => {
      const el = document.querySelector('.listen-chord');
      const box = document.querySelector('.listen-ring').getBoundingClientRect();
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      const inner = (43 / 120) * box.width;
      const roots = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
      const suffixes = ['', 'm', '7', 'm7', 'maj7', 'sus4', 'sus2'];
      const names = [...roots.flatMap((root) => suffixes.map((suffix) => root + suffix)), 'N.C.'];
      const before = { text: el.textContent, className: el.className };
      let worst = { name: '', clear: Infinity, width: 0 };
      let widest = { name: '', width: 0 };
      for (const name of names) {
        el.textContent = name;
        el.className = `listen-chord${
          name.length >= 6 ? ' longest' : name.length === 5 ? ' longer' : name.length === 4 ? ' long' : ''
        }`;
        const r = el.getBoundingClientRect();
        const reach = Math.max(
          ...[
            [r.left, r.top],
            [r.right, r.top],
            [r.left, r.bottom],
            [r.right, r.bottom],
          ].map(([x, y]) => Math.hypot(x - cx, y - cy)),
        );
        if (inner - reach < worst.clear) {
          worst = { name, clear: +(inner - reach).toFixed(1), width: +r.width.toFixed(1) };
        }
        if (r.width > widest.width) widest = { name, width: +r.width.toFixed(1) };
      }
      el.textContent = before.text;
      el.className = before.className;
      return { count: names.length, worst, widest };
    });
  const fitPhone = await measureFit();
  // The type clamp tops out on a wide screen, which is where the names are
  // biggest against a ring that has stopped growing.
  await quiet.setViewportSize({ width: 1100, height: 900 });
  await quiet.waitForTimeout(250);
  const fitDesktop = await measureFit();
  await quiet.setViewportSize({ width: 430, height: 932 });
  await quiet.waitForTimeout(250);
  checkThat(
    'every chord name in the vocabulary clears the ring, on a phone and on a desktop',
    fitPhone.count === 85 && fitPhone.worst.clear > 12 && fitDesktop.worst.clear > 12,
    `${fitPhone.count} names; widest ${fitDesktop.widest.name} at ${fitDesktop.widest.width}px, tightest ${fitDesktop.worst.name} with ${fitDesktop.worst.clear}px to spare on desktop and ${fitPhone.worst.clear}px on a phone`,
  );

  // Recording by hand still works from under the overlay — and a take that is
  // running does not make a chord out of noise either.
  await quiet.getByRole('button', { name: 'Record anyway' }).click();
  await quiet.waitForTimeout(2500);
  const forced = await quiet.evaluate(listenState);
  checkThat(
    'the controls under the overlay are still reachable',
    forced.eyebrow === 'Recording',
    `eyebrow says "${forced.eyebrow}"`,
  );
  checkThat(
    'and a take with no chord in it still says so rather than naming one',
    forced.overlay === 'No music detected' && forced.chord === '···' && forced.still,
    `chord ${forced.chord}, overlay ${JSON.stringify(forced.overlay)}`,
  );

  console.log('\n3d. cancelling a take, without leaving the screen');
  // A room that never turns into a song is the only place this can be watched
  // without a race: the gate cannot re-open behind the assertions.
  checkThat(
    'a take is running, with something to throw away',
    forced.timer !== '00:00' && forced.painted > 0 && forced.spectroOn,
    `${forced.timer}, ${forced.painted} px of backdrop`,
  );
  await quiet.getByRole('button', { name: 'Discard this take' }).click();
  await quiet.waitForTimeout(400);
  const discarded = await quiet.evaluate(listenState);
  checkThat(
    'cancelling returns the screen to waiting instead of leaving it',
    discarded.onScreen && discarded.eyebrow === 'Waiting for the song',
    `${discarded.onScreen ? 'still here' : 'gone'}, eyebrow says "${discarded.eyebrow}"`,
  );
  checkThat(
    'and the discarded take leaves no timer, no backdrop and no chord behind',
    discarded.timer === '00:00' && discarded.painted === 0 && !discarded.spectroOn && discarded.chord === '···',
    `${discarded.timer}, ${discarded.painted} px, chord ${discarded.chord}`,
  );
  // A music gate that survived the discard would still be latched open, and the
  // take would spring straight back to life on the next reading.
  await quiet.waitForTimeout(2000);
  const stillWaiting = await quiet.evaluate(listenState);
  checkThat(
    'the music gate starts over too, rather than staying open',
    stillWaiting.eyebrow === 'Waiting for the song' && stillWaiting.timer === '00:00',
    `${stillWaiting.eyebrow} at ${stillWaiting.timer}`,
  );
  await quiet.getByRole('button', { name: 'Record anyway' }).click();
  await quiet.waitForTimeout(1500);
  const again = await quiet.evaluate(listenState);
  checkThat(
    'and the screen can record again straight away',
    again.eyebrow === 'Recording' && again.timer !== '00:00',
    `${again.eyebrow} at ${again.timer}`,
  );
  await quietBrowser.close();
  quietBrowser = undefined;

  console.log('\n4. the ambient backdrop stays behind the content');
  await page.setViewportSize({ width: 1180, height: 900 });
  await page.goto(ORIGIN, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    const grid = document.querySelector('.feature-grid');
    if (grid) window.scrollBy(0, grid.getBoundingClientRect().top - 60);
    document
      .querySelectorAll('.backdrop-strings i')
      .forEach((el) => el.getAnimations().forEach((a) => a.pause()));
  });
  await page.waitForTimeout(300);
  const box = await page.evaluate(() => {
    const r = document.querySelector('.feature').getBoundingClientRect();
    return { top: Math.round(r.y), left: Math.round(r.x), right: Math.round(r.right) };
  });
  // The whole column, not a band: the field is a handful of faint diagonals,
  // so a fixed-height sample depends on whether a line happens to cross it,
  // which moves with page height and failed for edits nowhere near it.
  const marginStrip = async () =>
    (await page.screenshot({ clip: { x: 0, y: 0, width: box.left - 10, height: 900 } })).toString(
      'base64',
    );
  const marginBefore = await marginStrip();
  await page.evaluate(() => {
    document.querySelector('.backdrop').style.display = 'none';
  });
  await page.waitForTimeout(150);
  const marginAfter = await marginStrip();
  await page.evaluate(() => {
    document.querySelector('.backdrop').style.display = '';
  });
  checkThat('the field actually draws in the page margin', marginBefore !== marginAfter);

  // A fixed element with a z-index paints after in-flow block backgrounds, so
  // moving the backdrop inside .app would put the string field on top of every
  // unpositioned card again. Assert that as the stacking fact it is: comparing
  // pixels across the card instead measured the compositor, which nudges the
  // antialiasing of the chord diagrams' hairlines whenever a fixed layer comes
  // and goes — a difference that says nothing about what painted where.
  const stacking = await page.evaluate(() => {
    const zOf = (el) => Number(getComputedStyle(el).zIndex) || 0;
    const card = getComputedStyle(document.querySelector('.feature'));
    const alpha = card.backgroundColor.startsWith('rgba')
      ? Number(card.backgroundColor.split(',')[3])
      : 1;
    return {
      backdropZ: zOf(document.querySelector('.backdrop')),
      appZ: zOf(document.querySelector('.app')),
      inApp: document.querySelector('.app').contains(document.querySelector('.backdrop')),
      cardAlpha: alpha,
    };
  });
  checkThat(
    'the field never draws over a card: it sits below the app, under opaque cards',
    stacking.backdropZ < stacking.appZ && !stacking.inApp && stacking.cardAlpha === 1,
    JSON.stringify(stacking),
  );

  console.log('\n5. the strings get plucked');
  const straight = /^M0,[\d.]+H100$/;
  const bowedCount = () =>
    page.evaluate(
      (re) =>
        [...document.querySelectorAll('.backdrop-field path')].filter(
          (el) => !new RegExp(re).test(el.getAttribute('d')),
        ).length,
      straight.source,
    );
  let sawPluck = false;
  let sawStill = false;
  for (let i = 0; i < 100 && !(sawPluck && sawStill); i++) {
    const bowed = await bowedCount();
    if (bowed > 0) sawPluck = true;
    // Only counts once a pluck has been seen, or the very first sample would
    // pass for "still" before anything has had a chance to ring.
    if (sawPluck && bowed === 0) sawStill = true;
    await page.waitForTimeout(120);
  }
  checkThat('a string rings', sawPluck);
  checkThat('and settles back straight', sawStill);

  // The pointer plays the field too. Wait for quiet first, so what follows is
  // the pointer's doing and not an ambient pluck that happened to overlap.
  for (let i = 0; i < 60 && (await bowedCount()) > 0; i++) await page.waitForTimeout(100);
  const view = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  await page.mouse.move(view.w * 0.2, view.h * 0.15);
  for (let y = 0.2; y <= 0.8; y += 0.06) {
    await page.mouse.move(view.w * 0.5, view.h * y);
  }
  checkThat('sweeping the pointer across the page catches the strings', (await bowedCount()) > 0);

  for (let i = 0; i < 60 && (await bowedCount()) > 0; i++) await page.waitForTimeout(100);
  // Somewhere with no control under it, so this tests the field and not a button.
  await page.mouse.click(view.w * 0.5, view.h * 0.9);
  await page.waitForTimeout(60);
  checkThat('and a press rings one properly', (await bowedCount()) > 0);

  // The field must never take a click away from the page.
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: 'Chords', exact: true }).click();
  checkThat(
    'the field still lets clicks through to the page',
    (await page.locator('.library-grid .chord-tile').count()) > 0,
  );
  await page.goto(ORIGIN, { waitUntil: 'networkidle' });

  console.log('\n6. language toggle');
  await page.goto(ORIGIN, { waitUntil: 'networkidle' });
  const chordButtonEnStart = await page.evaluate(() => {
    const buttons = document.querySelectorAll('.topbar button');
    return Array.from(buttons).find(b => b.textContent.trim() === 'Chords')?.textContent.trim() || null;
  });
  check('chords button starts in English', chordButtonEnStart, 'Chords');
  await page.evaluate(() => {
    const buttons = document.querySelectorAll('.topbar button');
    Array.from(buttons).find(b => b.textContent.trim() === 'CN')?.click();
  });
  await page.waitForTimeout(300);
  const chordButtonZh = await page.evaluate(() => {
    const buttons = document.querySelectorAll('.topbar button');
    return Array.from(buttons).find(b => b.textContent.includes('和弦'))?.textContent.trim() || null;
  });
  checkThat('chords button switches to Chinese', chordButtonZh && chordButtonZh.includes('和弦'), chordButtonZh);
  await page.evaluate(() => {
    const buttons = document.querySelectorAll('.topbar button');
    Array.from(buttons).find(b => b.textContent.trim() === 'EN')?.click();
  });
  await page.waitForTimeout(300);
  const chordButtonBackEn = await page.evaluate(() => {
    const buttons = document.querySelectorAll('.topbar button');
    return Array.from(buttons).find(b => b.textContent.trim() === 'Chords')?.textContent.trim() || null;
  });
  check('chords button switches back to English', chordButtonBackEn, 'Chords');

  console.log('\n6b. theme switch');
  // Start from the system preference with nothing stored, so the default path
  // is exercised before the override is.
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => localStorage.removeItem('geetaab-theme'));
  await page.goto(ORIGIN, { waitUntil: 'networkidle' });
  const themeState = () =>
    page.evaluate(() => ({
      attr: document.documentElement.getAttribute('data-theme'),
      scheme: getComputedStyle(document.documentElement).colorScheme,
      surface: getComputedStyle(document.querySelector('.feature')).backgroundColor,
    }));
  const dark = await themeState();
  check('the system preference decides when nothing is stored', dark.attr, 'dark');
  await page.getByRole('button', { name: 'Switch to the light theme' }).click();
  await page.waitForTimeout(200);
  const light = await themeState();
  check('the switch puts the light theme on the document', light.attr, 'light');
  check('and keeps color-scheme in step, so controls follow', light.scheme, 'light');
  // The attribute alone proves nothing: a card has to actually repaint.
  checkThat(
    'a card really changes colour',
    light.surface !== dark.surface,
    `${dark.surface} -> ${light.surface}`,
  );
  await page.getByRole('button', { name: 'Switch to the dark theme' }).click();
  await page.waitForTimeout(200);
  const backToDark = await themeState();
  check('and back again', backToDark.attr, 'dark');
  check('with the card back to where it started', backToDark.surface, dark.surface);
  // The choice persists, so a reload must not fall back to the system.
  await page.getByRole('button', { name: 'Switch to the light theme' }).click();
  await page.goto(ORIGIN, { waitUntil: 'networkidle' });
  const remembered = await themeState();
  check('the choice outlives a reload', remembered.attr, 'light');
  await page.evaluate(() => localStorage.removeItem('geetaab-theme'));
  await page.emulateMedia({ colorScheme: null });

  console.log('\n6c. the pages you can link to');
  await page.goto(`${ORIGIN}#/chords`, { waitUntil: 'networkidle' });
  checkThat(
    'opening the chord library by address lands on it',
    (await page.locator('.library-grid .chord-tile').count()) > 0,
  );
  await page.reload({ waitUntil: 'networkidle' });
  checkThat(
    'and reloading stays there rather than going home',
    (await page.locator('.library-grid .chord-tile').count()) > 0,
    await page.evaluate(() => location.hash),
  );
  await page.goto(`${ORIGIN}#/how?lang=zh`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const linked = await page.evaluate(() => ({
    onExplainer: Boolean(document.querySelector('.how-it-works')),
    lang: document.documentElement.lang,
    hash: location.hash,
  }));
  checkThat(
    'a link can carry the language as well as the page',
    linked.onExplainer && linked.lang.startsWith('zh'),
    JSON.stringify(linked),
  );
  // Put the browser back into English for the checks that follow.
  await page.goto(`${ORIGIN}#/?lang=en`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  checkThat(
    'and back at the home address the app is home again',
    (await page.locator('.home-hero').count()) > 0,
  );

  console.log('\n7. the how-it-works explainer');
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto(ORIGIN, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'How chords are recognized' }).click();
  await page.getByRole('heading', { name: 'How Chords Are Recognized' }).waitFor();
  const explainer = await page.evaluate(() => {
    const figures = [...document.querySelectorAll('.how-it-works figure svg')];
    const boxes = figures.map((svg) => svg.getBoundingClientRect());
    return {
      stages: document.querySelectorAll('.how-it-works .hw-stage').length,
      steps: document.querySelectorAll('.how-it-works .hw-step').length,
      figures: figures.length,
      drawn: boxes.filter((b) => b.width > 0 && b.height > 0).length,
      labelled: figures.filter((svg) => (svg.getAttribute('aria-label') || '').length > 20).length,
      captions: document.querySelectorAll('.how-it-works figure figcaption').length,
    };
  });
  const deeper = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.hw-deeper')];
    const before = items.map((d) => d.open);
    items[0]?.querySelector('summary')?.click();
    const legend = [...document.querySelectorAll('.hw-legend li')].map((li) => li.textContent.trim());
    const fig = document.querySelector('.hw-fig svg');
    const box = fig?.getBoundingClientRect();
    const natural = Number(fig?.getAttribute('viewBox')?.split(/\s+/)[2] ?? 0);
    return {
      count: items.length,
      shutToStart: before.every((open) => open === false),
      opens: items[0]?.open === true,
      legend,
      figWidth: Math.round(box?.width ?? 0),
      natural,
      // Every figure's box against the drawing inside it and the column around
      // it, so the hug can be checked on the narrow ones as well as the widest.
      hug: [...document.querySelectorAll('.hw-fig')].map((card) => ({
        card: Math.round(card.getBoundingClientRect().width),
        svg: Math.round(card.querySelector('svg')?.getBoundingClientRect().width ?? 0),
        column: Math.round(card.parentElement?.getBoundingClientRect().width ?? 0),
      })),
    };
  });
  checkThat(
    'the hard ideas have a second layer, shut until it is asked for',
    deeper.count >= 2 && deeper.shutToStart && deeper.opens,
    JSON.stringify({ count: deeper.count, shut: deeper.shutToStart, opens: deeper.opens }),
  );
  checkThat(
    'the overview says which colour means what',
    deeper.legend.length === 3,
    deeper.legend.join(' · '),
  );
  const frost = await page.evaluate(() => {
    const read = (el) => {
      if (!el) return null;
      const cs = getComputedStyle(el);
      const alpha = Number(/rgba?\([^)]*?([\d.]+)\)/.exec(cs.backgroundColor)?.[1] ?? '1');
      return {
        alpha: cs.backgroundColor.startsWith('rgba') ? alpha : 1,
        blurred: (cs.backdropFilter || cs.webkitBackdropFilter || 'none') !== 'none',
      };
    };
    const figures = [...document.querySelectorAll('.hw-fig')];
    const teal = figures.find((f) => !f.closest('.hw-stage.decided'));
    const amber = figures.find((f) => f.closest('.hw-stage.decided'));
    return { teal: read(teal), amber: read(amber) };
  });
  checkThat(
    // The amber figures used to be a 5% tint over nothing, because a shorthand
    // reset the surface out from under them, so the backdrop's diagonals ran
    // through those and not through the teal ones.
    'both colours of figure sit on the same frosted surface, not one on nothing',
    frost.teal && frost.amber &&
      Math.abs(frost.teal.alpha - frost.amber.alpha) < 0.02 &&
      frost.teal.alpha > 0.5 && frost.teal.alpha < 1 &&
      frost.teal.blurred && frost.amber.blurred,
    JSON.stringify(frost),
  );
  checkThat(
    'and a diagram is never drawn bigger than the size its type was set for',
    deeper.natural > 0 && deeper.figWidth <= deeper.natural + 1,
    `${deeper.figWidth}px drawn against ${deeper.natural} natural`,
  );
  const hugs = deeper.hug.filter((h) => h.svg > 0);
  const narrower = hugs.filter((h) => h.card < h.column - 4);
  checkThat(
    // A small drawing centred in a full-width card reads as a mistake.
    'the box around a diagram hugs it rather than stretching to the column',
    hugs.length >= 6 &&
      hugs.every((h) => h.card <= h.svg + 40) &&
      narrower.length >= hugs.length - 2,
    `${narrower.length} of ${hugs.length} narrower than their column; widest gap ${Math.max(
      ...hugs.map((h) => h.card - h.svg),
    )}px`,
  );
  checkThat(
    'the explainer draws nine stages, nine sized diagrams and their captions',
    explainer.stages === 9 &&
      explainer.figures === 9 &&
      explainer.drawn === 9 &&
      explainer.labelled === 9 &&
      explainer.captions === 9,
    JSON.stringify(explainer),
  );
  await page.getByRole('button', { name: 'Key', exact: true }).click();
  await page.waitForTimeout(700);
  const stepped = await page.evaluate(() => ({
    current: document.querySelector('.hw-step[aria-current="step"]')?.textContent.trim() ?? null,
    scrolled: window.scrollY,
  }));
  checkThat(
    'the stepper jumps to a stage and marks it current',
    stepped.current === 'Key' && stepped.scrolled > 200,
    `${stepped.current} at y=${Math.round(stepped.scrolled)}`,
  );
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Listen with the mic' }).waitFor();
  checkThat(
    'and Back returns to the home screen',
    await page.evaluate(() => document.querySelector('.how-it-works') === null),
  );

  console.log('\n7b. the page ends where the page ends');
  // Two ways a page grew a dead tail: a 96px reserve for a Practise dock that
  // only one screen has, and a footer that was not pinned to the bottom of the
  // min-height box, so a viewport taller than the content left blank under it.
  const tails = [];
  for (const [hash, label, height] of [
    ['#/', 'home', 932],
    ['#/chords', 'the chord library', 932],
    ['#/how', 'the explainer', 932],
    ['#/', 'a screen taller than the home page', 2400],
  ]) {
    await page.setViewportSize({ width: 430, height });
    await page.goto(`${ORIGIN}/${hash}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(250);
    tails.push({
      label,
      ...(await page.evaluate(() => {
        const footer = document.querySelector('.app-footer');
        const shell = document.querySelector('.shell');
        const fr = footer.getBoundingClientRect();
        return {
          reserve: parseFloat(getComputedStyle(shell).paddingBottom),
          gap: Math.round(fr.top - shell.getBoundingClientRect().bottom),
          below: document.documentElement.scrollHeight - Math.round(fr.bottom + window.scrollY),
          restsOnTheBottom: Math.abs(fr.bottom - window.innerHeight) <= 1,
        };
      })),
    });
  }
  await page.setViewportSize({ width: 430, height: 932 });
  checkThat(
    'no screen without a dock reserves room for one',
    tails.every((t) => t.reserve <= 32 && t.gap <= 2),
    tails.map((t) => `${t.label} ${t.reserve}px`).join(', '),
  );
  checkThat(
    'and the footer sits on the bottom of the screen, not with the screen below it',
    tails.every((t) => t.below === 0 && t.restsOnTheBottom),
    tails.map((t) => `${t.label} ${t.below}px below`).join(', '),
  );

  console.log('\n7c. every screen starts at the top of itself');
  // The places people leave a screen from are the bottom of it: the footer's
  // link into the explainer, the Practise button under the tab, the top bar
  // after a page of chords. Each hop below scrolls to the bottom first.
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto(ORIGIN, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const bottom = async () => {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(200);
    return page.evaluate(() => Math.round(window.scrollY));
  };
  const landings = [];
  const hop = async (label, go, settle) => {
    const left = await bottom();
    await go();
    await settle();
    await page.waitForTimeout(300);
    landings.push({ label, left, at: await page.evaluate(() => Math.round(window.scrollY)) });
  };
  // Wait on the screen's own container, not on words: several of these labels
  // also exist in a stepper that is hidden at phone width, and a hidden match
  // never becomes visible.
  const seeScreen = (selector) => () =>
    page.locator(selector).first().waitFor({ state: 'visible', timeout: 90000 });
  await hop(
    'home to the chord library',
    () => page.getByRole('button', { name: 'Chords', exact: true }).click(),
    seeScreen('.shell.library'),
  );
  await hop(
    'the library back home',
    () => page.getByRole('button', { name: 'Home', exact: true }).click(),
    seeScreen('.shell.home'),
  );
  await hop(
    'home into the explainer',
    () => page.getByRole('button', { name: /^How chords are recogni[sz]ed$/ }).click(),
    seeScreen('.shell.how-it-works'),
  );
  await hop(
    'the explainer back home',
    () => page.getByRole('button', { name: 'Back' }).first().click(),
    seeScreen('.shell.home'),
  );
  await hop(
    'home into a finished tab',
    () => page.getByRole('button', { name: 'try the demo' }).click(),
    seeScreen('.tab-header'),
  );
  await hop(
    'the tab back home',
    () => page.getByRole('button', { name: 'Back' }).first().click(),
    seeScreen('.shell.home'),
  );
  checkThat(
    'every hop lands at the top, and every one of them started at the bottom',
    landings.every((l) => l.at === 0 && l.left > 100),
    landings.map((l) => `${l.label}: left at ${l.left}, landed at ${l.at}`).join('; '),
  );
  // ...but a jump within one screen is not a change of screen, and must still
  // land where it was aimed.
  await page.goto(`${ORIGIN}/#/how`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Key', exact: true }).click();
  await page.waitForTimeout(900);
  const anchored = await page.evaluate(() => Math.round(window.scrollY));
  checkThat('and the explainer stepper still jumps within the page', anchored > 100, `at ${anchored}`);

  console.log('\n7d. installable to the home screen');
  // The only way an iPhone gives a web page the whole screen: Safari has no
  // Fullscreen API for anything but a <video>, so standalone-from-the-home-
  // screen is the route, and that needs a manifest the page actually links to.
  const install = await page.evaluate(async () => {
    const href = document.querySelector('link[rel="manifest"]')?.getAttribute('href') ?? null;
    const manifest = href ? await fetch(href).then((r) => (r.ok ? r.json() : null)) : null;
    const icons = manifest
      ? await Promise.all(
          manifest.icons.map((i) => fetch(i.src).then((r) => ({ src: i.src, ok: r.ok }))),
        )
      : [];
    const apple = document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href') ?? null;
    return {
      href,
      display: manifest?.display ?? null,
      // Relative on purpose: this build has to keep working from a sub-path.
      relative: Boolean(manifest) && !manifest.start_url.startsWith('/') && !manifest.scope.startsWith('/'),
      iconsOk: icons.length > 0 && icons.every((i) => i.ok),
      appleOk: apple ? (await fetch(apple)).ok : false,
      capable: Boolean(document.querySelector('meta[name="apple-mobile-web-app-capable"][content="yes"]')),
    };
  });
  checkThat(
    'the page offers a manifest that installs standalone, with icons that load',
    install.display === 'standalone' && install.relative && install.iconsOk && install.appleOk && install.capable,
    JSON.stringify(install),
  );

  console.log('\n8. console');
  checkThat('no page or console errors', consoleErrors.length === 0, consoleErrors.join(' | '));
} finally {
  await browser?.close();
  await quietBrowser?.close();
  try {
    process.kill(-server.pid);
  } catch {
    // Already gone.
  }
  await rm(dir, { recursive: true, force: true });
}

console.log('');
if (failures.length) {
  console.error(`${failures.length} check(s) failed:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('all checks passed');
