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
