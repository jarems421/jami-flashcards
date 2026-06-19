import { describe, expect, it } from "vitest";
import {
  buildMigratedTopicIds,
  buildTopicSummaries,
  chunkTopicWrites,
  collectMissingTopicNames,
} from "@/lib/practice/topic-management";
import type { Topic } from "@/lib/practice/topics";
import type { Card } from "@/lib/study/cards";

describe("Topic migration helpers", () => {
  it("reuses existing names case-insensitively and deduplicates missing names", () => {
    expect(
      collectMissingTopicNames(
        [["Biology", "Cell Energy"], ["biology", "CELL ENERGY", "Mitosis"]],
        [{ name: "Biology" }]
      )
    ).toEqual(["Cell Energy", "Mitosis"]);
  });

  it("unions migrated IDs without truncating over-limit legacy cards", () => {
    const current = ["a", "b", "c", "d", "e", "f"];
    const idsByName = new Map([
      ["biology", "b"],
      ["chemistry", "g"],
    ]);

    expect(
      buildMigratedTopicIds(current, ["Biology", "Chemistry"], idsByName)
    ).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
  });

  it("is idempotent when migration is retried", () => {
    const idsByName = new Map([["biology", "topic-biology"]]);
    const first = buildMigratedTopicIds([], ["Biology"], idsByName);
    expect(buildMigratedTopicIds(first, ["biology"], idsByName)).toEqual(first);
  });

  it("chunks large write sets without dropping operations", () => {
    const writes = Array.from({ length: 801 }, (_, index) => index);
    const chunks = chunkTopicWrites(writes, 400);
    expect(chunks.map((chunk) => chunk.length)).toEqual([400, 400, 1]);
    expect(chunks.flat()).toEqual(writes);
  });

  it("counts pending drafts and real card evidence only", () => {
    const topic: Topic = {
      id: "topic-1",
      name: "Mitosis",
      slug: "mitosis",
      subject: "Biology",
      status: "active",
      createdBy: "user",
      createdAt: 1,
      updatedAt: 1,
    };
    const card: Card = {
      id: "card-1",
      deckId: "deck-1",
      userId: "user-1",
      front: "Front",
      back: "Back",
      tags: [],
      topicIds: [topic.id],
      createdAt: 1,
      dueDate: 5,
      difficulty: 9,
      lapses: 3,
      reps: 5,
    };
    const [summary] = buildTopicSummaries({
      topics: [topic],
      cards: [card],
      notebooks: [],
      sources: [],
      drafts: [
        {
          id: "pending",
          kind: "flashcard",
          title: "Pending",
          topicIds: [topic.id],
          origin: "ai-assisted",
          contentStatus: "draft",
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: "approved",
          kind: "flashcard",
          title: "Approved",
          topicIds: [topic.id],
          origin: "ai-assisted",
          contentStatus: "approved",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      now: 10,
    });

    expect(summary).toMatchObject({
      cardCount: 1,
      draftCount: 1,
      dueCardCount: 1,
      weakCardCount: 1,
      notebookCount: 0,
    });
  });
});
