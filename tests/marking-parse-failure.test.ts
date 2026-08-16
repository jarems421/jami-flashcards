import { describe, expect, it } from "vitest";
import { classifyMarkingParseFailure } from "@/lib/ai/marking-parse-failure";

const diagnose = (raw: string, expected = ["q1"], max: Record<string, number> = { q1: 5 }) =>
  classifyMarkingParseFailure({ raw, expectedQuestionIds: expected, maxMarksByQuestion: max });

/**
 * One label over five faults made a 12.5% failure rate impossible to act on.
 * A truncated response needs a bigger output budget, a dropped question needs
 * a firmer prompt, and a refusal needs neither.
 */
describe("classifying an unreadable marking report", () => {
  it("reports nothing at all as empty", () => {
    expect(diagnose("   ").kind).toBe("empty");
  });

  it("recognises a refusal before trying to parse it", () => {
    expect(diagnose("I'm sorry, I cannot assist with marking this.").kind).toBe("refusal");
  });

  /** Cut off by the token cap: brackets opened and never closed. */
  it("tells a truncated response from merely invalid JSON", () => {
    const truncated = '{"questionResults":[{"questionId":"q1","awardedMarks":3,"feedback":"The candidate';
    expect(diagnose(truncated).kind).toBe("truncated");
    expect(diagnose(truncated).detail).toContain("unclosed");

    expect(diagnose("not json at all, just prose about the essay.").kind).toBe("invalid_json");
  });

  it("reads JSON wrapped in a code fence", () => {
    const fenced = '```json\n{"questionResults":[{"questionId":"q1","awardedMarks":0}]}\n```';
    expect(diagnose(fenced).kind).not.toBe("invalid_json");
  });

  it("names a question the model dropped", () => {
    const report = '{"questionResults":[{"questionId":"q1","awardedMarks":2,"evidence":["x"]}]}';
    const result = classifyMarkingParseFailure({
      raw: report,
      expectedQuestionIds: ["q1", "q2"],
      maxMarksByQuestion: { q1: 5, q2: 5 },
    });
    expect(result.kind).toBe("missing_questions");
    expect(result.detail).toContain("q2");
  });

  it("catches a mark the question cannot carry", () => {
    const report = '{"questionResults":[{"questionId":"q1","awardedMarks":9,"evidence":["x"]}]}';
    expect(diagnose(report).kind).toBe("mark_out_of_range");
  });

  /**
   * The shipped parser silently discards a scoring question that quotes no
   * evidence, which then fails the question count. Without naming it, that
   * reads as malformed output when the output was fine.
   */
  it("names the evidence rule that makes the parser discard a question", () => {
    const report = '{"questionResults":[{"questionId":"q1","awardedMarks":4,"evidence":[]}]}';
    const result = diagnose(report);
    expect(result.kind).toBe("missing_evidence");
    expect(result.detail).toContain("no evidence");
  });

  it("accepts evidence carried on a criterion instead", () => {
    const report =
      '{"questionResults":[{"questionId":"q1","awardedMarks":4,"evidence":[],"criterionResults":[{"criterionId":"C1","awarded":true,"evidence":"quoted line"}]}]}';
    expect(diagnose(report).kind).not.toBe("missing_evidence");
  });

  it("falls back to wrong schema for JSON that is simply not a report", () => {
    expect(diagnose('{"marks":5}').kind).toBe("wrong_schema");
    expect(diagnose("[1,2,3]").kind).toBe("wrong_schema");
  });

  it("records how much the model returned, so truncation is visible", () => {
    expect(diagnose('{"a":1}').length).toBe(7);
  });
});
