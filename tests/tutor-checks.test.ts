import { describe, expect, it } from "vitest";
import {
  PENDING_CHECK_TTL_MS,
  buildTutorCheckWrite,
  decodeTutorCheck,
  readPendingTutorCheck,
  readTutorCheckMarking,
  readTutorCheckProposal,
  type PendingTutorCheck,
} from "@/lib/learning/events/tutor-check";
import { tutorCheckObservations } from "@/lib/learning/profile/tutor-check-signals";
import { buildLearnerProfile } from "@/lib/learning/profile/build-learner-profile";
import { DEFAULT_LEARNING_TUNING } from "@/lib/learning/scoring/tuning";
import { nextStudyAction } from "@/lib/learning/actions/practice-for-material";
import type { StudyAction } from "@/lib/learning/actions/study-actions";
import { buildAssistantResponseSchema } from "@/app/api/ai/assistant/response-schema";
import { parseJamiAssistantModelAnswer } from "@/lib/ai/jami-assistant";

/**
 * Tutor's quick checks: the one way a chat produces evidence without the
 * student asking to be marked. Every gate fails closed, and the marks always
 * come from points fixed before the student answered.
 */

const NOW = Date.parse("2026-10-01T10:00:00.000Z");
const MINUTE = 60 * 1000;

const PROPOSAL = {
  points: [
    { criterion: "States that the gradient is the coefficient of x", marks: 1 },
    { criterion: "Reads off the intercept correctly", marks: 2 },
  ],
};

function pending(overrides: Partial<PendingTutorCheck> = {}): PendingTutorCheck {
  const check = readTutorCheckProposal({
    proposal: PROPOSAL,
    id: "check-1",
    topicKeys: ["topic:lines"],
    scope: { folderId: "maths" },
    askedAt: NOW - 2 * MINUTE,
  });
  if (!check) throw new Error("fixture rejected");
  return { ...check, ...overrides };
}

describe("quick check proposals", () => {
  it("places a valid proposal on the server's concept and scope", () => {
    const check = pending();
    expect(check.topicKeys).toEqual(["topic:lines"]);
    expect(check.scope).toEqual({ folderId: "maths" });
    expect(check.points).toHaveLength(2);
  });

  it.each([
    ["no points", { points: [] }],
    ["too many points", { points: Array.from({ length: 5 }, () => ({ criterion: "x", marks: 1 })) }],
    ["a point worth too much", { points: [{ criterion: "x", marks: 3 }] }],
    ["a fractional mark", { points: [{ criterion: "x", marks: 1.5 }] }],
    ["an empty criterion", { points: [{ criterion: "  ", marks: 1 }] }],
    ["not an object", "ask them about lines"],
  ])("rejects %s", (_label, proposal) => {
    expect(
      readTutorCheckProposal({
        proposal,
        id: "check-1",
        topicKeys: ["topic:lines"],
        scope: { folderId: "maths" },
        askedAt: NOW,
      })
    ).toBeNull();
  });

  it("asks nothing that would have nowhere to count", () => {
    const base = { proposal: PROPOSAL, id: "c", askedAt: NOW };
    expect(readTutorCheckProposal({ ...base, topicKeys: [], scope: { folderId: "maths" } })).toBeNull();
    expect(readTutorCheckProposal({ ...base, topicKeys: ["lines"], scope: { folderId: "maths" } })).toBeNull();
    expect(
      readTutorCheckProposal({
        ...base,
        topicKeys: ["topic:lines"],
        scope: { folderId: "a", deckId: "b" } as unknown as { folderId: string },
      })
    ).toBeNull();
  });

  it("lapses once its answer window has passed", () => {
    const stored = { ...pending() };
    expect(readPendingTutorCheck(stored, NOW)).not.toBeNull();
    expect(readPendingTutorCheck(stored, stored.askedAt + PENDING_CHECK_TTL_MS + 1)).toBeNull();
    expect(readPendingTutorCheck(undefined, NOW)).toBeNull();
  });
});

describe("marking a quick check", () => {
  it("adds up marks from the stored points, not the verdict", () => {
    const result = readTutorCheckMarking({
      verdict: { attempted: true, awarded: [false, true], awardedMarks: 99 },
      pending: pending(),
      markedAt: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.check.awardedMarks).toBe(2);
    expect(result.check.maxMarks).toBe(3);
  });

  it("records nothing when the student did not attempt it", () => {
    expect(
      readTutorCheckMarking({ verdict: { attempted: false, awarded: [] }, pending: pending(), markedAt: NOW })
    ).toEqual({ ok: false, reason: "not_attempted" });
  });

  it.each([
    ["the wrong number of points", { attempted: true, awarded: [true] }],
    ["a non-boolean entry", { attempted: true, awarded: [true, "yes"] }],
    ["no attempted flag", { awarded: [true, true] }],
  ])("rejects a verdict with %s", (_label, verdict) => {
    expect(readTutorCheckMarking({ verdict, pending: pending(), markedAt: NOW })).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("round-trips through storage and recomputes the totals on read", () => {
    const result = readTutorCheckMarking({
      verdict: { attempted: true, awarded: [true, false] },
      pending: pending(),
      markedAt: NOW,
    });
    if (!result.ok) throw new Error("rejected");
    const stored = { ...buildTutorCheckWrite(result.check, NOW), awardedMarks: 3 };
    const decoded = decodeTutorCheck("check-1", stored);
    expect(decoded?.awardedMarks).toBe(1);
    expect(decoded?.maxMarks).toBe(3);
    expect(decodeTutorCheck("check-1", { ...stored, schemaVersion: 2 })).toBeNull();
  });
});

describe("quick checks as learner evidence", () => {
  function markedCheck(id: string, awarded: boolean[]) {
    const result = readTutorCheckMarking({
      verdict: { attempted: true, awarded },
      pending: pending({ id }),
      markedAt: NOW,
    });
    if (!result.ok) throw new Error("rejected");
    return { id, ...result.check };
  }

  it("becomes tutor-check observations, weighted below notebook marking", () => {
    const observations = tutorCheckObservations([markedCheck("a", [true, true]), markedCheck("a", [false, false])]);
    expect(observations).toHaveLength(1);
    expect(observations[0]?.kind).toBe("tutor-check");
    expect(observations[0]?.score).toBe(1);
    expect(DEFAULT_LEARNING_TUNING.evidenceSourceWeight["tutor-check"]).toBeLessThan(
      DEFAULT_LEARNING_TUNING.evidenceSourceWeight.notebook
    );
  });

  it("reaches the learner profile for the topic it was asked on", () => {
    const profile = buildLearnerProfile({
      scope: { folderId: "maths", deckIds: [] },
      evidence: {
        cards: [],
        flashcardReviewEvents: [],
        pastPaperAttempts: [],
        practicePaperAttempts: [],
        tutorChecks: [markedCheck("a", [false, false]), markedCheck("b", [true, false])],
        topicLabels: { "topic:lines": { label: "Straight lines", source: "student-topic" } },
      },
      now: NOW,
    });
    const topic = profile.topics.find((entry) => entry.topicKey === "topic:lines");
    expect(topic?.signal?.evidence).toContain("tutor-check");
  });
});

describe("Tutor's next step", () => {
  function action(id: string, priority: number, extra: Partial<StudyAction> = {}): StudyAction {
    return {
      id,
      priority,
      reason: "low_mastery",
      target: { kind: "topic", topicKey: `topic:${id}`, label: id, source: "student-topic" },
      destination: { kind: "topic", href: `/t/${id}`, selection: {} },
      ...extra,
    } as unknown as StudyAction;
  }

  it("is the engine's highest-priority startable action", () => {
    const chosen = nextStudyAction([
      action("low", 1),
      action("resting", 9, { cooldown: "dismissed" }),
      action("nowhere", 8, { destination: undefined }),
      action("high", 5),
    ]);
    expect(chosen?.id).toBe("high");
  });
});

describe("the response contract", () => {
  it("offers each new field only on turns it applies to", () => {
    const none = buildAssistantResponseSchema([], false, false, false, false, []);
    expect(Object.keys(none.properties)).not.toEqual(
      expect.arrayContaining(["quickCheck"])
    );
    const all = buildAssistantResponseSchema([], false, false, false, false, [], {
      checkInvited: true,
      pendingCheckPoints: 2,
      nextStepAvailable: true,
    });
    expect(Object.keys(all.properties)).toEqual(
      expect.arrayContaining(["quickCheck", "checkMarking", "offerNextStep"])
    );
  });

  it("passes the new fields through the parser unread", () => {
    const parsed = parseJamiAssistantModelAnswer(
      JSON.stringify({
        answer: "Quick check: what is the gradient of y = 3x + 1?",
        sourceRefs: [],
        usedCurrentContext: false,
        usedGeneralKnowledge: true,
        usedWebResearch: false,
        graphs: [],
        quickCheck: PROPOSAL,
        checkMarking: { attempted: true, awarded: [true] },
        offerNextStep: true,
      }),
      []
    );
    expect(parsed?.quickCheck).toEqual(PROPOSAL);
    expect(parsed?.checkMarking).toEqual({ attempted: true, awarded: [true] });
    expect(parsed?.offerNextStep).toBe(true);
  });
});
