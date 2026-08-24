import { useCallback, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';

/**
 * Whether the printable sheet needs to exist yet.
 *
 * The sheet is a second, paper-shaped copy of the whole song — header, chord
 * boxes, chart, and every bar of engraved tablature. It used to sit in the
 * document at all times under `display: none`, which reads as free and is not:
 * on a five-minute song it is eighteen thousand DOM nodes, half of everything
 * on the tab screen, built during the commit that first shows the song and
 * never looked at until someone presses Print. That is most of the second the
 * page spends frozen when a long song finishes analysing.
 *
 * So it is built on demand instead. `beforeprint` fires before the browser
 * takes its snapshot, and `flushSync` makes React commit inside that handler
 * rather than after it, so the sheet is in the document by the time the
 * snapshot is taken. Safari has not always fired `beforeprint`, so the print
 * media query is watched as well — it flips for the same reason, and either
 * path arriving first leaves the other with nothing to do.
 */
export function usePrintMount(): { printing: boolean; print: () => void } {
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    const mount = (): void => {
      // Not `setPrinting(true)`: a normal update commits after this handler
      // returns, which is after the browser has already decided what to print.
      flushSync(() => setPrinting(true));
    };
    const unmount = (): void => setPrinting(false);
    const media = typeof matchMedia === 'function' ? matchMedia('print') : null;
    const onMedia = (event: MediaQueryListEvent): void => (event.matches ? mount() : unmount());

    window.addEventListener('beforeprint', mount);
    window.addEventListener('afterprint', unmount);
    media?.addEventListener('change', onMedia);
    return () => {
      window.removeEventListener('beforeprint', mount);
      window.removeEventListener('afterprint', unmount);
      media?.removeEventListener('change', onMedia);
    };
  }, []);

  /**
   * The Print button.
   *
   * `window.print()` blocks until the dialog closes, so the sheet has to be in
   * the document before it is called rather than in a render it schedules.
   */
  const print = useCallback(() => {
    flushSync(() => setPrinting(true));
    window.print();
  }, []);

  return { printing, print };
}
