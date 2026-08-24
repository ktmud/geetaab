/* Write the native app's privacy policy as a static HTML file.

   The app already has this policy on a screen of its own at #/privacy-ios, but
   that screen is a hash route in a single-page app: reaching it means running
   the JavaScript. A store's review tooling, a crawler, a text browser or a
   reader who has scripting off all fetch a URL and read what comes back, and
   what comes back for a hash route is an empty shell. A privacy policy is
   exactly the kind of page that has to survive that.

   So this writes public/privacy-ios.html — one file, no scripts, no fonts or
   images from anywhere, both languages in the same document with English
   first, because that is the one a review is conducted in.

     node scripts/privacy-page.mjs --write   write it
     node scripts/privacy-page.mjs --check   fail if what is committed is stale

   `--check` is what stops the two copies drifting: the screen and the file are
   rendered from the same module, but the file is committed, so it can go stale
   the moment that module changes without this being run.
*/
import { readFile, writeFile } from 'node:fs/promises';
import { POLICY_DATE, PRIVACY_IOS } from '../src/content/privacyIos.ts';

const OUT = new URL('../public/privacy-ios.html', import.meta.url);

/** Text into HTML. Nothing here is markup and none of it should become markup. */
const escape = (text) =>
  String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function renderPolicy(lang, policy, other) {
  const sections = policy.sections
    .map((section) => {
      const body = section.body.map((p) => `        <p>${escape(p)}</p>`).join('\n');
      const points = section.points
        ? `\n        <ul>\n${section.points.map((p) => `          <li>${escape(p)}</li>`).join('\n')}\n        </ul>`
        : '';
      return `      <section>\n        <h2>${escape(section.title)}</h2>\n${body}${points}\n      </section>`;
    })
    .join('\n');
  return `    <article lang="${lang}" id="${lang}">
      <p class="eyebrow">${escape(policy.eyebrow)}</p>
      <h1>${escape(policy.title)}</h1>
      <p class="lede">${escape(policy.lede)}</p>
      <p class="dated">${escape(policy.dated(POLICY_DATE))}</p>
      <p class="swap"><a href="#${other.id}">${escape(other.label)}</a></p>
${sections}
      <p class="closing">${escape(policy.closing)}</p>
    </article>`;
}

/* Styling is inline and small on purpose: a page that loads nothing cannot be
   made to look like it loaded something, and a policy does not need to. It
   follows the reader's theme rather than picking one, which is the one bit of
   the site's manners worth carrying over. */
const CSS = `    :root { color-scheme: light dark; --ink: #16181d; --dim: #5b6068; --line: #e3e5e9; --bg: #fbfbfc; --accent: #b0560f; }
    @media (prefers-color-scheme: dark) {
      :root { --ink: #eceef2; --dim: #9aa0aa; --line: #262a31; --bg: #0e0f13; --accent: #f0a04b; }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0 auto; padding: 40px 22px 72px; max-width: 42rem;
      background: var(--bg); color: var(--ink);
      font: 16px/1.62 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      -webkit-text-size-adjust: 100%;
    }
    article + article { margin-top: 72px; padding-top: 40px; border-top: 1px solid var(--line); }
    h1 { font-size: clamp(26px, 5vw, 34px); line-height: 1.2; letter-spacing: -0.02em; margin: 6px 0 14px; }
    h2 { font-size: 18px; letter-spacing: -0.01em; margin: 34px 0 8px; }
    p { margin: 0 0 12px; }
    ul { margin: 12px 0 0; padding-left: 20px; }
    li { margin-bottom: 8px; }
    .eyebrow { font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent); margin: 0; }
    .lede { font-size: 17px; color: var(--dim); }
    .dated, .swap, .closing { font-size: 13.5px; color: var(--dim); }
    .swap { margin-bottom: 26px; }
    .closing { margin-top: 40px; padding-top: 18px; border-top: 1px solid var(--line); }
    a { color: var(--accent); }`;

export function renderPage() {
  const en = renderPolicy('en', PRIVACY_IOS.en, { id: 'zh', label: '中文' });
  const zh = renderPolicy('zh', PRIVACY_IOS.zh, { id: 'en', label: 'English' });
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Privacy Policy — Geetaab for iPhone and iPad</title>
    <meta name="description" content="${escape(PRIVACY_IOS.en.lede)}" />
    <meta name="robots" content="index, follow" />
    <style>
${CSS}
    </style>
  </head>
  <body>
${en}
${zh}
  </body>
</html>
`;
}

// Acting takes an explicit flag, the way scripts/tabsheet.mjs takes its paths.
// The test imports `renderPage` from here, and a module that writes a file just
// for being imported is a module that rewrites the repository during `vitest`.
// Asking "was I run directly" does not work: under vite-node argv[1] is the
// vite-node binary and the script's own path is not in argv at all.
if (process.argv.includes('--check')) {
  const page = renderPage();
  const committed = await readFile(OUT, 'utf8').catch(() => null);
  if (committed !== page) {
    console.error(
      'public/privacy-ios.html is out of date with src/content/privacyIos.ts.\n' +
        'Run: npm run privacy',
    );
    process.exit(1);
  }
  console.log('public/privacy-ios.html is current.');
} else if (process.argv.includes('--write')) {
  const page = renderPage();
  await writeFile(OUT, page);
  // Characters, not bytes: the Chinese half is three bytes a character, so the
  // file on disk is a good deal larger than this and saying "bytes" would be
  // wrong by about a fifth.
  console.log(`Wrote ${OUT.pathname} (${page.length} characters).`);
}
