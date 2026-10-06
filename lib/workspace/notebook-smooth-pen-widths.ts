import { WIDTH_SMOOTHING_RADIUS, WIDTH_VARIATION_FLOOR } from "@/lib/workspace/notebook-smooth-pen-tuning";

/**
 * Each sample's width, pulled towards the stroke's own average.
 *
 * This is what `pressureResponse` does, and it has to happen before anything
 * else looks at the widths: at zero every point comes out at the mean, so the
 * variation test then correctly reports a stroke of one width and the cheaper
 * stroked path is taken. Flooring the widths instead -- which is all
 * `minimumWidthFraction` can do -- cannot produce that, because a floor only
 * lifts the light points and leaves the heavy ones heavy.
 *
 * Above one it pushes the other way, so a light touch reads lighter and a
 * heavy one heavier than the digitiser reported.
 */
export function shapePenPressure(raw: number[], pressureResponse: number) {
  if (pressureResponse === 1) return raw;
  const mean = raw.reduce((sum, value) => sum + value, 0) / Math.max(raw.length, 1);
  return raw.map((value) => Math.max(0.1, mean + (value - mean) * pressureResponse));
}

/** Whether a stroke was drawn with enough varying weight to be worth tapering. */
export function penWidthVaries(raw: number[]) {
  if (raw.length < 3) return false;
  let smallest = raw[0];
  let largest = raw[0];
  let total = 0;
  for (const value of raw) {
    if (value < smallest) smallest = value;
    if (value > largest) largest = value;
    total += value;
  }
  const mean = total / raw.length;
  return mean > 0 && (largest - smallest) / mean >= WIDTH_VARIATION_FLOOR;
}

/** Half the width at each point, averaged along the stroke and floored. */
export function penHalfWidthsAlong(raw: number[], count: number, minimumWidthFraction: number) {
  const mean = raw.reduce((sum, value) => sum + value, 0) / Math.max(raw.length, 1);
  const floor = mean * minimumWidthFraction;
  const result: number[] = [];

  for (let index = 0; index < count; index += 1) {
    let total = 0;
    let samples = 0;
    for (let offset = -WIDTH_SMOOTHING_RADIUS; offset <= WIDTH_SMOOTHING_RADIUS; offset += 1) {
      const source = index + offset;
      if (source < 0 || source >= raw.length) continue;
      total += raw[source];
      samples += 1;
    }
    result.push(Math.max(samples ? total / samples : mean, floor) / 2);
  }
  return result;
}
