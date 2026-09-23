import { describe, expect, it } from "vitest";
import { buildPracticePaperPayload, type PracticePaper } from "@/lib/practice/practice-papers";

/**
 * Firestore refuses any field set to undefined, and refuses the whole write for
 * it. A paper generated without web research has no research receipt, and two
 * finished papers in the first benchmark pilot were lost at the save for that
 * one missing field.
 */
describe("saving a generated paper", () => {
  it("writes no undefined field, whatever optional parts the paper lacks", () => {
    const paper = {
      notebookId: "n1",
      folderId: "f1",
      title: "Paper",
      origin: "generated",
      status: "ready",
      sourceIds: [],
      sourceLabels: [],
      request: "",
      coverage: "",
      length: "full",
      focus: "balanced",
      durationMinutes: 90,
      timingMode: "timed",
      timingState: "not_started",
      totalPausedMs: 0,
      deadlineVersion: 0,
      tutorEnabled: false,
      tutorUsed: false,
      timerEnabled: true,
      instructions: [],
      assessmentProfile: {},
      questions: [],
      choiceGroups: [],
      totalMarks: 0,
      markScheme: { kind: "jami_generated", label: "", notice: "", items: [] },
      researchReceipt: undefined,
      generationAudit: undefined,
      gradeGuidance: undefined,
      examinerInsights: undefined,
    } as unknown as Omit<PracticePaper, "id" | "createdAt" | "updatedAt">;

    const payload = buildPracticePaperPayload(paper) as Record<string, unknown>;
    const undefinedFields = Object.entries(payload)
      .filter(([, value]) => value === undefined)
      .map(([key]) => key);
    expect(undefinedFields).toEqual([]);
    expect(payload.researchReceipt).toBeNull();
  });
});
