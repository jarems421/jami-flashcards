import { describe, expect, it } from "vitest";
import { parseAndValidateVideoGeneration } from "@/services/ai/video-card-generation.server";

function cards(count: number, evidenceId = "concept") {
  return Array.from({ length: count }, (_, index) => ({ id: `c${index}`, front: `What is concept ${index}?`, back: `Supported explanation ${index}.`, evidenceIds: [evidenceId], timestampSeconds: index * 5 }));
}

describe("video card generation validation", () => {
  it("flags an unaccounted-for referenced visual", () => {
    const parsed = parseAndValidateVideoGeneration(JSON.stringify({ title: "Lesson", evidence: [{ id: "concept", kind: "concept", summary: "Teaching", facts: ["Fact"], referenced: false, timestampSeconds: 0 }, { id: "graph", kind: "visual", visualType: "graph", classification: "uncertain", summary: "A referenced graph", facts: [], referenced: true, timestampSeconds: 42 }], cards: cards(12), warnings: [] }), "standard");
    expect(parsed.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ timestampSeconds: 42, visualType: "graph" })]));
  });

  it("accepts an intentionally excluded practice question", () => {
    const parsed = parseAndValidateVideoGeneration(JSON.stringify({ title: "Lesson", evidence: [{ id: "concept", kind: "concept", summary: "Teaching", facts: ["Fact"], referenced: false, timestampSeconds: 0 }, { id: "practice", kind: "visual", visualType: "worked_example", classification: "practice_question", summary: "Standalone question", facts: [], referenced: true, exclusionReason: "The explanation introduced no reusable method.", timestampSeconds: 80 }], cards: cards(12), warnings: [] }), "standard");
    expect(parsed.warnings).toHaveLength(0);
  });

  it("rejects unsupported cards and an out-of-range batch", () => {
    expect(() => parseAndValidateVideoGeneration(JSON.stringify({ title: "Lesson", evidence: [], cards: cards(12, "missing"), warnings: [] }), "standard")).toThrow("card_count_out_of_range");
  });
});
