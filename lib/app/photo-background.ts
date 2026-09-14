/**
 * A photo of the student's own as the app's background.
 *
 * The photo and the colours picked from it belong to the account, so they
 * follow the student between devices. Each device also keeps a copy of both in
 * local storage, because the blocking script that paints the first frame cannot
 * wait for Firestore: without the copy every load would open on the colour
 * theme and change under the student once the account had been read.
 */

export const PHOTO_BACKGROUND_STORAGE_KEY = "jami:photo-background";
export const PHOTO_BACKGROUND_EVENT = "jami-photo-background-change";

export type PhotoBackgroundScheme = "dark" | "light";

/**
 * The primitives a palette sets. globals.css builds every app colour from
 * these, so a palette is sixteen short values rather than a whole theme.
 */
export const PHOTO_BACKGROUND_VAR_NAMES = [
  "--photo-base",
  "--photo-surface-rgb",
  "--photo-panel-alpha",
  "--photo-panel-strong-alpha",
  "--photo-solid",
  "--photo-solid-alt",
  "--photo-text",
  "--photo-text-secondary",
  "--photo-text-muted",
  "--photo-line-rgb",
  "--photo-shadow-rgb",
  "--photo-accent",
  "--photo-accent-hover",
  "--photo-accent-rgb",
  "--photo-on-accent",
  "--photo-overlay",
] as const;

export type PhotoBackgroundVarName = (typeof PHOTO_BACKGROUND_VAR_NAMES)[number];
export type PhotoBackgroundVars = Record<PhotoBackgroundVarName, string>;

/**
 * Which part of the photo stays in view: a point, as percentages across and
 * down, and how far in to zoom around it. The point stays where it is on every
 * screen, so a phone and a monitor both keep what the student chose.
 */
export type PhotoBackgroundView = {
  focusX: number;
  focusY: number;
  zoom: number;
};

export const DEFAULT_PHOTO_BACKGROUND_VIEW: PhotoBackgroundView = { focusX: 50, focusY: 50, zoom: 1 };
export const MAX_PHOTO_BACKGROUND_ZOOM = 3;

/**
 * A tiny copy of the photo, as base64 RGB bytes.
 *
 * Kept so the colours can be picked again for whichever part of the photo is
 * in view after it has been moved. The stored photo cannot be read back into a
 * canvas -- Storage does not send the headers that would allow it -- so this is
 * the only copy of its pixels the app can still look at.
 */
export type PhotoBackgroundSample = {
  width: number;
  height: number;
  data: string;
};

export const MAX_PHOTO_BACKGROUND_SAMPLE_EDGE = 48;

export type PhotoBackgroundRecord = PhotoBackgroundView & {
  storagePath: string;
  scheme: PhotoBackgroundScheme;
  vars: PhotoBackgroundVars;
  updatedAt: number;
  sample?: PhotoBackgroundSample;
};

/** What a device keeps: the account's record, whose account it is, and a URL to paint it with. */
export type CachedPhotoBackground = PhotoBackgroundRecord & {
  userId: string;
  imageUrl: string;
};

export const PHOTO_BACKGROUND_CLASS_NAMES = [
  "photo-background-enabled",
  "photo-background-dark",
  "photo-background-light",
];

/**
 * A colour, an alpha or an "r g b" triplet, and nothing a stylesheet could be
 * talked into doing more with: no semicolons, colons, quotes or braces.
 */
export const PHOTO_BACKGROUND_VALUE_PATTERN = /^[#a-zA-Z0-9.,()%\s/-]{1,80}$/;
/** An https URL with nothing in it that could close the CSS `url("...")` it is placed in. */
export const PHOTO_BACKGROUND_URL_PATTERN = /^https:\/\/[^\s"'()\\]+$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function finiteOr(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Where a photo background is never drawn.
 *
 * Far shorter than the star sky's list. The sky is kept off notebooks and
 * past-paper questions because forty animated stars sat behind a canvas that
 * repaints on every stroke; a photo is one still image on a layer of its own,
 * painted once, so it costs the ink nothing. Only the constellation page is
 * left out, because it draws a sky in the middle of itself.
 */
export const PHOTO_BACKGROUND_EXCLUDED_PATHS = ["/dashboard/constellation"];

export function allowsPhotoBackground(pathname: string) {
  return !PHOTO_BACKGROUND_EXCLUDED_PATHS.some((prefix) => pathname.startsWith(prefix));
}

export function photoBackgroundStoragePrefix(userId: string) {
  return `users/${userId}/appBackgrounds/`;
}

/**
 * The file name photos are saved under since uploads were made sharper.
 *
 * Earlier uploads were shrunk in a single step to at most 2560px and saved as
 * `background.jpg`. Their detail is gone from the stored file, so nothing can
 * sharpen them afterwards; the name is how the app tells them apart and asks
 * for the photo again.
 */
export const SHARP_PHOTO_BACKGROUND_FILE_STEM = "background-sharp";
/**
 * A photo that was smaller than the screen, cleaned up, softened a little and
 * enlarged on upload. Named apart so the card can say what happened to it.
 */
export const ENLARGED_PHOTO_BACKGROUND_FILE_STEM = "background-enlarged";

function photoBackgroundFileName(storagePath: string) {
  return storagePath.split("/").pop() ?? "";
}

export function isEnlargedPhotoBackground(storagePath: string) {
  return photoBackgroundFileName(storagePath).startsWith(`${ENLARGED_PHOTO_BACKGROUND_FILE_STEM}.`);
}

export function isSoftPhotoBackground(storagePath: string) {
  return (
    !photoBackgroundFileName(storagePath).startsWith(`${SHARP_PHOTO_BACKGROUND_FILE_STEM}.`) &&
    !isEnlargedPhotoBackground(storagePath)
  );
}

/** What Storage accepts for a background (storage.rules), and the extension each is saved under. */
const PHOTO_BACKGROUND_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
export const MAX_PHOTO_BACKGROUND_UPLOAD_BYTES = 15 * 1024 * 1024;

export function photoBackgroundFileExtension(type: string) {
  return PHOTO_BACKGROUND_EXTENSIONS[type] ?? null;
}

/**
 * Whether to upload the student's own file rather than a re-encoded copy.
 *
 * A photo that needs no shrinking gains nothing from being encoded again, and
 * an image that was already compressed -- a wallpaper saved from the web --
 * loses more detail to every round. So when it already fits, is a format
 * Storage takes and is within its size limit, the original bytes are kept.
 */
export function shouldKeepOriginalPhoto(input: { type: string; size: number; scale: number }) {
  return (
    // Neither shrunk nor enlarged.
    input.scale === 1 &&
    input.size <= MAX_PHOTO_BACKGROUND_UPLOAD_BYTES &&
    photoBackgroundFileExtension(input.type) !== null
  );
}

/** Stretch beyond which a background visibly blurs, so the card explains it. */
export const LOW_RESOLUTION_PHOTO_STRETCH = 1.5;

/**
 * How many times the browser enlarges the photo to cover this screen, counting
 * device pixels and the chosen zoom. Nothing processed after upload can add
 * detail to an image smaller than the screen; this is how the app can say so.
 */
export function photoBackgroundStretch(input: {
  imageWidth: number;
  imageHeight: number;
  screenWidth: number;
  screenHeight: number;
  pixelRatio: number;
  zoom: number;
}) {
  if (input.imageWidth <= 0 || input.imageHeight <= 0) return 1;
  return (
    Math.max(input.screenWidth / input.imageWidth, input.screenHeight / input.imageHeight) *
    input.zoom *
    input.pixelRatio
  );
}

export function getPhotoBackgroundClassNames(scheme: PhotoBackgroundScheme) {
  return ["photo-background-enabled", `photo-background-${scheme}`];
}

export function photoBackgroundImageValue(imageUrl: string) {
  return `url("${imageUrl}")`;
}

/** The view as CSS reads it: the point kept in view, and the zoom around it. */
export function photoBackgroundPosition(view: PhotoBackgroundView) {
  return `${view.focusX}% ${view.focusY}%`;
}

export function normalizePhotoBackgroundView(value: {
  focusX?: unknown;
  focusY?: unknown;
  zoom?: unknown;
}): PhotoBackgroundView {
  const rounded = (input: number) => Math.round(input * 100) / 100;
  return {
    focusX: rounded(clamp(finiteOr(value.focusX, 50), 0, 100)),
    focusY: rounded(clamp(finiteOr(value.focusY, 50), 0, 100)),
    zoom: rounded(clamp(finiteOr(value.zoom, 1), 1, MAX_PHOTO_BACKGROUND_ZOOM)),
  };
}

/** Packs RGBA pixel data, as `getImageData` returns it, into a sample. */
export function encodePhotoBackgroundSample(
  pixels: ArrayLike<number>,
  width: number,
  height: number
): PhotoBackgroundSample {
  let binary = "";
  for (let index = 0; index < width * height; index += 1) {
    binary += String.fromCharCode(pixels[index * 4], pixels[index * 4 + 1], pixels[index * 4 + 2]);
  }
  return { width, height, data: btoa(binary) };
}

/**
 * The sample's pixels that can be on screen for this view, as RGBA.
 *
 * On any screen shape, the part of the photo shown sits inside a window
 * `1 / zoom` of the photo across and down, placed so the focus point keeps its
 * position. Picking colours from that whole window rather than from one
 * screen's crop is what keeps text readable on every device at once.
 */
export function photoBackgroundViewPixels(
  sample: PhotoBackgroundSample,
  view: PhotoBackgroundView
): number[] {
  const bytes = atob(sample.data);
  const span = 1 / view.zoom;
  const left = (view.focusX / 100) * (1 - span);
  const top = (view.focusY / 100) * (1 - span);
  const pixels: number[] = [];
  for (let y = 0; y < sample.height; y += 1) {
    if ((y + 1) / sample.height <= top || y / sample.height >= top + span) continue;
    for (let x = 0; x < sample.width; x += 1) {
      if ((x + 1) / sample.width <= left || x / sample.width >= left + span) continue;
      const index = (y * sample.width + x) * 3;
      pixels.push(bytes.charCodeAt(index), bytes.charCodeAt(index + 1), bytes.charCodeAt(index + 2), 255);
    }
  }
  return pixels;
}

function hasEveryVar(vars: Partial<PhotoBackgroundVars>): vars is PhotoBackgroundVars {
  return PHOTO_BACKGROUND_VAR_NAMES.every((name) => typeof vars[name] === "string");
}

function normalizeVars(value: unknown): PhotoBackgroundVars | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const vars: Partial<PhotoBackgroundVars> = {};
  for (const name of PHOTO_BACKGROUND_VAR_NAMES) {
    const entry = input[name];
    if (typeof entry !== "string" || !PHOTO_BACKGROUND_VALUE_PATTERN.test(entry)) return null;
    vars[name] = entry;
  }
  return hasEveryVar(vars) ? vars : null;
}

function normalizeSample(value: unknown): PhotoBackgroundSample | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const { width, height, data } = input;
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_PHOTO_BACKGROUND_SAMPLE_EDGE ||
    height > MAX_PHOTO_BACKGROUND_SAMPLE_EDGE ||
    typeof data !== "string" ||
    data.length !== 4 * width * height ||
    !BASE64_PATTERN.test(data)
  ) {
    return undefined;
  }
  return { width, height, data };
}

/**
 * A stored background, or nothing.
 *
 * Only a photo inside the account's own background folder is accepted, so a
 * record can never point the app -- or the clean-up that runs when a photo is
 * replaced -- at anybody else's file. A record saved before photos could be
 * moved reads as centred and unzoomed.
 */
export function normalizePhotoBackgroundRecord(
  value: unknown,
  userId: string
): PhotoBackgroundRecord | null {
  if (!value || typeof value !== "object" || !userId) return null;
  const input = value as Record<string, unknown>;
  const storagePath = typeof input.storagePath === "string" ? input.storagePath : "";
  if (
    !storagePath.startsWith(photoBackgroundStoragePrefix(userId)) ||
    storagePath.includes("..") ||
    storagePath.length > 400
  ) {
    return null;
  }
  const scheme = input.scheme === "light" ? "light" : input.scheme === "dark" ? "dark" : null;
  const vars = normalizeVars(input.vars);
  if (!scheme || !vars) return null;
  const sample = normalizeSample(input.sample);
  return {
    storagePath,
    scheme,
    vars,
    updatedAt: finiteOr(input.updatedAt, 0),
    ...normalizePhotoBackgroundView(input),
    ...(sample ? { sample } : {}),
  };
}

export function parseCachedPhotoBackground(raw: string | null): CachedPhotoBackground | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const input = parsed as Record<string, unknown>;
  const userId = typeof input.userId === "string" ? input.userId : "";
  const imageUrl = typeof input.imageUrl === "string" ? input.imageUrl : "";
  const record = normalizePhotoBackgroundRecord(input, userId);
  return record && PHOTO_BACKGROUND_URL_PATTERN.test(imageUrl)
    ? { ...record, userId, imageUrl }
    : null;
}

export function readPhotoBackground(): CachedPhotoBackground | null {
  if (typeof window === "undefined") return null;
  try {
    return parseCachedPhotoBackground(window.localStorage.getItem(PHOTO_BACKGROUND_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writePhotoBackground(value: CachedPhotoBackground | null) {
  if (typeof window === "undefined") return;
  try {
    if (value) {
      window.localStorage.setItem(PHOTO_BACKGROUND_STORAGE_KEY, JSON.stringify(value));
    } else {
      window.localStorage.removeItem(PHOTO_BACKGROUND_STORAGE_KEY);
    }
  } catch {
    // Storage refused: the account still holds the photo, and the next sync tries again.
  }
  window.dispatchEvent(new Event(PHOTO_BACKGROUND_EVENT));
}
