import { beforeEach, describe, expect, it, vi } from "vitest";
import { mapPracticePaperData } from "@/lib/practice/practice-papers";

const generateAiText = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/lib/ai/provider-router", () => ({ generateAiText }));

const { buildMarkerRequest, markPracticePaperWithAudit } = await import(
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

  it("reuses completed provider checkpoints after a workflow retry", async () => {
    generateAiText.mockRejectedValue(new Error("provider must not be called"));
    const parsed = JSON.parse(report({ q1: 2, q2: 3 }));
    const normalized = (await import("@/lib/ai/practice-paper-marking"))
      .parsePracticePaperMarkingModelAnswer(JSON.stringify(parsed), paper)!;
    const completedStages: string[] = [];
    const resumed = await markPracticePaperWithAudit({
      ...input(),
      cachedStageResults: {
        primary: { result: normalized, diagnostics: [] },
        verifier: { result: normalized, diagnostics: [] },
      },
      onStageResult: async (stage) => { completedStages.push(stage); },
    });
    expect(resumed.result.awardedMarks).toBe(5);
    expect(generateAiText).not.toHaveBeenCalled();
    expect(completedStages).toEqual([]);
  });

  it("gives Kimi only the unresolved question evidence before M3 reconciles", async () => {
    let supervisorCall = 0;
    generateAiText.mockImplementation(async ({ role }: { role: string }) => {
      if (role === "worker") return report({ q1: 0, q2: 3 });
      if (role === "juror") return report({ q1: 1 }, { questionIds: ["q1"] });
      supervisorCall += 1;
      if (supervisorCall === 1) return report({ q1: 2, q2: 3 });
      return report({ q1: 1, q2: 3 });
    });

    // q1 escalates because the blind markers landed two marks apart (2 v 0),
    // not because either of them said it felt unsure.
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

  /**
   * The third view is an extra safeguard over an already-adjudicated dispute.
   * The runbook offers OPENROUTER_JUROR_KILL_SWITCH as a juror-only measure,
   * which it can only be if losing the juror does not lose the marking.
   */
  describe("juror unavailable", () => {
    it("keeps the adjudicated marking when the third view cannot run", async () => {
      let supervisorCall = 0;
      generateAiText.mockImplementation(async ({ role }: { role: string }) => {
        if (role === "worker") return report({ q1: 0, q2: 3 });
        if (role === "juror") throw new Error("AI providers are not configured");
        supervisorCall += 1;
        return supervisorCall === 1
          ? report({ q1: 2, q2: 3 })
          : report({ q1: 1, q2: 3 });
      });

      const result = await markPracticePaperWithAudit(input());

      expect(result.result.awardedMarks).toBe(4);
      expect(result.audit).toMatchObject({
        disputedQuestionIds: ["q1"],
        adjudicatedQuestionIds: ["q1"],
        // Never claim a third view that did not happen.
        thirdViewQuestionIds: [],
      });
    });

    it("still fails the marking when adjudication itself cannot run", async () => {
      let supervisorCall = 0;
      generateAiText.mockImplementation(async ({ role }: { role: string }) => {
        if (role === "worker") return report({ q1: 0, q2: 3 });
        supervisorCall += 1;
        if (supervisorCall === 1) return report({ q1: 2, q2: 3 });
        throw new Error("supervisor unavailable");
      });

      await expect(markPracticePaperWithAudit(input())).rejects.toThrow();
    });
  });

  /**
   * Whichever report an adjudicator reads first wins disputes more often than
   * it should, so the two are unnamed and their order is drawn per marking.
   */
  describe("adjudicator position bias", () => {
    async function adjudicationPrompt(primaryFirst: boolean) {
      generateAiText.mockReset();
      let supervisorCall = 0;
      generateAiText.mockImplementation(async ({ role }: { role: string }) => {
        if (role === "worker") return report({ q1: 0, q2: 3 });
        if (role === "juror") return report({ q1: 1 }, { questionIds: ["q1"] });
        supervisorCall += 1;
        return supervisorCall === 1
          ? report({ q1: 2, q2: 3 })
          : report({ q1: 1, q2: 3 });
      });

      const random = vi
        .spyOn(Math, "random")
        .mockReturnValue(primaryFirst ? 0.1 : 0.9);
      try {
        await markPracticePaperWithAudit(input());
      } finally {
        random.mockRestore();
      }

      const call = generateAiText.mock.calls
        .map((entry) => entry[0])
        .find((entry) => JSON.stringify(entry.request.contents).includes("Report A"));
      expect(call).toBeTruthy();
      return JSON.stringify(call.request.contents);
    }

    it("never names either marker to the adjudicator", async () => {
      const prompt = await adjudicationPrompt(true);
      expect(prompt).toContain("Report A");
      expect(prompt).toContain("Report B");
      expect(prompt).not.toContain("Primary report");
      expect(prompt).not.toContain("Independent verifier report");
      expect(prompt).toContain("Neither has priority");
    });

    it("puts the primary first or second depending on the draw", async () => {
      const marksInOrder = (prompt: string) => {
        const a = prompt.indexOf("Report A");
        const b = prompt.indexOf("Report B");
        return [prompt.slice(a, b), prompt.slice(b)] as const;
      };

      const [firstWhenPrimary] = marksInOrder(await adjudicationPrompt(true));
      expect(firstWhenPrimary).toContain('\\"awardedMarks\\":2');

      const [firstWhenVerifier] = marksInOrder(await adjudicationPrompt(false));
      expect(firstWhenVerifier).toContain('\\"awardedMarks\\":0');
    });
  });
});

/**
 * The marking prompt adapts to the subject, and the quantitative branch used
 * to say only its lenient half: award method marks, do not let a later slip
 * erase a valid method. Nothing anywhere told the marker to check that the
 * method had been carried out, and the criterion benchmark says that was read
 * as permission -- 31 responses where Jami awarded a mark the examiner
 * withheld against 13 the other way, including marks given for working with
 * plainly wrong values in it.
 *
 * A measured claim now rests on this wording, so it is pinned.
 */
describe("what a quantitative paper's marker is told", () => {
  const quantitative = mapPracticePaperData("paper-2", {
    notebookId: "paper-2",
    folderId: "folder-1",
    title: "Higher Maths",
    status: "submitted",
    assessmentProfile: { qualificationOrModule: "Higher", specificationOrCourse: "mathematics" },
    questions: [{ id: "q1", label: "Question 1", prompt: "Find the tangent.", marks: 4 }],
    markScheme: {
      kind: "generated",
      items: [
        { questionId: "q1", answer: "y = 7x - 8", criteria: ["gradient"], acceptableAlternatives: [], commonMistakes: [] },
      ],
    },
  });

  const promptFor = (subject: typeof paper) => {
    const request = buildMarkerRequest({
      paper: subject,
      answerParts: [{ text: "working" }],
      deadlineAt: Date.now() + 60_000,
      maxOutputTokens: 1_000,
      role: "primary",
    });
    return request.contents[0].parts
      .map((part) => ("text" in part ? part.text : ""))
      .join("\n");
  };

  it("keeps positive marking and error-carried-forward", () => {
    const text = promptFor(quantitative);
    expect(text).toContain("marks accumulate");
    expect(text).toContain("never deducted");
    expect(text).toMatch(/error does not stop the working after it being marked/);
  });

  /** The half that was missing, and the reason the benchmark ran generous. */
  it("also tells the marker to check the working", () => {
    const text = promptFor(quantitative);
    expect(text).toContain("line by line");
    expect(text).toMatch(/correct final answer as no evidence on its own/);
    expect(text).toMatch(/candidate's own value must match it/);
  });

  it("leaves a non-quantitative paper on its own branch", () => {
    const text = promptFor(paper);
    expect(text).not.toContain("line by line");
  });

  /** Evidence has to locate the line, not summarise an impression of it. */
  it("asks for the candidate's own line as evidence", () => {
    expect(promptFor(quantitative)).toContain("the candidate's own line that earns or loses this mark");
  });
});

/**
 * Jami has marked half a mark generous through every configuration tried this
 * week -- with and without the question and scheme in front of it, and with
 * and without a prompt telling it to check the working. Neither more
 * information nor better instruction moved it, which points at how the
 * ensemble combines its markers rather than at what any one of them knows.
 *
 * That question is answerable from data the pipeline already computes and
 * throws away: each blind marker's own criterion decisions, kept only long
 * enough to notice a dispute. Recorded, they let a rule -- award only where
 * both markers agree, say -- be scored against the examiner by arithmetic
 * rather than by another paid run.
 */
describe("reporting what each marker decided", () => {
  beforeEach(() => {
    generateAiText.mockReset();
  });

  const identified = (scores: Record<string, number>, awarded: boolean) =>
    JSON.stringify({
      summary: "Report.",
      strengths: [],
      priorities: [],
      questionResults: ["q1", "q2"].map((questionId) => {
        const question = paper.questions.find((item) => item.id === questionId)!;
        return {
          questionId,
          label: question.label,
          awardedMarks: scores[questionId] ?? 0,
          maxMarks: question.marks,
          feedback: "Feedback.",
          criterionResults: [
            { criterionId: "C1", criterion: "first", awarded, evidence: "Working" },
            { criterionId: "C2", criterion: "second", awarded: false, evidence: "Working" },
          ],
          evidence: ["Working"],
          strengths: [],
          improvements: [],
          confidence: "high",
          attempted: true,
        };
      }),
    });

  it("fires once for each marker, carrying that marker's own decisions", async () => {
    generateAiText.mockImplementation(({ role }: { role: string }) =>
      Promise.resolve(
        role === "supervisor" ? identified({ q1: 2, q2: 3 }, true) : identified({ q1: 2, q2: 3 }, false)
      )
    );

    const reports: { role: string; criteria: { criterionId: string; awarded: boolean }[] }[] = [];
    await markPracticePaperWithAudit({
      ...input(),
      onMarkerReport: (report) =>
        reports.push({ role: report.role, criteria: report.questions[0].criteria }),
    });

    // Both markers reached the same totals and still disagreed about which
    // criteria earned them, which is a dispute -- and exactly the case the
    // recording exists for, since a total alone would have hidden it.
    expect(reports.map((r) => r.role)).toContain("primary");
    expect(reports.map((r) => r.role)).toContain("verifier");
    expect(reports.map((r) => r.role)).toContain("adjudicator");
    expect(reports.find((r) => r.role === "primary")?.criteria).toEqual([
      { criterionId: "C1", awarded: true, evidence: "Working" },
      { criterionId: "C2", awarded: false, evidence: "Working" },
    ]);
    // The verifier's own decisions, not the primary's, which is the whole point.
    expect(reports.find((r) => r.role === "verifier")?.criteria).toEqual([
      { criterionId: "C1", awarded: false, evidence: "Working" },
      { criterionId: "C2", awarded: false, evidence: "Working" },
    ]);
  });

  it("reports the adjudicator separately when the markers disagree", async () => {
    generateAiText.mockImplementation(({ role }: { role: string }) =>
      Promise.resolve(
        role === "supervisor" ? identified({ q1: 2, q2: 3 }, true) : identified({ q1: 1, q2: 3 }, true)
      )
    );

    const roles: string[] = [];
    await markPracticePaperWithAudit({
      ...input(),
      onMarkerReport: (report) => roles.push(report.role),
    });
    expect(roles).toContain("adjudicator");
  });

  /** Observation must not change what is being observed. */
  it("marks identically when nothing is listening", async () => {
    generateAiText.mockResolvedValue(identified({ q1: 2, q2: 3 }, true));
    const withReport = await markPracticePaperWithAudit({ ...input(), onMarkerReport: () => {} });
    generateAiText.mockResolvedValue(identified({ q1: 2, q2: 3 }, true));
    const without = await markPracticePaperWithAudit(input());
    expect(without.result.awardedMarks).toBe(withReport.result.awardedMarks);
    expect(without.audit.primaryScores).toEqual(withReport.audit.primaryScores);
  });

  /**
   * Evidence is the marker's own quotation of the line it judged, and
   * confidence is its own claim about how sure it was. Neither changes a
   * marking; both exist because hand-reading five disagreements is what found
   * the generosity, and that does not scale without them.
   */
  it("carries the marker's quotation and its stated confidence", async () => {
    generateAiText.mockResolvedValue(identified({ q1: 2, q2: 3 }, true));
    const reports: { confidence: string; evidence?: string }[] = [];
    await markPracticePaperWithAudit({
      ...input(),
      onMarkerReport: (r) =>
        reports.push({
          confidence: r.questions[0].confidence,
          evidence: r.questions[0].criteria[0].evidence,
        }),
    });
    expect(reports[0].confidence).toBe("high");
    expect(reports[0].evidence).toBe("Working");
  });

  /** A criterion the marker left unidentified cannot be paired with anything. */
  it("omits criteria the marker returned without the guide's id", async () => {
    generateAiText.mockResolvedValue(report({ q1: 2, q2: 3 }));
    const reports: { criteria: unknown[] }[] = [];
    await markPracticePaperWithAudit({
      ...input(),
      onMarkerReport: (r) => reports.push({ criteria: r.questions[0].criteria }),
    });
    expect(reports[0].criteria).toEqual([]);
  });
});
