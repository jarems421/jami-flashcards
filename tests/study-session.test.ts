import { afterEach, describe, expect, it, vi } from "vitest";
import type { Card } from "@/lib/study/cards";
import type { DailyReviewState } from "@/lib/study/daily-review";
import {
  buildPersistedStudySession,
  canRestorePersistedSession,
  clearClosedStudySessionTombstone,
  closePersistedStudySession,
  createEmptySessionStats,
  hasClosedStudySessionTombstone,
  hydratePersistedSessionCards,
  isIncomingSessionNewer,
  isStudySessionProgressRegression,
  normalizePersistedStudySession,
  saveClosedStudySessionTombstone,
} from "@/lib/study/session";

function createCard(id: string): Card {
  return {
    id,
    deckId: "deck-1",
    userId: "user-1",
    front: `Front ${id}`,
    back: `Back ${id}`,
    createdAt: 1,
    tags: [],
  };
}

function createDailyReviewState(overrides: Partial<DailyReviewState> = {}): DailyReviewState {
  return {
    id: "dailyReview",
    studyDayKey: "2026-05-02",
    generatedAt: 1,
    requiredCardIds: [],
    optionalCardIds: [],
    carryoverRequiredCardIds: [],
    completedRequiredCardIds: [],
    completedOptionalCardIds: [],
    parkedRequiredCardIds: [],
    requiredRetryCounts: {},
    updatedAt: 1,
    ...overrides,
  };
}

function installLocalStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("study session persistence", () => {
  it("normalizes quick-fix local sessions without the newer status fields", () => {
    const session = normalizePersistedStudySession(
      {
        version: 1,
        userId: "user-1",
        studyDayKey: "2026-05-02",
        kind: "daily-required",
        cardIds: ["a", "b"],
        index: 1,
        stats: { reviewedCards: 1, correctAnswers: 1, ratings: { good: 1 } },
        selectedDeckIds: [],
        selectedTags: [],
        savedAt: 100,
      },
      "user-1",
      "2026-05-02",
      200
    );

    expect(session).toMatchObject({
      sessionId: "legacy:user-1:2026-05-02:daily-required:100:2:a",
      revision: 1,
      status: "active",
      startedAt: 100,
      cardIds: ["a", "b"],
      index: 1,
      stats: {
        reviewedCards: 1,
        correctAnswers: 1,
        ratings: { again: 0, hard: 0, good: 1, easy: 0 },
      },
    });
  });

  it("preserves explicit session identity and revision when rebuilding a saved session", () => {
    const session = buildPersistedStudySession({
      userId: "user-1",
      sessionId: "session-1",
      revision: 4,
      kind: "daily-required",
      sessionCards: [createCard("a")],
      index: 1,
      stats: { ...createEmptySessionStats(), reviewedCards: 1 },
      selectedDeckIds: [],
      selectedTags: [],
      startedAt: 100,
      now: 200,
    });

    expect(session).toMatchObject({
      sessionId: "session-1",
      revision: 4,
      startedAt: 100,
    });
  });

  it("does not restore sessions that were ended on another device", () => {
    expect(
      normalizePersistedStudySession(
        {
          version: 1,
          userId: "user-1",
          studyDayKey: "2026-05-02",
          kind: "custom",
          status: "ended",
          cardIds: ["a"],
          index: 0,
          stats: createEmptySessionStats(),
          selectedDeckIds: [],
          selectedTags: [],
          startedAt: 100,
          savedAt: 150,
        },
        "user-1",
        "2026-05-02",
        200
      )
    ).toBeNull();
  });

  it("restores paused sessions across study day boundaries while they are still fresh", () => {
    const session = normalizePersistedStudySession(
      {
        version: 1,
        userId: "user-1",
        studyDayKey: "2026-05-01",
        kind: "daily-required",
        status: "active",
        cardIds: ["a"],
        index: 0,
        stats: createEmptySessionStats(),
        selectedDeckIds: [],
        selectedTags: [],
        startedAt: 100,
        savedAt: 150,
      },
      "user-1",
      "2026-05-02",
      200
    );

    expect(session?.studyDayKey).toBe("2026-05-01");
  });

  it("hydrates a saved queue without reintroducing daily cards already completed elsewhere", () => {
    const cards = ["a", "b", "c", "d"].map(createCard);
    const session = buildPersistedStudySession({
      userId: "user-1",
      kind: "daily-required",
      sessionCards: cards,
      index: 2,
      stats: createEmptySessionStats(),
      selectedDeckIds: [],
      selectedTags: [],
      now: 100,
    });
    const dailyReviewState = createDailyReviewState({
      requiredCardIds: ["a", "b", "c", "d"],
      completedRequiredCardIds: ["c"],
    });

    const restored = hydratePersistedSessionCards(session, cards, dailyReviewState);

    expect(restored.cards.map((card) => card.id)).toEqual(["a", "b", "d"]);
    expect(restored.index).toBe(2);
  });

  it("keeps custom-session restores tied to the requested filters", () => {
    const session = buildPersistedStudySession({
      userId: "user-1",
      kind: "custom",
      sessionCards: [createCard("a")],
      index: 0,
      stats: createEmptySessionStats(),
      selectedDeckIds: ["deck-1"],
      selectedTags: ["Cell Biology"],
      now: 100,
    });

    expect(canRestorePersistedSession(session, "custom", ["deck-1"], ["cell biology"])).toBe(true);
    expect(canRestorePersistedSession(session, "custom", ["deck-2"], ["cell biology"])).toBe(false);
    expect(canRestorePersistedSession(session, "daily", [], [])).toBe(false);
  });

  it("persists Simple Study sessions with stable identity and revision", () => {
    const session = buildPersistedStudySession({
      userId: "user-1",
      sessionId: "simple-session",
      revision: 2,
      kind: "simple",
      sessionCards: [createCard("a")],
      index: 0,
      stats: createEmptySessionStats(),
      selectedDeckIds: [],
      selectedTags: [],
      startedAt: 100,
      now: 200,
    });

    expect(session).toMatchObject({
      kind: "simple",
      sessionId: "simple-session",
      revision: 2,
    });
    expect(canRestorePersistedSession(session, null, [], [])).toBe(true);
    expect(canRestorePersistedSession(session, "daily", [], [])).toBe(false);
    expect(canRestorePersistedSession(session, "custom", [], [])).toBe(false);
  });

  it("detects stale active-session writes that would rewind progress", () => {
    const cards = ["a", "b", "c"].map(createCard);
    const base = buildPersistedStudySession({
      userId: "user-1",
      kind: "daily-required",
      sessionCards: cards,
      index: 1,
      stats: { ...createEmptySessionStats(), reviewedCards: 1 },
      selectedDeckIds: [],
      selectedTags: [],
      startedAt: 100,
      now: 200,
    });
    const stale = {
      ...base,
      index: 0,
      stats: createEmptySessionStats(),
      savedAt: 300,
    };
    const next = {
      ...base,
      index: 2,
      stats: { ...createEmptySessionStats(), reviewedCards: 2 },
      savedAt: 300,
    };

    expect(isStudySessionProgressRegression(base, stale)).toBe(true);
    expect(isStudySessionProgressRegression(base, next)).toBe(false);
  });

  it("orders active session writes by revision", () => {
    const cards = ["a", "b", "c"].map(createCard);
    const existing = buildPersistedStudySession({
      userId: "user-1",
      sessionId: "session-1",
      revision: 3,
      kind: "daily-required",
      sessionCards: cards,
      index: 2,
      stats: { ...createEmptySessionStats(), reviewedCards: 2 },
      selectedDeckIds: [],
      selectedTags: [],
      startedAt: 100,
      now: 300,
    });
    const older = { ...existing, revision: 2, index: 1, savedAt: 400 };
    const newer = { ...existing, revision: 4, index: 3, savedAt: 400 };

    expect(isIncomingSessionNewer(existing, older)).toBe(false);
    expect(isIncomingSessionNewer(existing, newer)).toBe(true);
  });

  it("keeps closed sessions newer than later active saves for the same session", () => {
    const active = buildPersistedStudySession({
      userId: "user-1",
      sessionId: "session-1",
      revision: 3,
      kind: "daily-required",
      sessionCards: [createCard("a")],
      index: 0,
      stats: createEmptySessionStats(),
      selectedDeckIds: [],
      selectedTags: [],
      startedAt: 100,
      now: 300,
    });
    const closed = closePersistedStudySession(active, "ended", "user-ended", 350);
    const lateActiveSave = { ...active, revision: 4, savedAt: 400 };

    expect(isIncomingSessionNewer(active, closed)).toBe(true);
    expect(isIncomingSessionNewer(closed, lateActiveSave)).toBe(false);
  });

  it("stores local closed-session tombstones that block restore", () => {
    installLocalStorage();
    const active = buildPersistedStudySession({
      userId: "user-1",
      sessionId: "session-1",
      revision: 3,
      kind: "daily-required",
      sessionCards: [createCard("a")],
      index: 0,
      stats: createEmptySessionStats(),
      selectedDeckIds: [],
      selectedTags: [],
      startedAt: 100,
      now: 300,
    });
    const closed = closePersistedStudySession(active, "ended", "user-ended", 350);

    saveClosedStudySessionTombstone(closed, true, 350);

    expect(hasClosedStudySessionTombstone("user-1", "session-1", closed.revision, 360)).toBe(true);

    clearClosedStudySessionTombstone("user-1");
    expect(hasClosedStudySessionTombstone("user-1", "session-1", closed.revision, 360)).toBe(false);
  });
});
