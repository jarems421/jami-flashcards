import { describe, expect, it } from "vitest";
import {
  EXAM_SPECIFICATION_OUTLINES,
  outlineConcepts,
  outlineLabel,
  outlineSlug,
  outlineTopics,
  type SpecificationOutline,
} from "@/lib/practice/exam-specification-outlines";
import {
  examSpecificationConceptCatalogue,
  servableExamSpecificationConcepts,
} from "@/lib/practice/exam-specification-concepts";
import {
  examSpecificationTopicCatalogue,
  servableExamSpecificationTopics,
} from "@/lib/practice/exam-specification-topics";

/**
 * Science catalogues derived from the specification's own numbered headings.
 *
 * The ids end up stored on questions, so they have to be unique and must not
 * move when a board retitles a heading; and a draft derived this way is still
 * a draft until a person has checked it.
 */

const SAMPLE: SpecificationOutline = {
  specificationId: "test",
  idPrefix: "board-test",
  source: "test",
  groups: [
    {
      label: "Physics",
      sections: [
        ["6.5", "Forces", [
          ["6.5.2", "Work done and energy transfer"],
          ["6.5.5", "Momentum (HT only)", [["6.5.5.1", "Conservation of momentum"]]],
        ]],
      ],
    },
  ],
};

describe("specification outlines", () => {
  it("labels a heading as a student reads it, without the board's markers", () => {
    expect(outlineLabel("Monoclonal antibodies (biology only) (HT only)")).toBe("Monoclonal antibodies");
    expect(outlineLabel("The development of the model of the atom (common content with physics)")).toBe(
      "The development of the model of the atom"
    );
    expect(outlineSlug("Forces, accelerations and Newton's Laws of motion")).toBe(
      "forces-accelerations-and-newtons-laws-of-motion"
    );
    expect(outlineSlug("Using concentrations of solutions in mol/dm³")).toBe(
      "using-concentrations-of-solutions-in-mol-dm3"
    );
  });

  it("makes sections topics and the finest headings beneath them concepts", () => {
    expect(outlineTopics(SAMPLE)).toEqual([{ id: "board-test-forces", label: "Physics: Forces" }]);
    expect(outlineConcepts(SAMPLE)).toEqual([
      {
        id: "board-test-forces-work-done-and-energy-transfer",
        parentTopicId: "board-test-forces",
        label: "Work done and energy transfer",
        reference: "6.5.2",
      },
      {
        id: "board-test-forces-conservation-of-momentum",
        parentTopicId: "board-test-forces",
        label: "Conservation of momentum",
        reference: "6.5.5.1",
        higherTierOnly: true,
      },
    ]);
  });

  it("keeps an id when its heading is retitled", () => {
    const retitled = { ...SAMPLE, slugOverrides: { "6.5": "motion-and-forces" } };
    expect(outlineTopics(retitled)[0]?.id).toBe("board-test-motion-and-forces");
    expect(outlineConcepts(retitled).every((concept) => concept.parentTopicId === "board-test-motion-and-forces")).toBe(true);
  });

  it.each(EXAM_SPECIFICATION_OUTLINES.map((outline) => [outline.specificationId, outline] as const))(
    "gives %s unique ids and unique references",
    (_specificationId, outline) => {
      const topics = outlineTopics(outline);
      const concepts = outlineConcepts(outline);
      expect(new Set(topics.map((topic) => topic.id)).size).toBe(topics.length);
      expect(new Set(concepts.map((concept) => concept.id)).size).toBe(concepts.length);
      expect(new Set(concepts.map((concept) => concept.reference)).size).toBe(concepts.length);
      for (const concept of concepts) {
        expect(concept.id).toMatch(/^[a-z0-9-]+$/);
        expect(concept.id.startsWith(`${concept.parentTopicId}-`)).toBe(true);
        expect(concept.label).not.toMatch(/only\)/i);
      }
    }
  );

  it("keeps the id the biology draft already used", () => {
    expect(examSpecificationTopicCatalogue("8461")?.topics.map((topic) => topic.id)).toContain(
      "aqa-8461-inheritance-variation-evolution"
    );
  });

  it("names a combined course's topics with their science", () => {
    const labels = examSpecificationTopicCatalogue("8464")?.topics.map((topic) => topic.label) ?? [];
    expect(labels).toContain("Chemistry: Atomic structure and the periodic table");
    expect(labels).toContain("Physics: Atomic structure");
    expect(examSpecificationConceptCatalogue("8464")?.concepts.map((concept) => concept.id)).toContain(
      "aqa-8464-using-resources-life-cycle-assessment"
    );
  });

  /*
   * Served exactly while checked, in both directions: the four sciences the
   * owner checked are served, and an outline added later is inert until it is.
   * Concepts need a checked topic list under them as well as their own check.
   */
  it("serves an outline's lists exactly while a person has checked them", () => {
    for (const outline of EXAM_SPECIFICATION_OUTLINES) {
      const topicsChecked = outline.checked?.topics === true;
      const conceptsChecked = outline.checked?.concepts === true;
      expect(Boolean(servableExamSpecificationTopics(outline.specificationId))).toBe(topicsChecked);
      expect(servableExamSpecificationConcepts(outline.specificationId).length > 0).toBe(
        topicsChecked && conceptsChecked
      );
      expect(examSpecificationConceptCatalogue(outline.specificationId)?.provenance).toBe(
        conceptsChecked ? "verified_specification" : "ai_suggested"
      );
    }
  });
});
