import { describe, expect, it } from 'vitest';
import { PRIVACY_IOS, POLICY_DATE } from './privacyIos';
// @ts-expect-error — a plain script, imported for the one pure function in it.
import { renderPage } from '../../scripts/privacy-page.mjs';

/**
 * The policy is a promise about a specific program, so the two places it is
 * rendered have to say the same thing. They read one module, which is most of
 * the guarantee; these are the rest.
 */
describe('the native app policy', () => {
  it('says the same things in both languages', () => {
    expect(PRIVACY_IOS.zh.sections).toHaveLength(PRIVACY_IOS.en.sections.length);
    for (const [i, en] of PRIVACY_IOS.en.sections.entries()) {
      const zh = PRIVACY_IOS.zh.sections[i];
      expect(zh.body).toHaveLength(en.body.length);
      expect(zh.points?.length ?? 0).toBe(en.points?.length ?? 0);
    }
  });

  it('carries a date a reviewer can see, and one that was set by hand', () => {
    expect(POLICY_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(PRIVACY_IOS.en.dated(POLICY_DATE)).toContain(POLICY_DATE);
    expect(PRIVACY_IOS.zh.dated(POLICY_DATE)).toContain(POLICY_DATE);
  });

  it('makes the four claims a store review looks for', () => {
    const all = PRIVACY_IOS.en.sections
      .flatMap((s) => [s.title, ...s.body, ...(s.points ?? [])])
      .join(' ');
    expect(all).toMatch(/microphone/i);
    expect(all).toMatch(/on-device|on the device/i);
    expect(all).toMatch(/never uploads|no networking/i);
    expect(all).toMatch(/Deleting the app/i);
  });

  it('renders a standalone page that needs nothing else to be readable', () => {
    const html: string = renderPage();
    expect(html.startsWith('<!doctype html>')).toBe(true);
    // Nothing fetched: no scripts, and no src or href pointing off the page.
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/\ssrc=/i);
    // Both languages, and every section of each.
    expect(html).toContain('lang="en"');
    expect(html).toContain('lang="zh"');
    const sections = html.match(/<section>/g) ?? [];
    expect(sections).toHaveLength(PRIVACY_IOS.en.sections.length + PRIVACY_IOS.zh.sections.length);
    expect(html).toContain(PRIVACY_IOS.en.title);
    expect(html).toContain(PRIVACY_IOS.zh.title);
  });
});
