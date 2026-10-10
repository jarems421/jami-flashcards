import { describe, expect, it } from "vitest";
import { decodeInkDocument, encodeInkDocument, quantizeInkDocument } from "@/lib/ink/codec";
import { goldenInkDocument } from "./support/ink-golden";

/*
 * THESE STRINGS ARE THE STORED FORMAT. Pages saved by every past build are
 * read with this decoder, so the text below must never change. If a test here
 * fails, the encoder or decoder changed behaviour: fix the code, not the
 * literal. New kinds get new golden strings beside these.
 */
const GOLDEN_J3 =
  "j3:AwMIAQlmaWxsLW9ubHkBFQQBwAKABQKABQACAJAFBQH_AAD__wELc3Ryb2tlLW9ubHkAIgMBAAADoAGgAaABAKABnwEEoAGfAaABoAECAAD_gEgCAoABBGJvdGgBJgYBgBmAGQKAGQACAIAZBQGAGYAZAsACwAIDAIAA_wAAAP8gAAH_AgRsaW5lAQwAAAD_QAEgQOBKyGMCBWFycm93AQ_ICh7_YALAcICWAcAMwAwCB3BvbHlnb24BEAAAAP8wAwMAAIAZAL8MgBQCB2VsbGlwc2UBEgAAAP8gBMBwgJYBiA_AB4CABAkGZnV0dXJlAQQBAgP6";

describe("ink codec golden bytes", () => {
  it("encodes the sample document to exactly the stored text", () => {
    expect(encodeInkDocument(goldenInkDocument())).toBe(GOLDEN_J3);
  });

  it("decodes the stored text to the sample document, every kind included", () => {
    const decoded = decodeInkDocument(GOLDEN_J3);
    expect(decoded).toEqual(quantizeInkDocument(goldenInkDocument()));
    expect(decoded?.items.map((item) => item.kind)).toEqual([
      "outline",
      "outline",
      "outline",
      "shape",
      "shape",
      "shape",
      "shape",
      "unknown",
    ]);
  });

  it("re-encodes the stored text unchanged", () => {
    const decoded = decodeInkDocument(GOLDEN_J3);
    expect(decoded && encodeInkDocument(decoded)).toBe(GOLDEN_J3);
  });
});
