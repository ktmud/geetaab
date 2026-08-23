import type { SongTab } from '../music/tab';
import { tabSystems } from '../music/tabText';
import { ChordDiagram } from './ChordDiagram';

export interface PrintSheetProps {
  tab: SongTab;
  title: string;
}

/**
 * The song as one printable sheet: header, chord boxes, the full chord chart,
 * and the whole song's tablature.
 *
 * It lives in the document at all times but only the print stylesheet shows
 * it, so plain Ctrl+P works exactly like the Print button and the sheet always
 * reflects the capo and strumming options currently chosen on screen.
 */
export function PrintSheet({ tab, title }: PrintSheetProps) {
  const systems = tabSystems(tab.bars, tab.strum, 2);
  const strumMarks: string[] = [];
  for (let beat = 0; beat < tab.beatsPerBar; beat += 0.5) {
    const step = tab.strum.steps.find((s) => Math.abs(s.beat - beat) < 1e-6);
    strumMarks.push(step ? (step.direction === 'D' ? '↓' : '↑') : '·');
  }

  return (
    <section className="print-sheet" aria-hidden="true">
      <h1>{title || 'Untitled song'}</h1>
      <p className="print-meta">
        Key {tab.key.name} · {Math.round(tab.tempo)} BPM · {tab.beatsPerBar}/4 ·{' '}
        {tab.capo > 0 ? `capo on fret ${tab.capo}, shapes read in ${tab.shapeKeyName}` : 'no capo'} ·{' '}
        {tab.strum.name}: {strumMarks.join(' ')}
      </p>

      <div className="print-palette">
        {tab.palette.map((chord, index) => (
          <div className="print-chord" key={index}>
            <b>{chord.shapeLabel}</b>
            <ChordDiagram shape={chord.shape} width={64} title={`${chord.shapeLabel} chord diagram`} />
            {chord.substitutedFrom ? (
              <span>for {chord.label}</span>
            ) : tab.capo > 0 ? (
              <span>sounds as {chord.label}</span>
            ) : null}
          </div>
        ))}
      </div>

      {tab.loop ? (
        <p className="print-loop">
          The loop, {Math.round(tab.loop.coverage * 100)}% of the song:{' '}
          <strong>| {tab.loop.bars.map((bar) => bar || 'N.C.').join(' | ')} |</strong>
        </p>
      ) : null}

      <h2>Chord chart</h2>
      <div className="print-bars">
        {tab.bars.map((bar) => (
          <div
            className={`print-bar${tab.loop && bar.index % tab.loop.length === 0 ? ' section' : ''}`}
            key={bar.index}
          >
            <i>{bar.index + 1}</i>
            <span>{bar.signature || 'N.C.'}</span>
          </div>
        ))}
      </div>

      <h2>Tablature</h2>
      {systems.map((system) => (
        <div className="print-sys" key={system.startBar}>
          <i>{system.label}</i>
          <pre>{system.text}</pre>
        </div>
      ))}

      <p className="print-foot">
        geetaab — a machine transcription. Trust your ears over it.
      </p>
    </section>
  );
}
