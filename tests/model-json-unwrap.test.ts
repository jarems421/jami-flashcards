import { describe, expect, it } from "vitest";
import { unwrapModelJsonObject } from "@/lib/ai/model-json";

/*
 * The readings a model actually produces when asked for JSON.
 *
 * This is the shape of a real bug rather than a hypothetical: the planning
 * conversation parsed its reply with a bare `JSON.parse`, so every answer that
 * arrived fenced or with a sentence in front of it was discarded, and the
 * student got a canned line back twice in a row as though they had said
 * nothing. Salvage is not a nicety here; it is the difference between the
 * feature working and appearing broken.
 */
describe("unwrapping a model's JSON object", () => {
  it("leaves clean JSON exactly as it is", () => {
    expect(unwrapModelJsonObject('{"reply":"hello","plan":""}')).toBe(
      '{"reply":"hello","plan":""}'
    );
  });

  it("strips a code fence", () => {
    expect(unwrapModelJsonObject('```json\n{"reply":"hi"}\n```')).toBe('{"reply":"hi"}');
    expect(unwrapModelJsonObject('```\n{"reply":"hi"}\n```')).toBe('{"reply":"hi"}');
  });

  it("finds the object behind a sentence", () => {
    expect(unwrapModelJsonObject('Sure! Here is the plan:\n{"reply":"hi"}')).toBe(
      '{"reply":"hi"}'
    );
  });

  it("keeps a nested object whole", () => {
    const nested = '{"reply":"hi","plan":"{\\"days\\":[1,3]}"}';
    expect(unwrapModelJsonObject(`\`\`\`json\n${nested}\n\`\`\``)).toBe(nested);
  });

  it("hands back anything with no object in it, so the caller reports the original", () => {
    expect(unwrapModelJsonObject("I could not do that.")).toBe("I could not do that.");
    expect(unwrapModelJsonObject("")).toBe("");
  });
});
