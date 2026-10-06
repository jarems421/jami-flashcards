import type { ExamQuestion } from "@/lib/practice/exam-questions";
import type { PracticePaperQuestionAsset } from "@/lib/practice/practice-papers";

/** The id ingestion gives the crop of a question exactly as the board printed it. */
export const EXAM_PRINTED_QUESTION_ASSET_ID = "question-extract";

/**
 * Whether a question is shown as its printed page rather than as text.
 *
 * An ingested question carries both the board's own crop and a transcription
 * of it, and showing the two stacked put the same question on screen twice --
 * once retyped, once as printed. The printed page is the real question, so it
 * is shown alone; the transcription stays for screen readers. A question Jami
 * wrote has no printed page, so its text is the question.
 */
export function examQuestionShowsPrintedPage(question: {
  origin?: string;
  assets: Pick<PracticePaperQuestionAsset, "id" | "type">[];
}) {
  return (
    question.origin !== "jami_generated" &&
    question.assets.some(
      (asset) => asset.id === EXAM_PRINTED_QUESTION_ASSET_ID && asset.type === "image"
    )
  );
}

/** Where a question came from, in one line: board, sitting, paper and number. */
export function examQuestionProvenanceLine(question: Pick<ExamQuestion, "origin" | "provenance">) {
  // Jami's own questions have no sitting to name; a year there read as a real paper's date.
  if (question.origin === "jami_generated") return "Jami-created · not from a past paper";
  const { boardLabel, series, year, paperReference, questionNumber } = question.provenance;
  return [boardLabel, `${series} ${year}`, paperReference, `Q${questionNumber}`].filter(Boolean).join(" · ");
}

/**
 * What a question is worth, and what else the paper offers for it.
 *
 * AQA English Literature prints "[30 marks] AO4 [4 marks]" under its Section A
 * questions: thirty for the answer, four more for technical accuracy scored
 * across the section from its own grid. Jami marks the thirty and says so,
 * rather than showing a score out of thirty and leaving a student to wonder
 * why their paper says thirty-four. Empty for a question with nothing extra.
 */
export function examQuestionTariffNote(question: Pick<ExamQuestion, "marks" | "separateAwardMarks">) {
  if (!question.separateAwardMarks) return "";
  return `The paper awards ${question.separateAwardMarks} further marks for technical accuracy across this section. Jami marks the ${question.marks} for your answer, and does not mark spelling or punctuation.`;
}
