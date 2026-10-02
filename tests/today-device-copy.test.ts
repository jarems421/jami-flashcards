import { describe, expect, it } from "vitest";
import type { Card } from "@/lib/study/cards";
import type { Source } from "@/lib/material/sources";
import type { DashboardSnapshot } from "@/services/dashboard/today";
import {
  fromTodayDeviceCopy,
  keepTodayDeviceCopy,
  readTodayDeviceCopy,
  toTodayDeviceCopy,
} from "@/services/dashboard/today-device-copy";

const NOW = Date.UTC(2026, 9, 2, 9, 0, 0);
const DAY = "2026-10-02";
const USER = "student-1";
const BUILD = "build-a";

const READY = {
  decks: "ready",
  profile: "ready",
  cards: "ready",
  session: "ready",
  goals: "ready",
  activity: "ready",
  topics: "ready",
  mastery: "ready",
  drafts: "ready",
  sources: "ready",
  folders: "ready",
  notebooks: "ready",
  dailyReview: "ready",
} as const satisfies DashboardSnapshot["sections"];

function card(id: string, overrides: Partial<Card> = {}): Card {
  return {
    id,
    deckId: "deck-1",
    userId: USER,
    front: `What is written on ${id}`,
    back: `The answer on ${id}`,
    frontImage: { storagePath: `users/${USER}/${id}.png`, width: 10, height: 10 } as Card["frontImage"],
    createdAt: 1,
    tags: [],
    topicIds: ["topic-1"],
    dueDate: NOW - 1,
    reps: 3,
    difficulty: 6,
    lapses: 1,
    lastReview: NOW - 86_400_000,
    ...overrides,
  };
}

function source(overrides: Partial<Source> = {}): Source {
  return {
    id: "source-1",
    title: "Lecture 4",
    type: "text",
    folderIds: ["folder-1"],
    topicIds: [],
    contentText: "Everything the lecture said, at length.",
    status: "active",
    createdBy: USER,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as Source;
}

function snapshot(overrides: Partial<DashboardSnapshot> = {}): DashboardSnapshot {
  const cards = [card("card-1"), card("card-2", { dueDate: NOW + 86_400_000 })];
  return {
    fetchedAt: NOW,
    sections: { ...READY },
    decks: [{ id: "deck-1", name: "Biology" }] as DashboardSnapshot["decks"],
    dueCards: [cards[0]],
    remainingOptionalCount: 2,
    activeGoals: [],
    hasEarnedStars: true,
    studyActivity: [],
    cards,
    topics: [],
    masteryEvents: [],
    drafts: [],
    sources: [source()],
    studyFolders: [],
    notebooks: [],
    username: "Sam",
    hasActiveStudySession: false,
    ...overrides,
  };
}

const expected = { userId: USER, dayKey: DAY, now: NOW + 60_000, build: BUILD };

describe("the device copy of Today", () => {
  it("keeps what Today draws from, and nothing written on a card or in a source", () => {
    const copy = toTodayDeviceCopy({ snapshot: snapshot(), userId: USER, dayKey: DAY, now: NOW, build: BUILD });
    expect(copy).not.toBeNull();
    const kept = JSON.stringify(copy);
    expect(kept).not.toContain("What is written on");
    expect(kept).not.toContain("The answer on");
    expect(kept).not.toContain("storagePath");
    expect(kept).not.toContain("Everything the lecture said");
    // The scheduling that decides what is due and what is at risk stays.
    expect(copy?.snapshot.cards[0]).toMatchObject({
      id: "card-1",
      deckId: "deck-1",
      topicIds: ["topic-1"],
      dueDate: NOW - 1,
      reps: 3,
      difficulty: 6,
      lapses: 1,
    });
    // Due cards are some of the cards, kept by id rather than twice over.
    expect(copy?.snapshot.dueCardIds).toEqual(["card-1"]);
    expect(copy?.snapshot.sources[0]).toMatchObject({ id: "source-1", title: "Lecture 4" });
  });

  it("keeps no copy of a snapshot that came back with gaps", () => {
    const degraded = snapshot({ sections: { ...READY, mastery: "stale" } });
    expect(
      toTodayDeviceCopy({ snapshot: degraded, userId: USER, dayKey: DAY, now: NOW, build: BUILD })
    ).toBeNull();
  });

  it("comes back as Today, every section marked as still to be loaded", () => {
    const copy = toTodayDeviceCopy({ snapshot: snapshot(), userId: USER, dayKey: DAY, now: NOW, build: BUILD });
    // Through storage, as it would really travel.
    const restored = fromTodayDeviceCopy(JSON.parse(JSON.stringify(copy)), expected);
    expect(restored).not.toBeNull();
    expect(Object.values(restored!.sections).every((state) => state === "stale")).toBe(true);
    expect(restored!.cards.map((each) => each.id)).toEqual(["card-1", "card-2"]);
    expect(restored!.cards[0]).toMatchObject({ front: "", back: "", dueDate: NOW - 1 });
    expect(restored!.dueCards.map((each) => each.id)).toEqual(["card-1"]);
    // The very same card object, as the snapshot's own due cards are.
    expect(restored!.dueCards[0]).toBe(restored!.cards[0]);
    expect(restored!.username).toBe("Sam");
    expect(restored!.remainingOptionalCount).toBe(2);
  });

  it("is shown only to its student, on its study day, by the build that kept it", () => {
    const copy = JSON.parse(
      JSON.stringify(
        toTodayDeviceCopy({ snapshot: snapshot(), userId: USER, dayKey: DAY, now: NOW, build: BUILD })
      )
    );
    expect(fromTodayDeviceCopy(copy, expected)).not.toBeNull();
    expect(fromTodayDeviceCopy(copy, { ...expected, userId: "someone-else" })).toBeNull();
    expect(fromTodayDeviceCopy(copy, { ...expected, dayKey: "2026-10-03" })).toBeNull();
    // A deploy can change the snapshot's shape; an old copy must never meet it.
    expect(fromTodayDeviceCopy(copy, { ...expected, build: "build-b" })).toBeNull();
    expect(fromTodayDeviceCopy({ ...copy, version: 2 }, expected)).toBeNull();
    // A clock that has been moved does not revive a copy, either way.
    expect(fromTodayDeviceCopy(copy, { ...expected, now: NOW - 1 })).toBeNull();
    expect(fromTodayDeviceCopy(copy, { ...expected, now: NOW + 21 * 3_600_000 })).toBeNull();
  });

  it("refuses anything that is not a copy", () => {
    const copy = JSON.parse(
      JSON.stringify(
        toTodayDeviceCopy({ snapshot: snapshot(), userId: USER, dayKey: DAY, now: NOW, build: BUILD })
      )
    );
    expect(fromTodayDeviceCopy(null, expected)).toBeNull();
    expect(fromTodayDeviceCopy("today", expected)).toBeNull();
    expect(fromTodayDeviceCopy({ ...copy, snapshot: null }, expected)).toBeNull();
    expect(
      fromTodayDeviceCopy({ ...copy, snapshot: { ...copy.snapshot, cards: "lots" } }, expected)
    ).toBeNull();
  });

  it("simply has no copy where the device cannot keep one", async () => {
    // No IndexedDB here, as in a browser that refuses it: nothing throws.
    await expect(
      keepTodayDeviceCopy({ snapshot: snapshot(), userId: USER, dayKey: DAY, now: NOW })
    ).resolves.toBeUndefined();
    await expect(readTodayDeviceCopy({ userId: USER, dayKey: DAY, now: NOW })).resolves.toBeNull();
  });
});
