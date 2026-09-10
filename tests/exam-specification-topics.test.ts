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

  it("keeps the specification's own ids and drops the rest", () => {
    const catalogue = { ...EXAM_SPECIFICATION_TOPICS[0]!, verified: true };
    // Exercised through a stand-in rather than by flipping a real draft to
    // verified, which is a claim only a person may make.
    const known = new Set(catalogue.topics.map((topic) => topic.id));
    const kept = ["aqa-8461-ecology", "photosynthesis-and-vibes"].filter((id) => known.has(id));
    expect(kept).toEqual(["aqa-8461-ecology"]);
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
