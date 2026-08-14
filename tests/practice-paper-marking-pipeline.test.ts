import { beforeEach, describe, expect, it, vi } from "vitest";
import { mapPracticePaperData } from "@/lib/practice/practice-papers";

const generateAiText = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/lib/ai/provider-router", () => ({ generateAiText }));

const { markPracticePaperWithAudit } = await import(
  "@/services/ai/practice-paper-marking.server"
);

const paper = mapPracticePaperData("paper-1", {
  notebookId: "paper-1",
  folderId: "folder-1",
  title: "Biology paper",
  status: "submitted",
  assessmentProfile: { qualificationOrModule: "GCSE Biology" },
  questions: [
    { id: "q1", label: "Question 1", prompt: "Describe mitosis.", marks: 2 },
    { id: "q2", label: "Question 2", prompt: "Explain osmosis.", marks: 3 },
  ],
  markScheme: {
    kind: "generated",
    items: [
      { questionId: "q1", answer: "Cell division", criteria: ["Two stages"], acceptableAlternatives: [], commonMistakes: [] },
      { questionId: "q2", answer: "Water movement", criteria: ["Gradient"], acceptableAlternatives: [], commonMistakes: [] },
    ],
  },
});

function report(scores: Record<string, number>, options: {
  lowConfidence?: readonly string[];
  questionIds?: readonly string[];
} = {}) {
  const questionIds = options.questionIds ?? ["q1", "q2"];
  return JSON.stringify({
    summary: "Evidence-based report.",
    strengths: ["Relevant knowledge"],
    priorities: ["Use precise evidence"],
    questionResults: questionIds.map((questionId) => {
      const question = paper.questions.find((item) => item.id === questionId)!;
      return {
        questionId,
        label: question.label,
        awardedMarks: scores[questionId] ?? 0,
        maxMarks: question.marks,
        feedback: "Specific feedback.",
        criterionResults: [{ criterion: questionId, awarded: true, evidence: "Visible working" }],
        evidence: ["Visible working"],
        strengths: [],
        improvements: [],
        confidence: options.lowConfidence?.includes(questionId) ? "low" : "high",
        attempted: true,
      };
    }),
  });
}

function input() {
  return {
    paper,
    answerParts: [
      { text: "--- BEGIN UNTRUSTED REFERENCE: ANSWER q1 ---" },
      { inlineData: { data: "cTEtaW1hZ2U=", mimeType: "image/png" } },
      { text: "--- END UNTRUSTED REFERENCE: ANSWER q1 ---" },
      { text: "--- BEGIN UNTRUSTED REFERENCE: ANSWER q2 ---" },
      { inlineData: { data: "cTItaW1hZ2U=", mimeType: "image/png" } },
      { text: "--- END UNTRUSTED REFERENCE: ANSWER q2 ---" },
    ],
    originalPaperParts: [
      { text: "--- BEGIN UNTRUSTED REFERENCE: ORIGINAL PAPER ---" },
      { inlineData: { data: "cGFwZXItaW1hZ2U=", mimeType: "image/png" } },
      { text: "--- END UNTRUSTED REFERENCE: ORIGINAL PAPER ---" },
    ],
    deadlineAt: Date.now() + 60_000,
    maxOutputTokens: 2_000,
  };
}

describe("formal blind marking pipeline", () => {
  beforeEach(() => {
    generateAiText.mockReset();
  });

  it("starts blind M3 and MiMo markers concurrently with the same original evidence", async () => {
    let releasePrimary!: (value: string) => void;
    let releaseVerifier!: (value: string) => void;
    generateAiText.mockImplementation(({ role }: { role: string }) => new Promise<string>((resolve) => {
      if (role === "supervisor") releasePrimary = resolve;
      else releaseVerifier = resolve;
    }));

    const pending = markPracticePaperWithAudit(input());
    await vi.waitFor(() => expect(generateAiText).toHaveBeenCalledTimes(2));

    const [primaryCall, verifierCall] = generateAiText.mock.calls.map((call) => call[0]);
    expect(primaryCall.role).toBe("supervisor");
    expect(verifierCall.role).toBe("worker");
    expect(primaryCall.request.systemInstruction).not.toContain("verifier report");
    expect(verifierCall.request.systemInstruction).not.toContain("primary report");
    for (const call of [primaryCall, verifierCall]) {
      const serialized = JSON.stringify(call.request.contents);
      expect(serialized).toContain("cGFwZXItaW1hZ2U=");
      expect(serialized).toContain("cTEtaW1hZ2U=");
      expect(serialized).toContain("cTItaW1hZ2U=");
    }

    releasePrimary(report({ q1: 2, q2: 3 }));
    releaseVerifier(report({ q1: 2, q2: 3 }));
    await expect(pending).resolves.toMatchObject({
      result: { awardedMarks: 5, totalMarks: 5 },
      audit: { disputedQuestionIds: [], thirdViewQuestionIds: [] },
    });
  });

  it("gives Kimi only the unresolved question evidence before M3 reconciles", async () => {
    let supervisorCall = 0;
    generateAiText.mockImplementation(async ({
      role,
      request,
    }: {
      role: string;
      request: { systemInstruction: string };
    }) => {
      if (role === "worker") return report({ q1: 0, q2: 3 });
      if (role === "juror") return report({ q1: 1 }, { questionIds: ["q1"] });
      supervisorCall += 1;
      if (supervisorCall === 1) return report({ q1: 2, q2: 3 });
      if (request.systemInstruction.includes("adjudicator") && supervisorCall === 2) {
        return report({ q1: 1, q2: 3 }, { lowConfidence: ["q1"] });
      }
      return report({ q1: 1, q2: 3 });
    });

    const result = await markPracticePaperWithAudit(input());
    expect(result.audit).toMatchObject({
      disputedQuestionIds: ["q1"],
      adjudicatedQuestionIds: ["q1"],
      thirdViewQuestionIds: ["q1"],
    });
    const jurorCall = generateAiText.mock.calls
      .map((call) => call[0])
      .find((call) => call.role === "juror");
    expect(jurorCall).toBeTruthy();
    const jurorEvidence = JSON.stringify(jurorCall.request.contents);
    expect(jurorEvidence).toContain("ANSWER q1");
    expect(jurorEvidence).toContain("cTEtaW1hZ2U=");
    expect(jurorEvidence).not.toContain("ANSWER q2");
    expect(jurorEvidence).not.toContain("cTItaW1hZ2U=");
    expect(jurorEvidence).not.toContain("cGFwZXItaW1hZ2U=");
  });
});
