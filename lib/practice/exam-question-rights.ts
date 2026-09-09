import type { ExamBoardId } from "@/lib/practice/exam-formats";
import { canServeExamRights, type ExamQuestion, type ExamRightsSnapshot } from "@/lib/practice/exam-questions";

export type ExamQuestionRightsRecord = ExamRightsSnapshot & {
  board: ExamBoardId | "jami";
  evidenceReference: string;
  checkedAt: number;
  notes: string;
};

/**
 * Rights are intentionally fail-closed. Populate evidence references from the
 * owner's written agreements before enabling a board in production. The
 * ingestion pipeline may read these records; it may never invent or promote
 * one of them.
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

/** A literal false-like value is an immediate board kill switch. */
export function isExamQuestionBoardEnabled(board: ExamBoardId) {
  const value = process.env[BOARD_SWITCH_NAMES[board]]?.trim().toLowerCase();
  return !value || !["0", "false", "off", "disabled"].includes(value);
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
 * Official material additionally waits on `humanChecked`. Extraction and the
 * audit pass are both model work, and licensed exam material is not something
 * to put in front of a student on model output alone -- a person confirms the
 * question, its tariff and its scheme before the status means anything.
 * Jami-created fillers are exempt because nothing was licensed to get wrong.
 */
export function isExamQuestionServable(question: ExamQuestion) {
  const rights = getExamQuestionRights(question.rights.key, question.rights.version);
  const official = question.origin === "official_past_paper";
  return Boolean(
    question.status === "published" &&
      (!official || question.humanChecked === true) &&
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
