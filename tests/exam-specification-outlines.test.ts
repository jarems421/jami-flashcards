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
import { EXAM_CORPUS_TARGETS } from "@/lib/practice/exam-corpus-plan";
import { examCoursePapers } from "@/lib/practice/exam-papers";

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
    expect(outlineTopics(SAMPLE)).toEqual([
      { id: "board-test-forces", label: "Physics: Forces", group: "Physics" },
    ]);
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
      // Only where the board prints one: a language specification numbers
      // nothing, and blank references would all collide.
      const references = concepts.map((concept) => concept.reference).filter(Boolean);
      expect(new Set(references).size).toBe(references.length);
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

/**
 * A course sat as more than one subject, kept apart in Practice.
 *
 * Combined Science is one qualification and three sciences. Its topics and its
 * papers both had the science in their wording and nowhere else, so the picker
 * offered twenty-one topics in one flat run and a session drew Biology,
 * Chemistry and Physics at once. Both sides now carry the part they belong to,
 * and the filter only works while the two sides agree on its name.
 */
describe("a combined course's parts", () => {
  const trilogy = servableExamSpecificationTopics("8464");
  const course = EXAM_CORPUS_TARGETS.find((entry) => entry.specificationId === "8464");

  it("puts every combined science topic in one of the three sciences", () => {
    expect(trilogy).toBeDefined();
    expect([...new Set(trilogy!.topics.map((topic) => topic.group))]).toEqual([
      "Biology",
      "Chemistry",
      "Physics",
    ]);
  });

  /* The label is stored on questions and sessions, so it stays as written. */
  it("leaves the label saying it too", () => {
    for (const topic of trilogy!.topics) {
      expect(topic.label.startsWith(`${topic.group}: `)).toBe(true);
    }
  });

  it("names a paper's part exactly as its topics name theirs", () => {
    expect(course).toBeDefined();
    const papers = examCoursePapers(
      course!.components.map((component) => ({
        componentCode: component.code,
        componentTitle: component.title,
        tier: component.tier ?? "",
      })),
      { tier: "Higher" }
    );
    expect([...new Set(papers.map((paper) => paper.group))]).toEqual([
      "Biology",
      "Chemistry",
      "Physics",
    ]);
  });

  /* A single-subject course has no parts, so no part picker appears on it. */
  it("gives a single-subject course no parts", () => {
    const maths = servableExamSpecificationTopics("8300");
    expect(maths!.topics.every((topic) => !topic.group)).toBe(true);
  });
});
