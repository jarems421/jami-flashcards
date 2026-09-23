import { describe, expect, it } from "vitest";
import {
  combinePaperReview,
  deterministicPaperFindings,
  isAiPaperReviewer,
  readAiPaperReview,
} from "@/lib/practice/paper-review";
import type { PracticePaper } from "@/lib/practice/practice-papers";

/**
 * A generated paper reviewed by a model standing in for a person.
 *
 * The model's verdict is read strictly and the arithmetic is never left to it:
 * a paper whose marks do not add up is unusable whatever the model says.
 */

type Paper = Pick<PracticePaper, "questions" | "markScheme" | "totalMarks" | "choiceGroups">;

const question = (id: string, marks: number, prompt: string, assets: unknown[] = []) =>
  ({ id, label: id.toUpperCase(), prompt, marks, assets }) as unknown as PracticePaper["questions"][number];

const item = (questionId: string, maxMarks: number, answer: string) =>
  ({ questionId, maxMarks, marking: "additive", answer, points: [] }) as never;

function paper(over: Partial<Paper> = {}): Paper {
  return {
    questions: [
      question("q1", 2, "Outline what is meant by interference as an explanation of forgetting."),
      question("q2", 3, "Explain one strength of the multi-store model of memory."),
    ],
    markScheme: {
      kind: "jami_generated",
      label: "Scheme",
      notice: "",
      items: [
        item("q1", 2, "Interference: forgetting because one memory disrupts another, proactive or retroactive."),
        item("q2", 3, "Strength of the multi-store model: research support for separate stores, such as HM's case."),
      ],
    } as unknown as PracticePaper["markScheme"],
    totalMarks: 5,
    choiceGroups: [],
    ...over,
  };
}

const SCORES = {
  authenticity: 4,
  levelFit: 4,
  schemeCorrectness: 5,
  specificationCoverage: 4,
  timing: 4,
  visualQuality: 5,
  accessibility: 4,
  originality: 4,
};
const QUESTIONS = new Set(["q1", "q2"]);

describe("what code decides, whatever the model says", () => {
  it("finds nothing wrong with a paper that adds up", () => {
    expect(deterministicPaperFindings(paper())).toEqual([]);
  });

  it("catches a total that does not add up", () => {
    const findings = deterministicPaperFindings(paper({ totalMarks: 6 }));
    expect(findings.map((finding) => finding.blocker)).toContain("invalid_total");
  });

  it("catches a question with no scheme at all", () => {
    const base = paper();
    const findings = deterministicPaperFindings({
      ...base,
      markScheme: { ...base.markScheme, items: base.markScheme.items.slice(0, 1) },
    });
    expect(findings).toContainEqual(expect.objectContaining({ blocker: "incorrect_scheme", questionId: "q2" }));
  });

  it("catches a figure that failed its own validation", () => {
    const base = paper();
    const findings = deterministicPaperFindings({
      ...base,
      questions: [
        base.questions[0]!,
        question("q2", 3, base.questions[1]!.prompt, [{ id: "fig", title: "Graph", validationStatus: "invalid" }]),
      ],
    });
    expect(findings).toContainEqual(expect.objectContaining({ blocker: "broken_visual", questionId: "q2" }));
  });

  it("leaves the total to judgement when optional questions make it depend on a choice", () => {
    const findings = deterministicPaperFindings(
      paper({
        totalMarks: 3,
        choiceGroups: [
          { id: "g", label: "Answer one", requiredCount: 1, questionIds: ["q1", "q2"], selectionRule: "highest_scoring" },
        ],
      })
    );
    expect(findings.map((finding) => finding.blocker)).not.toContain("invalid_total");
  });
});

describe("reading the model's verdict strictly", () => {
  it("reads a well-formed verdict", () => {
    const review = readAiPaperReview({ usable: true, scores: SCORES, blockers: [], comments: "Sound paper." }, QUESTIONS);
    expect(review).toMatchObject({ usable: true, scores: SCORES, findings: [], comments: "Sound paper." });
  });

  it("refuses the whole verdict when a score cannot be read", () => {
    expect(readAiPaperReview({ usable: true, scores: { ...SCORES, timing: 4.5 } }, QUESTIONS)).toBeNull();
    expect(readAiPaperReview({ usable: true, scores: { ...SCORES, timing: 6 } }, QUESTIONS)).toBeNull();
    expect(readAiPaperReview({ usable: true, scores: { ...SCORES, originality: undefined } }, QUESTIONS)).toBeNull();
    expect(readAiPaperReview("not json", QUESTIONS)).toBeNull();
  });

  it("drops a blocker that names no evidence, an unknown code, or a question not on the paper", () => {
    const review = readAiPaperReview(
      {
        usable: false,
        scores: SCORES,
        blockers: [
          { code: "answer_leak", questionId: "q1", evidence: "The figure caption states the answer, 2.5 m." },
          { code: "answer_leak", questionId: "q1", evidence: "" },
          { code: "made_up", questionId: "q1", evidence: "Something." },
          { code: "unanswerable_question", questionId: "q9", evidence: "No such question." },
          { code: "missing_insert", questionId: null, evidence: "Refers to Source A, which is not included." },
        ],
      },
      QUESTIONS
    );
    expect(review?.findings).toEqual([
      { blocker: "answer_leak", questionId: "q1", evidence: "The figure caption states the answer, 2.5 m." },
      { blocker: "missing_insert", evidence: "Refers to Source A, which is not included." },
    ]);
  });
});

describe("the review that is stored", () => {
  it("is unusable when either the model or the arithmetic found a blocker", () => {
    const ai = readAiPaperReview({ usable: true, scores: SCORES, blockers: [] }, QUESTIONS)!;
    const combined = combinePaperReview(ai, deterministicPaperFindings(paper({ totalMarks: 9 })));
    expect(combined.usable).toBe(false);
    expect(combined.blockers).toEqual(["invalid_total"]);
    expect(combined.comments).toContain("add up to 5 marks");
  });

  it("is usable only when the model says so and nothing blocks it", () => {
    const yes = readAiPaperReview({ usable: true, scores: SCORES, blockers: [] }, QUESTIONS)!;
    const no = readAiPaperReview({ usable: false, scores: SCORES, blockers: [] }, QUESTIONS)!;
    expect(combinePaperReview(yes, []).usable).toBe(true);
    expect(combinePaperReview(no, []).usable).toBe(false);
  });

  it("tells a model's review from a person's by who signed it", () => {
    expect(isAiPaperReviewer("ai:gemini-3.8-flash")).toBe(true);
    expect(isAiPaperReviewer("uid-of-a-person")).toBe(false);
    expect(isAiPaperReviewer(undefined)).toBe(false);
  });
});
