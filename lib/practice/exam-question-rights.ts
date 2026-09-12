import type { ExamBoardId } from "@/lib/practice/exam-formats";
import {
  canServeExamRights,
  isExamQuestionApproved,
  type ExamQuestion,
  type ExamRightsSnapshot,
} from "@/lib/practice/exam-questions";

export type ExamQuestionRightsRecord = ExamRightsSnapshot & {
  board: ExamBoardId | "jami";
  evidenceReference: string;
  checkedAt: number;
  notes: string;
};

/**
 * Where the agreements themselves live.
 *
 * Deliberately not a link or a message id. The licences are correspondence in
 * the owner's own mailbox, and a pointer into a private inbox is neither
 * useful to a reader nor something to commit; what a reader needs to know is
 * that evidence exists and who can produce it. Anyone auditing a board asks
 * the owner, who sends the agreement directly.
 */
const OWNER_HELD_EVIDENCE =
  "Owner-held licensing correspondence; request the agreement from the Jami owner.";

/**
 * Rights are intentionally fail-closed, and only a person may add to this list.
 *
 * Each record is written out in full rather than generated from a list of
 * boards, because the verbosity is the point: adding a board has to be a
 * deliberate act of asserting, one permission at a time, what that board has
 * actually agreed to. The ingestion pipeline may read these records; it may
 * never invent or promote one.
 *
 * The four permissions are separate grants and are not assumed from each
 * other. `aiInferenceAllowed` is the one that carries the most weight here: a
 * licence may well permit reproducing a paper for students without
 * contemplating the question and its mark scheme being sent to a third party's
 * model, and that transmission happens on every answer this feature marks.
 */
export const EXAM_QUESTION_RIGHTS: readonly ExamQuestionRightsRecord[] = [
  {
    key: "jami-original",
    version: 1,
    board: "jami",
    evidenceReference: "Jami-owned generated content",
    checkedAt: 1,
    notes: "Original fallback material; the board field describes alignment, not authorship.",
    verified: true,
    storageAllowed: true,
    studentDisplayAllowed: true,
    aiInferenceAllowed: true,
    revoked: false,
  },
  {
    key: "aqa-2026",
    version: 1,
    board: "aqa",
    evidenceReference: OWNER_HELD_EVIDENCE,
    checkedAt: Date.UTC(2026, 8, 9),
    notes:
      "AQA (England). Owner confirmed on 2026-09-09 that the licence covers " +
      "storage, display to students, and transmission to third-party AI providers " +
      "for marking.",
    verified: true,
    storageAllowed: true,
    studentDisplayAllowed: true,
    aiInferenceAllowed: true,
    revoked: false,
  },
  {
    key: "pearson_edexcel-2026",
    version: 1,
    board: "pearson_edexcel",
    evidenceReference: OWNER_HELD_EVIDENCE,
    checkedAt: Date.UTC(2026, 8, 9),
    notes:
      "Pearson Edexcel (England). Owner confirmed on 2026-09-09 that the licence covers " +
      "storage, display to students, and transmission to third-party AI providers " +
      "for marking.",
    verified: true,
    storageAllowed: true,
    studentDisplayAllowed: true,
    aiInferenceAllowed: true,
    revoked: false,
  },
  {
    key: "ocr-2026",
    version: 1,
    board: "ocr",
    evidenceReference: OWNER_HELD_EVIDENCE,
    checkedAt: Date.UTC(2026, 8, 9),
    notes:
      "OCR (England). Owner confirmed on 2026-09-09 that the licence covers " +
      "storage, display to students, and transmission to third-party AI providers " +
      "for marking.",
    verified: true,
    storageAllowed: true,
    studentDisplayAllowed: true,
    aiInferenceAllowed: true,
    revoked: false,
  },
  {
    key: "wjec-2026",
    version: 1,
    board: "wjec",
    evidenceReference: OWNER_HELD_EVIDENCE,
    checkedAt: Date.UTC(2026, 8, 9),
    notes:
      "WJEC (Wales). Owner confirmed on 2026-09-09 that the licence covers " +
      "storage, display to students, and transmission to third-party AI providers " +
      "for marking.",
    verified: true,
    storageAllowed: true,
    studentDisplayAllowed: true,
    aiInferenceAllowed: true,
    revoked: false,
  },
  {
    key: "eduqas-2026",
    version: 1,
    board: "eduqas",
    evidenceReference: OWNER_HELD_EVIDENCE,
    checkedAt: Date.UTC(2026, 8, 9),
    notes:
      "Eduqas (Wales and England). Owner confirmed on 2026-09-09 that the licence covers " +
      "storage, display to students, and transmission to third-party AI providers " +
      "for marking.",
    verified: true,
    storageAllowed: true,
    studentDisplayAllowed: true,
    aiInferenceAllowed: true,
    revoked: false,
  },
  {
    key: "ccea-2026",
    version: 1,
    board: "ccea",
    evidenceReference: OWNER_HELD_EVIDENCE,
    checkedAt: Date.UTC(2026, 8, 9),
    notes:
      "CCEA (Northern Ireland). Owner confirmed on 2026-09-09 that the licence covers " +
      "storage, display to students, and transmission to third-party AI providers " +
      "for marking.",
    verified: true,
    storageAllowed: true,
    studentDisplayAllowed: true,
    aiInferenceAllowed: true,
    revoked: false,
  },
  {
    key: "qualifications_scotland-2026",
    version: 1,
    board: "qualifications_scotland",
    evidenceReference: OWNER_HELD_EVIDENCE,
    checkedAt: Date.UTC(2026, 8, 9),
    notes:
      "Qualifications Scotland (Scotland). Owner confirmed on 2026-09-09 that the licence covers " +
      "storage, display to students, and transmission to third-party AI providers " +
      "for marking.",
    verified: true,
    storageAllowed: true,
    studentDisplayAllowed: true,
    aiInferenceAllowed: true,
    revoked: false,
  },
];

export function getExamQuestionRights(key: string, version: number) {
  return EXAM_QUESTION_RIGHTS.find((record) => record.key === key && record.version === version);
}

/**
 * The environment variable that turns each board off.
 *
 * Read through a function rather than captured in a constant: a kill switch
 * that binds its value when the module first loads is not a kill switch, it is
 * a build-time setting, and the one time it matters is the one time nobody
 * wants to wait for a redeploy.
 */
const BOARD_SWITCH_NAMES: Record<ExamBoardId, string> = {
  aqa: "EXAM_QUESTION_AQA_ENABLED",
  pearson_edexcel: "EXAM_QUESTION_PEARSON_EDEXCEL_ENABLED",
  ocr: "EXAM_QUESTION_OCR_ENABLED",
  wjec: "EXAM_QUESTION_WJEC_EDUQAS_ENABLED",
  eduqas: "EXAM_QUESTION_WJEC_EDUQAS_ENABLED",
  ccea: "EXAM_QUESTION_CCEA_ENABLED",
  qualifications_scotland: "EXAM_QUESTION_QUALIFICATIONS_SCOTLAND_ENABLED",
  cambridge_international: "EXAM_QUESTION_CAMBRIDGE_ENABLED",
  pearson_international: "EXAM_QUESTION_PEARSON_INTERNATIONAL_ENABLED",
  oxford_aqa: "EXAM_QUESTION_OXFORD_AQA_ENABLED",
  ib: "EXAM_QUESTION_IB_ENABLED",
};

/**
 * A board serves only when it has been switched on for this deployment.
 *
 * This used to default to on, so every board in the registry was servable the
 * moment a corpus existed for it -- and the registry's records all say the same
 * thing, in the same words, from the same day: the owner confirmed a licence
 * and holds the correspondence privately. That is a reasonable way to record a
 * licence and a poor way to decide that seven boards are ready for students at
 * once.
 *
 * Opt-in makes enabling a board a deliberate, per-board act, which is what
 * rolling out one validated course at a time requires. An explicit false-like
 * value still reads as off, so the switch keeps working as an emergency stop
 * for a board that was turned on.
 */
export function isExamQuestionBoardEnabled(board: ExamBoardId) {
  const value = process.env[BOARD_SWITCH_NAMES[board]]?.trim().toLowerCase();
  return ["1", "true", "on", "enabled"].includes(value ?? "");
}

/** Comma-separated specification IDs provide a narrower emergency switch. */
export function isExamQuestionSpecificationEnabled(specificationId: string) {
  const disabled = (process.env.EXAM_QUESTION_DISABLED_SPECIFICATIONS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return !disabled.includes(specificationId);
}

/**
 * Every gate a question passes before a student sees it.
 *
 * Official material waits on two separate checks, because they catch different
 * things. A review -- by a model or a person, recorded either way -- reads this
 * question against the page it came from. A spot-check is a person sampling the
 * paper it came out of, which is the only one of the two that can notice a
 * fault running through the whole extraction rather than sitting in one
 * question.
 *
 * Jami-created fillers need neither: nothing was extracted, and nothing
 * licensed can be got wrong.
 */
export function isExamQuestionServable(question: ExamQuestion) {
  const rights = getExamQuestionRights(question.rights.key, question.rights.version);
  const official = question.origin === "official_past_paper";
  return Boolean(
    question.status === "published" &&
      (!official || isExamQuestionApproved(question.review)) &&
      /*
       * A model may approve a question; a person has to have sampled its paper.
       *
       * Approval is a model reading one question against one rendered page, and
       * the faults worth catching in extraction are systematic -- a scheme
       * paired one question out, a region located on the wrong page -- which a
       * per-question reviewer is the wrong shape to notice. Without this, "we
       * spot-check the corpus" is a habit somebody keeps rather than a
       * condition anything enforces, and a paper nobody ever got round to
       * would serve exactly like one that passed.
       */
      (!official || typeof question.paperSpotCheckedAt === "number") &&
      canServeExamRights(question.rights) &&
      rights &&
      canServeExamRights(rights) &&
      (official
        ? rights.board === question.provenance.board
        : rights.board === "jami") &&
      // The board switch is a rights control, so it covers the board's own
      // material and not Jami's. A Jami-created question names the board it is
      // aligned to, which is not the same as being the board's to withdraw --
      // and switching AQA off must not silently take out the original questions
      // written to stand in for it.
      (!official || isExamQuestionBoardEnabled(question.provenance.board)) &&
      // The specification switch does cover both: a superseded spec makes a
      // question wrong for the course whoever wrote it.
      isExamQuestionSpecificationEnabled(question.provenance.specificationId),
  );
}
