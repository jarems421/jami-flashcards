import { expect, it, vi } from "vitest";
import { mergeGapOutcomes, validateSemanticResult } from "@/lib/study/semantic-validation";
import { runStudySemanticCheck } from "@/lib/study/semantic-check";
import { canRestoreStudyExercise } from "@/lib/study/restored-exercise";
import { buildSessionExerciseSnapshots } from "@/lib/study/session-exercises";
import type { Card } from "@/lib/study/cards";
import { studyPresentationFlags } from "@/lib/study/presentation-state";

const card: Card = { id: "c", userId: "u", deckId: "d", front: "Speed?", back: "26 m/s", tags: [], createdAt: 1 };
const valid = { verdict: "correct", feedback: "Correct", evidence: ["26"], coveredConcepts: ["speed"], missingConcepts: [], confidence: 0.9 };
it("syncs only one-bit recovery markers, never answers or marked response data", () => {
  expect(studyPresentationFlags({ "counted:p": "1", "retired:v": "1", "hint-revisit:c": "1", "state:p": "private feedback", "p": "private answer", "counted:injected": "private answer" })).toEqual({ "counted:p": "1", "retired:v": "1", "hint-revisit:c": "1" });
});
it("never lets semantic reassurance override a conclusive wrong gap", () => {
  const result = mergeGapOutcomes([{ gapId: "number", verdict: "incorrect" }, { gapId: "words", verdict: "needs-self-grade" }], [{ gapId: "number", verdict: "correct" }, { gapId: "words", verdict: "correct" }]);
  expect(result.verdict).toBe("partial");
  expect(result.outcomes[0].verdict).toBe("incorrect");
});
it("keeps missing or duplicated gap decisions uncertain", () => {
  expect(mergeGapOutcomes([{ gapId: "g", verdict: "needs-self-grade" }], [{ gapId: "g", verdict: "correct" }, { gapId: "g", verdict: "incorrect" }]).verdict).toBe("needs-self-grade");
});
it("rejects a confident contradiction or invented evidence", () => {
  expect(validateSemanticResult({ ...valid, missingConcepts: ["units"] }, "26")).toBeNull();
  expect(validateSemanticResult(valid, "27")).toBeNull();
  expect(validateSemanticResult(valid, "26 m/s")).not.toBeNull();
});
it("repairs malformed output once without buying a routine second mark", async () => {
  const call = vi.fn().mockResolvedValueOnce("not JSON").mockResolvedValueOnce(JSON.stringify(valid));
  expect(JSON.parse(await runStudySemanticCheck(call, "26", [], Date.now() + 20_000)).verdict).toBe("correct");
  expect(call).toHaveBeenCalledTimes(2);
  const first = vi.fn().mockResolvedValue(JSON.stringify(valid));
  await runStudySemanticCheck(first, "26", [], Date.now() + 20_000);
  expect(first).toHaveBeenCalledTimes(1);
});
it("does not decide disagreements or exceed its call limit", async () => {
  const call = vi.fn().mockResolvedValueOnce(JSON.stringify({ ...valid, confidence: 0.1 })).mockResolvedValueOnce(JSON.stringify({ ...valid, verdict: "incorrect" }));
  expect(JSON.parse(await runStudySemanticCheck(call, "26", [], Date.now() + 20_000)).verdict).toBe("needs-self-grade");
  expect(call).toHaveBeenCalledTimes(2);
});
it("starts no call after the shared deadline", async () => {
  const call = vi.fn();
  await runStudySemanticCheck(call, "26", [], Date.now() - 1);
  expect(call).not.toHaveBeenCalled();
});
it("does not call a model when every gap is conclusive", async () => {
  const call = vi.fn();
  const result = JSON.parse(await runStudySemanticCheck(call, "27", [{ gapId: "g", response: "27", verdict: "incorrect" }], Date.now() + 20_000));
  expect(result.verdict).toBe("incorrect"); expect(call).not.toHaveBeenCalled();
});
it("refuses old unvalidated generated presentations", () => {
  expect(canRestoreStudyExercise({ cardId: "c", mode: "multiple-choice", contentHash: "h", mcq: { options: [{ id: "a", text: "26" }, { id: "b", text: "27" }], correctOptionId: "a" } }, card)).toBe(false);
});
it("preserves a distinct Classic retry identity in its snapshot", () => {
  const snapshots = buildSessionExerciseSnapshots({ cards: [card], asAsked: (value) => value, modePolicy: { kind: "fixed", mode: "classic" }, index: 0, seed: 1, presentationId: "session:0:c:retry-uuid", firstExercise: null });
  expect(snapshots[0].presentationId).toBe("session:0:c:retry-uuid");
});
