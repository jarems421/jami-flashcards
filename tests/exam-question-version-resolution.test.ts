import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A session keeps the question it started on, after the paper is re-ingested.
 *
 * The scheme has honoured the session's version for a while. The question did
 * not, so re-ingesting a paper changed the wording and the images a running
 * session displayed, the images sent to the marker, and the images copied into
 * a notebook -- while the scheme stayed correctly pinned to the old version.
 * The two halves of the same question could come from different ingests, which
 * is worse than either being stale.
 *
 * Versioned image paths alone do not fix this: they stop the bytes being
 * overwritten, but every read still asked for "the assets of question X", and
 * that record now points somewhere else.
 */
const store = new Map<string, Record<string, unknown>>();

const snapshotFor = (path: string) => ({
  exists: store.has(path),
  id: path.split("/").at(-1)!,
  data: () => store.get(path),
});

function collectionFor(path: string) {
  return { doc: (id: string) => ({ get: async () => snapshotFor(`${path}/${id}`) }) };
}

const db = {
  collection: (name: string) => ({
    ...collectionFor(name),
    doc: (id: string) => ({
      get: async () => snapshotFor(`${name}/${id}`),
      collection: (child: string) => collectionFor(`${name}/${id}/${child}`),
    }),
  }),
};

vi.mock("server-only", () => ({}));
vi.mock("@/services/firebase/admin", () => ({
  getAdminDb: () => db,
  getAdminStorageBucket: () => ({ file: () => ({ download: async () => [Buffer.from("")] }) }),
}));

const { loadServableExamQuestion } = await import("@/services/practice/exam-evidence.server");

const RIGHTS = {
  key: "aqa-2026",
  version: 1,
  verified: true,
  storageAllowed: true,
  studentDisplayAllowed: true,
  aiInferenceAllowed: true,
  revoked: false,
};

function questionAt(version: string, imagePath: string, prompt: string) {
  return {
    id: "question-1",
    paperId: "paper-1",
    subject: "Biology",
    subjectKey: "biology",
    studyLevel: "gcse-equivalent",
    label: "Question 1",
    prompt,
    marks: 3,
    contentVersion: version,
    topicIds: [],
    difficulty: "medium",
    status: "published",
    origin: "official_past_paper",
    humanChecked: true,
    review: { status: "approved", reviewedBy: "owner", reviewedAt: 1 },
    rights: RIGHTS,
    assets: [
      {
        id: "question-extract",
        type: "image",
        title: "Original question layout",
        storagePath: imagePath,
        mimeType: "image/png",
      },
    ],
    provenance: {
      board: "aqa",
      boardLabel: "AQA",
      qualification: "gcse",
      specificationId: "8461",
      componentCode: "8461/1F",
      specificationTitle: "GCSE Biology (8461)",
      componentTitle: "Paper 1 Foundation",
    },
  };
}

const ORIGINAL = questionAt(
  "v1",
  "internal/examQuestionBank/aqa/paper-1/question-1-v1-question.png",
  "Describe the original diagram."
);
const REISSUED = questionAt(
  "v2",
  "internal/examQuestionBank/aqa/paper-1/question-1-v2-question.png",
  "Describe the redrawn diagram."
);

beforeEach(() => {
  // Boards are opt-in now, so a fixture corpus needs its board switched on.
  process.env.EXAM_QUESTION_AQA_ENABLED = "true";
  store.clear();
  store.set("examPapers/paper-1", { status: "published", activeFrom: 0 });
});

describe("a session that started before the paper was re-ingested", () => {
  /** The state after a re-ingest: v2 live, v1 archived beside it. */
  function reingest() {
    store.set("examQuestions/question-1", REISSUED);
    store.set("examQuestionRevisions/question-1_v1", { question: ORIGINAL, archivedAt: 2 });
  }

  it("still serves the wording and the image it started on", async () => {
    reingest();
    const question = await loadServableExamQuestion("question-1", "student-1", "v1");
    expect(question.prompt).toBe("Describe the original diagram.");
    expect(question.assets[0].storagePath).toContain("question-1-v1-question.png");
  });

  it("serves the current question to a session that started on it", async () => {
    reingest();
    const question = await loadServableExamQuestion("question-1", "student-1", "v2");
    expect(question.prompt).toBe("Describe the redrawn diagram.");
  });

  it("serves the current question when no version is asked for", async () => {
    reingest();
    const question = await loadServableExamQuestion("question-1", "student-1");
    expect(question.prompt).toBe("Describe the redrawn diagram.");
  });

  /*
   * Substituting today's question for a version that was never archived is
   * exactly the swap this exists to prevent, so it refuses instead. Marking
   * already treats `question_changed` as final rather than retryable.
   */
  it("refuses rather than substituting when the version was never archived", async () => {
    store.set("examQuestions/question-1", REISSUED);
    await expect(loadServableExamQuestion("question-1", "student-1", "v1")).rejects.toThrow(
      "question_changed"
    );
  });

  /*
   * An archived version is historical content, not a historical licence. If
   * the board's permission goes, the old version stops being servable at the
   * same moment the current one does.
   */
  it("still refuses an archived version once its licence is revoked", async () => {
    store.set("examQuestions/question-1", REISSUED);
    store.set("examQuestionRevisions/question-1_v1", {
      question: { ...ORIGINAL, rights: { ...RIGHTS, revoked: true } },
      archivedAt: 2,
    });
    await expect(loadServableExamQuestion("question-1", "student-1", "v1")).rejects.toThrow(
      "question_unavailable"
    );
  });

  it("refuses an archived version once the paper itself is withdrawn", async () => {
    reingest();
    store.set("examPapers/paper-1", { status: "withdrawn", activeFrom: 0 });
    await expect(loadServableExamQuestion("question-1", "student-1", "v1")).rejects.toThrow(
      "question_unavailable"
    );
  });

  /** Nothing has been re-ingested: the live question is the session's own. */
  it("needs no archive when the question has not changed", async () => {
    store.set("examQuestions/question-1", ORIGINAL);
    const question = await loadServableExamQuestion("question-1", "student-1", "v1");
    expect(question.assets[0].storagePath).toContain("question-1-v1-question.png");
  });
});
