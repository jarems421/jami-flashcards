import { describe, expect, it } from "vitest";
import {
  formatEvidencePassages,
  getPinnedPassageLimit,
  longestCopiedRun,
  MAX_WHOLE_SOURCE_READS,
  planSourceEvidence,
  type EvidencePassage,
} from "@/lib/ai/source-evidence";

function passage(
  sourceId: string,
  chunkIndex: number,
  distance: number | undefined,
  length = 1_000
): EvidencePassage {
  return {
    id: `${sourceId}-${chunkIndex}`,
    sourceId,
    chunkIndex,
    distance,
    text: `${sourceId} passage ${chunkIndex} `.padEnd(length, "x"),
  };
}

describe("what each source contributes to a question", () => {
  it("leaves out an indexed source the search found nothing relevant in, instead of reading it whole", () => {
    const plans = planSourceEvidence({
      sources: [
        { id: "notes", pinned: false, indexed: true },
        { id: "unrelated", pinned: false, indexed: true },
      ],
      passages: [passage("notes", 3, 0.2)],
    });

    expect(plans).toEqual([
      expect.objectContaining({ sourceId: "notes", kind: "passages" }),
      { sourceId: "unrelated", kind: "skip", reason: "not_relevant" },
    ]);
  });

  it("reads a source whole when it has no index, or when the index could not be searched", () => {
    expect(
      planSourceEvidence({
        sources: [{ id: "new-upload", pinned: true, indexed: false }],
        passages: [],
      })
    ).toEqual([{ sourceId: "new-upload", kind: "whole" }]);

    expect(
      planSourceEvidence({
        sources: [{ id: "indexed", pinned: true, indexed: true }],
        passages: [],
        retrievalFailed: true,
      })
    ).toEqual([{ sourceId: "indexed", kind: "whole" }]);
  });

  it("reads at most five sources whole, chosen sources first", () => {
    const sources = [
      ...Array.from({ length: 4 }, (_, index) => ({
        id: `related-${index}`,
        pinned: false,
        indexed: false,
      })),
      ...Array.from({ length: 4 }, (_, index) => ({
        id: `chosen-${index}`,
        pinned: true,
        indexed: false,
      })),
    ];
    const plans = planSourceEvidence({ sources, passages: [] });
    const whole = plans.filter((plan) => plan.kind === "whole").map((plan) => plan.sourceId);

    expect(whole).toHaveLength(MAX_WHOLE_SOURCE_READS);
    expect(whole.filter((id) => id.startsWith("chosen"))).toHaveLength(4);
    expect(plans.filter((plan) => plan.kind === "skip")).toEqual(
      Array.from({ length: 3 }, () =>
        expect.objectContaining({ kind: "skip", reason: "whole_read_limit" })
      )
    );
    // The plan keeps the order the sources were given, so S-references stay stable.
    expect(plans.map((plan) => plan.sourceId)).toEqual(sources.map((source) => source.id));
  });

  it("hears from every chosen source before any one of them gets a second passage", () => {
    const sources = Array.from({ length: 15 }, (_, index) => ({
      id: `source-${index}`,
      pinned: true,
      indexed: true,
    }));
    // Source 0 matches far better than the rest and has many passages.
    const passages = [
      ...Array.from({ length: 8 }, (_, chunk) => passage("source-0", chunk, 0.05, 4_000)),
      ...sources.slice(1).map((source) => passage(source.id, 0, 0.4, 3_000)),
    ];
    const plans = planSourceEvidence({ sources, passages, characterBudget: 48_000 });

    expect(plans.every((plan) => plan.kind === "passages")).toBe(true);
    const first = plans[0];
    expect(first.kind === "passages" ? first.passages.length : 0).toBeLessThan(8);
  });

  it("puts a source's passages back into reading order", () => {
    const [plan] = planSourceEvidence({
      sources: [{ id: "book", pinned: true, indexed: true }],
      passages: [passage("book", 9, 0.1), passage("book", 2, 0.3), passage("book", 10, undefined)],
    });

    expect(plan.kind === "passages" ? plan.passages.map((item) => item.chunkIndex) : []).toEqual([
      2, 9, 10,
    ]);
  });

  it("searches one source thoroughly and many sources a little each", () => {
    expect(getPinnedPassageLimit(1)).toBeGreaterThan(getPinnedPassageLimit(4));
    expect(getPinnedPassageLimit(15)).toBeGreaterThanOrEqual(2);
  });

  it("frames passages as material to understand, with where they came from", () => {
    const text = formatEvidencePassages([
      { ...passage("book", 1, 0.1, 10), pageStart: 4, pageEnd: 5, heading: "Enzymes" },
    ]);

    expect(text).toContain("in your own words");
    expect(text).toContain("[pp. 4-5 · Enzymes]");
  });
});

describe("measuring how much of an answer was copied", () => {
  const source =
    "Enzymes are biological catalysts that speed up the rate of chemical reactions without being used up themselves in the process.";

  it("finds a lifted sentence, ignoring case and punctuation", () => {
    const answer =
      "Put simply: enzymes are biological catalysts, that speed up the rate of chemical reactions without being used up.";

    expect(longestCopiedRun(answer, [source])).toBeGreaterThanOrEqual(15);
  });

  it("is zero for an answer that teaches the same idea in its own words", () => {
    const answer =
      "An enzyme lowers the energy a reaction needs to get going, so it happens faster, and the enzyme is free to do it again afterwards.";

    expect(longestCopiedRun(answer, [source])).toBe(0);
  });
});
