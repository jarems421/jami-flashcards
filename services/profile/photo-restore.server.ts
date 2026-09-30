import "server-only";

import { randomUUID } from "node:crypto";
import sharp from "sharp";
import {
  restoreModelScale,
  type PhotoRestoreSize,
} from "@/lib/app/photo-background-restore";
import {
  photoBackgroundStoragePrefix,
  RESTORED_PHOTO_BACKGROUND_FILE_STEM,
} from "@/lib/app/photo-background";
import { getAdminStorageBucket } from "@/services/firebase/admin";

/**
 * Restoring a background photo with Real-ESRGAN on Replicate.
 *
 * The photo goes to Replicate only for the length of one run: the uploaded
 * copy is deleted as soon as the run ends, and Replicate removes an API
 * prediction's inputs and outputs within the hour on its own. Nothing about
 * the photo is kept anywhere but the student's own Storage folder.
 */

const REPLICATE_API = "https://api.replicate.com/v1";
const MODEL = "nightmareai/real-esrgan";
const POLL_INTERVAL_MS = 1_000;
/** Background photos are shown, not studied: high enough that skies do not band. */
const OUTPUT_WEBP_QUALITY = 90;

export class PhotoRestoreUnavailableError extends Error {}

/** Switched on only once the key is set and sending photos to Replicate has been signed off. */
export function isPhotoRestoreConfigured() {
  return (
    Boolean(process.env.REPLICATE_API_TOKEN?.trim()) &&
    process.env.REPLICATE_ENABLED === "true" &&
    process.env.REPLICATE_PRIVACY_APPROVED === "true"
  );
}

function headers(extra: Record<string, string> = {}) {
  return { Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN?.trim()}`, ...extra };
}

async function replicateJson(response: Response, what: string) {
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Replicate ${what} failed with ${response.status}: ${detail.slice(0, 300)}`);
  }
  return (await response.json()) as Record<string, unknown>;
}

let cachedVersion: string | null = null;

/** The pinned version when one is set, otherwise the model's latest, looked up once per instance. */
async function modelVersion(signal: AbortSignal) {
  const pinned = process.env.REPLICATE_UPSCALE_VERSION?.trim();
  if (pinned) return pinned;
  if (cachedVersion) return cachedVersion;
  const model = await replicateJson(
    await fetch(`${REPLICATE_API}/models/${MODEL}`, { headers: headers(), signal }),
    "model lookup"
  );
  const latest = model.latest_version as { id?: unknown } | undefined;
  if (typeof latest?.id !== "string") throw new Error("Replicate model has no published version.");
  cachedVersion = latest.id;
  return cachedVersion;
}

async function uploadInput(bytes: Uint8Array<ArrayBuffer>, contentType: string, signal: AbortSignal) {
  const form = new FormData();
  form.append("content", new Blob([bytes], { type: contentType }), "photo");
  const file = await replicateJson(
    await fetch(`${REPLICATE_API}/files`, { method: "POST", headers: headers(), body: form, signal }),
    "file upload"
  );
  const urls = file.urls as { get?: unknown } | undefined;
  if (typeof file.id !== "string" || typeof urls?.get !== "string") {
    throw new Error("Replicate file upload returned no URL.");
  }
  return { id: file.id, url: urls.get };
}

function outputUrl(output: unknown) {
  if (typeof output === "string") return output;
  if (Array.isArray(output) && typeof output[0] === "string") return output[0];
  return null;
}

type Prediction = { id: string; status: string; output: unknown; cancelUrl: string | null; getUrl: string };

function readPrediction(value: Record<string, unknown>): Prediction {
  const urls = (value.urls ?? {}) as { get?: unknown; cancel?: unknown };
  if (typeof value.id !== "string" || typeof urls.get !== "string") {
    throw new Error("Replicate returned an unreadable prediction.");
  }
  return {
    id: value.id,
    status: typeof value.status === "string" ? value.status : "unknown",
    output: value.output,
    cancelUrl: typeof urls.cancel === "string" ? urls.cancel : null,
    getUrl: urls.get,
  };
}

async function runModel(imageUrl: string, scale: number, signal: AbortSignal) {
  const version = await modelVersion(signal);
  let prediction = readPrediction(
    await replicateJson(
      await fetch(`${REPLICATE_API}/predictions`, {
        method: "POST",
        headers: headers({ "Content-Type": "application/json", Prefer: "wait=55" }),
        body: JSON.stringify({ version, input: { image: imageUrl, scale, face_enhance: false } }),
        signal,
      }),
      "prediction"
    )
  );

  try {
    while (prediction.status === "starting" || prediction.status === "processing") {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      signal.throwIfAborted();
      prediction = readPrediction(
        await replicateJson(await fetch(prediction.getUrl, { headers: headers(), signal }), "poll")
      );
    }
  } catch (error) {
    // Out of time: stop the run so it is not billed to the end.
    if (prediction.cancelUrl) {
      await fetch(prediction.cancelUrl, { method: "POST", headers: headers() }).catch(() => undefined);
    }
    throw error;
  }

  const url = prediction.status === "succeeded" ? outputUrl(prediction.output) : null;
  if (!url) throw new Error(`Replicate prediction ${prediction.id} ended ${prediction.status}.`);
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Replicate output download failed with ${response.status}.`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Restores the photo, fits it to the size the screen needs, and saves it in
 * the student's background folder. Returns where it was saved.
 */
export async function restorePhotoBackground(input: {
  uid: string;
  bytes: Uint8Array<ArrayBuffer>;
  contentType: string;
  size: PhotoRestoreSize;
  signal: AbortSignal;
}) {
  if (!isPhotoRestoreConfigured()) throw new PhotoRestoreUnavailableError("Photo restore is not configured.");

  const uploaded = await uploadInput(input.bytes, input.contentType, input.signal);
  let restored: Uint8Array;
  try {
    restored = await runModel(uploaded.url, restoreModelScale(input.size), input.signal);
  } finally {
    await fetch(`${REPLICATE_API}/files/${uploaded.id}`, { method: "DELETE", headers: headers() }).catch(
      () => undefined
    );
  }

  const webp = await sharp(restored)
    .resize(input.size.targetWidth, input.size.targetHeight, { fit: "fill", kernel: "lanczos3" })
    .webp({ quality: OUTPUT_WEBP_QUALITY })
    .toBuffer();

  const storagePath = `${photoBackgroundStoragePrefix(input.uid)}${randomUUID()}/${RESTORED_PHOTO_BACKGROUND_FILE_STEM}.webp`;
  await getAdminStorageBucket()
    .file(storagePath)
    .save(webp, {
      contentType: "image/webp",
      resumable: false,
      // What the web SDK's getDownloadURL reads, so the page can show it like any upload.
      metadata: { metadata: { firebaseStorageDownloadTokens: randomUUID() } },
    });
  return storagePath;
}
