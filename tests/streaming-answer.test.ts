import { describe, expect, it } from "vitest";
import { extractStreamingAnswer } from "@/lib/ai/streaming-answer";

/**
 * The assistant streams structured JSON, so the client sees the answer field
 * long before the object closes. Everything here is a prefix of a valid
 * response, which is exactly what arrives mid-stream.
 */
describe("extractStreamingAnswer", () => {
  it("returns nothing until the field has started", () => {
    expect(extractStreamingAnswer("")).toBe("");
    expect(extractStreamingAnswer("{")).toBe("");
    expect(extractStreamingAnswer('{"ans')).toBe("");
    expect(extractStreamingAnswer('{"answer":"')).toBe("");
  });

  it("returns the answer so far while the string is still open", () => {
    expect(extractStreamingAnswer('{"answer":"Photosynthesis is')).toBe(
      "Photosynthesis is"
    );
  });

  it("returns the whole answer once the string closes", () => {
    expect(
      extractStreamingAnswer('{"answer":"All done.","sourceRefs":["S1"]}')
    ).toBe("All done.");
  });

  it("does not stop at an escaped quote", () => {
    expect(extractStreamingAnswer('{"answer":"She said \\"go\\" firmly')).toBe(
      'She said "go" firmly'
    );
  });

  it("handles an escaped backslash before a closing quote", () => {
    expect(extractStreamingAnswer('{"answer":"path\\\\","sourceRefs":[]}')).toBe(
      "path\\"
    );
  });

  it("unescapes newlines and LaTeX backslashes", () => {
    expect(extractStreamingAnswer('{"answer":"Line one\\nUse $\\\\frac{1}{2}$')).toBe(
      "Line one\nUse $\\frac{1}{2}$",
    );
  });

  it("falls back to the last safe boundary on a half-arrived escape", () => {
    expect(extractStreamingAnswer('{"answer":"Nearly there\\u00e')).toBe(
      "Nearly there"
    );
  });

  it("tolerates whitespace around the key", () => {
    expect(extractStreamingAnswer('{ "answer" : "Spaced out')).toBe("Spaced out");
  });

  it("ignores a document whose answer field has not appeared yet", () => {
    expect(extractStreamingAnswer('{"sourceRefs":["S1"],"usedCurrentContext":true')).toBe(
      ""
    );
  });
});
