import "server-only";
import sharp from "sharp";
import { EXAM_WORKING_MAX_BYTES } from "@/lib/practice/exam-questions";

/**
 * A student's working sheet, checked before it is stored or marked.
 *
 * Kept apart from the rest of the evidence helpers because this is the only
 * one that needs an image library, and the tutor and marking paths that read
 * evidence should not drag `sharp` in behind them.
 */
export async function validateExamWorking(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("invalid_working");
  const input = value as Record<string, unknown>;
  if (input.mimeType !== "image/png" || typeof input.dataBase64 !== "string" ||
    input.dataBase64.length > Math.ceil(EXAM_WORKING_MAX_BYTES / 3) * 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(input.dataBase64)) throw new Error("invalid_working");
  const bytes = Buffer.from(input.dataBase64, "base64");
  if (!bytes.length || bytes.length > EXAM_WORKING_MAX_BYTES) throw new Error("invalid_working");
  const decoder = sharp(bytes, { limitInputPixels: 4096 * 4096, failOn: "warning" });
  const metadata = await decoder.metadata();
  if (metadata.format !== "png" || !metadata.width || !metadata.height ||
    metadata.width > 4096 || metadata.height > 4096 || (metadata.pages ?? 1) > 1 ||
    metadata.width !== input.width || metadata.height !== input.height) throw new Error("invalid_working");
  // Decoding the pixels validates the file, not just its client-supplied header.
  const normalized = await decoder.png().toBuffer();
  if (normalized.length > EXAM_WORKING_MAX_BYTES) throw new Error("invalid_working");
  return { bytes: normalized, width: metadata.width, height: metadata.height };
}
