import type { ExamBoardId } from "@/lib/practice/exam-formats";

/**
 * The corpus rollout, in the order it is actually being built.
 *
 * England's three big boards and the quantitative subjects first, because
 * those are where a mark scheme is most nearly objective: a maths or science
 * scheme awards on specific values, terms and steps, so an extraction can be
 * checked against the page with much less ambiguity than an essay band
 * descriptor. Getting the loop right on those before touching banded marking
 * is deliberate, not an accident of ordering.
 *
 * The codes here are the boards' own specification codes and are what the
 * discovery step matches links against. They go stale when a board reissues a
 * specification, which is why nothing reads them as truth -- the catalogue
 * decides what is current, and this only decides what to look for first.
 */
export type ExamCorpusTarget = {
  board: ExamBoardId;
  subject: string;
  level: "gcse" | "a_level";
  specificationId: string;
};

export const ENGLAND_MATHS_AND_SCIENCE: readonly ExamCorpusTarget[] = [
  // AQA
  { board: "aqa", subject: "Mathematics", level: "gcse", specificationId: "8300" },
  { board: "aqa", subject: "Biology", level: "gcse", specificationId: "8461" },
  { board: "aqa", subject: "Chemistry", level: "gcse", specificationId: "8462" },
  { board: "aqa", subject: "Physics", level: "gcse", specificationId: "8463" },
  { board: "aqa", subject: "Combined Science: Trilogy", level: "gcse", specificationId: "8464" },
  { board: "aqa", subject: "Mathematics", level: "a_level", specificationId: "7357" },
  { board: "aqa", subject: "Biology", level: "a_level", specificationId: "7402" },
  { board: "aqa", subject: "Chemistry", level: "a_level", specificationId: "7405" },
  { board: "aqa", subject: "Physics", level: "a_level", specificationId: "7408" },

  // Pearson Edexcel
  { board: "pearson_edexcel", subject: "Mathematics", level: "gcse", specificationId: "1MA1" },
  { board: "pearson_edexcel", subject: "Biology", level: "gcse", specificationId: "1BI0" },
  { board: "pearson_edexcel", subject: "Chemistry", level: "gcse", specificationId: "1CH0" },
  { board: "pearson_edexcel", subject: "Physics", level: "gcse", specificationId: "1PH0" },
  { board: "pearson_edexcel", subject: "Combined Science", level: "gcse", specificationId: "1SC0" },
  { board: "pearson_edexcel", subject: "Mathematics", level: "a_level", specificationId: "9MA0" },
  { board: "pearson_edexcel", subject: "Biology A", level: "a_level", specificationId: "9BN0" },
  { board: "pearson_edexcel", subject: "Chemistry", level: "a_level", specificationId: "9CH0" },
  { board: "pearson_edexcel", subject: "Physics", level: "a_level", specificationId: "9PH0" },

  // OCR
  { board: "ocr", subject: "Mathematics", level: "gcse", specificationId: "J560" },
  { board: "ocr", subject: "Biology A", level: "gcse", specificationId: "J247" },
  { board: "ocr", subject: "Chemistry A", level: "gcse", specificationId: "J248" },
  { board: "ocr", subject: "Physics A", level: "gcse", specificationId: "J249" },
  { board: "ocr", subject: "Combined Science A", level: "gcse", specificationId: "J250" },
  { board: "ocr", subject: "Mathematics A", level: "a_level", specificationId: "H240" },
  { board: "ocr", subject: "Biology A", level: "a_level", specificationId: "H420" },
  { board: "ocr", subject: "Chemistry A", level: "a_level", specificationId: "H432" },
  { board: "ocr", subject: "Physics A", level: "a_level", specificationId: "H556" },
];

export function examCorpusTargetsForBoard(board: ExamBoardId) {
  return ENGLAND_MATHS_AND_SCIENCE.filter((target) => target.board === board);
}
