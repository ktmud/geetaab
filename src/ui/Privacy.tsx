import { useLanguage, useT } from '../i18n';
import { POLICY_DATE, PRIVACY_IOS, type PolicySection } from '../content/privacyIos';
import { BackIcon } from './icons';

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
  const [lang] = useLanguage();
  const ios = platform === 'ios';
  // The app's policy is a document with its own home, shared with the static
  // file a store crawler reads; the site's is interface text like the rest.
  const policy = PRIVACY_IOS[lang];
  const sections: readonly PolicySection[] = ios ? policy.sections : t.privacySections;
  return (
    <div className="shell privacy">
      <div className="btn-row" style={{ marginBottom: 14 }}>
        <button className="btn btn-ghost" onClick={onBack}>
          <BackIcon size={17} /> {t.back}
        </button>
      </div>

      <div className="eyebrow">{ios ? policy.eyebrow : t.privacyEyebrow}</div>
      <h1 style={{ fontSize: 'clamp(24px, 4.5vw, 36px)' }}>{ios ? policy.title : t.privacyTitle}</h1>
      <p className="lede" style={{ marginBottom: 20 }}>
        {ios ? policy.lede : t.privacyLede}
      </p>
      {ios ? <p className="faint privacy-dated">{policy.dated(POLICY_DATE)}</p> : null}

      {sections.map((section) => (
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
        <p>{ios ? policy.closing : t.privacyClosing}</p>
      </div>
    </div>
  );
}
