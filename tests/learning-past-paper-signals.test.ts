import { describe, expect, it } from "vitest";
import { pastPaperObservations } from "@/lib/learning/profile/past-paper-signals";

/**
 * A marked past-paper answer as evidence: about its question's topics and
 * concepts, and carrying the command word the question opened with.
 */
const NOW = Date.UTC(2026, 8, 15, 12);

describe("past-paper observations", () => {
  it("counts an answer towards its question's topics and concepts, once each, with its command word", () => {
    const [observation] = pastPaperObservations([
      {
        id: "attempt-1",
        questionId: "question-1",
        attemptNumber: 1,
        markedAt: NOW,
        updatedAt: NOW,
        topicIds: ["aqa-8300-algebra-graphs"],
        conceptIds: ["aqa-8300-algebra-straight-line-graphs", "aqa-8300-algebra-graphs"],
        commandWord: "Work out",
        result: { attempted: true, awardedMarks: 1, maxMarks: 2, criterionResults: [], improvements: [] },
      },
    ]);

    expect(observation).toMatchObject({
      topicKeys: ["spec:aqa-8300-algebra-graphs", "spec:aqa-8300-algebra-straight-line-graphs"],
      commandWord: "Work out",
    });
  });

  it("leaves the command word off an answer whose question printed none", () => {
    const [observation] = pastPaperObservations([
      {
        id: "attempt-2",
        questionId: "question-2",
        attemptNumber: 1,
        updatedAt: NOW,
        topicIds: [],
        result: { attempted: true, awardedMarks: 2, maxMarks: 2, criterionResults: [], improvements: [] },
      },
    ]);
    expect(observation).not.toHaveProperty("commandWord");
  });
});
