import { readMarkedAnswer, type StoredMarkedAnswer } from "@/lib/learning/profile/marked-answer";
import { isValidEvidenceTime } from "@/lib/learning/evidence-time";
import type { LearningObservation } from "@/lib/learning/types";

/**
 * Marked notebook working, as evidence about what a student knows.
 *
 * Until now a notebook counted only as exposure -- "they have notes on this"
 * -- which is right for notes and wrong for working that Tutor has actually
 * marked. A student who works a question through in their notebook and has it
 * marked has demonstrated something, and the engine was throwing that away
 * while counting a flashcard tapped "good" in half a second.
 *
 * It is admitted at a fraction of the weight, for reasons that are about the
 * evidence rather than about caution:
 *
 * - It is marked by a model against the question, not by a scheme against a
 *   tariff. The score is an opinion, and a generous one when working is
 *   partial.
 * - The student chose the question. Work someone selects for themselves is
 *   not a random sample of what they can do, and skews easy.
 * - Working is often unfinished, and a page can be marked mid-thought.
 *
 * So it moves a mastery estimate, and it can never by itself carry a topic
 * past the confidence needed to call it strong. Everything downstream --
 * capping per item, sharing across concepts, recency -- applies unchanged.
 */

/**
 * What one marked notebook page is worth against one marked exam question.
 *
 * A third. Chosen to sit below a past-paper answer (1.0) and a practice-paper
 * question, and above nothing, which is what it was worth before. This is a
 * hand-set starting point like every constant in `tuning.ts` and it belongs in
 * the same fitting process once there is enough marked notebook work to fit it
 * against.
 */
export const NOTEBOOK_EVIDENCE_WEIGHT = 1 / 3;

export type NotebookMarkedWorking = {
  /** The marking record's own id, so one marking can never count twice. */
  id: string;
  notebookId: string;
  /** The page marked, so re-marking the same page replaces rather than adds. */
  pageId?: string;
  topicIds?: readonly string[];
  markedAt: number;
  result: StoredMarkedAnswer;
};

/**
 * Observations from a student's marked notebook working.
 *
 * Working with no topic is dropped rather than attributed to the notebook as a
 * whole: a notebook is not a concept, and evidence that cannot be placed is
 * not evidence the engine can use.
 */
export function notebookObservations(
  markings: readonly NotebookMarkedWorking[]
): LearningObservation[] {
  const observations: LearningObservation[] = [];
  const seen = new Set<string>();

  /*
   * Most recent first, so the page-level de-duplication below keeps the latest
   * marking of a page rather than whichever one the caller happened to load
   * first. Re-marking a page after working on it further must not be read as
   * the earlier, worse attempt.
   */
  const ordered = [...markings].sort(
    (left, right) => right.markedAt - left.markedAt || left.id.localeCompare(right.id)
  );

  for (const marking of ordered) {
    if (!isValidEvidenceTime(marking.markedAt)) continue;
    const topicKeys = (marking.topicIds ?? [])
      .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      .map((id) => `topic:${id.trim()}`);
    if (topicKeys.length === 0) continue;

    const read = readMarkedAnswer(marking.result);
    if (!read) continue;

    /*
     * One observation per page, not per marking.
     *
     * Asking Tutor to check the same page twice is one piece of evidence about
     * the student, looked at twice. Keyed on the page so the most recent
     * marking of it wins, and on the marking id only when there is no page.
     */
    const itemId = marking.pageId
      ? `notebook:${marking.notebookId}:${marking.pageId}`
      : `notebook:${marking.notebookId}:${marking.id}`;
    if (seen.has(itemId)) continue;
    seen.add(itemId);

    const share = 1 / topicKeys.length;
    observations.push({
      kind: "notebook",
      evidenceId: `notebook-marking:${marking.id}`,
      itemId,
      topicKeys,
      topicShares: Object.fromEntries(topicKeys.map((key) => [key, share])),
      score: read.score,
      weight: NOTEBOOK_EVIDENCE_WEIGHT,
      count: 1,
      at: marking.markedAt,
      // Each marking is dated, so a series of them is a real change over time.
      trendEligible: true,
      errorChecks: read.errorChecks,
    });
  }

  return observations;
}
