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
  DEFAULT_PHOTO_BACKGROUND_VIEW,
  encodePhotoBackgroundSample,
  MAX_PHOTO_BACKGROUND_SAMPLE_EDGE,
  normalizePhotoBackgroundRecord,
  normalizePhotoBackgroundView,
  photoBackgroundStoragePrefix,
  readPhotoBackground,
  writePhotoBackground,
  type CachedPhotoBackground,
  type PhotoBackgroundRecord,
  type PhotoBackgroundView,
} from "@/lib/app/photo-background";
import { setConstellationBackgroundEnabled } from "@/lib/constellation/background";

/** What a phone camera produces, before it is resized. */
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
/** Sharp on a large desktop monitor, and light enough to sit behind every page on an iPad. */
const MAX_EDGE = 2560;

function drawScaled(source: CanvasImageSource, width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("This browser could not prepare the photo.");
  context.drawImage(source, 0, 0, width, height);
  return { canvas, context };
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
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const { canvas } = drawScaled(bitmap, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.86)
    );
    if (!blob) throw new Error("This browser could not prepare the photo.");

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
  const storagePath = `${photoBackgroundStoragePrefix(userId)}${createStorageFileId()}/background.jpg`;

  await uploadStorageFile({
    storagePath,
    file: new File([prepared.blob], "background.jpg", { type: "image/jpeg" }),
    contentType: "image/jpeg",
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
  if (code === "storage/unauthorized" || code === "permission-denied") {
    return "Photo backgrounds are not available on this account.";
  }
  if (code.startsWith("storage/")) return getStorageUploadErrorMessage(error, "photo");
  return error instanceof Error && error.message
    ? error.message
    : "Your background could not be saved. Please try again.";
}
