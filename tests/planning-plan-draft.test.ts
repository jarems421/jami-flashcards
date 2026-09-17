import { describe, expect, it } from "vitest";
import type { StudyAction } from "@/lib/learning/actions/study-actions";
import { normalizeRevisionPlanDraft } from "@/lib/planning/normalize-plan";
import {
  assessPlanDraftReadiness,
  describePlanDraftOffer,
  MIN_EVIDENCED_ACTIONS_TO_DRAFT,
} from "@/lib/planning/plan-readiness";
import type { LearningRecommendationReason } from "@/lib/learning/types";

const NOW = Date.parse("2026-09-14T09:00:00Z");

function action(id: string, reason: LearningRecommendationReason, folderId = "biology"): StudyAction {
  return {
    id,
    reason,
    action: "practice",
    priority: 0.5,
    target: { kind: "topic", topicKey: `topic:${id}`, source: "student-topic", label: id },
    evidence: { count: 4, uniqueItems: 3, sources: ["flashcards"] },
    scope: { folderId },
    explanationCode: `${reason}.practice`,
    destination: { kind: "flashcards", href: `/study?x=${id}` },
  } as StudyAction;
}

describe("normalising a plan", () => {
  it("keeps a plan the student built", () => {
    const { draft, valid, problems } = normalizeRevisionPlanDraft(
      {
        title: "  Summer exams  ",
        scopes: [{ folderId: "biology", weight: 2 }],
        cadence: [{ weekday: 1, minutes: 45 }],
        startDayKey: "2026-09-14",
        endDayKey: "2026-10-12",
      },
      NOW
    );

    expect(valid).toBe(true);
    expect(problems).toEqual([]);
    expect(draft.title).toBe("Summer exams");
    expect(draft.scopes).toEqual([{ folderId: "biology", weight: 2 }]);
  });

  it("refuses to trust anything a draft arrives with", () => {
    /*
     * The student's own builder is bounded by its controls, so most of this
     * only ever fires for a plan a language model wrote. Running both through
     * one gate means the builder is never the only thing between a bad value
     * and Firestore.
     */
    const { draft } = normalizeRevisionPlanDraft(
      {
        title: "x".repeat(500),
        origin: "tutor",
        scopes: [
          { folderId: "biology", weight: 99 },
          { folderId: "biology", weight: 1 },
          { weight: 2 } as never,
          { deckId: "spanish", weight: -4 },
        ],
        cadence: [
          { weekday: 1, minutes: 9000 },
          { weekday: 1, minutes: 30 },
          { weekday: 42 as never, minutes: 30 },
        ],
      },
      NOW
    );

    expect(draft.title.length).toBe(80);
    // Duplicates dropped, scopes with no subject dropped, weights clamped.
    expect(draft.scopes).toEqual([
      { folderId: "biology", weight: 3 },
      { deckId: "spanish", weight: 1 },
    ]);
    // One entry per weekday, the last one winning, and nonsense weekdays gone.
    expect(draft.cadence).toEqual([{ weekday: 1, minutes: 30 }]);
  });

  it("drops emphasis on a subject the plan does not cover", () => {
    const { draft } = normalizeRevisionPlanDraft(
      {
        scopes: [{ folderId: "biology", weight: 1 }],
        cadence: [{ weekday: 1, minutes: 30 }],
        emphasis: [
          { scopeKey: "folder:biology", wants: "diagnose", note: "enzymes confuse me" },
          { scopeKey: "folder:physics", wants: "practice" },
        ],
      },
      NOW
    );

    expect(draft.emphasis).toEqual([
      { scopeKey: "folder:biology", wants: "diagnose", note: "enzymes confuse me" },
    ]);
  });

  it("says what is missing without throwing the rest away", () => {
    // A half-finished plan still renders what has been set, so the problems
    // read as guidance rather than as a wall.
    const { draft, problems, valid } = normalizeRevisionPlanDraft(
      { title: "Mocks", scopes: [], cadence: [] },
      NOW
    );

    expect(valid).toBe(false);
    expect(problems).toEqual(["no-scopes", "no-cadence"]);
    expect(draft.title).toBe("Mocks");
  });

  it("catches a finish date before the start", () => {
    const { problems } = normalizeRevisionPlanDraft(
      {
        scopes: [{ folderId: "biology", weight: 1 }],
        cadence: [{ weekday: 1, minutes: 30 }],
        startDayKey: "2026-10-12",
        endDayKey: "2026-09-14",
      },
      NOW
    );
    expect(problems).toContain("bad-dates");
  });
});

describe("whether Jami may draft unasked", () => {
  it("waits when everything it knows is an absence", () => {
    /*
     * `untested_exposure` and `not_yet_assessed` exist precisely because
     * nothing has been tested. A profile made entirely of those knows what
     * exists, not how the student is doing -- so Jami has no business
     * proposing a plan as though it understood them.
     */
    const readiness = assessPlanDraftReadiness([
      action("a", "untested_exposure"),
      action("b", "not_yet_assessed"),
      action("c", "untested_exposure"),
      action("d", "not_yet_assessed"),
    ]);

    expect(readiness.evidenced).toBe(0);
    expect(readiness.canDraftUnprompted).toBe(false);
    expect(describePlanDraftOffer(readiness).primary).toBe("Tell Jami what I need");
  });

  it("offers to draft once there is real work behind it", () => {
    const readiness = assessPlanDraftReadiness([
      action("a", "low_mastery"),
      action("b", "declining_mastery"),
      action("c", "persistent_error", "chemistry"),
      action("d", "not_yet_assessed"),
    ]);

    expect(readiness.evidenced).toBe(MIN_EVIDENCED_ACTIONS_TO_DRAFT);
    expect(readiness.scopes).toBe(2);
    expect(readiness.canDraftUnprompted).toBe(true);
    expect(describePlanDraftOffer(readiness).primary).toBe("Draft it for me");
  });

  it("does not count work the student could not start", () => {
    const stranded = { ...action("a", "low_mastery"), destination: undefined } as StudyAction;
    const readiness = assessPlanDraftReadiness([
      stranded,
      action("b", "low_mastery"),
      action("c", "low_mastery"),
    ]);
    expect(readiness.actionable).toBe(2);
    expect(readiness.canDraftUnprompted).toBe(false);
  });
});
