import { isValidEvidenceTime } from "@/lib/learning/evidence-time";
import { tutorCheckMarkedAnswer, type TutorCheck } from "@/lib/learning/events/tutor-check";
import { markedAnswerWeight, readMarkedAnswer } from "@/lib/learning/profile/marked-answer";
import type { LearningObservation } from "@/lib/learning/types";

/**
 * Tutor's quick checks, as evidence about what a student knows.
 *
 * The weakest evidence the engine reads, and weighted below notebook marking
 * (`evidenceSourceWeight`) for reasons about the evidence itself:
 *
 * - It is marked by a model, against points it chose a moment earlier.
 * - It is often asked straight after Tutor has explained the idea, and an
 *   answer then says the explanation was followed more than that the idea has
 *   stuck -- the reason Revision Sessions do not count their guided step.
 * - It is one short question, answered with the conversation on screen.
 *
 * So a run of quick checks can move a topic, and can never decide one alone.
 */
export function tutorCheckObservations(checks: readonly TutorCheck[]): LearningObservation[] {
  const observations: LearningObservation[] = [];
  const seen = new Set<string>();
  for (const check of checks) {
    if (!check.id || seen.has(check.id) || !isValidEvidenceTime(check.markedAt)) continue;
    if (check.topicKeys.length === 0) continue;
    const read = readMarkedAnswer(tutorCheckMarkedAnswer(check));
    if (!read) continue;
    seen.add(check.id);

    const itemId = `tutor-check:${check.id}`;
    const share = 1 / check.topicKeys.length;
    observations.push({
      kind: "tutor-check",
      evidenceId: itemId,
      itemId,
      topicKeys: [...check.topicKeys],
      topicShares: Object.fromEntries(check.topicKeys.map((key) => [key, share])),
      score: read.score,
      weight: markedAnswerWeight(read.maxMarks),
      count: 1,
      at: check.markedAt,
      trendEligible: true,
      errorChecks: read.errorChecks,
    });
  }
  return observations;
}
