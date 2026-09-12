import { doc, setDoc } from "firebase/firestore";
import type { RulesTestContext } from "@firebase/rules-unit-testing";

/** What the emulator hands back, which is not the modular `Firestore`. */
type EmulatorFirestore = ReturnType<RulesTestContext["firestore"]>;

/**
 * A licensed corpus small enough to seed, real enough to walk through.
 *
 * Past Paper Practice had never been opened in a browser: every check on it was
 * a unit test over a fixture, which cannot see a layout, a focus trap, or an
 * answer that fails to come back after a reload. The emulator has no AI
 * provider, so marking here fails on purpose -- which is the point, because the
 * failure path is the one carrying the frozen-evidence and retry rules.
 *
 * Rights are the real registry's `aqa-2026` record so the licence gate is
 * exercised rather than bypassed; nothing here is board material, only text
 * written for the test.
 */
export const E2E_EXAM_FOLDER_ID = "e2e-exam-folder";
/**
 * A session that is already marked, seeded rather than earned.
 *
 * The emulator has no AI provider, so no answer submitted in a walkthrough ever
 * reaches a mark -- which left the entire second half of the loop unreachable
 * in a browser. The mark report, the guided retry and the check-a-mark path had
 * never been rendered by anything.
 *
 * The mark itself is invented and says nothing about marking quality. What it
 * makes testable is everything the student does *after* a mark arrives.
 */
export const E2E_MARKED_SESSION_ID = "e2e-exam-marked-session";
export const E2E_MARKED_ATTEMPT_ID = "e2e-exam-marked-attempt";
export const E2E_EXAM_SPEC_ID = "8461";
export const E2E_EXAM_TIER = "foundation";

export const E2E_EXAM_COURSE = {
  board: "aqa",
  qualification: "gcse",
  specificationId: E2E_EXAM_SPEC_ID,
  specificationTitle: "GCSE Biology (8461)",
  tier: E2E_EXAM_TIER,
  componentIds: [],
};

const RIGHTS = {
  key: "aqa-2026",
  version: 1,
  verified: true,
  storageAllowed: true,
  studentDisplayAllowed: true,
  aiInferenceAllowed: true,
  revoked: false,
};

/** Long enough that "what you wrote" is visibly distinct from the prompt. */
export const E2E_EXAM_QUESTIONS = [
  {
    id: "e2e-exam-q1",
    label: "Question 1",
    prompt: "Describe how the structure of a root hair cell is adapted for absorbing water.",
    marks: 3,
    difficulty: "medium" as const,
  },
  {
    id: "e2e-exam-q2",
    label: "Question 2",
    prompt: "Explain why a plant wilts when the soil around it dries out.",
    marks: 4,
    difficulty: "medium" as const,
  },
];

function question(item: (typeof E2E_EXAM_QUESTIONS)[number], index: number, now: number) {
  return {
    id: item.id,
    paperId: "e2e-exam-paper",
    subject: "Biology",
    subjectKey: "biology",
    studyLevel: "gcse-equivalent",
    label: item.label,
    prompt: item.prompt,
    marks: item.marks,
    assets: [],
    reviewAssets: [],
    topicIds: [],
    tier: E2E_EXAM_TIER,
    difficulty: item.difficulty,
    status: "published",
    origin: "official_past_paper",
    humanChecked: true,
    review: { status: "approved", reviewedBy: "owner", reviewedAt: now },
    // The second half of the correctness gate: a person has sampled the paper
    // this came out of. Without it the walkthrough would find no questions at
    // all, which is the gate working rather than the fixture being wrong.
    paperSpotCheckedAt: now,
    selectionKey: index,
    contentVersion: `v1-${item.id}`,
    rights: RIGHTS,
    provenance: {
      board: "aqa",
      boardLabel: "AQA",
      qualification: "gcse",
      specificationId: E2E_EXAM_SPEC_ID,
      specificationTitle: "GCSE Biology (8461)",
      componentCode: "8461/1F",
      componentTitle: "Paper 1 Foundation",
      series: "June",
      year: 2023,
      paperReference: "8461/1F",
      questionNumber: String(index + 1),
    },
    createdAt: now,
    updatedAt: now,
  };
}

function secret(item: (typeof E2E_EXAM_QUESTIONS)[number]) {
  return {
    questionId: item.id,
    contentVersion: `v1-${item.id}`,
    officialMarkScheme: `Award up to ${item.marks} marks for the points below.`,
    markSchemeItem: {
      questionId: item.id,
      maxMarks: item.marks,
      marking: "additive",
      answer: "A model answer written for the browser walkthrough.",
      acceptableAlternatives: [],
      commonMistakes: [],
      points: Array.from({ length: item.marks }, (_unused, index) => ({
        id: `${item.id}.m${index + 1}`,
        marks: 1,
        code: "B",
        text: `Creditworthy point ${index + 1}.`,
        dep: [],
        ft: false,
        essentialTerms: [],
        allow: [],
        reject: [],
      })),
    },
  };
}

function markedAttempt(userId: string, now: number) {
  const question = E2E_EXAM_QUESTIONS[0];
  return {
    id: E2E_MARKED_ATTEMPT_ID,
    userId,
    sessionId: E2E_MARKED_SESSION_ID,
    questionId: question.id,
    attemptNumber: 1,
    answerText:
      "Root hair cells have a long thin extension, which gives a large surface area for water to move in by osmosis.",
    status: "marked",
    workingIncluded: false,
    reviewUsed: false,
    startedAt: now - 300_000,
    submittedAt: now - 240_000,
    markedAt: now - 230_000,
    updatedAt: now - 230_000,
    audit: { primaryScore: 2, adaptivelyVerified: false, adjudicated: false, studentReviewed: false },
    result: {
      questionId: question.id,
      label: question.label,
      awardedMarks: 2,
      maxMarks: question.marks,
      feedback: "A clear point about surface area, but the osmosis gradient is only implied.",
      criterionResults: [
        { criterion: "Large surface area", awarded: true, awardedMarks: 1, maxMarks: 1, evidence: "long thin extension" },
        { criterion: "Water moves by osmosis", awarded: true, awardedMarks: 1, maxMarks: 1, evidence: "in by osmosis" },
        { criterion: "States the concentration gradient", awarded: false, awardedMarks: 0, maxMarks: 1, evidence: "" },
      ],
      evidence: ["long thin extension"],
      strengths: ["Names the adaptation and links it to surface area."],
      improvements: ["Say which way the water moves, and why: from a dilute solution to a more concentrated one."],
      confidence: "high",
      attempted: true,
      counted: true,
    },
  };
}

function markedSession(userId: string, now: number) {
  const question = E2E_EXAM_QUESTIONS[0];
  return {
    id: E2E_MARKED_SESSION_ID,
    userId,
    folderId: E2E_EXAM_FOLDER_ID,
    folderName: "Biology past papers",
    subject: "Biology",
    studyLevel: "gcse-equivalent",
    course: E2E_EXAM_COURSE,
    requestedMix: { easy: 0, medium: 1, hard: 0 },
    topicIds: [],
    questions: [{
      id: question.id,
      attemptId: E2E_MARKED_ATTEMPT_ID,
      label: question.label,
      prompt: question.prompt,
      marks: question.marks,
      assets: [],
      difficulty: question.difficulty,
      origin: "official_past_paper",
      provenance: {
        board: "aqa",
        boardLabel: "AQA",
        qualification: "gcse",
        specificationId: E2E_EXAM_SPEC_ID,
        specificationTitle: "GCSE Biology (8461)",
        componentCode: "1F",
        componentTitle: "Paper 1 Foundation",
        year: 2023,
        series: "June",
        paperReference: "8461/1F",
        questionNumber: "1",
        sourceUrl: "https://example.invalid/e2e",
        sourceSha256: "e2e",
      },
      contentVersion: "e2e-v1",
    }],
    status: "active",
    answeredCount: 1,
    awardedTotal: 2,
    assessedTotal: question.marks,
    maxTotal: question.marks,
    createdAt: now - 300_000,
    updatedAt: now - 230_000,
  };
}

export async function seedExamPractice(db: EmulatorFirestore, userId: string, now: number) {
  await Promise.all([
    setDoc(doc(db, "users", userId, "examSessions", E2E_MARKED_SESSION_ID), markedSession(userId, now)),
    setDoc(doc(db, "users", userId, "examAttempts", E2E_MARKED_ATTEMPT_ID), markedAttempt(userId, now)),
    setDoc(doc(db, "users", userId, "studyFolders", E2E_EXAM_FOLDER_ID), {
      name: "Biology past papers",
      subject: "Biology",
      studyLevel: "gcse-equivalent",
      examCourse: E2E_EXAM_COURSE,
      color: null,
      icon: null,
      topicIds: [],
      archived: false,
      createdAt: now,
      updatedAt: now,
    }),
    setDoc(doc(db, "examFormatCatalogue", "aqa-8461-foundation"), {
      board: "aqa",
      status: "current",
      qualification: "gcse",
      specificationCode: E2E_EXAM_SPEC_ID,
      specificationTitle: "GCSE Biology (8461)",
      tier: E2E_EXAM_TIER,
      updatedAt: now,
    }),
    setDoc(doc(db, "examPapers", "e2e-exam-paper"), {
      id: "e2e-exam-paper",
      status: "published",
      activeFrom: now - 1_000,
      board: "aqa",
      specificationId: E2E_EXAM_SPEC_ID,
    }),
    ...E2E_EXAM_QUESTIONS.flatMap((item, index) => [
      setDoc(doc(db, "examQuestions", item.id), question(item, index, now)),
      setDoc(doc(db, "examQuestionSecrets", item.id), secret(item)),
    ]),
  ]);
}
