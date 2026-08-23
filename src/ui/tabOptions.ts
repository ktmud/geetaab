import { useMemo } from 'react';
import type { AnalysisResult } from '../core/analyze';
import { chooseCapo, patternsFor, type StrumPattern } from '../music/arrange';
import { levelsWorthOffering, reduceSegments, type TabLevel } from '../music/levels';
import { buildTab, type SongTab } from '../music/tab';

export interface TabOptions {
  capo?: number;
  simplify: boolean;
  strumId?: string;
  level?: TabLevel;
}

export interface ArrangedSong {
  /** All three readings, so the level switch can offer only the ones that differ. */
  tabs: Record<TabLevel, SongTab>;
  /** The one being shown. */
  tab: SongTab;
  level: TabLevel;
  offeredLevels: TabLevel[];
  /** Capo the arranger would pick if nobody had chosen one. */
  autoCapo: number;
  patterns: StrumPattern[];
}

/**
 * Everything the arrangement controls need, derived from the analysis and the
 * reader's choices.
 *
 * Lifted out of the tab screen because the practice screen now changes the same
 * settings from a sheet of its own, and two copies of this would drift: the
 * levels on offer, which capo counts as suggested, and which patterns fit the
 * metre are all decisions, not lookups. The caller above both screens holds it
 * once and hands the result down, so switching to a different strum in the
 * middle of practising shows the same tab the tab screen would have shown.
 */
export function useArrangedSong(
  /** Null before a song exists; the hook still runs, and returns null. */
  analysis: AnalysisResult | null,
  options: TabOptions,
): ArrangedSong | null {
  const tabs = useMemo(() => {
    if (!analysis) return null;
    const patterns = patternsFor(analysis.beatsPerBar);
    const strum = options.strumId ? patterns.find((p) => p.id === options.strumId) : undefined;
    const base = { capo: options.capo, strum };
    const standard = buildTab(analysis, { ...base, simplify: true });
    const faithful = buildTab(analysis, { ...base, simplify: false });
    const easy = buildTab(
      { ...analysis, segments: reduceSegments(analysis.segments, analysis.beatsPerBar) },
      { ...base, simplify: true },
    );
    return { easy, standard, faithful } as Record<TabLevel, SongTab>;
  }, [analysis, options.capo, options.strumId]);

  const offeredLevels = useMemo(() => (tabs ? levelsWorthOffering(tabs) : []), [tabs]);
  const wanted: TabLevel = options.level ?? (options.simplify === false ? 'faithful' : 'standard');
  const level: TabLevel = offeredLevels.includes(wanted) ? wanted : 'standard';

  const autoCapo = useMemo(
    () =>
      analysis
        ? chooseCapo(analysis.segments, analysis.key, { simplify: level !== 'faithful' }).fret
        : 0,
    [analysis, level],
  );

  if (!tabs) return null;
  const tab = tabs[level];
  return { tabs, tab, level, offeredLevels, autoCapo, patterns: patternsFor(tab.beatsPerBar) };
}
