import { readMarkedAnswer, type StoredMarkedAnswer } from "@/lib/learning/profile/marked-answer";

/**
 * A marked practice paper, read as "the work Jami asked for is done".
 *
 * Only a paper Jami wrote in answer to a recommendation can say this, which is
 * why the provenance is stored on the paper rather than inferred: a paper the
 * student made themselves is not an intervention being completed, however
 * similar it looks once it is marked.
 *
 * The moment is marking rather than submitting. For a flashcard session the
 * two are the same instant, but a practice paper is submitted and then marked
 * afterwards, and until it is marked there is nothing to count -- no marks, no
 * evidence, and no honest number to show the student.
 */

export type PracticeMissionCompletion = {
  interventionId: string;
  conceptLabel: string;
  /** Questions that produced a mark the engine will actually count. */
  answered: number;
  /** Questions the paper asked. */
  targetItems: number;
};

type MarkedPaper = {
  createdByInterventionId?: string;
  coverage?: string;
  title?: string;
  questions?: readonly unknown[];
  result?: { questionResults?: readonly unknown[] } | undefined;
};

/**
 * How many answers actually counted.
 *
 * Deliberately the engine's own rule rather than a second version of it: an
 * unattempted question is stored as a result like any other, and counting rows
 * would tell a student who answered two of five that they answered five. The
 * two definitions would then drift, and the one on screen would be the wrong
 * one.
 */
export function countedAnswers(result: MarkedPaper["result"]) {
  return (result?.questionResults ?? []).filter(
    (entry) => readMarkedAnswer(entry as StoredMarkedAnswer) !== null
  ).length;
}

/**
 * What to record, or nothing.
 *
 * Nothing when the paper was not Jami's idea, and nothing when the sitting
 * produced no countable answer -- a paper opened, submitted blank and marked
 * zero is not the recommendation having been carried out, and saying so would
 * both mislead the student and rest advice they still need.
 */
export function practiceMissionCompletion(
  paper: MarkedPaper | null | undefined
): PracticeMissionCompletion | null {
  const interventionId = paper?.createdByInterventionId?.trim();
  if (!paper || !interventionId) return null;

  const answered = countedAnswers(paper.result);
  if (answered <= 0) return null;

  return {
    interventionId,
    conceptLabel: paper.coverage?.trim() || paper.title?.trim() || "This paper",
    answered,
    targetItems: paper.questions?.length ?? answered,
  };
}
