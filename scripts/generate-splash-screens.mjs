/**
 * Builds the launch screens iOS shows while an installed Jami is opening.
 *
 * Android draws its own from the manifest's `background_color` and icon. iOS
 * does not: without an `apple-touch-startup-image` at exactly the right size it
 * shows a blank screen until the page paints, which reads as the app hanging on
 * a dark rectangle rather than opening.
 *
 * The image has to match the device's resolution and orientation exactly or iOS
 * ignores it, which is why this generates the set rather than shipping one.
 *
 *   node scripts/generate-splash-screens.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

/** The manifest's background_color, so the launch matches the app it opens. */
const BACKGROUND = "#100719";
/**
 * How much of the shorter side the mark takes.
 *
 * The app's own opening screen draws it at the same share -- `BrandMark`'s
 * `launch` size, `min(26vw, 26vh)` -- so that when the web page takes over from
 * this image the mark does not appear to move or resize. Change one and change
 * the other.
 */
const MARK_RATIO = 0.26;

/**
 * The corner radius of the mark, as a fraction of its size.
 *
 * The source icon is a full square whose corners are painted very nearly black
 * rather than left transparent. Composited straight onto the launch background
 * those corners read as a hard black box around the mark -- the whole reason
 * the opening looked blocky -- so they are masked away at the radius the
 * artwork is already drawn to. Apple's own icon grid is 22.37%.
 */
const CORNER_RATIO = 0.2237;

/**
 * How far the glow reaches past the mark, and how strong it is at the mark's
 * edge.
 *
 * The app's own opening screen puts the same warm halo behind the mark -- see
 * `.login-brand-halo`, whose spread is 38% of the mark either side -- so the
 * launch image is not a plainer version of the screen that replaces it.
 */
const GLOW_RATIO = 0.38;
const GLOW_OPACITY = 0.22;

const SOURCE_ICON = join(process.cwd(), "public", "icons", "icon-512.png");
const OUTPUT_DIR = join(process.cwd(), "public", "splash");

/** A rounded rectangle used as an alpha mask, at the mark's own radius. */
function cornerMask(size) {
  const radius = Math.round(size * CORNER_RATIO);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#fff"/>` +
      `</svg>`
  );
}

/**
 * The warm halo, drawn a good deal larger than the mark and faded to nothing
 * well inside its own edge so it never ends on a visible ring.
 */
function glow(size) {
  const centre = size / 2;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<defs><radialGradient id="g">` +
      `<stop offset="0%" stop-color="#ffefaa" stop-opacity="${GLOW_OPACITY}"/>` +
      `<stop offset="42%" stop-color="#eadbff" stop-opacity="${(
        GLOW_OPACITY * 0.68
      ).toFixed(3)}"/>` +
      `<stop offset="72%" stop-color="#eadbff" stop-opacity="0"/>` +
      `<stop offset="100%" stop-color="#eadbff" stop-opacity="0"/>` +
      `</radialGradient></defs>` +
      `<circle cx="${centre}" cy="${centre}" r="${centre}" fill="url(#g)"/>` +
      `</svg>`
  );
}

/**
 * The same list the markup points iOS at, so an image cannot exist without a
 * link or a link without an image.
 */
const { devices: DEVICES } = (
  await import("../lib/app/launch-screens.json", { with: { type: "json" } })
).default;

async function writeSplash({ name, pixelWidth, pixelHeight, orientation }) {
  const markSize = Math.round(Math.min(pixelWidth, pixelHeight) * MARK_RATIO);
  const glowSize = Math.round(markSize * (1 + GLOW_RATIO * 2));
  const mark = await sharp(SOURCE_ICON)
    .resize(markSize, markSize, { fit: "contain", background: BACKGROUND })
    // Keep only what falls inside the mark's rounded corners, so the artwork's
    // near-black square corners cannot sit as a box on the launch background.
    .composite([{ input: cornerMask(markSize), blend: "dest-in" }])
    .png()
    .toBuffer();

  const image = await sharp({
    create: {
      width: pixelWidth,
      height: pixelHeight,
      channels: 4,
      background: BACKGROUND,
    },
  })
    .composite([
      { input: glow(glowSize), gravity: "centre" },
      { input: mark, gravity: "centre" },
    ])
    // A flat background behind one mark needs nowhere near full colour, and as
    // truecolour the set came to 7.9MB of repository and of every device's
    // cache. The glow is a wide, very shallow gradient though, which is exactly
    // what a 256-colour palette bands into visible rings, so it is given the
    // full palette and sharp's dithering to spend it well.
    .png({ compressionLevel: 9, palette: true, colours: 256, dither: 1 })
    .toBuffer();

  const fileName = `${name}-${orientation}.png`;
  await writeFile(join(OUTPUT_DIR, fileName), image);
  return { fileName, pixelWidth, pixelHeight };
}

await mkdir(OUTPUT_DIR, { recursive: true });

const written = [];
for (const device of DEVICES) {
  written.push(
    await writeSplash({
      name: device.name,
      orientation: "portrait",
      pixelWidth: device.width * device.scale,
      pixelHeight: device.height * device.scale,
    })
  );
  written.push(
    await writeSplash({
      name: device.name,
      orientation: "landscape",
      pixelWidth: device.height * device.scale,
      pixelHeight: device.width * device.scale,
    })
  );
}

console.log(`Wrote ${written.length} launch screens to public/splash.`);
