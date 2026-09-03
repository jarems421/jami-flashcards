import { beforeEach, describe, expect, it, vi } from "vitest";

const generateAiText = vi.fn();
vi.mock("@/lib/ai/provider-router", () => ({ generateAiText: (...args: unknown[]) => generateAiText(...args) }));

const {
  applyResolutions,
  collectFlaggedItems,
  parseAndValidateVideoGeneration,
  refineCardsWithPrivateRouter,
} = await import("@/services/ai/video-card-generation.server");

/*
 * Subjects rather than "concept 1, concept 2", because the checks under test
 * read the words. Formulaic fixtures would either all look like duplicates of
 * each other or all look unsupported, and would prove nothing either way.
 */
const SUBJECTS = [
  "osmosis", "mitosis", "photosynthesis", "respiration", "diffusion", "enzymes", "transpiration",
  "glycolysis", "meiosis", "translation", "transcription", "homeostasis", "excretion", "digestion",
  "circulation", "immunity", "hormones", "neurons", "genetics", "evolution", "ecology", "carbon",
  "nitrogen", "hydration", "protein", "lipids", "glucose", "starch", "chlorophyll", "stomata",
  "xylem", "phloem", "ribosomes", "mitochondria", "nucleus", "vacuoles", "plasmids", "antibodies",
  "platelets", "keratin",
];

/** A batch that passes every deterministic check, of whatever size is asked for. */
function batch(count: number) {
  const subjects = SUBJECTS.slice(0, count);
  return {
    title: "Lesson",
    evidence: subjects.map((subject, index) => ({
      id: `e${index}`,
      kind: "concept",
      summary: `The tutor explains how ${subject} responds to temperature`,
      facts: [`${subject} speeds up as temperature rises`, `${subject} needs a large surface area`],
      referenced: false,
      timestampSeconds: index * 10,
    })),
    cards: subjects.map((subject, index) => ({
      id: `c${index}`,
      front: `How does temperature affect ${subject}?`,
      back: `${subject} speeds up as temperature rises, and needs a large surface area.`,
      evidenceIds: [`e${index}`],
      timestampSeconds: index * 10,
    })),
    warnings: [],
  };
}

const json = (value: unknown) => JSON.stringify(value);

describe("video card generation validation", () => {
  beforeEach(() => generateAiText.mockReset());

  describe("what reaches the student", () => {
    it("flags an unaccounted-for referenced visual", () => {
      const source = batch(12);
      source.evidence.push({
        id: "graph",
        kind: "visual",
        visualType: "graph",
        classification: "uncertain",
        summary: "A referenced graph",
        facts: [],
        referenced: true,
        timestampSeconds: 42,
      } as never);

      const parsed = parseAndValidateVideoGeneration(json(source), "standard");
      expect(parsed.warnings).toEqual(
        expect.arrayContaining([expect.objectContaining({ timestampSeconds: 42, visualType: "graph" })])
      );
    });

    it("accepts an intentionally excluded practice question", () => {
      const source = batch(12);
      source.evidence.push({
        id: "practice",
        kind: "visual",
        visualType: "worked_example",
        classification: "practice_question",
        summary: "Standalone question",
        facts: [],
        referenced: true,
        exclusionReason: "The explanation introduced no reusable method.",
        timestampSeconds: 80,
      } as never);

      expect(parseAndValidateVideoGeneration(json(source), "standard").warnings).toHaveLength(0);
    });

    it("refuses a batch in which nothing is grounded", () => {
      const source = batch(12);
      source.cards = source.cards.map((card) => ({ ...card, evidenceIds: ["missing"] }));
      expect(() => parseAndValidateVideoGeneration(json(source), "standard")).toThrow("no_usable_cards");
    });

    it("drops a card that asks what another card already asked", () => {
      const source = batch(12);
      source.cards.push({
        id: "duplicate",
        front: "What does temperature do to osmosis?",
        back: "Osmosis speeds up as temperature rises, and needs a large surface area.",
        evidenceIds: ["e0"],
        timestampSeconds: 0,
      });

      const parsed = parseAndValidateVideoGeneration(json(source), "standard");
      expect(parsed.cards.map((card) => card.id)).not.toContain("duplicate");
      expect(parsed.cards).toHaveLength(12);
    });

    it("drops an answer that answers nothing", () => {
      const source = batch(12);
      source.cards.push({
        id: "empty",
        front: "Does temperature matter?",
        back: "Yes.",
        evidenceIds: ["e0"],
        timestampSeconds: 0,
      });

      expect(parseAndValidateVideoGeneration(json(source), "standard").cards.map((card) => card.id)).not.toContain(
        "empty"
      );
    });

    /*
     * Kept, not deleted: word overlap is too blunt a measure to throw work away
     * on. Naming it is what lets the second look at the video settle it.
     */
    it("keeps a card the evidence does not support, and flags it for another look", () => {
      const source = batch(12);
      source.cards.push({
        id: "wandered",
        front: "What did the tutor add at the end?",
        back: "Napoleon was defeated at Waterloo in 1815.",
        evidenceIds: ["e0"],
        timestampSeconds: 5,
      });

      const parsed = parseAndValidateVideoGeneration(json(source), "standard");
      expect(parsed.cards.map((card) => card.id)).toContain("wandered");
      expect(parsed.weakCardIds).toEqual(["wandered"]);
    });
  });

  describe("the coverage range", () => {
    it("fails a short batch while it is still judging the provider", () => {
      // Eight cards for a twelve-card minimum: reason enough to fall back to a
      // stronger model rather than accept what came back.
      expect(() => parseAndValidateVideoGeneration(json(batch(8)), "standard")).toThrow("card_count_out_of_range");
    });

    it("delivers a short batch once the video has already been read", () => {
      const parsed = parseAndValidateVideoGeneration(json(batch(8)), "standard", { enforceMinimum: false });
      expect(parsed.cards).toHaveLength(8);
      expect(parsed.warnings[0]?.message).toContain("8 well-grounded cards");
    });

    /*
     * This used to throw, which made the trim on the following line
     * unreachable and failed an import that only needed cutting down.
     */
    it("trims an over-generous batch instead of failing it", () => {
      const parsed = parseAndValidateVideoGeneration(json(batch(25)), "standard");
      expect(parsed.cards).toHaveLength(20);
    });
  });

  describe("timestamps", () => {
    it("pulls a hallucinated timestamp back inside the video", () => {
      const source = batch(12);
      source.cards[0].timestampSeconds = 99999;
      source.evidence[0].timestampSeconds = 99999;

      const parsed = parseAndValidateVideoGeneration(json(source), "standard", { durationSeconds: 600 });
      expect(parsed.cards[0].timestampSeconds).toBe(600);
      expect(parsed.evidence[0].timestampSeconds).toBe(600);
    });

    it("leaves a real timestamp alone", () => {
      const parsed = parseAndValidateVideoGeneration(json(batch(12)), "standard", { durationSeconds: 600 });
      expect(parsed.cards[1].timestampSeconds).toBe(10);
    });
  });

  describe("the second look", () => {
    it("finds nothing to check on a clean import", () => {
      expect(collectFlaggedItems(parseAndValidateVideoGeneration(json(batch(12)), "standard"))).toEqual([]);
    });

    it("collects the weak card, the uncertain moment, and the visual nobody covered", () => {
      const source = batch(12);
      source.cards.push({
        id: "wandered",
        front: "What did the tutor add at the end?",
        back: "Napoleon was defeated at Waterloo in 1815.",
        evidenceIds: ["e0"],
        timestampSeconds: 5,
      });
      source.evidence.push(
        { id: "unsure", kind: "concept", classification: "uncertain", summary: "Something half-said", facts: [], referenced: false, timestampSeconds: 100 } as never,
        { id: "chart", kind: "visual", visualType: "table", classification: "core_teaching", summary: "A table nobody covered", facts: [], referenced: true, timestampSeconds: 200 } as never
      );

      const flagged = collectFlaggedItems(parseAndValidateVideoGeneration(json(source), "standard"));
      expect(flagged.map((item) => item.kind)).toEqual([
        "card_weakly_supported",
        "evidence_uncertain",
        "visual_uncovered",
      ]);
    });

    it("applies a correction, a drop, and a confirmation", () => {
      const parsed = parseAndValidateVideoGeneration(json(batch(12)), "standard");
      const withWarning = {
        ...parsed,
        warnings: [{ id: "w1", message: "Not sure about this one.", timestampSeconds: 0 }],
        weakCardIds: ["c1"],
      };

      const applied = applyResolutions(withWarning, [
        { target: "c0", action: "correct", front: "Corrected question?", back: "Corrected answer." },
        { target: "c2", action: "drop" },
        { target: "e0", action: "confirm" },
      ]);

      expect(applied.cards[0]).toMatchObject({ front: "Corrected question?", back: "Corrected answer." });
      expect(applied.cards.map((card) => card.id)).not.toContain("c2");
      // The warning sat on the moment the second look just settled.
      expect(applied.warnings).toHaveLength(0);
    });

    it("leaves a card alone when the second look only confirmed it", () => {
      const parsed = parseAndValidateVideoGeneration(json(batch(12)), "standard");
      const applied = applyResolutions(parsed, [{ target: "c0", action: "confirm" }]);
      expect(applied.cards[0]).toEqual(parsed.cards[0]);
    });
  });

  describe("the refine pass", () => {
    /*
     * The defect this exists to prevent. The refiner was re-checked against the
     * same coverage range, so removing enough weak cards to fall under the
     * minimum threw, was swallowed, and shipped the unrefined batch instead --
     * the harder the quality pass worked, the likelier its work was discarded.
     */
    it("keeps a refined batch that is smaller than the coverage minimum", async () => {
      const original = parseAndValidateVideoGeneration(json(batch(16)), "standard");
      generateAiText.mockResolvedValue(json({ ...batch(10), title: "Lesson" }));

      const result = await refineCardsWithPrivateRouter(original, "standard", 600);

      expect(result.applied).toBe(true);
      expect(result.generation.cards).toHaveLength(10);
    });

    it("keeps the original when the refiner returns a mangled batch", async () => {
      const original = parseAndValidateVideoGeneration(json(batch(16)), "standard");
      generateAiText.mockResolvedValue(json(batch(3)));

      const result = await refineCardsWithPrivateRouter(original, "standard", 600);

      expect(result.applied).toBe(false);
      expect(result.generation).toBe(original);
    });

    it("keeps the original when the refiner returns something unusable", async () => {
      const original = parseAndValidateVideoGeneration(json(batch(16)), "standard");
      generateAiText.mockResolvedValue("I could not complete that request.");

      const result = await refineCardsWithPrivateRouter(original, "standard", 600);

      expect(result.applied).toBe(false);
      expect(result.generation).toBe(original);
    });
  });
});
