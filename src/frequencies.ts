/** Real OSM data rarely carries frequency tags for the positions we care
 * about, so these are deterministic per-airport placeholders within the
 * correct real-world VHF band per position - stable across sessions
 * (same airport always shows the same numbers) but not sourced from an
 * official AIP. Good enough for a sim frequency strip, not for real nav. */
function seedFor(icao: string): number {
  let seed = 0;
  for (const ch of icao) seed = (seed * 31 + ch.charCodeAt(0)) % 9973;
  return seed;
}

const BANDS: Record<string, [number, number]> = {
  ramp: [131.55, 131.975],
  ground: [121.6, 121.95],
  tower: [118.0, 121.0],
  approach: [124.0, 127.0],
};

export function frequencyFor(icao: string, position: keyof typeof BANDS): string {
  const [lo, hi] = BANDS[position];
  const seed = seedFor(icao + position);
  const steps = Math.round((hi - lo) / 0.025);
  const value = lo + (seed % steps) * 0.025;
  return value.toFixed(3);
}
