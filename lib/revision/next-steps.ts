import type {
  RevisionNextStep,
  RevisionStepKind,
  RevisionStepRecord,
  RevisionTarget,
} from "@/lib/revision/types";

/**
 * What to do after a Revision Session, chosen from why it went the way it did.
 *
 * Two different kinds of struggle want two different kinds of work, and
 * telling them apart is the whole point:
 *
 * - **The idea did not land.** The student could not say what it is, needed it
 *   explained twice, or could not recall it without help. More questions would
 *   only drill a method they do not yet understand; what helps is going over
 *   the idea itself until it sticks -- flashcards.
 * - **The idea landed and the steps did not.** They could do it with support,
 *   or on the familiar question, and lost their way on the unfamiliar one, or
 *   forgot a step. That is fluency, and fluency comes from doing more of it --
 *   practice questions.
 *
 * Every offer is a rule about the recorded steps and the capabilities the
 * caller supplies. The model never suggests anything here, including which
 * neighbouring concept to look at next: that comes from the engine.
 */

/** A step at or above this is one the student did well. */
const GOOD = 0.8;
const MAX_OFFERS = 3;

export type RevisionNextStepContext = {
  target: RevisionTarget & { folderId: string };
  /** Jami can write cards and questions for it: a specification concept, with generation on. */
  canWrite: boolean;
  /** The specification concept id, when there is one. */
  conceptId?: string;
  /** Real exam questions narrowed to this concept, where the course has them. */
  examQuestionsHref?: string;
  /** The student's own cards on it, where they have some. */
  reviewCardsHref?: string;
  /** Where a session on this same concept starts. */
  sessionHref: string;
  /** A neighbouring concept the engine says needs work. */
  neighbour?: { topicKey: string; conceptLabel: string; sessionHref: string };
};

export type RevisionStruggle = {
  /** The idea itself did not land. */
  concept: boolean;
  /** The idea landed; the steps did not hold. */
  method: boolean;
  /** Everything counted was done well, or went wrong only by slips. */
  sound: boolean;
};

function stepOf(steps: readonly RevisionStepRecord[], kind: RevisionStepKind) {
  const step = steps.find((candidate) => candidate.kind === kind);
  return step?.resolvedAt !== undefined ? step : undefined;
}

const scoreOf = (step: RevisionStepRecord | undefined) => (step ? step.score ?? 0 : 0);

/** What went wrong, read from the steps and nothing else. */
export function readRevisionStruggle(steps: readonly RevisionStepRecord[]): RevisionStruggle {
  const independent = stepOf(steps, "independent");
  const apply = stepOf(steps, "apply");
  const retrieve = stepOf(steps, "retrieve");

  const concept =
    steps.some((step) => step.mistake === "concept") ||
    // Needing the idea explained a second way is the idea not landing the first time.
    steps.some((step) => step.kind === "retry") ||
    // Could not recall it cold -- unless the marker says what went was a step
    // or a slip, which is fluency rather than the idea -- or could not start one alone.
    Boolean(
      retrieve &&
        (retrieve.skipped || scoreOf(retrieve) < GOOD) &&
        retrieve.mistake !== "slip" &&
        retrieve.mistake !== "method"
    ) ||
    Boolean(independent?.skipped);

  const method =
    steps.some((step) => step.mistake === "method") ||
    // Fine on the familiar question, lost on the unfamiliar one: the steps, not
    // the idea -- unless the marker says it was the idea, or only a slip.
    Boolean(
      apply &&
        scoreOf(independent) >= GOOD &&
        (apply.skipped || scoreOf(apply) < GOOD) &&
        apply.mistake !== "slip" &&
        apply.mistake !== "concept"
    ) ||
    // Recalling the method with a step missing.
    Boolean(retrieve && scoreOf(retrieve) < GOOD && retrieve.mistake === "method") ||
    // Needed a nudge where there was no example to lean on.
    steps.some(
      (step) => (step.kind === "independent" || step.kind === "apply") && step.hintUsed
    );

  const counted = [independent, apply, retrieve];
  const sound = counted.every(
    (step) => step !== undefined && !step.skipped && (scoreOf(step) >= GOOD || step.mistake === "slip")
  );

  return { concept, method, sound: sound && !concept && !method };
}

/**
 * Up to three things to do next, most useful first.
 *
 * The remedy for what went wrong comes first, then a neighbouring concept that
 * needs work. A session that went well is offered real exam questions rather
 * than more of the same.
 */
export function planRevisionNextSteps(
  steps: readonly RevisionStepRecord[],
  context: RevisionNextStepContext
): RevisionNextStep[] {
  const struggle = readRevisionStruggle(steps);
  const base = {
    topicKey: context.target.topicKey,
    conceptLabel: context.target.conceptLabel,
    folderId: context.target.folderId,
    ...(context.conceptId ? { conceptId: context.conceptId } : {}),
  };
  const offers: RevisionNextStep[] = [];

  if (struggle.concept) {
    if (context.canWrite && context.conceptId) {
      offers.push({
        ...base,
        kind: "flashcards",
        reason: "The idea itself hasn't settled yet. Cards on it will help it stick.",
      });
    } else if (context.reviewCardsHref) {
      offers.push({
        ...base,
        kind: "review-cards",
        reason: "The idea hasn't settled yet. Going over your cards on it will help.",
        href: context.reviewCardsHref,
      });
    } else {
      offers.push({
        ...base,
        kind: "session",
        reason: "Worth another session on this once it has had time to sink in.",
        href: context.sessionHref,
      });
    }
  }

  if (struggle.method) {
    if (context.canWrite && context.conceptId) {
      offers.push({
        ...base,
        kind: "practice",
        reason: "You've got the idea. It's the steps that slip, and a few more questions will make them automatic.",
      });
    } else if (context.examQuestionsHref) {
      offers.push({
        ...base,
        kind: "exam-questions",
        reason: "You've got the idea. It's the steps that slip, and more questions on it will make them automatic.",
        href: context.examQuestionsHref,
      });
    }
  }

  if (struggle.sound && context.examQuestionsHref) {
    offers.push({
      ...base,
      kind: "exam-questions",
      reason: "That all held up. Try it on real exam questions.",
      href: context.examQuestionsHref,
    });
  }

  if (context.neighbour && context.neighbour.topicKey !== context.target.topicKey) {
    offers.push({
      topicKey: context.neighbour.topicKey,
      conceptLabel: context.neighbour.conceptLabel,
      folderId: context.target.folderId,
      kind: "session",
      reason: "Close to this one, and still shaky in your recent work.",
      href: context.neighbour.sessionHref,
    });
  }

  return offers.slice(0, MAX_OFFERS);
}
