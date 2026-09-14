import { deleteField, doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/services/firebase/client";
import {
  createStorageFileId,
  deleteStorageFile,
  getStorageFileDownloadUrl,
  getStorageUploadErrorMessage,
  uploadStorageFile,
} from "@/services/firebase/storage-files";
import { derivePhotoBackgroundPaletteForView } from "@/lib/app/photo-background-palette";
import {
  findFlatPalette,
  isFaithfulSharpening,
  photoBackgroundUpscaleFactor,
  sharpenFlatGraphic,
} from "@/lib/app/photo-background-upscale";
import {
  photoSoftenSigma,
  reduceCompressionArtifacts,
  softenPhoto,
} from "@/lib/app/photo-background-soften";
import {
  DEFAULT_PHOTO_BACKGROUND_VIEW,
  encodePhotoBackgroundSample,
  ENLARGED_PHOTO_BACKGROUND_FILE_STEM,
  LOW_RESOLUTION_PHOTO_STRETCH,
  MAX_PHOTO_BACKGROUND_SAMPLE_EDGE,
  MAX_PHOTO_BACKGROUND_UPLOAD_BYTES,
  normalizePhotoBackgroundRecord,
  normalizePhotoBackgroundView,
  photoBackgroundFileExtension,
  photoBackgroundStoragePrefix,
  readPhotoBackground,
  SHARP_PHOTO_BACKGROUND_FILE_STEM,
  shouldKeepOriginalPhoto,
  writePhotoBackground,
  type CachedPhotoBackground,
  type PhotoBackgroundRecord,
  type PhotoBackgroundView,
} from "@/lib/app/photo-background";
import { setConstellationBackgroundEnabled } from "@/lib/constellation/background";

/** What a phone camera produces, before it is resized. */
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
/**
 * Enough to cover a retina laptop, an iPad Pro or a 4K monitor without the
 * photo being stretched, with a little room to zoom. 2560 was short of a
 * retina laptop's width, so every background was upscaled before it was shown.
 */
const MAX_EDGE = 3840;
/**
 * WebP where the browser can write it: at the same size it keeps hard edges and
 * flat colour -- patterns, illustrations, text in a photo -- far cleaner than
 * JPEG. Safari cannot encode WebP from a canvas, so it falls back to JPEG.
 * Both are high enough that skies do not band, and well inside the 15 MB limit.
 */
const WEBP_QUALITY = 0.95;
const JPEG_QUALITY = 0.92;

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * A flat graphic as PNG: a few solid colours compress to very little without
 * loss, where JPEG and WebP would soften the edges that were just sharpened.
 */
async function encodeGraphic(canvas: HTMLCanvasElement) {
  const png = await canvasBlob(canvas, "image/png", 1);
  return png && png.size <= MAX_PHOTO_BACKGROUND_UPLOAD_BYTES ? png : encodeBackground(canvas);
}

async function encodeBackground(canvas: HTMLCanvasElement) {
  const webp = await canvasBlob(canvas, "image/webp", WEBP_QUALITY);
  // A browser that cannot write WebP quietly hands back a PNG instead.
  if (webp?.type === "image/webp") return webp;
  const jpeg = await canvasBlob(canvas, "image/jpeg", JPEG_QUALITY);
  if (!jpeg) throw new Error("This browser could not prepare the photo.");
  return jpeg;
}

function drawScaled(source: CanvasImageSource, width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("This browser could not prepare the photo.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, width, height);
  return { canvas, context };
}

/**
 * The photo at its final size, shrunk in halves on the way down.
 *
 * One draw from a camera photo straight to the final size reads only a few of
 * the original pixels for each one it writes, which is what left uploaded
 * backgrounds jagged and soft. Halving first means every step averages the
 * pixels it drops.
 */
function resizeSmoothly(
  image: CanvasImageSource,
  imageWidth: number,
  imageHeight: number,
  width: number,
  height: number
) {
  let source = image;
  let sourceWidth = imageWidth;
  let sourceHeight = imageHeight;
  while (sourceWidth / 2 >= width && sourceHeight / 2 >= height) {
    sourceWidth = Math.round(sourceWidth / 2);
    sourceHeight = Math.round(sourceHeight / 2);
    source = drawScaled(source, sourceWidth, sourceHeight).canvas;
  }
  return drawScaled(source, width, height);
}

/**
 * A flat graphic enlarged and its edges redrawn crisp, or null for anything
 * that should stay a photo.
 *
 * Two checks: the image has to be drawn in a handful of solid colours, and the
 * sharpened result, shrunk back down, has to still be the original image --
 * which catches a subtle shade or a small gradient the palette would erase.
 */
function enlargeFlatGraphic(bitmap: ImageBitmap, factor: number) {
  const nativeWidth = bitmap.width;
  const nativeHeight = bitmap.height;
  const original = drawScaled(bitmap, nativeWidth, nativeHeight)
    .context.getImageData(0, 0, nativeWidth, nativeHeight).data;
  const palette = findFlatPalette(original, nativeWidth, nativeHeight);
  if (!palette) return null;

  const width = Math.max(1, Math.round(nativeWidth * factor));
  const height = Math.max(1, Math.round(nativeHeight * factor));
  const enlarged = drawScaled(bitmap, width, height);
  const image = enlarged.context.getImageData(0, 0, width, height);
  sharpenFlatGraphic(image.data, palette, factor);
  enlarged.context.putImageData(image, 0, 0);

  const roundTrip = resizeSmoothly(enlarged.canvas, width, height, nativeWidth, nativeHeight)
    .context.getImageData(0, 0, nativeWidth, nativeHeight).data;
  return isFaithfulSharpening(original, roundTrip) ? enlarged : null;
}

/**
 * A photo smaller than the screen: compression noise smoothed and the picture
 * softened a little at its own size, then enlarged, so the screen shows a
 * smooth photo rather than magnified JPEG blocks.
 */
function enlargeSmallPhoto(bitmap: ImageBitmap, factor: number) {
  const nativeWidth = bitmap.width;
  const nativeHeight = bitmap.height;
  const native = drawScaled(bitmap, nativeWidth, nativeHeight);
  const image = native.context.getImageData(0, 0, nativeWidth, nativeHeight);
  reduceCompressionArtifacts(image.data, nativeWidth, nativeHeight);
  softenPhoto(image.data, nativeWidth, nativeHeight, photoSoftenSigma(factor));
  native.context.putImageData(image, 0, 0);
  return drawScaled(
    native.canvas,
    Math.max(1, Math.round(nativeWidth * factor)),
    Math.max(1, Math.round(nativeHeight * factor))
  );
}

/**
 * The photo resized and re-encoded, a small sample of it, and the colours read
 * from that sample.
 *
 * Re-encoding also means whatever the camera produced -- including an iPhone's
 * HEIC, where the browser can decode it -- is stored as an ordinary JPEG with
 * its orientation already applied.
 */
export async function preparePhotoBackground(file: File) {
  if (!file.type.startsWith("image/")) throw new Error("Choose a photo.");
  if (file.size > MAX_SOURCE_BYTES) throw new Error("That photo is too large. Choose one under 25 MB.");

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("That photo could not be opened. Try a JPEG or PNG.");
  }

  try {
    const shrink = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    /*
     * A flat graphic smaller than the screen is enlarged here and its edges
     * redrawn crisp, rather than left for the browser to stretch into blur.
     * Photos are never enlarged: that would only move the blur into the file.
     */
    const upscaleFactor = shrink === 1 ? photoBackgroundUpscaleFactor(bitmap.width, bitmap.height) : 1;
    const graphic = upscaleFactor > 1 ? enlargeFlatGraphic(bitmap, upscaleFactor) : null;
    // A photo only stretched a little looks fine as it is; past that, it is prepared for the stretch.
    const photo =
      !graphic && upscaleFactor > LOW_RESOLUTION_PHOTO_STRETCH
        ? enlargeSmallPhoto(bitmap, upscaleFactor)
        : null;
    const scale = graphic || photo ? upscaleFactor : shrink;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const { canvas } =
      graphic ?? photo ?? resizeSmoothly(bitmap, bitmap.width, bitmap.height, width, height);
    const blob = shouldKeepOriginalPhoto({ type: file.type, size: file.size, scale })
      ? file
      : graphic
        ? await encodeGraphic(canvas)
        : await encodeBackground(canvas);

    const sampleScale = MAX_PHOTO_BACKGROUND_SAMPLE_EDGE / Math.max(width, height);
    const sampleWidth = Math.max(1, Math.round(width * sampleScale));
    const sampleHeight = Math.max(1, Math.round(height * sampleScale));
    const small = drawScaled(canvas, sampleWidth, sampleHeight);
    const sample = encodePhotoBackgroundSample(
      small.context.getImageData(0, 0, sampleWidth, sampleHeight).data,
      sampleWidth,
      sampleHeight
    );

    return {
      blob,
      sample,
      palette: derivePhotoBackgroundPaletteForView(sample, DEFAULT_PHOTO_BACKGROUND_VIEW),
      enlargedPhoto: Boolean(photo),
    };
  } finally {
    bitmap.close();
  }
}

export async function loadRemotePhotoBackground(userId: string) {
  const snapshot = await getDoc(doc(db, "users", userId));
  return snapshot.exists()
    ? normalizePhotoBackgroundRecord(snapshot.data().photoBackground, userId)
    : null;
}

/** The record exactly as Firestore should hold it: no device-only fields, and nothing undefined. */
function storedRecord(record: PhotoBackgroundRecord): PhotoBackgroundRecord {
  return {
    storagePath: record.storagePath,
    scheme: record.scheme,
    vars: record.vars,
    updatedAt: record.updatedAt,
    focusX: record.focusX,
    focusY: record.focusY,
    zoom: record.zoom,
    ...(record.sample ? { sample: record.sample } : {}),
  };
}

async function writeRemoteRecord(userId: string, record: PhotoBackgroundRecord) {
  await setDoc(
    doc(db, "users", userId),
    { photoBackground: storedRecord(record), updatedAt: record.updatedAt },
    { merge: true }
  );
}

async function deleteOwnPhotos(userId: string, paths: Array<string | undefined>, keep?: string) {
  const prefix = photoBackgroundStoragePrefix(userId);
  const stale = [...new Set(paths)].filter(
    (path): path is string => typeof path === "string" && path !== keep && path.startsWith(prefix)
  );
  await Promise.all(stale.map((path) => deleteStorageFile(path).catch(() => undefined)));
}

/**
 * Upload a photo, make it the account's background, and paint it here now.
 *
 * The account record is written only once the photo is uploaded, and the
 * upload is removed again if that write fails, so no device is ever pointed at
 * a file that is not there. The photo it replaces is removed afterwards.
 */
export async function savePhotoBackground(userId: string, file: File): Promise<CachedPhotoBackground> {
  const prepared = await preparePhotoBackground(file);
  const previous = await loadRemotePhotoBackground(userId).catch(() => null);
  const extension = photoBackgroundFileExtension(prepared.blob.type);
  const contentType = extension ? prepared.blob.type : "image/jpeg";
  const stem = prepared.enlargedPhoto
    ? ENLARGED_PHOTO_BACKGROUND_FILE_STEM
    : SHARP_PHOTO_BACKGROUND_FILE_STEM;
  const fileName = `${stem}.${extension ?? "jpg"}`;
  const storagePath = `${photoBackgroundStoragePrefix(userId)}${createStorageFileId()}/${fileName}`;

  await uploadStorageFile({
    storagePath,
    file: new File([prepared.blob], fileName, { type: contentType }),
    contentType,
  });

  const record: PhotoBackgroundRecord = {
    storagePath,
    scheme: prepared.palette.scheme,
    vars: prepared.palette.vars,
    updatedAt: Date.now(),
    ...DEFAULT_PHOTO_BACKGROUND_VIEW,
    sample: prepared.sample,
  };
  let imageUrl: string;
  try {
    imageUrl = await getStorageFileDownloadUrl(storagePath);
    await writeRemoteRecord(userId, record);
  } catch (error) {
    await deleteStorageFile(storagePath).catch(() => undefined);
    throw error;
  }

  const local = readPhotoBackground();
  await deleteOwnPhotos(
    userId,
    [previous?.storagePath, local?.userId === userId ? local.storagePath : undefined],
    storagePath
  );

  // Choosing a photo is the newest choice on this device, so it replaces the sky here.
  setConstellationBackgroundEnabled(false);
  const cached: CachedPhotoBackground = { ...record, userId, imageUrl };
  writePhotoBackground(cached);
  return cached;
}

/**
 * Keep a different part of the photo in view, and re-pick the colours for it.
 *
 * A photo that is calm in the middle and bright at one edge needs different
 * glass depending on which of the two is on screen, so moving the photo is a
 * new palette as well as a new position.
 */
export async function savePhotoBackgroundView(
  userId: string,
  view: PhotoBackgroundView
): Promise<CachedPhotoBackground> {
  const local = readPhotoBackground();
  const current = local?.userId === userId ? local : null;
  const base = (await loadRemotePhotoBackground(userId)) ?? current;
  if (!base) throw new Error("Choose a photo first.");

  const nextView = normalizePhotoBackgroundView(view);
  const palette = base.sample
    ? derivePhotoBackgroundPaletteForView(base.sample, nextView)
    : { scheme: base.scheme, vars: base.vars };
  const record: PhotoBackgroundRecord = {
    ...storedRecord(base),
    ...nextView,
    scheme: palette.scheme,
    vars: palette.vars,
    updatedAt: Date.now(),
  };
  await writeRemoteRecord(userId, record);

  const imageUrl =
    current?.storagePath === base.storagePath
      ? current.imageUrl
      : await getStorageFileDownloadUrl(base.storagePath);
  const cached: CachedPhotoBackground = { ...record, userId, imageUrl };
  writePhotoBackground(cached);
  return cached;
}

export async function removePhotoBackground(userId: string) {
  const remote = await loadRemotePhotoBackground(userId).catch(() => null);
  await setDoc(
    doc(db, "users", userId),
    { photoBackground: deleteField(), updatedAt: Date.now() },
    { merge: true }
  );
  const local = readPhotoBackground();
  await deleteOwnPhotos(userId, [
    remote?.storagePath,
    local?.userId === userId ? local.storagePath : undefined,
  ]);
  writePhotoBackground(null);
}

/**
 * Bring this device's copy up to date with the account.
 *
 * A copy belonging to another account is dropped at once, before the account
 * is read, so on a shared device nobody sits in front of the last person's
 * photo while their own loads. A photo chosen, moved or removed on another
 * device arrives here too. Offline, the read throws and the device keeps what
 * it has.
 */
export async function syncPhotoBackground(userId: string) {
  const existing = readPhotoBackground();
  if (existing && existing.userId !== userId) writePhotoBackground(null);

  const remote = await loadRemotePhotoBackground(userId);
  const local = readPhotoBackground();
  if (!remote) {
    if (local) writePhotoBackground(null);
    return null;
  }
  if (
    local &&
    local.userId === userId &&
    local.storagePath === remote.storagePath &&
    local.updatedAt === remote.updatedAt
  ) {
    return local;
  }
  const imageUrl =
    local?.userId === userId && local.storagePath === remote.storagePath
      ? local.imageUrl
      : await getStorageFileDownloadUrl(remote.storagePath);
  const cached: CachedPhotoBackground = { ...remote, userId, imageUrl };
  writePhotoBackground(cached);
  return cached;
}

export function photoBackgroundErrorMessage(error: unknown) {
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
  /*
   * A refusal says the photo could not be kept, not that the feature is off.
   *
   * This read "not available on this account", which sent students looking for
   * a setting when the cause was the service refusing the upload -- one they
   * could do nothing about except try again later.
   */
  if (code === "storage/unauthorized" || code === "permission-denied") {
    return "Jami couldn't store your photo just now. Please try again later.";
  }
  if (code.startsWith("storage/")) return getStorageUploadErrorMessage(error, "photo");
  return error instanceof Error && error.message
    ? error.message
    : "Your background could not be saved. Please try again.";
}
