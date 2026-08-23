/**
 * Addresses for the screens worth linking to.
 *
 * Routing lives in the hash rather than the path because the build is meant to
 * work unchanged wherever it is served — a domain root, a `/<repo>/` sub-path
 * on GitHub Pages, a custom domain — and its asset URLs are relative to make
 * that true. A real path like `/chords` would need the host to serve the app
 * for every URL, and would resolve those relative assets differently depending
 * on where it was deployed. A hash asks nothing of the server and reloads to
 * the same place everywhere.
 *
 * Only the screens a person could reasonably bookmark are addressable. The tab
 * and practice screens belong to a song held in memory, so they stay where
 * they are; reloading returns to the library, as it always did.
 */
export type Route = 'home' | 'chords' | 'how';

export type Language = 'en' | 'zh';

export interface Location {
  route: Route;
  /** Present only when the URL asks for a language, which then wins over storage. */
  lang?: Language;
}

const PATHS: Record<Route, string> = {
  home: '/',
  chords: '/chords',
  how: '/how',
};

const ROUTES = new Map<string, Route>(
  (Object.entries(PATHS) as [Route, string][]).map(([route, path]) => [path, route]),
);

/** Read a location out of a hash such as `#/chords?lang=zh`. */
export function parseLocation(hash: string): Location {
  const raw = hash.replace(/^#/, '');
  const [pathPart, queryPart] = raw.split('?');
  // A trailing slash and an empty hash both mean home.
  const path = pathPart === '' ? '/' : pathPart.replace(/\/$/, '') || '/';
  const route = ROUTES.get(path) ?? 'home';
  const lang = new URLSearchParams(queryPart ?? '').get('lang');
  return lang === 'en' || lang === 'zh' ? { route, lang } : { route };
}

export function formatLocation(location: Location): string {
  const query = location.lang ? `?lang=${location.lang}` : '';
  return `#${PATHS[location.route]}${query}`;
}

/** The addressable screens, so callers need not know which names are routes. */
export function routeOf(screenName: string): Route | null {
  return screenName === 'home' || screenName === 'chords' || screenName === 'how'
    ? screenName
    : null;
}
