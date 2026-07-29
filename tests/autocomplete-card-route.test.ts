import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * The card back drafting route.
 *
 * This was dark behind enableFlashcardAi until the flag was defaulted on, so
 * nothing had ever exercised it end to end. The subject detection, prompt
 * building and incomplete-answer heuristics are left unmocked; only the
 * provider, budget and Firestore are stubbed.
 */

const mocks = vi.hoisted(() => {
  const cardsQuery = {
    where: vi.fn(),
    limit: vi.fn(),
    get: vi.fn(),
  };
  cardsQuery.where.mockReturnValue(cardsQuery);
  cardsQuery.limit.mockReturnValue(cardsQuery);
  cardsQuery.get.mockResolvedValue({
    docs: [
      {
        id: "card-2",
        data: () => ({
          front: "What is the quadratic formula?",
          back: "x = (-b +/- sqrt(b^2 - 4ac)) / 2a",
          topicIds: ["topic-algebra"],
        }),
      },
    ],
  });

  return {
    cardsQuery,
    flags: { enableFolders: true, enableMasteryProgress: true, enableFlashcardAi: true },
    verifyIdToken: vi.fn(async () => ({ uid: "user-1" })),
    checkBudget: vi.fn(async () => true),
    generateText: vi.fn(),
    db: { collection: () => cardsQuery },
  };
});

vi.mock("@/services/firebase/admin", () => ({
  getAdminAuth: () => ({ verifyIdToken: mocks.verifyIdToken }),
  getAdminDb: () => mocks.db,
}));

vi.mock("@/services/ai/budgets", () => ({
  checkAiBudget: mocks.checkBudget,
  getAiTokenCap: () => 900,
}));

vi.mock("@/lib/ai/gemini", () => ({
  generateGeminiText: mocks.generateText,
  isGeminiTimeoutError: (error: unknown) =>
    error instanceof Error && error.message === "Request timed out",
}));

vi.mock("@/lib/app/feature-flags", () => ({
  featureFlags: mocks.flags,
  isFeatureEnabled: (key: keyof typeof mocks.flags) => mocks.flags[key],
}));

let postAutocomplete: (request: NextRequest) => Promise<Response>;

function request(body: Record<string, unknown>, authorization = "Bearer test-token") {
  return new Request("http://localhost/api/ai/autocomplete-card", {
    method: "POST",
    headers: { Authorization: authorization, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function mathsCard(overrides: Record<string, unknown> = {}) {
  return {
    front: "Solve the equation x^2 + 3x = 0",
    deckId: "deck-1",
    deckName: "Algebra",
    topics: ["Quadratics"],
    topicIds: ["topic-algebra"],
    ...overrides,
  };
}

beforeAll(async () => {
  process.env.GEMINI_API_KEY = "test-key";
  ({ POST: postAutocomplete } = await import("@/app/api/ai/autocomplete-card/route"));
}, 120_000);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.flags.enableFlashcardAi = true;
  mocks.verifyIdToken.mockResolvedValue({ uid: "user-1" });
  mocks.checkBudget.mockResolvedValue(true);
  mocks.cardsQuery.where.mockReturnValue(mocks.cardsQuery);
  mocks.cardsQuery.limit.mockReturnValue(mocks.cardsQuery);
  mocks.generateText.mockResolvedValue("Factorise to $x(x + 3) = 0$, so $x = 0$ or $x = -3$.");
});

describe("card back autocomplete", () => {
  it("drafts a back for the card", async () => {
    const response = await postAutocomplete(request(mathsCard()));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.back).toContain("x = 0");
  });

  it("does nothing when the flashcard AI flag is off", async () => {
    mocks.flags.enableFlashcardAi = false;

    const response = await postAutocomplete(request(mathsCard()));

    expect(response.status).toBe(403);
    expect(mocks.checkBudget).not.toHaveBeenCalled();
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("scopes the related-card lookup to the deck rather than the collection", async () => {
    await postAutocomplete(request(mathsCard()));

    const filters = mocks.cardsQuery.where.mock.calls.map((call) => call[0]);
    expect(filters).toContain("userId");
    expect(filters).toContain("deckId");
    expect(mocks.cardsQuery.limit).toHaveBeenCalledWith(20);
  });

  it("skips the lookup entirely for a card with no deck", async () => {
    await postAutocomplete(request(mathsCard({ deckId: undefined })));

    expect(mocks.cardsQuery.where).not.toHaveBeenCalled();
    expect(mocks.generateText).toHaveBeenCalled();
  });

  it("asks a maths card for LaTeX rather than Unicode symbols", async () => {
    await postAutocomplete(request(mathsCard()));

    const systemPrompt = (
      mocks.generateText.mock.calls[0]?.[0] as {
        request: { systemInstruction: string };
      }
    ).request.systemInstruction;

    expect(systemPrompt).toContain("Maths accuracy rules:");
    expect(systemPrompt).toContain("$...$");
    expect(systemPrompt).not.toContain("not LaTeX");
  });

  it("retries once when the first draft looks unfinished", async () => {
    mocks.generateText
      .mockResolvedValueOnce("The answer is (x + 3")
      .mockResolvedValueOnce("Factorise to $x(x + 3) = 0$, so $x = 0$ or $x = -3$.");

    const response = await postAutocomplete(request(mathsCard()));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.generateText).toHaveBeenCalledTimes(2);
    expect(body.back).toContain("x = -3");
  });

  it("reports a failure rather than saving an empty back", async () => {
    mocks.generateText.mockResolvedValue("");

    const response = await postAutocomplete(request(mathsCard()));

    expect(response.status).toBe(502);
  });

  it("requires a front", async () => {
    const response = await postAutocomplete(request(mathsCard({ front: "" })));

    expect(response.status).toBe(400);
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("refuses once the daily budget is spent", async () => {
    mocks.checkBudget.mockResolvedValueOnce(false);

    const response = await postAutocomplete(request(mathsCard()));

    expect(response.status).toBe(429);
    expect(mocks.generateText).not.toHaveBeenCalled();
  });
});
