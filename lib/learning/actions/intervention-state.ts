import type { StudyActionEvent } from "@/lib/learning/events/study-action-event";
import type { LearningObservation } from "@/lib/learning/types";

/**
 * What Jami is currently trying to establish about a concept.
 *
 * The profile says what a student knows. The decision says what to do about
 * it. Neither says what is *already underway*, and without that the engine
 * cannot tell "I think this is weak" from "I am finding out whether this is
 * weak" -- which are different claims, and only one of them should be repeated
 * back to a student who is in the middle of answering it.
 *
 * **Derived, never stored.** This is a fold over events that already exist:
 * what was suggested, what the student did with it, and what evidence has
 * arrived since. A stored copy would be a second source of truth that could
 * disagree with the first, and the disagreement would be invisible. Nothing
 * here writes anything.
 *
 * It answers one narrow question. It is not a history of everything ever
 * recommended, and it is not a view of mastery: both of those live elsewhere
 * and stay there.
 */

export type InterventionStatus =
  /** Suggested, not yet opened. */
  | "offered"
  /** Opened, and nothing has come back yet. */
  | "open"
  /** The student opened it and left without finishing. */
  | "abandoned"
  /** Evidence produced by this intervention has arrived. */
  | "answered"
  /** The student said no. */
  | "declined";

export type InterventionState = {
  interventionId: string;
  targetKey: string;
  status: InterventionStatus;
  offeredAt?: number;
  startedAt?: number;
  /** The most recent terminal event: completed, abandoned or dismissed. */
  closedAt?: number;
  /** Answers carrying this intervention's own id. */
  attributedAnswers: number;
  /** The newest evidence on the target, whether or not this intervention caused it. */
  lastEvidenceAt?: number;
};

function latest(current: number | undefined, candidate: number) {
  return current === undefined ? candidate : Math.max(current, candidate);
}

/**
 * The current state of each intervention, newest first.
 *
 * One entry per action id rather than per concept, because a student can be
 * offered the same concept twice for different reasons -- once to diagnose it
 * and later to practise it -- and those are separate things being established.
 * `currentInterventionFor` picks between them.
 */
export function deriveInterventionStates(
  events: readonly StudyActionEvent[],
  observations: readonly LearningObservation[]
): InterventionState[] {
  const byAction = new Map<string, InterventionState>();

  for (const event of events) {
    const existing = byAction.get(event.actionId) ?? {
      interventionId: event.actionId,
      targetKey: event.targetKey,
      status: "offered" as InterventionStatus,
      attributedAnswers: 0,
    };
    switch (event.outcome) {
      case "shown":
        existing.offeredAt = latest(existing.offeredAt, event.at);
        break;
      case "started":
        existing.startedAt = latest(existing.startedAt, event.at);
        break;
      case "completed":
      case "abandoned":
      case "dismissed":
        existing.closedAt = latest(existing.closedAt, event.at);
        break;
    }
    byAction.set(event.actionId, existing);
  }

  /*
   * Evidence decides the outcome, not the events.
   *
   * A student can finish a session having answered nothing, and a session
   * still open can already have produced answers. So the events say what
   * happened to the *offer*, and the answers say what happened to the
   * *question Jami was asking* -- and the second is what the status reports
   * wherever the two disagree.
   */
  const answersByIntervention = new Map<string, number>();
  const lastEvidenceByTarget = new Map<string, number>();
  for (const observation of observations) {
    if (observation.interventionId) {
      answersByIntervention.set(
        observation.interventionId,
        (answersByIntervention.get(observation.interventionId) ?? 0) + 1
      );
    }
    for (const key of observation.topicKeys) {
      lastEvidenceByTarget.set(key, latest(lastEvidenceByTarget.get(key), observation.at));
    }
  }

  const terminalByAction = new Map<string, StudyActionEvent["outcome"]>();
  for (const event of [...events].sort((left, right) => left.at - right.at)) {
    if (event.outcome === "completed" || event.outcome === "abandoned" || event.outcome === "dismissed") {
      terminalByAction.set(event.actionId, event.outcome);
    }
  }

  const states: InterventionState[] = [];
  for (const state of byAction.values()) {
    state.attributedAnswers = answersByIntervention.get(state.interventionId) ?? 0;
    const lastEvidenceAt = lastEvidenceByTarget.get(state.targetKey);
    if (lastEvidenceAt !== undefined) state.lastEvidenceAt = lastEvidenceAt;

    const terminal = terminalByAction.get(state.interventionId);
    if (state.attributedAnswers > 0) {
      // Work came back. Whatever became of the offer, the question was answered.
      state.status = "answered";
    } else if (terminal === "dismissed") {
      state.status = "declined";
    } else if (terminal === "abandoned") {
      state.status = "abandoned";
    } else if (state.startedAt !== undefined) {
      // Opened, nothing back yet, and no terminal event. Still open, not failed.
      state.status = "open";
    } else {
      state.status = "offered";
    }
    states.push(state);
  }

  return states.sort(
    (left, right) =>
      (right.startedAt ?? right.offeredAt ?? 0) - (left.startedAt ?? left.offeredAt ?? 0) ||
      left.interventionId.localeCompare(right.interventionId)
  );
}

/**
 * What is currently underway for one concept, if anything.
 *
 * The most recent intervention that is still asking something: offered and not
 * yet taken, or opened and not yet answered. An intervention that has been
 * answered, declined or abandoned has stopped being a question, so it is not
 * "current" however recent it is -- the engine is free to decide afresh.
 */
export function currentInterventionFor(
  states: readonly InterventionState[],
  targetKey: string
): InterventionState | undefined {
  return states.find(
    (state) =>
      state.targetKey === targetKey && (state.status === "offered" || state.status === "open")
  );
}

/**
 * Whether the engine is presently waiting to hear back about this concept.
 *
 * The one thing callers usually want: a topic with an open intervention is one
 * Jami has already asked about and has not had an answer to, and repeating the
 * question is worse than waiting for it.
 */
export function isAwaitingEvidence(
  states: readonly InterventionState[],
  targetKey: string
) {
  return currentInterventionFor(states, targetKey)?.status === "open";
}
