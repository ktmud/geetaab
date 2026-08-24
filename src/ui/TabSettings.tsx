import type { AnalysisResult } from '../core/analyze';
import { translateKeyName, useLanguage, useT } from '../i18n';
import type { TabLevel } from '../music/levels';
import type { ArrangedSong, TabOptions } from './tabOptions';

export interface TabSettingsProps {
  analysis: AnalysisResult;
  song: ArrangedSong;
  options: TabOptions;
  onOptionsChange: (options: TabOptions) => void;
  /** Re-run the analysis at a forced tempo; absent when the audio is gone. */
  onRetempo?: (bpm: number) => void;
  busy?: boolean;
}

/**
 * The arrangement controls: capo, right-hand pattern, level, tempo reading.
 *
 * One component, two homes — the tab screen shows it as a card, and the
 * practice screen opens it in a sheet without leaving the song. They used to be
 * one place, which meant deciding mid-practice that the strum was wrong cost a
 * trip back to the tab screen and a rebuild of your place in the track.
 */
export function TabSettings({
  analysis,
  song,
  options,
  onOptionsChange,
  onRetempo,
  busy,
}: TabSettingsProps) {
  const t = useT();
  const [lang] = useLanguage();
  const { tab, level, offeredLevels, autoCapo, patterns } = song;

  const LEVEL_LABELS: Record<TabLevel, string> = {
    easy: t.easy,
    standard: t.standard,
    faithful: t.faithful,
  };
  const LEVEL_HINTS: Record<TabLevel, string> = {
    easy: t.easyHint,
    standard: t.standardHint,
    faithful: t.faithfulHint,
  };

  return (
    <>
      <div className="controls-grid">
        <div className="field">
          <label htmlFor="capo">{t.capo}</label>
          <select
            id="capo"
            className="input"
            value={options.capo ?? autoCapo}
            onChange={(event) => onOptionsChange({ ...options, capo: Number(event.target.value) })}
          >
            {Array.from({ length: 8 }, (_, fret) => (
              <option key={fret} value={fret}>
                {fret === 0 ? t.noCapoText : t.fretNth(fret)}
                {fret === autoCapo ? t.suggested : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="strum">{t.strumming}</label>
          <select
            id="strum"
            className="input"
            value={tab.strum.id}
            onChange={(event) => onOptionsChange({ ...options, strumId: event.target.value })}
          >
            {patterns.map((pattern) => (
              <option key={pattern.id} value={pattern.id}>
                {t.strumNames[pattern.id] ?? pattern.id}
              </option>
            ))}
          </select>
        </div>

        {offeredLevels.length > 1 ? (
          <div className="field">
            <label htmlFor="level">{t.level}</label>
            <div className="segmented" id="level">
              {offeredLevels.map((option) => (
                <button
                  key={option}
                  aria-pressed={level === option}
                  onClick={() =>
                    onOptionsChange({ ...options, level: option, simplify: option !== 'faithful' })
                  }
                >
                  {LEVEL_LABELS[option]}
                </button>
              ))}
            </div>
            <span className="field-hint">{LEVEL_HINTS[level]}</span>
          </div>
        ) : null}

        {onRetempo ? (
          <div className="field">
            <label>{t.tempoReading}</label>
            {analysis.tempoChoices.length > 1 ? (
              <>
                {/* The readings the analysis could not choose between, slowest
                    first, with the one it used already selected. Half and
                    double time put every chord in the same place — which of
                    them a player counts is a fact about the player, so it is
                    theirs to say rather than ours to guess. */}
                <div className="segmented" role="group" aria-label={t.tempoReading}>
                  {analysis.tempoChoices.map((choice) => (
                    <button
                      key={choice.bpm}
                      aria-pressed={choice.picked}
                      disabled={busy}
                      onClick={() => onRetempo(choice.bpm)}
                    >
                      {t.bpmValue(Math.round(choice.bpm))}
                    </button>
                  ))}
                </div>
                <span className="field-hint">{t.tempoAmbiguous}</span>
              </>
            ) : (
              <div className="btn-row">
                <button
                  className="btn"
                  disabled={busy || analysis.tempo / 2 < 40}
                  onClick={() => onRetempo(analysis.tempo / 2)}
                >
                  {t.halfTime}
                </button>
                <button
                  className="btn"
                  disabled={busy || analysis.tempo * 2 > 260}
                  onClick={() => onRetempo(analysis.tempo * 2)}
                >
                  {t.doubleTime}
                </button>
              </div>
            )}
          </div>
        ) : null}
      </div>
      <p className="faint settings-note">
        {tab.capo > 0
          ? t.withCapo(
              tab.capo,
              translateKeyName(tab.shapeKeyName, lang),
              translateKeyName(tab.key.name, lang),
              tab.capoOpenRatio,
            )
          : t.openShapes(tab.capoOpenRatio)}
      </p>
    </>
  );
}
