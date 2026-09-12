/**
 * One student-requested check of a mark, outside the request that asked for it.
 *
 * Queued like a marking and for the same reason, but bounded differently: a
 * student gets one check per answer, so this is never a queue of work competing
 * for capacity the way whole-paper marking is, and it takes no service-wide
 * lease.
 */
export async function reviewExamQuestionWorkflow(uid: string, attemptId: string, token: string) {
  "use workflow";

  if (await reviewIsCancelled(uid, attemptId, token)) return { status: "cancelled" as const };
  try {
    return { status: await runReview(uid, attemptId, token) };
  } catch {
    /*
     * The service settles its own failures, so reaching here means the step
     * itself did not survive -- a redeploy mid-call, or a crash. The attempt
     * would otherwise read `reviewing` until its lease ran out, with the
     * student's one check apparently spent on nothing.
     */
    await failReview(uid, attemptId, token);
    return { status: "failed" as const };
  }
}

async function reviewIsCancelled(uid: string, attemptId: string, token: string) {
  "use step";
  const service = await import("@/services/practice/exam-review.server");
  return service.examReviewIsCancelled(uid, attemptId, token);
}

async function runReview(uid: string, attemptId: string, token: string) {
  "use step";
  const service = await import("@/services/practice/exam-review.server");
  return service.runExamQuestionReview(uid, attemptId, token);
}

async function failReview(uid: string, attemptId: string, token: string) {
  "use step";
  const service = await import("@/services/practice/exam-review.server");
  return service.failExamQuestionReview(uid, attemptId, "marking_failed", token);
}
