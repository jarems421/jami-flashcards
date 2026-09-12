import { describe, expect, it } from "vitest";
import {
  EXAM_SPECIFICATION_TOPICS,
  filterCanonicalTopicIds,
  servableExamSpecificationTopics,
} from "@/lib/practice/exam-specification-topics";

/**
 * Topics a student sees have to be the specification's own.
 *
 * Nothing ever wrote the collection the app read, so the drawer was empty on
 * every course. Extraction meanwhile kept whatever strings the model returned,
 * up to twenty a question and unchecked, which would have put invented topic
 * names in front of students as the board's own -- and silently narrowed a
 * topic-filtered session to the wrong questions.
 */
describe("the canonical topic catalogue", () => {
  it("serves nothing until a person has checked it", () => {
    for (const catalogue of EXAM_SPECIFICATION_TOPICS) {
      if (catalogue.verified) continue;
      expect(servableExamSpecificationTopics(catalogue.specificationId)).toBeUndefined();
    }
  });

  it("offers no topics for a specification it has never heard of", () => {
    expect(servableExamSpecificationTopics("not-a-spec")).toBeUndefined();
    expect(filterCanonicalTopicIds("not-a-spec", ["anything"])).toEqual({
      topicIds: [],
      rejected: ["anything"],
    });
  });

  /*
   * The drafts exist so an owner has something to check rather than something
   * to write. Until then they must behave exactly like no catalogue at all.
   */
  it("drops every suggestion while the catalogue is unverified", () => {
    const draft = EXAM_SPECIFICATION_TOPICS.find((entry) => !entry.verified);
    expect(draft).toBeDefined();
    const real = draft!.topics[0]!.id;
    expect(filterCanonicalTopicIds(draft!.specificationId, [real])).toEqual({
      topicIds: [],
      rejected: [real],
    });
  });

  /*
   * Exercised against the real function now that a checked catalogue exists.
   * This used to filter through a stand-in set, because with every catalogue
   * unverified there was nothing `filterCanonicalTopicIds` could be asked that
   * did not return empty -- so the test proved a `Set` works rather than that
   * the pipeline does.
   */
  it("keeps the specification's own ids and drops the rest", () => {
    expect(
      filterCanonicalTopicIds("8300", ["aqa-8300-algebra-sequences", "vibes-and-vectors"])
    ).toEqual({
      topicIds: ["aqa-8300-algebra-sequences"],
      rejected: ["vibes-and-vectors"],
    });
  });

  it("serves a catalogue once it has been checked", () => {
    const catalogue = servableExamSpecificationTopics("8300");
    expect(catalogue?.specificationId).toBe("8300");
    expect(catalogue?.topics.length).toBeGreaterThan(0);
  });

  /*
   * The grain the specification itself names, guarded so nobody quietly
   * flattens it back to six. Six topics is a picker where "Algebra" is a third
   * of the paper; subdividing the three areas that publish no subsections
   * would be Jami's structure wearing the board's name.
   */
  it("covers all six content areas of AQA GCSE Maths at the published grain", () => {
    const ids = servableExamSpecificationTopics("8300")!.topics.map((topic) => topic.id);
    // Matched on the area prefix rather than a substring: "mensuration"
    // contains "ratio", and a looser check counted it as one.
    const inArea = (area: string) => ids.filter((id) => id.startsWith(`aqa-8300-${area}`));
    expect(inArea("number")).toHaveLength(3);
    expect(inArea("algebra")).toHaveLength(4);
    expect(inArea("geometry")).toHaveLength(3);
    // Flat in the specification, so flat here.
    expect(inArea("ratio")).toHaveLength(1);
    expect(inArea("probability")).toHaveLength(1);
    expect(inArea("statistics")).toHaveLength(1);
    expect(ids).toHaveLength(13);
  });

  it("gives every topic a stable id that is not the board's section number", () => {
    for (const catalogue of EXAM_SPECIFICATION_TOPICS) {
      for (const topic of catalogue.topics) {
        expect(topic.id).toMatch(/^[a-z0-9-]+$/);
        expect(topic.id).not.toMatch(/^\d/);
        expect(topic.label.length).toBeGreaterThan(0);
      }
      expect(new Set(catalogue.topics.map((t) => t.id)).size).toBe(catalogue.topics.length);
    }
  });
});
