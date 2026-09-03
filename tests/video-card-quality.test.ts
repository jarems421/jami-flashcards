import { describe, expect, it } from "vitest";
import {
  clampTimestamp,
  containment,
  contentTokens,
  dedupeNearDuplicates,
  hasSubstantiveBack,
  indexEvidence,
  measureEvidenceSupport,
  partitionByEvidenceSupport,
  rankBySupport,
} from "@/lib/ai/video-card-quality";

const evidence = [
  {
    id: "osmosis",
    summary: "The tutor explains osmosis across a partially permeable membrane",
    facts: ["Water moves from high water potential to low water potential", "The membrane is partially permeable"],
  },
  {
    id: "mitosis",
    summary: "The tutor explains the stages of mitosis",
    facts: ["Chromosomes line up along the equator before they separate"],
  },
];
const index = indexEvidence(evidence);

function card(id: string, front: string, back: string, evidenceIds = ["osmosis"]) {
  return { id, front, back, evidenceIds };
}

describe("video card quality", () => {
  describe("contentTokens", () => {
    it("keeps the words that carry meaning and drops the ones that match everything", () => {
      const tokens = contentTokens("What is the value of that measurement?");
      expect(tokens.has("value")).toBe(true);
      expect(tokens.has("measurement")).toBe(true);
      expect(tokens.has("what")).toBe(false);
      expect(tokens.has("the")).toBe(false);
    });

    it("keeps numbers however short, because in a lesson they are the point", () => {
      expect([...contentTokens("Heat it to 37 degrees")]).toEqual(expect.arrayContaining(["37", "heat", "degrees"]));
    });
  });

  describe("measureEvidenceSupport", () => {
    it("scores a card that says what its evidence says", () => {
      const support = measureEvidenceSupport(
        card("a", "Which way does water move?", "Water moves from high water potential to low water potential."),
        index
      );
      expect(support).toBeGreaterThan(0.8);
    });

    /*
     * The failure the old checks could not see. This card cites evidence that
     * exists, so every reference-level test passes, and it still asserts
     * something nobody said at that timestamp.
     */
    it("scores a card that cites real evidence and then says something else", () => {
      const support = measureEvidenceSupport(
        card("a", "What did the tutor say?", "Ribosomes assemble amino acids into polypeptide chains."),
        index
      );
      expect(support).toBeLessThan(0.18);
    });

    it("scores zero when nothing it cites resolves", () => {
      expect(measureEvidenceSupport(card("a", "Question", "Answer", ["gone"]), index)).toBe(0);
    });
  });

  describe("hasSubstantiveBack", () => {
    it("rejects an answer with nothing in it", () => {
      expect(hasSubstantiveBack(card("a", "Does water move?", "Yes."))).toBe(false);
    });

    it("rejects an answer that only repeats the question", () => {
      expect(hasSubstantiveBack(card("a", "Osmosis moves water across a membrane", "Osmosis moves water"))).toBe(false);
    });

    it("accepts an answer that adds something", () => {
      expect(
        hasSubstantiveBack(card("a", "What is osmosis?", "Water moving down a water potential gradient."))
      ).toBe(true);
    });
  });

  describe("containment", () => {
    it("sees one question sitting inside another", () => {
      expect(containment(contentTokens("What is osmosis?"), contentTokens("Define osmosis"))).toBe(1);
    });

    it("separates two questions built on the same frame", () => {
      expect(
        containment(contentTokens("How does temperature affect osmosis?"), contentTokens("How does temperature affect mitosis?"))
      ).toBeLessThan(0.8);
    });
  });

  describe("dedupeNearDuplicates", () => {
    it("removes a card that asks what another card already asked", () => {
      const { kept, removed } = dedupeNearDuplicates(
        [
          card("a", "What is osmosis?", "Water moves from high water potential to low water potential."),
          card("b", "Define osmosis", "Water moves from high water potential to low water potential."),
        ],
        index
      );
      expect(kept).toHaveLength(1);
      expect(removed).toHaveLength(1);
    });

    it("keeps the better-supported of a duplicate pair whichever came first", () => {
      const { kept } = dedupeNearDuplicates(
        [
          card("weak", "What is osmosis?", "The movement of water from high water potential to low water potential."),
          card(
            "strong",
            "Define osmosis",
            "Movement of water from a high water potential to a low water potential across a partially permeable membrane."
          ),
        ],
        index
      );
      expect(kept.map((entry) => entry.id)).toEqual(["strong"]);
    });

    it("keeps two cards that ask the same question and give genuinely different answers", () => {
      const { kept } = dedupeNearDuplicates(
        [
          card("a", "What is osmosis?", "Water moves from high water potential to low water potential."),
          card("b", "Define osmosis", "The membrane involved is partially permeable to solute particles."),
        ],
        index
      );
      expect(kept).toHaveLength(2);
    });

    /*
     * The false positive worth guarding. A batch built on one sentence frame is
     * normal in a lesson, and merging it would delete most of the content.
     */
    it("leaves cards that share a template but ask about different things", () => {
      const { kept } = dedupeNearDuplicates(
        [
          card("a", "How does temperature affect osmosis?", "Osmosis speeds up as temperature rises."),
          card("b", "How does temperature affect mitosis?", "Mitosis speeds up as temperature rises.", ["mitosis"]),
        ],
        index
      );
      expect(kept).toHaveLength(2);
    });
  });

  describe("partitionByEvidenceSupport", () => {
    it("separates supported, weak, and empty answers", () => {
      const result = partitionByEvidenceSupport(
        [
          card("good", "Which way does water move?", "Water moves from high water potential to low water potential."),
          card("weak", "What else?", "Ribosomes assemble amino acids into polypeptide chains."),
          card("empty", "Does water move?", "Yes."),
        ],
        index
      );

      expect(result.supported.map((entry) => entry.id)).toEqual(["good"]);
      expect(result.weak.map((entry) => entry.id)).toEqual(["weak"]);
      expect(result.empty.map((entry) => entry.id)).toEqual(["empty"]);
    });
  });

  describe("rankBySupport", () => {
    it("puts the best-grounded first and keeps the original order otherwise", () => {
      const ranked = rankBySupport(
        [
          card("weak", "What else?", "Ribosomes assemble amino acids into polypeptide chains."),
          card("good", "Which way?", "Water moves from high water potential to low water potential."),
        ],
        index
      );
      expect(ranked.map((entry) => entry.id)).toEqual(["good", "weak"]);
    });
  });

  describe("clampTimestamp", () => {
    it("pulls a hallucinated timestamp back inside the video", () => {
      expect(clampTimestamp(99999, 600)).toBe(600);
    });

    it("refuses to go before the start", () => {
      expect(clampTimestamp(-40, 600)).toBe(0);
    });

    it("leaves a real timestamp alone", () => {
      expect(clampTimestamp(125, 600)).toBe(125);
    });

    it("has nothing to clamp against when the duration is unknown", () => {
      expect(clampTimestamp(99999, 0)).toBe(99999);
    });

    it("returns nothing for a value that is not a number", () => {
      expect(clampTimestamp("120", 600)).toBeUndefined();
      expect(clampTimestamp(Number.NaN, 600)).toBeUndefined();
      expect(clampTimestamp(undefined, 600)).toBeUndefined();
    });
  });
});
