/**
 * Putting the practice screen sideways without asking the reader to do it.
 *
 * The chords scroll past a playhead, so the screen needs the long edge. Asking
 * for it in words works, but only after the reader has already arrived at a
 * screen they cannot use — and on a phone with rotation lock switched on,
 * turning it does nothing at all, which reads as the app being broken.
 *
 * Where the platform allows it we simply take the landscape: full screen, then
 * an orientation lock. Both calls have to happen inside the tap that opens the
 * practice screen, because the browser only grants full screen while a gesture
 * is still being handled — an effect that runs after the screen has mounted is
 * already too late, and the lock will not be granted without full screen.
 *
 * Nothing here can be relied on. Desktop browsers refuse the lock, iOS Safari
 * refuses both, and a phone can be in a state where full screen resolves and
 * the lock still does not. So the practice screen keeps the rotate prompt for
 * whenever the reader ends up in portrait regardless.
 */

/** `lock` is not in the DOM lib's ScreenOrientation and is absent on iOS, so
 * both halves are declared optional here rather than assumed. */
type LockableOrientation = ScreenOrientation & {
  lock?: (orientation: string) => Promise<void>;
  unlock?: () => void;
};

const orientationOf = (): LockableOrientation | undefined =>
  typeof screen !== 'undefined' ? (screen.orientation as LockableOrientation | undefined) : undefined;

/**
 * Ask for a full-screen landscape.
 *
 * Call it synchronously from a click handler. Resolves to whether the
 * orientation lock was actually granted, which the caller may use to decide
 * how loudly to talk about rotating the phone — but never to block anything,
 * since the honest answer on iOS is always false.
 */
export async function enterLandscape(): Promise<boolean> {
  const root = document.documentElement;
  try {
    if (!document.fullscreenElement) {
      await root.requestFullscreen?.({ navigationUI: 'hide' });
    }
  } catch {
    // Refused, or unsupported. The lock below will almost certainly refuse too;
    // try it anyway, because a browser that locks without full screen costs
    // nothing to ask.
  }
  try {
    await orientationOf()?.lock?.('landscape');
    return true;
  } catch {
    return false;
  }
}

/** Give the orientation and the full screen back, whether or not we got them. */
export function exitLandscape(): void {
  try {
    orientationOf()?.unlock?.();
  } catch {
    // Unlocking something that was never locked is not an error worth having.
  }
  if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
}
