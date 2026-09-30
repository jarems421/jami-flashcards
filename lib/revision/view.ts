import {
  currentRevisionStep,
  isRevisionAnswerStep,
  isRevisionSessionFinished,
  revisionProgress,
} from "@/lib/revision/session-machine";
import type {
  RevisionAnswerStepKind,
  RevisionLesson,
  RevisionNextStep,
  RevisionSessionRecord,
  RevisionSessionStatus,
  RevisionStepRecord,
  RevisionTask,
  RevisionVerdict,
} from "@/lib/revision/types";

/**
 * What the browser is allowed to see of a session.
 *
 * The record on the server holds the whole lesson, answers included. This is
 * the one place it is cut down for the screen: the current step only, its hint
 * only once asked for, and its answer only once the step is over. A student
 * who opens the network tab learns nothing a student who pressed "Show me"
 * would not.
 */

export type RevisionTaskView = {
  kind: RevisionAnswerStepKind;
  /** Set on the retry step: the second way of explaining it. */
  intro?: string;
  prompt: string;
  hint?: string;
  /** Present once the step is over. */
  outcome?: {
    verdict?: RevisionVerdict;
    skipped: boolean;
    selfGraded: boolean;
    answer: string;
    solution: string;
  };
};

export type RevisionStepView =
  | { kind: "orient"; goals: string[]; orientation: string }
  | {
      kind: "explain";
      body: string;
      example: { problem: string; steps: string[] };
    }
  | RevisionTaskView;

export type RevisionCompletionView = {
  /** Only the things the student actually did well. */
  earned: string[];
  /** One line about how it went, chosen from the outcomes. */
  note: string;
  /** Answered steps, for the handback to Today. */
  answered: number;
  /** What to do next, chosen by rule when the session finished. */
  nextSteps: RevisionNextStep[];
};

export type RevisionSessionView = {
  id: string;
  status: RevisionSessionStatus;
  conceptLabel: string;
  /** The recommendation this answers, when it answers one. */
  actionId?: string;
  folderId?: string;
  why: string[];
  goals: string[];
  progress: { total: number; done: number; currentIndex: number };
  step?: RevisionStepView;
  completion?: RevisionCompletionView;
};

function taskFor(lesson: RevisionLesson, kind: RevisionAnswerStepKind): RevisionTask | null {
  switch (kind) {
    case "guided":
      return lesson.guided;
    case "retry":
      return lesson.retry?.task ?? null;
    case "independent":
      return lesson.independent;
    case "apply":
      return lesson.apply;
    case "retrieve":
      return lesson.retrieve;
  }
}

export function revisionTaskFor(
  lesson: RevisionLesson | undefined,
  kind: RevisionAnswerStepKind
): RevisionTask | null {
  return lesson ? taskFor(lesson, kind) : null;
}

function stepView(lesson: RevisionLesson, step: RevisionStepRecord): RevisionStepView | undefined {
  if (step.kind === "orient") {
    return { kind: "orient", goals: lesson.goals, orientation: lesson.orientation };
  }
  if (step.kind === "explain") {
    return { kind: "explain", body: lesson.explanation.body, example: lesson.explanation.example };
  }
  if (!isRevisionAnswerStep(step.kind)) return undefined;
  const task = taskFor(lesson, step.kind);
  if (!task) return undefined;
  const over = step.resolvedAt !== undefined;
  return {
    kind: step.kind,
    ...(step.kind === "retry" && lesson.retry ? { intro: lesson.retry.explanation } : {}),
    prompt: task.prompt,
    ...(step.hintUsed || over ? { hint: task.hint } : {}),
    ...(over
      ? {
          outcome: {
            ...(step.verdict ? { verdict: step.verdict } : {}),
            skipped: step.skipped,
            selfGraded: step.selfGraded,
            answer: task.answer,
            solution: task.solution,
          },
        }
      : {}),
  };
}

const EARNED_LINES: Record<Exclude<RevisionAnswerStepKind, "retry">, string> = {
  guided: "Worked one through with Jami",
  independent: "Did one on your own",
  apply: "Used it in a question you hadn't seen before",
  retrieve: "Explained it back without looking",
};

const GOOD = 0.8;

function scoreOf(steps: readonly RevisionStepRecord[], kind: RevisionAnswerStepKind) {
  const step = steps.find((candidate) => candidate.kind === kind);
  return step?.resolvedAt !== undefined ? step.score ?? 0 : undefined;
}

/**
 * What to say at the end, from what happened and nothing else.
 *
 * Chosen by code, never written by the model, and only ever about the steps:
 * a tick for each thing the student did well, and one line naming the part
 * that was hardest. It never says a topic is now known -- that is the engine's
 * call, made from all the evidence rather than one sitting -- and never
 * promises what Jami will do next.
 */
export function summariseRevisionSession(
  steps: readonly RevisionStepRecord[],
  nextSteps: readonly RevisionNextStep[] = []
): RevisionCompletionView {
  const guided = Math.max(scoreOf(steps, "guided") ?? 0, scoreOf(steps, "retry") ?? 0);
  const independent = scoreOf(steps, "independent") ?? 0;
  const apply = scoreOf(steps, "apply") ?? 0;
  const retrieve = scoreOf(steps, "retrieve") ?? 0;

  const earned = [
    guided >= 0.5 ? EARNED_LINES.guided : null,
    independent >= GOOD ? EARNED_LINES.independent : null,
    apply >= GOOD ? EARNED_LINES.apply : null,
    retrieve >= GOOD ? EARNED_LINES.retrieve : null,
  ].filter((line): line is string => line !== null);

  const note =
    independent < GOOD && apply < GOOD && retrieve < GOOD
      ? "This one hasn't clicked yet, and that's fine. It's worth another session."
      : independent < GOOD
        ? "Doing it on your own is still the shaky part. Worth another go soon."
        : apply < GOOD
          ? "The unfamiliar question was the harder part. That's the thing to come back to."
          : retrieve < GOOD
            ? "Recalling it without help was the tricky part. That's the thing to come back to."
            : "Everything held up, including the question you hadn't seen before.";

  return {
    earned,
    note,
    answered: steps.filter(
      (step) => isRevisionAnswerStep(step.kind) && step.resolvedAt !== undefined && !step.skipped
    ).length,
    nextSteps: [...nextSteps],
  };
}

export function projectRevisionSession(record: RevisionSessionRecord): RevisionSessionView {
  const finished = record.status === "completed" || isRevisionSessionFinished(record);
  const current = currentRevisionStep(record);
  const step = !finished && record.lesson && current ? stepView(record.lesson, current) : undefined;
  return {
    id: record.id,
    status: record.status,
    conceptLabel: record.target.conceptLabel,
    ...(record.actionId ? { actionId: record.actionId } : {}),
    ...(record.target.folderId ? { folderId: record.target.folderId } : {}),
    why: record.why,
    goals: record.lesson?.goals ?? [],
    progress: revisionProgress(record),
    ...(step ? { step } : {}),
    ...(record.status === "completed"
      ? { completion: summariseRevisionSession(record.steps, record.nextSteps) }
      : {}),
  };
}
