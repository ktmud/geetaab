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
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
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

const dir = await mkdtemp(join(tmpdir(), 'geetaab-smoke-'));
const fixture = await writeFixture(dir);

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
  detached: true,
});
let browser;
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
  const sheet = await page.evaluate(() => ({
    onscreen: document.querySelectorAll('.tab-sys').length,
    systems: document.querySelectorAll('.print-sheet .print-sys').length,
    diagrams: document.querySelectorAll('.print-sheet .diagram').length,
    bars: document.querySelectorAll('.print-sheet .print-bar').length,
  }));
  checkThat('the tablature covers the whole song', sheet.onscreen >= 4, `${sheet.onscreen} systems on screen`);
  checkThat(
    'the print sheet carries diagrams, chart and tab',
    sheet.systems >= 4 && sheet.diagrams >= 4 && sheet.bars >= 8,
    `${sheet.systems} systems, ${sheet.diagrams} diagrams, ${sheet.bars} chart bars`,
  );
  await page.emulateMedia({ media: 'print' });
  const printSwap = await page.evaluate(() => ({
    sheet: getComputedStyle(document.querySelector('.print-sheet')).display !== 'none',
    cards: getComputedStyle(document.querySelector('.card')).display === 'none',
    topbar: getComputedStyle(document.querySelector('.topbar')).display === 'none',
  }));
  checkThat(
    'print media swaps the dark screen for the sheet',
    printSwap.sheet && printSwap.cards && printSwap.topbar,
    JSON.stringify(printSwap),
  );
  await page.emulateMedia({ media: 'screen' });

  console.log('\n2. practice transport');
  await page.getByRole('button', { name: /Practise this/ }).click();
  await page.waitForTimeout(400);
  const hintShown = await page.evaluate(() => Boolean(document.querySelector('.practice-hint')));
  checkThat('the first visit explains the screen', hintShown);
  await page.getByRole('button', { name: 'Got it' }).click();
  const hintGone = await page.evaluate(() => document.querySelector('.practice-hint') === null);
  checkThat('and the hint dismisses', hintGone);
  const laneBefore = await page.evaluate(() => document.querySelector('.lane-inner')?.style.transform);
  await page.getByRole('button', { name: 'Play' }).click();
  await page.waitForTimeout(900);
  const counting = await page.evaluate(() => document.querySelector('.countin')?.textContent ?? null);
  checkThat('counts the player in', counting !== null, `showed ${counting}`);
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.waitForTimeout(2500);
  const clock = () => page.evaluate(() => document.querySelector('.seek-time')?.textContent.trim());
  const clockAfterCancel = await clock();
  checkThat(
    'pausing during the count-in does not start playback',
    clockAfterCancel.startsWith('0:00'),
    clockAfterCancel,
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
  await page.getByRole('slider', { name: 'Practice speed' }).fill('0.6');
  const speed = await page.evaluate(() => document.querySelector('.speed-value')?.textContent.trim());
  check('slow-down control', speed, '60%');
  await page.getByRole('button', { name: /Exit/ }).click();

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
  const strip = async (x, width) =>
    (await page.screenshot({ clip: { x, y: box.top + 40, width, height: 1 } })).toString('base64');
  const marginBefore = await strip(0, box.left - 10);
  const cardBefore = await strip(box.left + 15, box.right - box.left - 30);
  await page.evaluate(() => {
    document.querySelector('.backdrop').style.display = 'none';
  });
  await page.waitForTimeout(150);
  const marginAfter = await strip(0, box.left - 10);
  const cardAfter = await strip(box.left + 15, box.right - box.left - 30);
  // A fixed element with a z-index paints after in-flow block backgrounds, so
  // moving the backdrop inside .app would put the string field on top of every
  // unpositioned card again. The margin is the control: if it does not change,
  // the field is not drawing and the card result would mean nothing.
  checkThat('the field actually draws in the page margin', marginBefore !== marginAfter);
  checkThat('the field never draws over a card', cardBefore === cardAfter);
  await page.evaluate(() => {
    document.querySelector('.backdrop').style.display = '';
  });

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

  console.log('\n6. language toggle');
  await page.goto(ORIGIN, { waitUntil: 'networkidle' });
  const chordButtonEnStart = await page.evaluate(() => {
    const buttons = document.querySelectorAll('.topbar button');
    return Array.from(buttons).find(b => b.textContent.trim() === 'Chords')?.textContent.trim() || null;
  });
  check('chords button starts in English', chordButtonEnStart, 'Chords');
  await page.evaluate(() => {
    const buttons = document.querySelectorAll('.topbar button');
    Array.from(buttons).find(b => b.textContent.includes('中文'))?.click();
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

  console.log('\n8. console');
  checkThat('no page or console errors', consoleErrors.length === 0, consoleErrors.join(' | '));
} finally {
  await browser?.close();
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
