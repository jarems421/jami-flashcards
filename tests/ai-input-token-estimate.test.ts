import { describe, expect, it } from "vitest";
import { getAiInputTokenCap } from "@/lib/ai/budgets";
import {
  estimateAiInputTokens,
  estimateImageTokens,
  imageSizeFromBase64,
} from "@/lib/ai/input-token-estimate";

/** A PNG header for the given size, padded out to a realistic file size. */
function png(width: number, height: number, totalBytes = 64) {
  const bytes = Buffer.alloc(Math.max(33, totalBytes));
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "latin1");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  // Compressed ink does not repeat, so the padding should not either.
  for (let index = 33; index < bytes.length; index += 1) bytes[index] = (index * 131) % 251;
  return bytes.toString("base64");
}

/** A JPEG whose frame header sits behind an application segment. */
function jpeg(width: number, height: number) {
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14)]);
  const sof0 = Buffer.alloc(19);
  sof0.writeUInt16BE(0xffc0, 0);
  sof0.writeUInt16BE(17, 2);
  sof0[4] = 8;
  sof0.writeUInt16BE(height, 5);
  sof0.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof0]).toString("base64");
}

function webpExtended(width: number, height: number) {
  const bytes = Buffer.alloc(40);
  bytes.write("RIFF", 0, "latin1");
  bytes.write("WEBP", 8, "latin1");
  bytes.write("VP8X", 12, "latin1");
  bytes.writeUIntLE(width - 1, 24, 3);
  bytes.writeUIntLE(height - 1, 27, 3);
  return bytes.toString("base64");
}

describe("imageSizeFromBase64", () => {
  it("reads PNG, JPEG and WebP sizes from their headers", () => {
    expect(imageSizeFromBase64(png(1200, 1653))).toEqual({ width: 1200, height: 1653 });
    expect(imageSizeFromBase64(jpeg(640, 480))).toEqual({ width: 640, height: 480 });
    expect(imageSizeFromBase64(webpExtended(2000, 1400))).toEqual({ width: 2000, height: 1400 });
  });

  it("does not guess at something it cannot read", () => {
    expect(imageSizeFromBase64(Buffer.alloc(100).toString("base64"))).toBeNull();
  });
});

/*
 * Every exam answer submitted with working was refused as "too large to mark"
 * before a model saw it. The sheet is 1200 x 1653, and a sheet of handwriting
 * compresses to a few hundred kilobytes -- counted as text, that alone was
 * several times the 32,000-token marking ceiling.
 */
describe("counting an image", () => {
  it("counts a working sheet by its pixels, not by how it compressed", () => {
    const sheet = png(1200, 1653, 400_000);
    const tokens = estimateImageTokens(sheet);
    expect(tokens).toBeGreaterThan(2_000);
    expect(tokens).toBeLessThan(3_000);
    // The same image at a tenth of the bytes costs the same.
    expect(estimateImageTokens(png(1200, 1653, 40_000))).toBe(tokens);
  });

  it("still counts an unreadable image conservatively, by its bytes", () => {
    const unknown = Buffer.alloc(35_000).toString("base64");
    expect(estimateImageTokens(unknown)).toBeGreaterThanOrEqual(10_000);
  });

  it("lets a marking request carrying a full sheet of working fit the marking ceiling", () => {
    const cap = getAiInputTokenCap("examQuestionMarking");
    const request = {
      systemInstruction: "You are Jami's primary assessment marker.",
      contents: [{
        parts: [
          // The guide, scheme and marking prompt, generously.
          { text: "g".repeat(30_000) },
          { text: "Original question asset: Figure 1." },
          { inlineData: { mimeType: "image/png", data: png(1600, 900, 250_000) } },
          { text: "The student's typed answer." },
          { inlineData: { mimeType: "image/png", data: png(1200, 1653, 400_000) } },
        ],
      }],
    };
    expect(cap).not.toBeNull();
    expect(estimateAiInputTokens(request)).toBeLessThan(cap!);
  });
});

describe("counting text", () => {
  it("is unchanged", () => {
    expect(
      estimateAiInputTokens({ systemInstruction: "", contents: [{ parts: [{ text: "x".repeat(3_500) }] }] })
    ).toBe(1_000);
  });
});
