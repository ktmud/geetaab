import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';

export interface ScrollAnchor<T extends HTMLElement> {
  /** Put this on the element that must not move. */
  ref: RefObject<T | null>;
  /** Call immediately before the change that will resize things above it. */
  hold: () => void;
}

/**
 * Keep one element where it is on screen while the page changes above it.
 *
 * The arrangement controls sit below the chord boxes, and changing the level
 * adds or removes chords — so the control being pressed slides out from under
 * the thumb pressing it, by however many rows of boxes appeared or vanished.
 *
 * Chrome fixes this by itself: CSS scroll anchoring watches for content
 * changing above the viewport and compensates. WebKit has never shipped it, so
 * on the iPhone this is a plain jump, and the phone is where it matters most.
 *
 * The measurement is taken before the change and again in a layout effect,
 * before the browser paints, and the difference is scrolled away. On a browser
 * that anchors natively the difference is already zero by the time the effect
 * runs, so this corrects what is left rather than correcting twice.
 */
export function useScrollAnchor<T extends HTMLElement>(): ScrollAnchor<T> {
  const ref = useRef<T | null>(null);
  const held = useRef<number | null>(null);

  // No dependency list on purpose: the effect has to run after whichever render
  // the change lands in, and it only does anything when a measurement is held.
  useLayoutEffect(() => {
    const was = held.current;
    if (was === null) return;
    held.current = null;
    const now = ref.current?.getBoundingClientRect().top;
    if (now === undefined) return;
    const drift = now - was;
    // Sub-pixel drift is rounding, not movement, and scrolling by it would
    // fight the browser rather than help it.
    if (Math.abs(drift) >= 1) window.scrollBy(0, drift);
  });

  const hold = useCallback(() => {
    held.current = ref.current?.getBoundingClientRect().top ?? null;
  }, []);

  return { ref, hold };
}
