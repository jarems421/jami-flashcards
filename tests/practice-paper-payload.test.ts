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

  /*
   * An uploaded paper is saved from the browser with its timer fields unset,
   * and every upload was refused on `deadlineAt` after its notebook existed.
   */
  it("writes no undefined field for an uploaded paper's unset timer", () => {
    const paper = {
      notebookId: "n1",
      folderId: "f1",
      title: "My mock",
      origin: "uploaded",
      status: "ready",
      sourceIds: [],
      sourceLabels: [],
      request: "Uploaded practice paper",
      coverage: "",
      length: "full",
      focus: "balanced",
      durationMinutes: 0,
      timingMode: "untimed",
      timingState: "not_started",
      deadlineAt: undefined,
      pausedAt: undefined,
      totalPausedMs: 0,
      overtimeStartedAt: undefined,
      deadlineSnapshotAt: undefined,
      deadlineVersion: 0,
      tutorEnabled: true,
      tutorUsed: false,
      timerEnabled: false,
      instructions: [],
      assessmentProfile: {},
      questions: [],
      choiceGroups: [],
      totalMarks: 0,
      markScheme: { kind: "estimated", label: "", notice: "", items: [] },
    } as unknown as Omit<PracticePaper, "id" | "createdAt" | "updatedAt">;

    const payload = buildPracticePaperPayload(paper) as Record<string, unknown>;
    expect(Object.entries(payload).filter(([, value]) => value === undefined)).toEqual([]);
    expect("deadlineAt" in payload).toBe(false);
  });
});
