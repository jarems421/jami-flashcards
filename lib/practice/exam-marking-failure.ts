export type ExamMarkingFailureCode =
  | "marking_failed"
  | "input_too_large"
  | "question_changed"
  | "budget_exhausted";

export type ExamMarkingFailure = {
  code: ExamMarkingFailureCode;
  message: string;
  at: number;
};

/**
 * What the student is told when a marking does not produce a mark.
 *
 * These used to be written straight into the submit route's catch, which
 * worked while marking happened inside that request. It does not any more: the
 * response returns while the marking is still queued, so the reason has to be
 * left on the attempt for the page to find later. Same words, one move further
 * from the failure.
 *
 * Three of them are worth distinguishing because they ask the student for
 * different things -- shorten it, nothing, try again -- and collapsing them
 * into "Jami couldn't mark this one" tells someone to retry a submission that
 * will fail identically every time.
 */
export function examMarkingFailureMessage(code: ExamMarkingFailureCode) {
  switch (code) {
    case "input_too_large":
      return "That answer and working are longer than Jami can mark in one go. Your answer is open for editing again — shorten it, or erase some working, then submit.";
    case "question_changed":
      return "This question was updated after you started. Your answer is saved, but Jami will not mark it against a different mark scheme.";
    case "budget_exhausted":
      return "You have reached today's marking limit. Your answer is saved and can be marked tomorrow.";
    default:
      return "Jami couldn't mark this one — your answer is saved.";
  }
}

/**
 * Whether resubmitting the identical evidence could ever succeed.
 *
 * An oversized request never reached a provider and never will while it is
 * that size, and a question that changed under a live session will not be
 * marked against its new scheme at all. Offering "Retry marking" for either is
 * an invitation to a loop.
 */
export function examMarkingFailureIsRetryable(code: ExamMarkingFailureCode) {
  return code === "marking_failed";
}

export function examMarkingFailure(code: ExamMarkingFailureCode, at: number): ExamMarkingFailure {
  return { code, message: examMarkingFailureMessage(code), at };
}

/**
 * The same failures, told from the mark check's side.
 *
 * A check is not a marking and the difference matters to the student: their
 * mark and feedback still stand, and -- because a check that produced nothing
 * is not a check -- their one check has not been spent. Reusing the marking
 * sentences here would tell someone their answer was not marked when it was.
 */
export function examReviewFailureMessage(code: ExamMarkingFailureCode) {
  switch (code) {
    case "input_too_large":
      return "There is too much here for Jami to check in one go. Your mark and feedback stand, and your check has not been used up.";
    case "question_changed":
      return "This question was updated after you started, so Jami will not check the mark against a different mark scheme. Your mark and feedback stand.";
    case "budget_exhausted":
      return "You have reached today's limit for checking marks. Your check has not been used up, and you can ask again tomorrow.";
    default:
      return "Jami couldn't check this mark just now. Your mark and feedback stand, and your check has not been used up.";
  }
}

export function examReviewFailure(code: ExamMarkingFailureCode, at: number): ExamMarkingFailure {
  return { code, message: examReviewFailureMessage(code), at };
}
