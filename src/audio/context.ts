type AudioContextCtor = typeof AudioContext;

interface LegacyWindow {
  webkitAudioContext?: AudioContextCtor;
}

/** Safari still only exposes the prefixed constructor on some versions. */
export function audioContextCtor(): AudioContextCtor {
  const legacy = window as unknown as LegacyWindow;
  const ctor = window.AudioContext ?? legacy.webkitAudioContext;
  if (!ctor) throw new Error('This browser has no Web Audio support.');
  return ctor;
}

let shared: AudioContext | null = null;

/**
 * One AudioContext for the whole app.
 *
 * Browsers cap how many contexts a page may create, and every context costs an
 * audio thread; the metronome and the analysis previews share this one.
 */
export function sharedAudioContext(): AudioContext {
  if (!shared || shared.state === 'closed') {
    shared = new (audioContextCtor())();
  }
  return shared;
}

/** Browsers start contexts suspended until a user gesture resumes them. */
export async function resumeAudio(): Promise<void> {
  const ctx = sharedAudioContext();
  if (ctx.state === 'suspended') await ctx.resume();
}
