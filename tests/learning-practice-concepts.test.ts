import { describe, expect, it } from "vitest";
import { practicePaperObservations } from "@/lib/learning/profile/practice-signals";
import { normalizePracticePaperQuestions } from "@/lib/practice/practice-papers";
import type { PracticePaperEvidenceAttempt } from "@/lib/learning/profile/practice-signals";

const NOW = Date.parse("2026-09-21T10:00:00.000Z");

function attempt(
  overrides: Partial<PracticePaperEvidenceAttempt> = {}
): PracticePaperEvidenceAttempt {
  return {
    id: "a1",
    paperId: "p1",
    assisted: false,
    markedAt: NOW,
    updatedAt: NOW,
    questionResults: [
      { questionId: "q1", attempted: true, counted: true, awardedMarks: 2, maxMarks: 4 },
      { questionId: "q2", attempted: true, counted: true, awardedMarks: 4, maxMarks: 4 },
    ],
    ...overrides,
  };
}

describe("generated practice as concept evidence", () => {
  it("counts a tagged question towards the concept it was written against", () => {
    const [first] = practicePaperObservations([
      attempt({ conceptIdsByQuestion: { q1: ["completing-the-square"] } }),
    ]);
    expect(first?.topicKeys).toEqual(["spec:completing-the-square"]);
  });

  it("leaves an untagged question attributed to nothing", () => {
    const observations = practicePaperObservations([attempt()]);
    expect(observations.every((entry) => entry.topicKeys.length === 0)).toBe(true);
    // Still evidence: it shapes recurring errors and the overall trend.
    expect(observations).toHaveLength(2);
  });

  it("tags only the questions the paper recorded", () => {
    const [first, second] = practicePaperObservations([
      attempt({ conceptIdsByQuestion: { q1: ["completing-the-square"] } }),
    ]);
    expect(first?.topicKeys).toHaveLength(1);
    expect(second?.topicKeys).toHaveLength(0);
  });
});

describe("storing a generated question's concepts", () => {
  const question = {
    id: "q1",
    prompt: "Solve by completing the square.",
    marks: 4,
    conceptIds: ["aqa-8300-algebra-quadratic-equations", "not-a-real-concept"],
  };

  it("keeps only ids the course's own catalogue holds", () => {
    const [stored] = normalizePracticePaperQuestions([question], "8300");
    expect(stored?.conceptIds).not.toContain("not-a-real-concept");
  });

  it("keeps none at all when the course is unknown", () => {
    const [stored] = normalizePracticePaperQuestions([question]);
    expect(stored?.conceptIds).toBeUndefined();
  });

  it("stores nothing rather than an empty list when nothing survives", () => {
    const [stored] = normalizePracticePaperQuestions(
      [{ ...question, conceptIds: ["invented"] }],
      "8300"
    );
    expect(stored?.conceptIds).toBeUndefined();
  });
});
