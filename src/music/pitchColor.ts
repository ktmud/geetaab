/**
 * Hue for a pitch class, laid out around the circle of fifths.
 *
 * Stepping by fifths rather than by semitones means notes that sound related
 * look related: C and G land next to each other, and the tones of any one chord
 * fall into a narrow wedge of the colour wheel instead of scattering across it.
 * A chromatic mapping would make every chord look like confetti.
 */
export function pitchClassHue(pitchClass: number): number {
  const pc = ((pitchClass % 12) + 12) % 12;
  return ((pc * 7) % 12) * 30;
}
