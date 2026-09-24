/**
 * One exam question, marked outside the request that submitted it.
 *
 * There is no concurrency lease here, unlike whole-paper marking. That one
 * exists to stop a handful of long ensembles saturating the provider; a single
 * question is one to three calls, and the per-student daily and burst
 * allowances are already taken by the submit request before this is queued.
 * Adding a service-wide lease would only make students queue behind each other
 * for capacity nothing has shown to be short.
 */
export async function markExamQuestionWorkflow(uid: string, attemptId: string, token: string) {
  "use workflow";

  /*
   * No cancellation step first. The marking step checks the same thing on the
   * documents it has to read anyway, and a step of its own cost the student a
   * queue hop and four reads before any marker had started.
   */
  try {
    return { status: await runMarking(uid, attemptId, token) };
  } catch {
    /*
     * The service settles its own failures, so reaching here means the step
     * itself did not survive -- a redeploy mid-call, or a crash. The attempt
     * would otherwise sit at `marking` until its lease ran out, telling the
     * student to keep waiting for something with nothing left to finish it.
     */
    await failMarking(uid, attemptId, token);
    return { status: "failed" as const };
  }
}

async function runMarking(uid: string, attemptId: string, token: string) {
  "use step";
  const service = await import("@/services/practice/exam-marking.server");
  return service.runExamQuestionMarking(uid, attemptId, token);
}

async function failMarking(uid: string, attemptId: string, token: string) {
  "use step";
  const service = await import("@/services/practice/exam-marking.server");
  return service.failExamQuestionMarking(uid, attemptId, "marking_failed", token);
}
