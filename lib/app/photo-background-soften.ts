/**
 * Preparing a photo that is smaller than the screen it covers.
 *
 * A small photo cannot be given real detail, but it can keep all the detail it
 * has. Stretched as it is, the browser magnifies the JPEG's blocks and speckle
 * along with the picture and spreads every edge across several screen pixels.
 * So on upload only the faintest compression speckle is smoothed away, the
 * photo is enlarged in gentle steps, and the edges the stretch spread out are
 * drawn back together with an unsharp mask at the final size.
 *
 * An earlier version blurred the photo before enlarging it, on the idea that a
 * soft wallpaper looks deliberate. Stretched three or four times, it just
 * looked out of focus.
 */

/**
 * Neighbours closer than this are the same surface with compression noise in
 * it. Kept low: leaves, grass and water are texture only a few levels apart,
 * and a wider limit averaged them into smears.
 */
const ARTIFACT_DISTANCE = 8;

/**
 * Smooths JPEG blocking and ringing, in place, without softening real edges.
 *
 * Each pixel becomes the average of itself and the neighbours whose colour is
 * already close to it. Across an edge the neighbours are too different to
 * count, so the edge stays where it is.
 */
export function reduceCompressionArtifacts(data: Uint8ClampedArray, width: number, height: number) {
  const source = data.slice();
  const limit = ARTIFACT_DISTANCE ** 2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      let r = source[index];
      let g = source[index + 1];
      let b = source[index + 2];
      let count = 1;
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          if ((dx === 0 && dy === 0) || nx < 0 || nx >= width) continue;
          const neighbour = (ny * width + nx) * 4;
          const distance =
            (source[neighbour] - source[index]) ** 2 +
            (source[neighbour + 1] - source[index + 1]) ** 2 +
            (source[neighbour + 2] - source[index + 2]) ** 2;
          if (distance > limit) continue;
          r += source[neighbour];
          g += source[neighbour + 1];
          b += source[neighbour + 2];
          count += 1;
        }
      }
      data[index] = r / count;
      data[index + 1] = g / count;
      data[index + 2] = b / count;
    }
  }
}

/** A gentle Gaussian blur, in place, in two passes (across, then down). */
export function softenPhoto(data: Uint8ClampedArray, width: number, height: number, sigma: number) {
  const radius = Math.max(1, Math.ceil(sigma * 2));
  const weights: number[] = [];
  let weightTotal = 0;
  for (let offset = -radius; offset <= radius; offset += 1) {
    const weight = Math.exp(-(offset * offset) / (2 * sigma * sigma));
    weights.push(weight);
    weightTotal += weight;
  }
  const kernel = weights.map((weight) => weight / weightTotal);
  const across = new Float32Array(width * height * 3);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sampleX = Math.min(width - 1, Math.max(0, x + offset));
        const source = (y * width + sampleX) * 4;
        const weight = kernel[offset + radius];
        r += data[source] * weight;
        g += data[source + 1] * weight;
        b += data[source + 2] * weight;
      }
      const target = (y * width + x) * 3;
      across[target] = r;
      across[target + 1] = g;
      across[target + 2] = b;
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sampleY = Math.min(height - 1, Math.max(0, y + offset));
        const source = (sampleY * width + x) * 3;
        const weight = kernel[offset + radius];
        r += across[source] * weight;
        g += across[source + 1] * weight;
        b += across[source + 2] * weight;
      }
      const target = (y * width + x) * 4;
      data[target] = r;
      data[target + 1] = g;
      data[target + 2] = b;
    }
  }
}

/**
 * How far to sharpen a photo after enlarging it by this factor.
 *
 * The enlargement spreads each original edge across about `factor` screen
 * pixels, so the mask's radius follows it; the strength stays moderate so
 * skies and skin do not grow halos and JPEG grain is not
 * picked out with the edges.
 */
export function enlargedPhotoSharpening(factor: number) {
  return {
    sigma: Math.min(2, Math.max(0.8, factor * 0.4)),
    amount: 0.5,
    threshold: 6,
  };
}

/**
 * An unsharp mask, in place: each pixel pushed away from its blurred
 * surroundings by `amount`. Differences of `threshold` levels or less are left
 * alone, so flat areas and leftover noise are not roughened.
 */
export function sharpenPhoto(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  { sigma, amount, threshold }: { sigma: number; amount: number; threshold: number }
) {
  const blurred = data.slice();
  softenPhoto(blurred, width, height, sigma);
  for (let index = 0; index < data.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const difference = data[index + channel] - blurred[index + channel];
      if (Math.abs(difference) <= threshold) continue;
      data[index + channel] = data[index + channel] + difference * amount;
    }
  }
}
