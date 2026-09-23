import type { LearningErrorCategory } from "@/lib/learning/types";
import type {
  RevisionAnswerStepKind,
  RevisionMistake,
  RevisionPolicy,
  RevisionSessionRecord,
  RevisionStepKind,
  RevisionStepRecord,
  RevisionVerdict,
} from "@/lib/revision/types";

/**
 * The shape of a Revision Session, and the only thing that moves one on.
 *
 * The model never chooses what comes next. It writes the lesson and marks
 * answers; this decides, from the marks, which step follows. That is what
 * keeps a session predictable, testable and honest about what it knows --
 * and it is why a session cannot wander off into "here's another explanation"
 * forever.
 *
 * Pure: time comes in on the event, and nothing here reads a clock or a store.
 */

/** Each policy's path. `retry` is never on one; see `needsRetry`. */
export const REVISION_POLICY_PATHS: Readonly<Record<RevisionPolicy, readonly RevisionStepKind[]>> = {
  teach: ["orient", "explain", "guided", "independent", "apply", "retrieve"],
};

const ANSWER_STEPS: ReadonlySet<RevisionStepKind> = new Set<RevisionAnswerStepKind>([
  "guided",
  "retry",
  "independent",
  "apply",
  "retrieve",
]);

/** A guided attempt below this is the one that earns a second explanation. */
const RETRY_BELOW_SCORE = 0.5;

export function isRevisionAnswerStep(kind: RevisionStepKind): kind is RevisionAnswerStepKind {
  return ANSWER_STEPS.has(kind);
}

function freshStep(kind: RevisionStepKind): RevisionStepRecord {
  return { kind, attempts: 0, hintUsed: false, skipped: false, selfGraded: false };
}

export function createRevisionSteps(policy: RevisionPolicy): RevisionStepRecord[] {
  return REVISION_POLICY_PATHS[policy].map(freshStep);
}

export function currentRevisionStep(record: Pick<RevisionSessionRecord, "steps" | "position">) {
  return record.steps[record.position];
}

export function isRevisionSessionFinished(
  record: Pick<RevisionSessionRecord, "steps" | "position">
) {
  return record.position >= record.steps.length;
}

export function isRevisionStepResolved(step: RevisionStepRecord) {
  return isRevisionAnswerStep(step.kind) ? step.resolvedAt !== undefined : true;
}

/**
 * Whether a resolved guided step should be followed by a second go.
 *
 * Wrong, skipped or self-marked as not right: all say the first explanation
 * did not land. Partial credit moves on -- the idea is there, and the next
 * step is where it gets practised. Only ever once: a retry that is also wrong
 * moves on too, because a session that loops is the failure this whole design
 * exists to prevent.
 */
function needsRetry(steps: readonly RevisionStepRecord[], position: number) {
  const step = steps[position];
  if (step?.kind !== "guided" || !isRevisionStepResolved(step)) return false;
  if (steps.some((candidate) => candidate.kind === "retry")) return false;
  return (step.score ?? 0) < RETRY_BELOW_SCORE;
}

export type RevisionSessionEvent =
  | { type: "continue" }
  | { type: "hint" }
  | {
      type: "answered";
      verdict: RevisionVerdict;
      score: number;
      errorCategory?: LearningErrorCategory;
      mistake?: RevisionMistake;
      at: number;
    }
  | { type: "self-graded"; correct: boolean; at: number }
  | { type: "skipped"; at: number };

export type RevisionTransitionRefusal =
  | "finished"
  | "not_an_answer_step"
  | "already_resolved"
  | "not_resolved";

export type RevisionTransition =
  | { ok: true; steps: RevisionStepRecord[]; position: number; retryAdded: boolean }
  | { ok: false; reason: RevisionTransitionRefusal };

const clampScore = (score: number) =>
  Number.isFinite(score) ? Math.min(1, Math.max(0, score)) : 0;

/**
 * The next state of a session, given what the student just did.
 *
 * Refuses anything that does not fit where the session is -- an answer to a
 * step that is not a question, a second answer to one already marked, moving
 * on from a question nobody has answered -- rather than guessing what was
 * meant. The route turns a refusal into a 409 and the screen re-reads.
 */
export function advanceRevisionSession(
  record: Pick<RevisionSessionRecord, "steps" | "position">,
  event: RevisionSessionEvent
): RevisionTransition {
  if (isRevisionSessionFinished(record)) return { ok: false, reason: "finished" };
  const steps = record.steps.map((step) => ({ ...step }));
  const position = record.position;
  const step = steps[position];

  if (event.type === "continue") {
    if (!isRevisionStepResolved(step)) return { ok: false, reason: "not_resolved" };
    const retryAdded = needsRetry(steps, position);
    if (retryAdded) steps.splice(position + 1, 0, freshStep("retry"));
    return { ok: true, steps, position: position + 1, retryAdded };
  }

  if (!isRevisionAnswerStep(step.kind)) return { ok: false, reason: "not_an_answer_step" };
  if (step.resolvedAt !== undefined) return { ok: false, reason: "already_resolved" };

  switch (event.type) {
    case "hint":
      step.hintUsed = true;
      break;
    case "answered":
      step.attempts += 1;
      step.verdict = event.verdict;
      step.score = clampScore(event.score);
      if (event.errorCategory) step.errorCategory = event.errorCategory;
      if (event.mistake) step.mistake = event.mistake;
      step.resolvedAt = event.at;
      break;
    case "self-graded":
      step.attempts += 1;
      step.selfGraded = true;
      step.verdict = event.correct ? "correct" : "incorrect";
      step.score = event.correct ? 1 : 0;
      step.resolvedAt = event.at;
      break;
    case "skipped":
      step.skipped = true;
      step.score = 0;
      step.resolvedAt = event.at;
      break;
  }
  return { ok: true, steps, position, retryAdded: false };
}

/**
 * Where the student is, as a row of dots.
 *
 * One dot per step on the policy's path after the orientation, so the row is
 * the same length from start to finish: a retry is more of the guided dot, not
 * a new one that makes the session look longer the moment something goes
 * wrong.
 */
export function revisionProgress(
  record: Pick<RevisionSessionRecord, "steps" | "position" | "policy">
) {
  const path: readonly RevisionStepKind[] = REVISION_POLICY_PATHS[record.policy].filter(
    (kind) => kind !== "orient"
  );
  const reached = new Set<RevisionStepKind>();
  record.steps.slice(0, record.position).forEach((step) => {
    if (step.kind === "retry") return;
    reached.add(step.kind);
  });
  const current = currentRevisionStep(record);
  const currentKind = current?.kind === "retry" ? "guided" : current?.kind;
  return {
    total: path.length,
    done: path.filter((kind) => reached.has(kind) && kind !== currentKind).length,
    currentIndex: currentKind ? path.indexOf(currentKind) : path.length,
  };
}
