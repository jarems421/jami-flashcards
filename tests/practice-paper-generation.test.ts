import { describe, expect, it } from "vitest";
import {
  buildPracticePaperResearchQuery,
  buildPracticePaperGenerationResponse,
  parsePracticePaperGenerationRequest,
  parsePracticePaperModelAnswer,
  rankPracticePaperSources,
} from "@/lib/ai/practice-paper-generation";
import type { Source } from "@/lib/material/sources";

function source(id: string, title: string, updatedAt = 1): Source {
  return {
    id,
    title,
    type: "manual_note",
    folderIds: ["folder-1"],
    topicIds: [],
    status: "active",
    createdBy: "user-1",
    createdAt: 1,
    updatedAt,
  };
}

const readyPayload = {
  status: "ready",
  clarificationQuestion: "",
  assessmentProfile: {
    studyLevel: "University",
    qualificationOrModule: "ECON201",
    awardingBodyOrInstitution: "Example University",
    specificationOrCourse: "Intermediate Microeconomics",
    tierOrComponent: "Final examination",
    formatSummary: "Four calculations followed by two essays",
    confidence: "high",
  },
  title: "ECON201 practice examination",
  instructions: ["Answer all questions in Section A."],
  durationMinutes: 120,
  questions: [
    { id: "q1", label: "Question 1", prompt: "Calculate elasticity.", marks: 5 },
    { id: "q2", label: "Question 2", prompt: "Evaluate the policy.", marks: 10 },
  ],
  markScheme: {
    kind: "generated",
    label: "Jami-generated marking guide",
    notice: "This is not an official mark scheme.",
    items: [
      // One paper, two regimes: the calculation is additive and the evaluation
      // is banded. This is the pairing a single sum-to-total rule would break,
      // and the reason the marking model belongs to the question.
      {
        questionId: "q1",
        marking: "additive",
        maxMarks: 5,
        answer: "A complete calculation.",
        points: [
          { id: "q1.m1", marks: 2, code: "M", text: "Correct elasticity formula." },
          {
            id: "q1.a1",
            marks: 3,
            code: "A",
            text: "Correct value.",
            dep: ["q1.m1"],
            ft: true,
            expected: { value: 1.5, tolerance: 0.05 },
          },
        ],
        acceptableAlternatives: [],
        commonMistakes: ["Inverting the ratio"],
      },
      {
        questionId: "q2",
        marking: "banded",
        maxMarks: 10,
        answer: "A balanced evaluation.",
        bands: [
          { id: "q2.L1", label: "Level 1", minMarks: 0, maxMarks: 3, descriptor: "Assertion without support." },
          { id: "q2.L2", label: "Level 2", minMarks: 4, maxMarks: 7, descriptor: "Relevant analysis, thin judgement." },
          { id: "q2.L3", label: "Level 3", minMarks: 8, maxMarks: 10, descriptor: "Supported, weighed judgement." },
        ],
        acceptableAlternatives: ["Either justified conclusion"],
        commonMistakes: [],
      },
    ],
  },
  sourceRefs: ["S1", "S2"],
};

describe("practice-paper generation request", () => {
  it("accepts up to fifteen sources and rejects a sixteenth", () => {
    const base = {
      folderId: "folder-1",
      request: "Create a module exam",
      coverage: "Whole folder",
      length: "full",
      focus: "balanced",
      focusDetail: "",
      timingMode: "timed",
      tutorEnabled: false,
    };
    expect(
      parsePracticePaperGenerationRequest({
        ...base,
        sourceIds: Array.from({ length: 15 }, (_, index) => `s${index}`),
      })?.sourceIds
    ).toHaveLength(15);
    expect(
      parsePracticePaperGenerationRequest({
        ...base,
        sourceIds: Array.from({ length: 16 }, (_, index) => `s${index}`),
      })
    ).toBeNull();
  });

  it("prioritises assessment authority before recency", () => {
    const ranked = rankPracticePaperSources([
      source("notes", "Lecture notes", 100),
      source("paper", "2025 past exam paper", 50),
      source("spec", "Current module handbook", 1),
      source("rubric", "Final assessment rubric", 2),
    ], "Create an ECON201 exam");
    expect(ranked.map((item) => item.id)).toEqual([
      "spec",
      "rubric",
      "paper",
      "notes",
    ]);
  });
});

describe("practice-paper model response", () => {
  it("keeps a fixed one-to-one marking guide and source receipt", () => {
    const parsed = parsePracticePaperModelAnswer(JSON.stringify(readyPayload), {
      allowedSourceRefs: ["S1", "S2"],
      length: "full",
    });
    expect(parsed?.status).toBe("ready");
    if (!parsed || parsed.status !== "ready") throw new Error("Expected a paper");
    expect(parsed.totalMarks).toBe(15);
    expect(parsed.markScheme.items.map((item) => item.questionId)).toEqual([
      "q1",
      "q2",
    ]);

    const sources = new Map([
      ["S1", source("handbook", "Module handbook")],
      ["S2", source("past", "2025 paper")],
    ]);
    expect(buildPracticePaperGenerationResponse({ parsed, sourcesByRef: sources }))
      .toMatchObject({
        status: "ready",
        sourceIds: ["handbook", "past"],
        sourceLabels: ["Module handbook", "2025 paper"],
      });
  });

  it("rejects missing rubric items and undeclared source references", () => {
    expect(
      parsePracticePaperModelAnswer(
        JSON.stringify({
          ...readyPayload,
          markScheme: {
            ...readyPayload.markScheme,
            items: readyPayload.markScheme.items.slice(0, 1),
          },
        }),
        { allowedSourceRefs: ["S1", "S2"], length: "full" }
      )
    ).toBeNull();
    expect(
      parsePracticePaperModelAnswer(
        JSON.stringify({ ...readyPayload, sourceRefs: ["S9"] }),
        { allowedSourceRefs: ["S1", "S2"], length: "full" }
      )
    ).toBeNull();
  });

  it("allows one focused clarification instead of inventing the exam context", () => {
    expect(
      parsePracticePaperModelAnswer(
        JSON.stringify({
          status: "needs_clarification",
          clarificationQuestion: "Should this follow the AQA or Edexcel specification?",
          sourceRefs: ["S1"],
        }),
        { allowedSourceRefs: ["S1"], length: "full" }
      )
    ).toEqual({
      status: "needs_clarification",
      question: "Should this follow the AQA or Edexcel specification?",
      sourceRefs: ["S1"],
    });
  });

  it("keeps private folder prose and student names out of web research queries", () => {
    const query = buildPracticePaperResearchQuery({
      subject: "Maya's private Biology tutoring notes for Dr Secret",
      studyLevel: "GCSE for Maya at Greenhill School",
      request: "Please mirror AQA GCSE BIO123 and use my private mock comments",
    });
    expect(query).toContain("biology");
    expect(query).toContain("AQA");
    expect(query).toContain("GCSE");
    expect(query).toContain("BIO123");
    expect(query).not.toMatch(/Maya|Secret|Greenhill|private|comments/i);
  });

  it("keeps structured assets, choice groups and honest grade guidance", () => {
    const parsed = parsePracticePaperModelAnswer(JSON.stringify({
      ...readyPayload,
      questions: readyPayload.questions.map((question, index) => ({
        ...question,
        assets: index === 0 ? [{ id: "graph-1", type: "graph", title: "Demand", content: "0,1\n1,2", altText: "An increasing line" }] : [],
      })),
      choiceGroups: [{ id: "choice", label: "Answer one", requiredCount: 1, questionIds: ["q1", "q2"], selectionRule: "highest_scoring" }],
      gradeGuidance: { kind: "estimated", label: "Estimated grades", notice: "Not official", boundaries: [{ label: "First", minimumPercentage: 70 }] },
      examinerInsights: ["State assumptions before calculating."],
    }), { allowedSourceRefs: ["S1", "S2"], length: "full" });
    expect(parsed?.status).toBe("ready");
    if (!parsed || parsed.status !== "ready") throw new Error("Expected a paper");
    expect(parsed.questions[0].assets[0]).toMatchObject({ type: "graph" });
    expect(parsed.choiceGroups[0]).toMatchObject({ requiredCount: 1 });
    expect(parsed.totalMarks).toBe(10);
    expect(parsed.gradeGuidance.kind).toBe("estimated");
  });

  it("normalises colliding and path-like asset IDs before persistence", () => {
    const parsed = parsePracticePaperModelAnswer(JSON.stringify({
      ...readyPayload,
      questions: [{
        ...readyPayload.questions[0],
        assets: [
          {
            id: "../shared graph",
            type: "graph",
            title: "Graph one",
            content: "0,1\n1,2",
            altText: "An increasing line",
          },
          {
            id: "../shared graph",
            type: "graph",
            title: "Graph two",
            content: "0,2\n1,3",
            altText: "Another increasing line",
          },
        ],
      }],
      markScheme: {
        ...readyPayload.markScheme,
        items: readyPayload.markScheme.items.slice(0, 1),
      },
    }), { allowedSourceRefs: ["S1", "S2"], length: "full" });
    expect(parsed?.status).toBe("ready");
    if (!parsed || parsed.status !== "ready") throw new Error("Expected a paper");
    expect(parsed.questions[0].assets.map((asset) => asset.id)).toEqual([
      "shared-graph",
      "shared-graph-2",
    ]);
    expect(new Set(parsed.questions[0].assets.map((asset) => asset.id)).size).toBe(2);
  });
});
