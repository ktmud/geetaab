import { useT } from '../i18n';
import { BackIcon } from './icons';

/**
 * When this policy last changed.
 *
 * A store listing wants a date, and a date that updates itself is a lie: it
 * would say the policy changed on a day nobody looked at it. Move it by hand,
 * in the same commit that changes what the page says.
 */
const POLICY_DATE = '2026-08-24';

/**
 * The i18n table is `as const`, so each section infers its own literal shape
 * and a section without bullets has no `points` at all. Naming the shape here
 * is what lets one loop render both kinds.
 */
interface PrivacySection {
  title: string;
  body: readonly string[];
  points?: readonly string[];
}

export interface PrivacyProps {
  onBack: () => void;
  /** Which build the policy is about. They are genuinely different documents. */
  platform?: 'web' | 'ios';
}

/**
 * What the app does with what it is given.
 *
 * Short, because there is very little to say: the recording never leaves the
 * device, nothing is sent anywhere, and the only stored things are the songs
 * the reader made and three preferences. A policy this small is worth writing
 * out rather than gesturing at, since the whole claim of the app is that the
 * transcription happens in the browser — and a page that says so in plain
 * words is the only way a reader can check that claim without reading the
 * source.
 *
 * Every sentence here is a fact about this build, not a promise about
 * intentions. If any of them stops being true, this page is part of the change.
 */
export function Privacy({ onBack, platform = 'web' }: PrivacyProps) {
  const t = useT();
  const ios = platform === 'ios';
  const sections = ios ? t.privacyIosSections : t.privacySections;
  return (
    <div className="shell privacy">
      <div className="btn-row" style={{ marginBottom: 14 }}>
        <button className="btn btn-ghost" onClick={onBack}>
          <BackIcon size={17} /> {t.back}
        </button>
      </div>

      <div className="eyebrow">{ios ? t.privacyIosEyebrow : t.privacyEyebrow}</div>
      <h1 style={{ fontSize: 'clamp(24px, 4.5vw, 36px)' }}>
        {ios ? t.privacyIosTitle : t.privacyTitle}
      </h1>
      <p className="lede" style={{ marginBottom: 20 }}>
        {ios ? t.privacyIosLede : t.privacyLede}
      </p>
      {ios ? <p className="faint privacy-dated">{t.privacyIosDated(POLICY_DATE)}</p> : null}

      {(sections as readonly PrivacySection[]).map((section) => (
        <div className="card" key={section.title}>
          <h2>{section.title}</h2>
          {section.body.map((paragraph, i) => (
            <p key={i}>{paragraph}</p>
          ))}
          {section.points ? (
            <ul className="tip-list">
              {section.points.map((point, i) => (
                <li key={i}>{point}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}

      <div className="hw-closing">
        <p>{ios ? t.privacyIosClosing : t.privacyClosing}</p>
      </div>
    </div>
  );
}
