/**
 * Restoring a photo that would be stretched to cover the screen.
 *
 * Any photo stretched past a little blurs, and sharpening only enlarges its
 * JPEG noise with its edges. So a photo that needs enlarging is sent to an
 * image-restoration model (Real-ESRGAN), which draws in believable detail, and
 * the result is saved at the size the screen needs. These are the limits both
 * sides of that request agree on; the page and the server check them alike.
 */

/** Stretch past which a photo is restored rather than enlarged in the browser. */
export const RESTORE_MIN_STRETCH = 1.15;
/** The model's recommended ceiling on what it is given (about 1440p). */
export const RESTORE_MAX_INPUT_PIXELS = 3_700_000;
/** Under the hosting platform's 4.5 MB request limit, with room to spare. */
export const RESTORE_MAX_INPUT_BYTES = 4 * 1024 * 1024;
export const RESTORE_MAX_OUTPUT_EDGE = 5120;
export const RESTORE_MAX_OUTPUT_PIXELS = 16_000_000;
export const RESTORE_MAX_MODEL_SCALE = 4;

export type PhotoRestoreSize = {
  width: number;
  height: number;
  targetWidth: number;
  targetHeight: number;
};

/** The size to send a photo at: its own, or shrunk to what the model takes. */
export function restoreInputSize(width: number, height: number) {
  const shrink = Math.min(1, Math.sqrt(RESTORE_MAX_INPUT_PIXELS / (width * height)));
  return {
    width: Math.max(1, Math.floor(width * shrink)),
    height: Math.max(1, Math.floor(height * shrink)),
  };
}

/** How far the model is asked to enlarge: whole steps, at least the stretch needed. */
export function restoreModelScale(size: PhotoRestoreSize) {
  const stretch = Math.max(size.targetWidth / size.width, size.targetHeight / size.height);
  return Math.min(RESTORE_MAX_MODEL_SCALE, Math.max(2, Math.ceil(stretch)));
}

function positiveInteger(value: unknown) {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isInteger(number) && number > 0 ? number : null;
}

/**
 * A request's sizes, or null when they are not a restore this app would ask
 * for: too big to send, too big to store, barely enlarged, or reshaped.
 */
export function readPhotoRestoreSize(input: Record<string, unknown>): PhotoRestoreSize | null {
  const width = positiveInteger(input.width);
  const height = positiveInteger(input.height);
  const targetWidth = positiveInteger(input.targetWidth);
  const targetHeight = positiveInteger(input.targetHeight);
  if (!width || !height || !targetWidth || !targetHeight) return null;
  if (width * height > RESTORE_MAX_INPUT_PIXELS) return null;
  if (Math.max(targetWidth, targetHeight) > RESTORE_MAX_OUTPUT_EDGE) return null;
  if (targetWidth * targetHeight > RESTORE_MAX_OUTPUT_PIXELS) return null;
  const stretchX = targetWidth / width;
  const stretchY = targetHeight / height;
  if (Math.min(stretchX, stretchY) < 1) return null;
  if (Math.max(stretchX, stretchY) > RESTORE_MAX_MODEL_SCALE * 1.05) return null;
  if (Math.abs(stretchX - stretchY) / Math.max(stretchX, stretchY) > 0.02) return null;
  return { width, height, targetWidth, targetHeight };
}
