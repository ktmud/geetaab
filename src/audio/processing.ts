/**
 * What the browser did with the microphone, as opposed to what it was asked.
 *
 * The recorder asks for echo cancellation, noise suppression and gain control
 * to be off, because all three are built for speech and all three damage music:
 * cancellation subtracts anything also coming out of the speakers, gain riding
 * pumps the noise floor up between strums, and suppression carves holes in
 * sustained chords. Asking is all a web page can do. Safari on iOS in
 * particular accepts the constraint and ignores it.
 *
 * The recorder cannot fix that, but it can stop pretending it did not happen:
 * a take made through a speech chain is worth less, and the player deserves to
 * know before spending a verse on it rather than after seeing a bad tab.
 */
export interface ProcessingVerdict {
  echoCancellation: boolean | null;
  noiseSuppression: boolean | null;
  autoGainControl: boolean | null;
  /** True when at least one stage is on despite being asked to be off. */
  processed: boolean;
  /** The stages that are on, for a message that names them. */
  active: string[];
  /** True when the browser would not say either way. */
  unknown: boolean;
}

type Settings = Partial<
  Record<'echoCancellation' | 'noiseSuppression' | 'autoGainControl', boolean | undefined>
>;

export function readProcessing(settings: Settings | undefined): ProcessingVerdict {
  const read = (key: keyof Settings): boolean | null => {
    const value = settings?.[key];
    return typeof value === 'boolean' ? value : null;
  };
  const echoCancellation = read('echoCancellation');
  const noiseSuppression = read('noiseSuppression');
  const autoGainControl = read('autoGainControl');
  const active: string[] = [];
  if (echoCancellation) active.push('echoCancellation');
  if (noiseSuppression) active.push('noiseSuppression');
  if (autoGainControl) active.push('autoGainControl');
  return {
    echoCancellation,
    noiseSuppression,
    autoGainControl,
    processed: active.length > 0,
    active,
    unknown: echoCancellation === null && noiseSuppression === null && autoGainControl === null,
  };
}

/** The constraints worth asking for, in one place so both attempts agree. */
export const RAW_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 1,
};
