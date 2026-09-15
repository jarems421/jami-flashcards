import { describe, expect, it } from "vitest";
import {
  EXAM_SPECIFICATION_CONCEPTS,
  conceptParentTopicIds,
  examSpecificationConceptCatalogue,
  filterCanonicalConceptIds,
  servableExamSpecificationConcepts,
} from "@/lib/practice/exam-specification-concepts";
import {
  examSpecificationTopicCatalogue,
  servableExamSpecificationTopics,
} from "@/lib/practice/exam-specification-topics";

/**
 * Finer specification concepts: stable, attached to real topics, and inert
 * until a person has checked them.
 */
describe("specification concept catalogues", () => {
  it("serves nothing from a catalogue nobody has checked", () => {
    for (const catalogue of EXAM_SPECIFICATION_CONCEPTS) {
      if (catalogue.verified && catalogue.provenance === "verified_specification") continue;
      expect(servableExamSpecificationConcepts(catalogue.specificationId)).toEqual([]);
    }
    expect(servableExamSpecificationConcepts("not-a-spec")).toEqual([]);
  });

  it("labels an unchecked catalogue as an AI suggestion, never as the specification", () => {
    for (const catalogue of EXAM_SPECIFICATION_CONCEPTS) {
      if (!catalogue.verified) expect(catalogue.provenance).toBe("ai_suggested");
    }
  });

  it("keeps the topic catalogue's served topics untouched by concepts", () => {
    // Extraction, tagging, the topic picker and calibration all read this list.
    expect(servableExamSpecificationTopics("8300")?.topics).toHaveLength(13);
  });

  it("serves the checked AQA maths concepts beneath their checked topics", () => {
    const concepts = servableExamSpecificationConcepts("8300");
    expect(concepts).toHaveLength(97);
    const topicIds = new Set(servableExamSpecificationTopics("8300")!.topics.map((topic) => topic.id));
    expect(concepts.every((concept) => topicIds.has(concept.parentTopicId))).toBe(true);
  });

  /*
   * Pearson prints the same national subject content under the same codes, so
   * its concepts are AQA's statements under Pearson's own ids -- and stay
   * unserved until a person has compared them with the Pearson document.
   */
  it("gives Pearson maths the same statements under its own ids, unserved until checked", () => {
    const aqa = examSpecificationConceptCatalogue("8300")!.concepts;
    const pearson = examSpecificationConceptCatalogue("1MA1")!.concepts;
    expect(pearson.map((concept) => concept.reference)).toEqual(aqa.map((concept) => concept.reference));
    expect(pearson.map((concept) => concept.label)).toEqual(aqa.map((concept) => concept.label));
    expect(
      pearson.every(
        (concept) =>
          concept.id.startsWith("pearson-edexcel-1ma1-") && concept.parentTopicId.startsWith("pearson-edexcel-1ma1-")
      )
    ).toBe(true);
    expect(servableExamSpecificationConcepts("1MA1")).toEqual([]);
  });

  it("keeps the concept ids a question may claim and reports the rest", () => {
    expect(
      filterCanonicalConceptIds("8300", ["aqa-8300-algebra-quadratic-equations", "aqa-8300-algebra-vibes"])
    ).toEqual({ conceptIds: ["aqa-8300-algebra-quadratic-equations"], rejected: ["aqa-8300-algebra-vibes"] });
    // An unchecked catalogue behaves exactly like no catalogue.
    expect(filterCanonicalConceptIds("8461", ["aqa-8461-cell-biology-osmosis"])).toEqual({
      conceptIds: [],
      rejected: ["aqa-8461-cell-biology-osmosis"],
    });
  });

  it("finds the topic each concept sits under, once", () => {
    expect(
      conceptParentTopicIds("8300", [
        "aqa-8300-algebra-quadratic-equations",
        "aqa-8300-algebra-linear-equations",
        "not-a-concept",
      ])
    ).toEqual(["aqa-8300-algebra-solving-equations-and-inequalities"]);
  });

  it("attaches every concept to a topic its specification names, with stable unique ids", () => {
    for (const catalogue of EXAM_SPECIFICATION_CONCEPTS) {
      const topicIds = new Set(
        examSpecificationTopicCatalogue(catalogue.specificationId)?.topics.map((topic) => topic.id) ?? []
      );
      expect(topicIds.size).toBeGreaterThan(0);
      const ids = catalogue.concepts.map((entry) => entry.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const entry of catalogue.concepts) {
        expect(topicIds.has(entry.parentTopicId)).toBe(true);
        expect(topicIds.has(entry.id)).toBe(false);
        expect(entry.id).toMatch(/^[a-z0-9-]+$/);
        expect(entry.id).not.toMatch(/^\d/);
        expect(entry.label.trim().length).toBeGreaterThan(0);
      }
      const references = catalogue.concepts.flatMap((entry) => (entry.reference ? [entry.reference] : []));
      expect(new Set(references).size).toBe(references.length);
    }
  });
});
