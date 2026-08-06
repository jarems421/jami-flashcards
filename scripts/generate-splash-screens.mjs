/**
 * Builds the launch screens iOS shows while an installed Jami is opening.
 *
 * Android draws its own from the manifest's `background_color`. iOS does not:
 * without an `apple-touch-startup-image` at exactly the right size it shows a
 * blank screen until the page paints, which reads as the app hanging on a white
 * rectangle rather than opening.
 *
 * These are deliberately nothing but that background colour.
 *
 * They used to carry the app icon, which made two loading screens out of one
 * opening: iOS drew a mark on a fixed colour, then the app drew its own mark on
 * whichever background the reader's theme sets, and the handover was visible as
 * the mark and the colour both changing. A launch image cannot follow the theme
 * -- it is a static file chosen by screen size alone, and Jami has six themes,
 * two of them light -- so it stops competing and holds a colour instead. The
 * mark then appears exactly once, on the app's own opening screen, where it can
 * be drawn against the background actually in use.
 *
 * The image has to match the device's resolution and orientation exactly or iOS
 * ignores it, which is why this generates the set rather than shipping one.
 *
 *   node scripts/generate-splash-screens.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

/**
 * The default theme's `--color-surface-base`, so an untouched install opens on
 * one continuous colour. The five other themes settle to their own colour as
 * the page paints; there is no static image that could have covered all six.
 */
const BACKGROUND = "#040827";

const OUTPUT_DIR = join(process.cwd(), "public", "splash");

/**
 * The same list the markup points iOS at, so an image cannot exist without a
 * link or a link without an image.
 */
const { devices: DEVICES } = (
  await import("../lib/app/launch-screens.json", { with: { type: "json" } })
).default;

async function writeSplash({ name, pixelWidth, pixelHeight, orientation }) {
  const image = await sharp({
    create: {
      width: pixelWidth,
      height: pixelHeight,
      channels: 4,
      background: BACKGROUND,
    },
  })
    // One flat colour, so a palette of one entry is the whole image and the
    // set costs a couple of kilobytes rather than megabytes of every device's
    // cache.
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
