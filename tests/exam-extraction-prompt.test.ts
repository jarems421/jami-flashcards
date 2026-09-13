import { describe, expect, it } from "vitest";
import {
  QUESTION_EXAMPLE,
  QUESTION_RULES,
  SCHEME_EXAMPLE,
  SCHEME_RULES,
  topicRulesFor,
} from "@/lib/practice/exam-extraction-prompt";

/**
 * The rules the ingestion model is given, asserted on directly.
 *
 * Everything that reads a mark scheme downstream only ever sees what
 * extraction chose to write, so a wrong instruction here cannot be caught by
 * any test of the code below it -- the scoring fixtures for 8300/1H question 9
 * pass just as happily against a scheme that lost a third of its answers. The
 * prompt is the only place that defect exists, so it is the only place a test
 * can guard it.
 */
describe("what extraction is told about a scheme that outruns its tariff", () => {
  /*
   * The instruction that lost question 9's third criticism. "The points must
   * add up to the question tariff" is satisfiable by dropping one, and on a
   * two-mark question listing three acceptable answers that is the only way to
   * satisfy it.
   */
  it("no longer tells the model to make the points add up", () => {
    expect(SCHEME_RULES).not.toContain("the points must add up to the question tariff");
  });

  it("tells it to keep every creditworthy point instead", () => {
    expect(SCHEME_RULES).toContain("Never drop, merge or shrink one to make a total match the tariff");
  });

  /*
   * A pool used to be described only as a scheme "reading 'any two from'".
   * Question 9 prints no such phrase -- it asks for two criticisms and lists
   * three -- so the model never reached pointPool and fell back to additive,
   * where the rule above then made it trim.
   */
  it("recognises a pool by its shape, not only by the words \"any two from\"", () => {
    expect(SCHEME_RULES).toContain("more creditworthy points than the tariff can award");
  });

  it("leaves a mismatch standing to be reviewed rather than resolved in the prompt", () => {
    expect(SCHEME_RULES).toContain("Do not adjust the points or the tariff to make them agree");
  });

  it("says how a dependent mark and an alternative route are each written down", () => {
    expect(SCHEME_RULES).toContain("name the other point's id in dep");
    expect(SCHEME_RULES).toContain("An alternative method is not an extra point");
  });
});

/**
 * Every field the rules name must have a shape in the example beside them.
 *
 * This is the file's own recorded failure: the schema once said
 * `"marking":"additive|pointPool|..."` with no definition of a point, and a
 * real Edexcel paper came back with 28 correct questions and not one awardable
 * mark. Naming a field the example never shows is the same mistake.
 */
describe("the rules and the example describing the same document", () => {
  it.each(["points", "bands", "traits", "awardable", "dep"])(
    "shows %s in the example, having asked for it in the rules",
    (field) => {
      expect(SCHEME_RULES).toContain(field);
      expect(SCHEME_EXAMPLE).toContain(`"${field}"`);
    }
  );

  it.each([SCHEME_EXAMPLE, QUESTION_EXAMPLE])("is a single valid JSON value and nothing else", (example) => {
    expect(() => JSON.parse(example)).not.toThrow();
  });

  it("keeps its instructions out of the JSON, where they once dropped extraction to zero", () => {
    expect(QUESTION_RULES).not.toContain("{");
    expect(SCHEME_RULES).not.toContain("{");
  });
});

describe("what a specification is told about its own topics", () => {
  it("asks for none rather than inviting a guess it would discard", () => {
    expect(topicRulesFor("a-specification-with-no-catalogue")).toContain("empty array");
  });
});
