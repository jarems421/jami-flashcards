import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "@/lib/study/cards";
import {
  getDailyReviewBucket,
  planDailyReviewState,
  sortCardsForDailyReview,
  type DailyReviewState,
} from "@/lib/study/daily-review";
import { getStudyDayKey } from "@/lib/study/day";
import { getMemoryRiskInfo } from "@/lib/study/memory-risk";
import type { PersistedStudySession } from "@/lib/study/session";

const firestore = vi.hoisted(() => ({
  setDoc: vi.fn(),
  runTransaction: vi.fn(),
}));

vi.mock("firebase/firestore", () => ({
  arrayUnion: vi.fn((...ids: string[]) => ({ arrayUnion: ids })),
  collection: vi.fn(),
  deleteDoc: vi.fn(),
  doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join("/") })),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  runTransaction: firestore.runTransaction,
  setDoc: firestore.setDoc,
}));
vi.mock("@/services/firebase/client", () => ({ db: {} }));
vi.mock("@/services/study/commit-effect", () => ({ commitStudyEffect: vi.fn() }));
vi.mock("@/services/dashboard/cache", () => ({ invalidateDashboardData: vi.fn() }));

const { ensureDailyReviewState, recordDailyReviewWeakAttempt } = await import("@/services/study/daily-review");

const now = Date.UTC(2026, 9, 9, 12);
const today = getStudyDayKey(now);

function card(id: string, overrides: Partial<Card> = {}): Card {
  return { id, deckId: "deck-1", userId: "user-1", front: id, back: id, createdAt: 1, dueDate: 0, tags: [], topicIds: [], ...overrides };
}

function stored(overrides: Partial<DailyReviewState> = {}): DailyReviewState {
  return {
    id: "dailyReview",
    studyDayKey: today,
    generatedAt: now - 1_000,
    requiredCardIds: ["a", "b"],
    optionalCardIds: [],
    carryoverRequiredCardIds: [],
    completedRequiredCardIds: ["a"],
    completedOptionalCardIds: [],
    parkedRequiredCardIds: [],
    requiredRetryCounts: {},
    updatedAt: now - 1_000,
    ...overrides,
  };
}

describe("planning today's Daily Review", () => {
  it("leaves today's state alone when the cards still match it", () => {
    const state = stored();
    const plan = planDailyReviewState(state, [card("a"), card("b")], now, null);
    expect(plan).toEqual({ state, save: null });
  });

  it("brings today's state up to date with the cards, keeping what was finished", () => {
    const plan = planDailyReviewState(stored(), [card("a"), card("b"), card("c")], now, null);
    expect(plan.state.requiredCardIds).toEqual(expect.arrayContaining(["a", "b", "c"]));
    expect(plan.state.completedRequiredCardIds).toEqual(["a"]);
    expect(plan.state.id).toBe("dailyReview");
    // What is saved is the same state, without the document's id.
    expect(plan.save).not.toHaveProperty("id");
    expect({ id: plan.state.id, ...plan.save }).toEqual(plan.state);
    expect(plan.save?.updatedAt).toBe(now);
  });

  it("builds a new day afresh, carrying over what the last one left unfinished", () => {
    // "b" was left unfinished yesterday and is not due again today.
    const notDue = { dueDate: now + 7 * 86_400_000, reps: 3, lastReviewedAt: now - 86_400_000 };
    const plan = planDailyReviewState(stored({ studyDayKey: "2026-10-08" }), [card("a"), card("b", notDue)], now, null);
    expect(plan.state.studyDayKey).toBe(today);
    expect(plan.state.carryoverRequiredCardIds).toEqual(["b"]);
    expect(plan.state.completedRequiredCardIds).toEqual([]);
    expect(plan.save).toMatchObject({ studyDayKey: today, carryoverRequiredCardIds: ["b"] });
  });

  it("is left as it stands while a Daily Review session is under way on it", () => {
    const state = stored();
    const session = { status: "active", kind: "daily-required", studyDayKey: today } as PersistedStudySession;
    expect(planDailyReviewState(state, [card("a"), card("b"), card("c")], now, session)).toEqual({ state, save: null });
  });
});

describe("ordering the queue", () => {
  /** The order as it was worked out before each card's risk was kept: both risks, at every comparison. */
  function referenceOrder(cards: Card[]) {
    const reviewed = (card: Card) =>
      typeof card.lastReview === "number" ||
      (card.reps ?? 0) > 0 || (card.lapses ?? 0) > 0 || (card.repetitions ?? 0) > 0 ||
      (card.stability ?? 0) > 0 || (card.difficulty ?? 0) > 0 || (card.interval ?? 0) > 0 || (card.easeFactor ?? 0) > 0 ||
      (typeof card.fsrsState === "number" && card.fsrsState !== 0) ||
      typeof card.dueDate === "number";
    const time = (card: Card) =>
      typeof card.dueDate === "number" ? card.dueDate : typeof card.lastReview === "number" ? card.lastReview : card.createdAt;
    const compare = (a: Card, b: Card) =>
      getMemoryRiskInfo(b, now).score - getMemoryRiskInfo(a, now).score || time(a) - time(b) || a.createdAt - b.createdAt;
    const bucket = (name: string) =>
      cards.filter((card) => reviewed(card) && getDailyReviewBucket(card, now) === name).sort(compare).map((card) => card.id);
    return {
      neverReviewedCards: cards
        .filter((card) => !reviewed(card))
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
        .map((card) => card.id),
      weakCards: bucket("weak"),
      mediumCards: bucket("medium"),
      easyCards: bucket("easy"),
    };
  }

  it("puts three thousand assorted cards in exactly the order it always has", () => {
    let seed = 7;
    const random = () => ((seed = (seed * 48_271) % 2_147_483_647) / 2_147_483_647);
    const pick = <T,>(...options: T[]) => options[Math.floor(random() * options.length)];
    const cards = Array.from({ length: 3_000 }, (_, index) =>
      card(`card-${index}`, {
        // Few distinct values, so ties are common and the tie-breaks are what is tested.
        createdAt: pick(1, 2, 3),
        dueDate: pick(undefined, now - 3 * 86_400_000, now - 1_000, now + 86_400_000),
        reps: pick(0, 0, 2, 5),
        difficulty: pick(0, 3, 5.5, 8),
        lapses: pick(0, 0, 1, 3),
        scheduledDays: pick(0, 1, 6),
        lastReview: pick(undefined, now - 2 * 86_400_000),
        lastStruggleAt: pick(undefined, undefined, now - 3_600_000),
        memoryRiskOverrideDayKey: pick(undefined, undefined, today, "2026-10-01"),
      })
    );

    const sorted = sortCardsForDailyReview(cards, now);
    const ids = Object.fromEntries(
      Object.entries(sorted).map(([bucket, bucketCards]) => [bucket, bucketCards.map((item) => item.id)])
    );
    expect(ids).toEqual(referenceOrder(cards));
    expect(sorted.weakCards.length).toBeGreaterThan(100);
    expect(sorted.mediumCards.length).toBeGreaterThan(100);
  });
});

describe("saving today's Daily Review", () => {
  beforeEach(() => {
    firestore.setDoc.mockReset();
    firestore.runTransaction.mockReset();
  });

  it("answers before the save has landed, and a retry waits for it", async () => {
    let land!: () => void;
    firestore.setDoc.mockReturnValue(new Promise<void>((resolve) => { land = resolve; }));
    firestore.runTransaction.mockResolvedValue({ attemptCount: 1, parked: false });

    const state = await ensureDailyReviewState("user-1", [card("a"), card("b"), card("c")], now, {
      existingState: stored(),
    });
    expect(state.requiredCardIds).toContain("c");
    expect(firestore.setDoc).toHaveBeenCalledOnce();

    const retry = recordDailyReviewWeakAttempt("user-1", "b", now);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // A transaction run now would read the old state and be overwritten by the save.
    expect(firestore.runTransaction).not.toHaveBeenCalled();

    land();
    await expect(retry).resolves.toEqual({ attemptCount: 1, parked: false });
    expect(firestore.runTransaction).toHaveBeenCalledOnce();
  });

  it("keeps the worked-out state when the save fails", async () => {
    firestore.setDoc.mockRejectedValue(new Error("offline"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    firestore.runTransaction.mockResolvedValue({ attemptCount: 1, parked: false });

    const state = await ensureDailyReviewState("user-1", [card("a"), card("b"), card("c")], now, {
      existingState: stored(),
    });
    expect(state.requiredCardIds).toContain("c");
    // A failed save holds nothing up.
    await expect(recordDailyReviewWeakAttempt("user-1", "b", now)).resolves.toEqual({ attemptCount: 1, parked: false });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
