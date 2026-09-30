import { describe, expect, it } from "vitest";
import {
  currentInterventionFor,
  deriveInterventionStates,
  isAwaitingEvidence,
} from "@/lib/learning/actions/intervention-state";
import {
  buildInterventionOutcome,
  summarizeInterventionOutcomes,
} from "@/lib/learning/evaluation/intervention-outcome";
import { summariseActionHistory } from "@/lib/learning/actions/action-cooldown";
import { MIN_SIGNAL_CONFIDENCE } from "@/lib/learning/profile/thresholds";
import type { StudyActionEvent, StudyActionOutcome } from "@/lib/learning/events/study-action-event";
import type { LearningObservation } from "@/lib/learning/types";

const NOW = Date.parse("2026-09-21T10:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const ACTION = "folder:f1|low_confidence|topic:osmosis";
const TARGET = "topic:osmosis";

function event(outcome: StudyActionOutcome, at: number, actionId = ACTION): StudyActionEvent {
  return {
    id: `${outcome}-${at}`,
    actionId,
    reason: "low_confidence",
    targetKey: actionId === ACTION ? TARGET : "topic:other",
    folderId: "f1",
    outcome,
    at,
    studyDayKey: "2026-09-20",
  };
}

function answer(at: number, interventionId?: string): LearningObservation {
  return {
    kind: "flashcards",
    evidenceId: `o-${at}-${interventionId ?? "none"}`,
    itemId: `card-${at}`,
    topicKeys: [TARGET],
    score: 1,
    weight: 1,
    count: 1,
    at,
    trendEligible: true,
    errorChecks: [],
    ...(interventionId ? { interventionId } : {}),
  };
}

describe("abandoning is its own thing", () => {
  it("is never inferred from an absent completion", () => {
    // Opened five days ago, nothing since. Still open, not abandoned.
    const [state] = deriveInterventionStates([event("shown", NOW - 6 * DAY), event("started", NOW - 5 * DAY)], []);
    expect(state?.status).toBe("open");
  });

  it("is recorded only when the student actually left it", () => {
    const [state] = deriveInterventionStates(
      [event("started", NOW - 5 * DAY), event("abandoned", NOW - 5 * DAY + 60_000)],
      []
    );
    expect(state?.status).toBe("abandoned");
  });

  it("is not what dismissing is", () => {
    const [state] = deriveInterventionStates(
      [event("shown", NOW - 2 * DAY), event("dismissed", NOW - 2 * DAY)],
      []
    );
    expect(state?.status).toBe("declined");
    expect(state?.startedAt).toBeUndefined();
  });

  it("does not rest the advice, and does not count as refusing it", () => {
    const history = summariseActionHistory([
      event("started", NOW - DAY),
      event("abandoned", NOW - DAY + 1_000),
    ]);
    const entry = history.get(ACTION);
    // Opening it counts as acting; walking away adds nothing either way.
    expect(entry?.abandons).toBe(1);
    expect(entry?.dismissals).toBe(0);
  });

  it("separates finishing with nothing from walking away", () => {
    const finishedEmpty = deriveInterventionStates(
      [event("started", NOW - DAY), event("completed", NOW - DAY + 60_000)],
      []
    );
    // They saw it through and produced nothing. That is not abandonment.
    expect(finishedEmpty[0]?.status).not.toBe("abandoned");
    expect(finishedEmpty[0]?.attributedAnswers).toBe(0);
  });
});

describe("what Jami is currently trying to establish", () => {
  it("reports an offer nobody has opened as offered", () => {
    const [state] = deriveInterventionStates([event("shown", NOW - DAY)], []);
    expect(state?.status).toBe("offered");
    expect(isAwaitingEvidence([state!], TARGET)).toBe(false);
  });

  it("waits once the student has opened it", () => {
    const states = deriveInterventionStates(
      [event("shown", NOW - 2 * DAY), event("started", NOW - DAY)],
      []
    );
    expect(isAwaitingEvidence(states, TARGET)).toBe(true);
  });

  it("stops waiting once its own answers arrive", () => {
    const states = deriveInterventionStates(
      [event("shown", NOW - 2 * DAY), event("started", NOW - DAY)],
      [answer(NOW - DAY + 60_000, ACTION)]
    );
    expect(states[0]?.status).toBe("answered");
    expect(states[0]?.attributedAnswers).toBe(1);
    expect(isAwaitingEvidence(states, TARGET)).toBe(false);
  });

  it("keeps waiting when the evidence belongs to something else", () => {
    const states = deriveInterventionStates(
      [event("started", NOW - DAY)],
      // Answered on the same topic, but not in this session.
      [answer(NOW - DAY + 60_000), answer(NOW, "folder:f1|low_mastery|topic:osmosis")]
    );
    expect(states[0]?.attributedAnswers).toBe(0);
    expect(states[0]?.status).toBe("open");
  });

  it("counts answers even when the session was left unfinished", () => {
    const states = deriveInterventionStates(
      [event("started", NOW - DAY), event("abandoned", NOW - DAY + 120_000)],
      [answer(NOW - DAY + 60_000, ACTION)]
    );
    // Six of nine cards is still six answers about the student.
    expect(states[0]?.status).toBe("answered");
    expect(states[0]?.attributedAnswers).toBe(1);
  });

  it("treats a newer intervention on the same concept as the current one", () => {
    const later = "folder:f1|low_mastery|topic:osmosis";
    const states = deriveInterventionStates(
      [
        event("shown", NOW - 5 * DAY),
        event("dismissed", NOW - 5 * DAY),
        { ...event("shown", NOW - DAY, later), targetKey: TARGET },
      ],
      []
    );
    expect(currentInterventionFor(states, TARGET)?.interventionId).toBe(later);
  });

  it("has no current intervention once every one has been answered or refused", () => {
    const states = deriveInterventionStates(
      [event("started", NOW - DAY), event("completed", NOW)],
      [answer(NOW, ACTION)]
    );
    expect(currentInterventionFor(states, TARGET)).toBeUndefined();
  });
});

describe("what became of the advice", () => {
  const before = { mastery: 0.55, confidence: 0.31, decision: { action: "diagnose" as const, reason: "low_confidence" as const } };

  it("calls a diagnosis that lowered mastery a success when it settled the question", () => {
    const outcome = buildInterventionOutcome({
      interventionId: ACTION,
      targetKey: TARGET,
      action: "diagnose",
      before,
      after: {
        mastery: 0.48,
        confidence: 0.82,
        decision: { action: "retrieve", reason: "due_for_retrieval" },
      },
      attributedAnswers: 9,
    });
    expect(outcome.resolution).toBe("resolved");
    expect(outcome.masteryChange).toBeLessThan(0);
    expect(outcome.decisionChanged).toBe(true);
    expect(outcome.basis).toBe("attributed");
  });

  it("records improvement and resolution independently", () => {
    const outcome = buildInterventionOutcome({
      interventionId: ACTION,
      targetKey: TARGET,
      before: { mastery: 0.4, confidence: 0.9 },
      after: { mastery: 0.68, confidence: 0.94 },
      attributedAnswers: 6,
    });
    expect(outcome.resolution).toBe("resolved");
    expect(outcome.masteryChange).toBeCloseTo(0.28, 5);
  });

  it("says a thin answer is still unresolved rather than calling it done", () => {
    const outcome = buildInterventionOutcome({
      interventionId: ACTION,
      targetKey: TARGET,
      before,
      after: { mastery: 0.5, confidence: MIN_SIGNAL_CONFIDENCE - 0.05 },
      attributedAnswers: 2,
    });
    expect(outcome.resolution).toBe("unresolved");
  });

  it("refuses to score an intervention nothing came back from", () => {
    const outcome = buildInterventionOutcome({
      interventionId: ACTION,
      targetKey: TARGET,
      before,
      after: before,
      attributedAnswers: 0,
    });
    expect(outcome.resolution).toBe("not_evaluable");
    // The distinction that matters: no evidence is not no improvement.
    expect(outcome.masteryChange).toBeNull();
    expect(outcome.basis).toBe("none");
  });

  it("marks a before-and-after that rests only on a window", () => {
    const outcome = buildInterventionOutcome({
      interventionId: ACTION,
      targetKey: TARGET,
      before,
      after: { mastery: 0.6, confidence: 0.8 },
      attributedAnswers: 0,
      windowAnswers: 4,
    });
    expect(outcome.basis).toBe("window_only");
    expect(outcome.masteryChange).not.toBeNull();
  });
});

describe("counting outcomes without lying about the denominator", () => {
  it("never lets unanswered interventions read as failures", () => {
    const evaluated = buildInterventionOutcome({
      interventionId: "a",
      targetKey: TARGET,
      before: { mastery: 0.4, confidence: 0.2 },
      after: { mastery: 0.7, confidence: 0.9 },
      attributedAnswers: 8,
    });
    const never = buildInterventionOutcome({
      interventionId: "b",
      targetKey: TARGET,
      before: { mastery: 0.4, confidence: 0.2 },
      after: { mastery: 0.4, confidence: 0.2 },
      attributedAnswers: 0,
    });

    const summary = summarizeInterventionOutcomes([evaluated, never, never, never]);
    expect(summary.total).toBe(4);
    expect(summary.evaluable).toBe(1);
    expect(summary.notEvaluable).toBe(3);
    // The one that was actually done improved. The mean says so.
    expect(summary.meanMasteryChange).toBeCloseTo(0.3, 5);
    expect(summary.improved).toBe(1);
  });

  it("reports nothing rather than zero when nothing is evaluable", () => {
    const never = buildInterventionOutcome({
      interventionId: "b",
      targetKey: TARGET,
      before: { mastery: 0.4, confidence: 0.2 },
      after: { mastery: 0.4, confidence: 0.2 },
      attributedAnswers: 0,
    });
    const summary = summarizeInterventionOutcomes([never, never]);
    expect(summary.meanMasteryChange).toBeNull();
    expect(summary.evaluable).toBe(0);
  });
});
