import { examSheetPageAssetNumber } from "@/lib/practice/exam-question-sheet";
import type { PracticePaperQuestionAsset } from "@/lib/practice/practice-papers";

/** Scheme-page facsimiles can contain neighbouring answers. Never serve them
 * as question material, even after marking. The marked attempt has its own
 * question-specific, answer-gated scheme presentation. Keep the legacy ID
 * blocked for existing bank records and already-projected sessions. */
export function candidateExamAssets(question: {
  assets: PracticePaperQuestionAsset[];
  reviewAssets?: PracticePaperQuestionAsset[];
}): PracticePaperQuestionAsset[] {
  const privateIds = new Set(question.reviewAssets?.map((asset) => asset.id));
  return question.assets.filter((asset) =>
    asset.id !== "scheme-extract" && !privateIds.has(asset.id)
  );
}

/**
 * The question material one marking call is sent.
 *
 * A student may be shown the paper twice over -- stitched into one image, and
 * again as the separate pages that make a sheet to write on -- because the two
 * serve different screens. A marker must not be: the pages are the same pixels
 * as the stitch, so sending both doubles the licensed bytes on the wire, spends
 * the vision budget twice on one question, and invites a model to read the
 * overlap between two crops as two different pieces of paper.
 */
export function markerExamAssets(question: {
  assets: PracticePaperQuestionAsset[];
  reviewAssets?: PracticePaperQuestionAsset[];
}): PracticePaperQuestionAsset[] {
  const candidates = candidateExamAssets(question);
  const stitched = candidates.filter((asset) => examSheetPageAssetNumber(asset.id) === null);
  // Unless the stitch is all there is: a question ingested as pages only would
  // otherwise be marked with no picture at all.
  return stitched.length > 0 ? stitched : candidates;
}
