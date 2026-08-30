import { describe, expect, it } from "vitest";
import {
  normalizeMarkSchemeItem,
  paperAssessmentObjectiveMarks,
  readAssessmentObjectives,
} from "@/lib/practice/mark-schemes";

/**
 * A paper reported its marks as A and B -- method, accuracy, independent --
 * which describe how a mark behaves and not what it assesses. Nothing could say
 * how its 96 marks divided between knowledge, application and evaluation, so
 * its weighting could not be checked against the specification that states one.
 *
 * The schemes were already writing it in prose, "AO1 (knowledge of the
 * multi-store model): ...", with nothing reading it.
 */
describe("reading assessment objectives", () => {
  it("takes them from an explicit field", () => {
    expect(readAssessmentObjectives("AO2")).toEqual(["AO2"]);
  });

  it("takes them from the prose a scheme already writes", () => {
    expect(
      readAssessmentObjectives(undefined, undefined, "AO1 (knowledge of the multi-store model): names two stores.")
    ).toEqual(["AO1"]);
  });

  it("finds every objective a band descriptor names", () => {
    expect(
      readAssessmentObjectives("AO1: rudimentary knowledge. AO3: little or no evaluation.")
    ).toEqual(["AO1", "AO3"]);
  });

  it("tolerates a space and mixed case", () => {
    expect(readAssessmentObjectives("ao 3 evaluation is limited")).toEqual(["AO3"]);
  });

  /** Not every subject uses them, and a scheme that names none must not invent one. */
  it("finds none where none are stated", () => {
    expect(readAssessmentObjectives("Award one mark for each correct store named.")).toEqual([]);
  });

  /** AO4 is not an objective of these papers; a stray number is not a match. */
  it("ignores numbers that are not objectives", () => {
    expect(readAssessmentObjectives("Award 2 marks. See AO4 guidance.")).toEqual([]);
  });

  it("attaches to a point through normalization", () => {
    const item = normalizeMarkSchemeItem(
      {
        marking: "additive",
        answer: "",
        points: [{ id: "1.1", marks: 2, code: "B", text: "AO2 application: identifies the conformity type." }],
      },
      { id: "q1", marks: 2, prompt: "Explain the conformity shown." } as never
    ) as { points: { assessmentObjective?: string }[] } | null;
    expect(item?.points[0].assessmentObjective).toBe("AO2");
  });
});

describe("how a paper's marks divide", () => {
  const additive = (id: string, marks: number, ao: string) => ({
    questionId: id,
    maxMarks: marks,
    marking: "additive",
    answer: "",
    points: [{ id: `${id}.1`, marks, code: "B", text: "x", dep: [], ft: false, assessmentObjective: ao }],
  }) as never;

  it("adds up the marks behind each objective", () => {
    expect(
      paperAssessmentObjectiveMarks([additive("q1", 4, "AO1"), additive("q2", 2, "AO3"), additive("q3", 6, "AO1")])
    ).toEqual({ AO1: 10, AO3: 2 });
  });

  /**
   * A banded question credits its objectives across the whole tariff rather
   * than mark by mark, so its marks divide evenly between the ones it names.
   */
  it("splits a banded question between the objectives its bands name", () => {
    expect(
      paperAssessmentObjectiveMarks([
        {
          questionId: "q4",
          maxMarks: 16,
          marking: "banded",
          answer: "",
          bands: [
            { id: "b1", label: "Level 1", minMarks: 0, maxMarks: 8, descriptor: "x", assessmentObjectives: ["AO1", "AO3"] },
          ],
        } as never,
      ])
    ).toEqual({ AO1: 8, AO3: 8 });
  });

  /**
   * Marks with no objective are counted as unattributed, never shared out
   * across the rest. Spreading them would turn an assumption into what looks
   * like a measurement -- and on the published paper 72 of 96 marks were
   * unattributed, which is the finding, not a rounding detail.
   */
  it("counts unattributed marks rather than guessing where they belong", () => {
    expect(
      paperAssessmentObjectiveMarks([
        additive("q1", 4, "AO1"),
        { questionId: "q2", maxMarks: 12, marking: "banded", answer: "", bands: [] } as never,
      ])
    ).toEqual({ AO1: 4, unattributed: 12 });
  });
});
