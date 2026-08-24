/**
 * Giving the practice screen the whole display.
 *
 * The player is a screen you look at while both hands are busy, so browser
 * chrome around it is pure loss: the toolbar covers a strip of the lane and
 * every tap near it risks leaving the song. Where the platform allows it we
 * simply take the full screen.
 *
 * It has to be asked for synchronously from the tap that opens the screen,
 * because the browser only grants it while a gesture is still being handled —
 * an effect that runs after the screen has mounted is already too late.
 *
 * What this deliberately does not do is lock the orientation. It used to: the
 * lane wants the long edge, so the screen took landscape and showed a "turn
 * your phone" prompt to anyone it could not take it from. The player now has a
 * layout for either way up, which makes the lock a worse deal than it looks —
 * it overrides how the reader is holding their phone to win a lane that is
 * merely wider, and on a phone lying flat it can flip the screen away from
 * them for no reason at all. Turning it sideways is still the better view; it
 * is now their call rather than ours.
 */

/**
 * Ask for the full screen. Call it synchronously from a click handler.
 *
 * Resolves to whether it was granted. Nothing may depend on that being true:
 * iOS Safari has no Fullscreen API outside `<video>` and always refuses.
 */
export async function enterImmersive(): Promise<boolean> {
  try {
    if (document.fullscreenElement) return true;
    await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
    return document.fullscreenElement !== null;
  } catch {
    return false;
  }
}

/** Give the screen back, whether or not we got it. */
export function exitImmersive(): void {
  if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
}
