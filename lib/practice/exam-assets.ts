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

/**
 * Whether a whole mark-scheme page would show a scheme the student has not
 * earned yet.
 *
 * The page served after marking is the board's facsimile, and one printed page
 * carries several questions' schemes. Which page each question sits on is not
 * kept, only which paper, so any other question from the same paper that is
 * still waiting in this session could be on it. Until every one of those is
 * marked the page waits; the question's own scheme text is shown instead, and
 * the page arrives once there is nothing left on it to give away.
 */
export function schemePageRevealsUnanswered(input: {
  paperId: string;
  siblings: readonly { paperId?: string; unlocked: boolean }[];
}) {
  return input.siblings.some((sibling) => sibling.paperId === input.paperId && !sibling.unlocked);
}
