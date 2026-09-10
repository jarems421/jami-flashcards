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
