import type { StudyModeResults } from "@/lib/study/session";
import { isStudyMode, type StudyAnswerOutcome, type StudyMode } from "@/lib/study/study-modes";

/** One more answer in a mode, added to the session's tally. */
export function addModeAnswer(
  results: StudyModeResults,
  mode: StudyMode,
  outcome: StudyAnswerOutcome,
  assisted: boolean
): StudyModeResults {
  const previous = results[mode] ?? { answered: 0, correct: 0, partial: 0, uncertain: 0, assisted: 0 };
  return {
    ...results,
    [mode]: {
      answered: previous.answered + 1,
      correct: previous.correct + (outcome === "correct" ? 1 : 0),
      partial: (previous.partial ?? 0) + (outcome === "partial" ? 1 : 0),
      uncertain: (previous.uncertain ?? 0) + (outcome === "uncertain" ? 1 : 0),
      assisted: (previous.assisted ?? 0) + (assisted ? 1 : 0),
    },
  };
}

/** How many answers each mode has had so far, which Smart Mix balances against. */
export function countModeAnswers(results: StudyModeResults): Partial<Record<StudyMode, number>> {
  const counts: Partial<Record<StudyMode, number>> = {};
  for (const [mode, result] of Object.entries(results)) {
    if (isStudyMode(mode)) counts[mode] = result?.answered ?? 0;
  }
  return counts;
}

/** Every answer the session has had, in any mode. */
export function countAllModeAnswers(results: StudyModeResults) {
  return Object.values(results).reduce((sum, result) => sum + (result?.answered ?? 0), 0);
}

/** The modes a session used, in the order it first used them. */
export function listModeResults(results: StudyModeResults) {
  return Object.entries(results).flatMap(([mode, result]) =>
    isStudyMode(mode) && result ? [{ mode, answered: result.answered, correct: result.correct }] : []
  );
}
