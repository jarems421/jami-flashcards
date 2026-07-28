import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The learn surface's card context.
 *
 * These two capabilities came from the retired /api/ai/chat route, which fed
 * the card's FSRS state and its neighbouring cards into the prompt so the
 * tutor could scale its scaffolding and spot likely mix-ups. They are read
 * server-side from the card document rather than trusted from the request,
 * which is a change from how chat did it.
 */

const mocks = vi.hoisted(() => {
  const cardDoc = {
    id: "card-1",
    exists: true,
    data: () => ({
      userId: "user-1",
      deckId: "deck-1",
      front: "What is photosynthesis?",
      back: "Converting light energy into chemical energy.",
      topicIds: ["topic-plants"],
      difficulty: 8,
      lapses: 4,
      reps: 2,
      scheduledDays: 1,
      elapsedDays: 3,
    }),
  };

  const deckDoc = {
    exists: true,
    data: () => ({ userId: "user-1", name: "Biology", folderIds: [] }),
  };

  const relatedCards = {
    docs: [
      {
        id: "card-2",
        data: () => ({
          front: "What is respiration?",
          back: "Releasing energy from glucose.",
          topicIds: ["topic-plants"],
        }),
      },
      {
        id: "card-1",
        data: () => ({ front: "What is photosynthesis?", back: "Should be excluded." }),
      },
    ],
  };

  const cardsQuery = { where: vi.fn(), limit: vi.fn(), get: vi.fn() };
  cardsQuery.where.mockReturnValue(cardsQuery);
  cardsQuery.limit.mockReturnValue(cardsQuery);
  cardsQuery.get.mockResolvedValue(relatedCards);

  const emptyDoc = { exists: false, data: () => undefined };
  const emptyCollection = {
    doc: () => ({ get: async () => emptyDoc }),
    where: () => emptyCollection,
    limit: () => emptyCollection,
    get: async () => ({ docs: [] }),
  };

  const db = {
    collection: vi.fn((name: string) => {
      if (name === "cards") {
        return { doc: () => ({ get: async () => cardDoc }), ...cardsQuery };
      }
      if (name === "decks") return { doc: () => ({ get: async () => deckDoc }) };
      // The context resolver also reaches users/{uid}/sources for related material.
      if (name === "users") {
        return { doc: () => ({ get: async () => emptyDoc, collection: () => emptyCollection }) };
      }
      return emptyCollection;
    }),
  };

  return { db, cardsQuery };
});

vi.mock("@/services/firebase/admin", () => ({
  getAdminDb: () => mocks.db,
  getAdminStorageBucket: () => ({}),
}));

const { resolveJamiAssistantContext } = await import("@/lib/ai/assistant-context.server");

async function resolveLearn() {
  return resolveJamiAssistantContext({
    uid: "user-1",
    message: "Give me a hint.",
    context: { surface: "learn", cardId: "card-1", phase: "question" },
    useRelatedSources: false,
  });
}

function contextText(resolved: Awaited<ReturnType<typeof resolveLearn>>) {
  return resolved.currentParts.map((part) => ("text" in part ? part.text : "")).join("\n");
}

beforeEach(() => {
  mocks.cardsQuery.where.mockClear();
  mocks.cardsQuery.limit.mockClear();
});

describe("learn context memory profile", () => {
  it("describes how well the student knows the card", async () => {
    const text = contextText(await resolveLearn());

    expect(text).toContain("Memory profile:");
    expect(text).toContain("Difficulty: high");
    expect(text).toContain("Times struggled: 4");
    expect(text).toContain("Successful reps: 2");
  });

  it("tells the tutor to scaffold more when the card looks shaky", async () => {
    const text = contextText(await resolveLearn());

    expect(text).toContain("give more scaffolding");
  });

  it("still carries the card, deck, and phase", async () => {
    const text = contextText(await resolveLearn());

    expect(text).toContain("Learn phase: question");
    expect(text).toContain("Deck: Biology");
    expect(text).toContain("What is photosynthesis?");
  });
});

describe("learn context related cards", () => {
  it("includes neighbouring cards for mix-up detection", async () => {
    const text = contextText(await resolveLearn());

    expect(text).toContain("Nearby cards in the same deck:");
    expect(text).toContain("What is respiration?");
  });

  it("excludes the card the student is already looking at", async () => {
    expect(contextText(await resolveLearn())).not.toContain("Should be excluded.");
  });

  it("scopes the query to the deck instead of scanning the collection", async () => {
    await resolveLearn();

    const filters = mocks.cardsQuery.where.mock.calls.map((call) => call[0]);
    expect(filters).toContain("userId");
    expect(filters).toContain("deckId");
    expect(mocks.cardsQuery.limit).toHaveBeenCalledWith(20);
  });
});
