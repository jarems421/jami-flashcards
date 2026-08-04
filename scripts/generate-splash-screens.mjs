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
/** How much of the shorter side the mark takes, matching the launch screen. */
const MARK_RATIO = 0.26;

const SOURCE_ICON = join(process.cwd(), "public", "icons", "icon-512.png");
const OUTPUT_DIR = join(process.cwd(), "public", "splash");

/**
 * The same list the markup points iOS at, so an image cannot exist without a
 * link or a link without an image.
 */
const { devices: DEVICES } = (
  await import("../lib/app/launch-screens.json", { with: { type: "json" } })
).default;

async function writeSplash({ name, pixelWidth, pixelHeight, orientation }) {
  const markSize = Math.round(Math.min(pixelWidth, pixelHeight) * MARK_RATIO);
  const mark = await sharp(SOURCE_ICON)
    .resize(markSize, markSize, { fit: "contain", background: BACKGROUND })
    .toBuffer();

  const image = await sharp({
    create: {
      width: pixelWidth,
      height: pixelHeight,
      channels: 4,
      background: BACKGROUND,
    },
  })
    .composite([{ input: mark, gravity: "centre" }])
    // A flat background behind one mark needs nowhere near full colour. As
    // truecolour the set came to 7.9MB of repository and of every device's
    // cache; as a palette it is a fraction of that and looks identical.
    .png({ compressionLevel: 9, palette: true })
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
