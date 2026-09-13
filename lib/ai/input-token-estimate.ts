import type { AiContentPart } from "@/lib/ai/content-parts";

/**
 * How big a request is before it is sent, estimated locally.
 *
 * Images used to be counted by their compressed bytes, as if a PNG were text.
 * A model does not read an image that way: it cuts the pixels into patches and
 * spends a token per patch, so what an image costs follows its width and
 * height and has nothing to do with how well it compressed. Counted by bytes,
 * the 1200 x 1653 working sheet a student submits with an exam answer came to
 * tens of thousands of "tokens" -- more than the whole marking ceiling -- and
 * every answer with working was refused as too large to mark before any model
 * saw it, while the same answer typed was marked.
 */

const CHARACTERS_PER_TOKEN = 3.5;

/*
 * One token per 28-pixel square: a 14-pixel patch merged two by two, which is
 * the finest reading among the vision encoders routed here. Gemini reads far
 * more coarsely. Counting at the finest density over-estimates an image rather
 * than under-estimating it, which is the right error for a preflight guard.
 */
const PIXELS_PER_IMAGE_TOKEN = 28 * 28;
/** The markers a model wraps around each image. */
const IMAGE_FRAMING_TOKENS = 16;
/** Enough of the file to reach a JPEG's size behind a large EXIF block. */
const HEADER_SCAN_BYTES = 256 * 1024;

export type ImageSize = { width: number; height: number };

function sized(width: number, height: number): ImageSize | null {
  return width > 0 && height > 0 ? { width, height } : null;
}

function pngSize(bytes: Buffer) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || signature.some((value, index) => bytes[index] !== value)) return null;
  if (bytes.toString("latin1", 12, 16) !== "IHDR") return null;
  return sized(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
}

function jpegSize(bytes: Buffer) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // Standalone markers carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2;
      continue;
    }
    // The image data began, or the file ended, before a frame header.
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = bytes.readUInt16BE(offset + 2);
    const isFrameHeader =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrameHeader) {
      if (offset + 9 > bytes.length) return null;
      return sized(bytes.readUInt16BE(offset + 7), bytes.readUInt16BE(offset + 5));
    }
    offset += 2 + length;
  }
  return null;
}

function webpSize(bytes: Buffer) {
  if (
    bytes.length < 30 ||
    bytes.toString("latin1", 0, 4) !== "RIFF" ||
    bytes.toString("latin1", 8, 12) !== "WEBP"
  ) {
    return null;
  }
  const chunk = bytes.toString("latin1", 12, 16);
  if (chunk === "VP8 ") {
    return sized(bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff);
  }
  if (chunk === "VP8L") {
    const [b0, b1, b2, b3] = [bytes[21], bytes[22], bytes[23], bytes[24]];
    return sized(
      1 + (((b1 & 0x3f) << 8) | b0),
      1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6))
    );
  }
  if (chunk === "VP8X") {
    return sized(1 + bytes.readUIntLE(24, 3), 1 + bytes.readUIntLE(27, 3));
  }
  return null;
}

/** An image's pixel size, read from its header without decoding the image. */
export function imageSizeFromBase64(data: string): ImageSize | null {
  const header = Buffer.from(
    data.slice(0, Math.ceil(HEADER_SCAN_BYTES / 3) * 4),
    "base64"
  );
  return pngSize(header) ?? jpegSize(header) ?? webpSize(header);
}

/**
 * What one inline image costs.
 *
 * An image whose size cannot be read is still counted by its bytes: that is
 * the old over-estimate, and over-estimating something unrecognised is safer
 * than guessing it small.
 */
export function estimateImageTokens(data: string) {
  const size = imageSizeFromBase64(data);
  if (!size) return Math.ceil(Math.ceil(data.length * 0.75) / CHARACTERS_PER_TOKEN);
  return Math.ceil((size.width * size.height) / PIXELS_PER_IMAGE_TOKEN) + IMAGE_FRAMING_TOKENS;
}

export function estimateAiInputTokens(request: {
  systemInstruction?: string;
  contents: ReadonlyArray<{ parts: readonly AiContentPart[] }>;
}) {
  let characters = request.systemInstruction?.length ?? 0;
  let imageTokens = 0;
  for (const message of request.contents) {
    for (const part of message.parts) {
      if ("text" in part) characters += part.text.length;
      else imageTokens += estimateImageTokens(part.inlineData.data);
    }
  }
  return Math.ceil(characters / CHARACTERS_PER_TOKEN) + imageTokens;
}
