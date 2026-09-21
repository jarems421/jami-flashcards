import { describe, expect, it } from "vitest";
import {
  MAX_SPEC_SESSION_ITEMS,
  applyStudySessionShape,
  readStudySessionShape,
} from "@/lib/study/session-spec-queue";
import { parseStudyActionId } from "@/lib/learning/events/study-action-event";
import type { Card } from "@/lib/study/cards";

const NOW = Date.parse("2026-09-21T10:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function card(id: string, overrides: Partial<Card> = {}): Card {
  return {
    id,
    userId: "u1",
    deckId: "d1",
    front: id,
    back: id,
    tags: [],
    createdAt: NOW - 30 * DAY,
    reps: 5,
    lapses: 0,
    stability: 30,
    difficulty: 5,
    fsrsState: 2,
    lastReview: NOW - DAY,
    dueDate: NOW + 5 * DAY,
    ...overrides,
  } as Card;
}

describe("shaping a session to what the engine asked for", () => {
  it("leaves an ordinary session alone", () => {
    const cards = [card("a"), card("b"), card("c")];
    expect(applyStudySessionShape(cards, null, NOW).map((item) => item.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("stops a session at the size the engine asked for", () => {
    const cards = Array.from({ length: 30 }, (_, index) => card(`c${index}`));
    expect(
      applyStudySessionShape(cards, { emphasis: "practise", targetItems: 8 }, NOW)
    ).toHaveLength(8);
  });

  it("spreads a diagnosis across the least-known cards, not the most-answered", () => {
    const cards = [
      card("well-known", { reps: 40, lastReview: NOW - DAY }),
      card("never-seen", { reps: 0, lastReview: undefined, stability: undefined, fsrsState: 0 }),
      card("barely-seen", { reps: 1 }),
    ];
    const shaped = applyStudySessionShape(cards, { emphasis: "diagnose", targetItems: 2 }, NOW);
    expect(shaped.map((item) => item.id)).toEqual(["never-seen", "barely-seen"]);
  });

  it("puts the weakest material first when teaching or practising", () => {
    const cards = [
      card("solid", { stability: 300, lapses: 0 }),
      card("shaky", { stability: 1, lapses: 6 }),
      card("middling", { stability: 20, lapses: 1 }),
    ];
    const shaped = applyStudySessionShape(cards, { emphasis: "practise", targetItems: 3 }, NOW);
    expect(shaped[0]?.id).toBe("shaky");
    expect(shaped[2]?.id).toBe("solid");
  });

  it("asks what is actually due when retrieving", () => {
    const cards = [
      card("later", { dueDate: NOW + 10 * DAY }),
      card("overdue", { dueDate: NOW - 3 * DAY }),
      card("due-today", { dueDate: NOW - 60_000 }),
    ];
    const shaped = applyStudySessionShape(cards, { emphasis: "retrieve", targetItems: 3 }, NOW);
    expect(shaped.map((item) => item.id)).toEqual(["overdue", "due-today", "later"]);
  });

  it("reinforces what was practised most recently, never an untouched card", () => {
    const cards = [
      card("fresh", { lastReview: NOW - DAY }),
      card("stale", { lastReview: NOW - 20 * DAY }),
      card("untouched", { reps: 0, lastReview: undefined }),
    ];
    const shaped = applyStudySessionShape(cards, { emphasis: "reinforce", targetItems: 3 }, NOW);
    expect(shaped.map((item) => item.id)).toEqual(["fresh", "stale", "untouched"]);
  });

  it("gives the same session twice for the same cards", () => {
    const cards = Array.from({ length: 12 }, (_, index) => card(`c${index}`, { stability: 10 }));
    const shape = { emphasis: "practise" as const, targetItems: 5 };
    expect(applyStudySessionShape(cards, shape, NOW).map((item) => item.id)).toEqual(
      applyStudySessionShape(cards, shape, NOW).map((item) => item.id)
    );
  });

  it("never opens an empty session because a policy was too fussy", () => {
    expect(applyStudySessionShape([], { emphasis: "retrieve", targetItems: 5 }, NOW)).toEqual([]);
    const cards = [card("a"), card("b")];
    expect(
      applyStudySessionShape(cards, { emphasis: "retrieve", targetItems: 10 }, NOW)
    ).toHaveLength(2);
  });
});

describe("reading a session shape off a link", () => {
  it("accepts what the engine writes", () => {
    expect(readStudySessionShape("diagnose", "9")).toEqual({
      emphasis: "diagnose",
      targetItems: 9,
    });
  });

  it("refuses anything it does not recognise", () => {
    expect(readStudySessionShape(null, "9")).toBeNull();
    expect(readStudySessionShape("cram", "9")).toBeNull();
    expect(readStudySessionShape("diagnose", null)).toBeNull();
    expect(readStudySessionShape("diagnose", "0")).toBeNull();
    expect(readStudySessionShape("diagnose", "lots")).toBeNull();
  });

  it("caps a hand-edited link rather than trusting it", () => {
    expect(readStudySessionShape("practise", "9999")?.targetItems).toBe(MAX_SPEC_SESSION_ITEMS);
  });
});

describe("recovering an action from its id", () => {
  it("reads back the scope, reason and target a session was opened for", () => {
    expect(parseStudyActionId("folder:f1|low_mastery|topic:osmosis")).toEqual({
      actionId: "folder:f1|low_mastery|topic:osmosis",
      reason: "low_mastery",
      targetKey: "topic:osmosis",
      folderId: "f1",
    });
    expect(parseStudyActionId("deck:d1|due_for_retrieval|deck:d1")?.deckId).toBe("d1");
  });

  it("refuses an id that is not one of ours", () => {
    expect(parseStudyActionId("nonsense")).toBeNull();
    expect(parseStudyActionId("folder:f1|made_up|topic:x")).toBeNull();
    expect(parseStudyActionId("folder:f1|low_mastery")).toBeNull();
    expect(parseStudyActionId("")).toBeNull();
  });
});
