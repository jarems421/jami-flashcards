import { createHash } from "node:crypto";
import type { PracticePaperMarkSchemeItem } from "@/lib/practice/practice-papers";
import type { QuestionRegion } from "@/lib/practice/exam-page-regions";

/**
 * What a question currently says, as a hash of its own content.
 *
 * A session snapshots a question's wording but marking loads the scheme by id,
 * so re-ingesting a paper used to mark a student against a scheme that no
 * longer belonged to the question in front of them. The version travels with
 * the session, and marking will not use a scheme that does not match it.
 *
 * It covers the picture as well as the words. A question is very often the
 * picture -- a graph, a circuit, a source extract -- so the region and page say
 * which part of which page is cut out, and the paper's own hash says which
 * document it was cut from. Any change to the source is a change of identity.
 *
 * It lives here, alone, because two separate things now compute it and they
 * must not be able to drift. Ingestion computes it to stamp a question.
 * The sheet backfill computes it to *prove* it has recovered the very regions
 * a stored question was built from, before it dares render anything over them:
 * if the recomputed version matches the stored one, every input to it matched,
 * and the regions are the same slice of the same paper. That proof is only
 * worth anything while both sides hash the same way, byte for byte -- so the
 * field order below is part of the contract, not a formatting choice.
 */
export function examQuestionContentVersion(input: {
  prompt: string;
  marks: number;
  markSchemeItem: PracticePaperMarkSchemeItem;
  page: number;
  regions: QuestionRegion[];
  paperSha256: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        prompt: input.prompt,
        marks: input.marks,
        markSchemeItem: input.markSchemeItem,
        page: input.page,
        regions: input.regions,
        paperSha256: input.paperSha256,
      })
    )
    .digest("hex")
    .slice(0, 16);
}
