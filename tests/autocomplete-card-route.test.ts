import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import {
  captureStructuredLogs,
  expectRedactedLogs,
} from "./support/log-capture";

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

  const deckGet = vi.fn();
  const deckDoc = { get: deckGet };
  const deckCollection = { doc: vi.fn(() => deckDoc) };
  const collection = vi.fn((name: string) =>
    name === "decks" ? deckCollection : cardsQuery
  );

  return {
    cardsQuery,
    collection,
    deckCollection,
    deckGet,
    flags: { enableFolders: true, enableMasteryProgress: true, enableFlashcardAi: true },
    verifyIdToken: vi.fn(async () => ({ uid: "user-1" })),
    checkBudget: vi.fn(),
    generateText: vi.fn(),
    providerConfigured: true,
    db: { collection },
  };
});

vi.mock("@/services/firebase/admin", () => ({
  getAdminAuth: () => ({ verifyIdToken: mocks.verifyIdToken }),
  getAdminDb: () => mocks.db,
}));

vi.mock("@/services/ai/budgets", () => ({
  checkAiBudget: mocks.checkBudget,
  createAiBudgetLimitResponse: (
    _action: string,
    decision: { reason: string; retryAfterSeconds: number }
  ) =>
    Response.json(
      {
        error:
          decision.reason === "burst_limit"
            ? "Jami is receiving requests too quickly. Try again in a moment."
            : "Jami has reached today's AI limit. Try again tomorrow.",
        code: decision.reason,
        retryAfterSeconds: decision.retryAfterSeconds,
      },
      {
        status: 429,
        headers:
          decision.reason === "burst_limit"
            ? { "Retry-After": String(decision.retryAfterSeconds) }
            : undefined,
      }
    ),
  getAiTokenCap: () => 900,
}));

vi.mock("@/lib/ai/gemini", () => ({
  isGeminiTimeoutError: (error: unknown) =>
    error instanceof Error && error.message === "Request timed out",
}));

// The route reaches the providers through the role router, never a named
// provider module, so the router is the seam a route test stubs.
vi.mock("@/lib/ai/provider-router", () => ({
  generateAiText: mocks.generateText,
  isAnyAiProviderConfigured: () => mocks.providerConfigured,
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
  mocks.providerConfigured = true;
  mocks.verifyIdToken.mockResolvedValue({ uid: "user-1" });
  mocks.checkBudget.mockResolvedValue({
    allowed: true,
    reason: null,
    retryAfterSeconds: 0,
  });
  mocks.deckGet.mockReset().mockResolvedValue({
    exists: true,
    data: () => ({ userId: "user-1" }),
  });
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
    expect(mocks.deckCollection.doc).toHaveBeenCalledWith("deck-1");
    expect(mocks.deckGet.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.checkBudget.mock.invocationCallOrder[0]
    );
  });

  it("does not charge when the supplied deck does not exist", async () => {
    mocks.deckGet.mockResolvedValueOnce({
      exists: false,
      data: () => undefined,
    });

    const response = await postAutocomplete(request(mathsCard()));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Deck not found" });
    expect(mocks.checkBudget).not.toHaveBeenCalled();
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("does not charge when the supplied deck belongs to another user", async () => {
    mocks.deckGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ userId: "user-2" }),
    });

    const response = await postAutocomplete(request(mathsCard()));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Deck not found" });
    expect(mocks.checkBudget).not.toHaveBeenCalled();
    expect(mocks.generateText).not.toHaveBeenCalled();
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

  it("does not charge when required nearby-card reads fail", async () => {
    mocks.cardsQuery.get.mockRejectedValueOnce(new Error("Firestore unavailable"));

    const response = await postAutocomplete(request(mathsCard()));

    expect(response.status).toBe(500);
    expect(mocks.checkBudget).not.toHaveBeenCalled();
    expect(mocks.generateText).not.toHaveBeenCalled();
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
    expect(mocks.checkBudget).not.toHaveBeenCalled();
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("refuses once the daily budget is spent", async () => {
    mocks.checkBudget.mockResolvedValueOnce({
      allowed: false,
      reason: "daily_limit",
      retryAfterSeconds: 3_600,
    });

    const response = await postAutocomplete(request(mathsCard()));
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body).toMatchObject({
      code: "daily_limit",
      retryAfterSeconds: 3_600,
    });
    expect(response.headers.get("Retry-After")).toBeNull();
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("returns a retry header for a burst rejection", async () => {
    mocks.checkBudget.mockResolvedValueOnce({
      allowed: false,
      reason: "burst_limit",
      retryAfterSeconds: 27,
    });

    const response = await postAutocomplete(request(mathsCard()));

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      code: "burst_limit",
      retryAfterSeconds: 27,
    });
    expect(response.headers.get("Retry-After")).toBe("27");
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("fails closed when the budget store is unavailable", async () => {
    mocks.checkBudget.mockRejectedValueOnce(new Error("Firestore unavailable"));

    const response = await postAutocomplete(request(mathsCard()));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "budget_unavailable",
    });
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("logs a correlated request without writing the card's text to the log", async () => {
    mocks.generateText.mockRejectedValue(
      Object.assign(new Error("Gemini is overloaded"), { status: 503 })
    );

    const { records, lines } = await captureStructuredLogs(() =>
      postAutocomplete(
        request(
          mathsCard({
            front: "Solve SECRET_CARD_FRONT for x",
            currentBack: "SECRET_CARD_DRAFT",
          })
        )
      )
    );

    expectRedactedLogs({
      records,
      lines,
      route: "ai.autocomplete-card",
      events: ["provider.first_attempt_failed", "provider.failed"],
      studentText: [
        "SECRET_CARD_FRONT",
        "SECRET_CARD_DRAFT",
        // The nearby cards pulled in for tone are someone's work too.
        "What is the quadratic formula?",
        "Algebra",
      ],
    });

    const failure = records.find((record) => record.event === "provider.failed");
    expect(failure?.error).toMatchObject({ status: 503 });
    expect(failure?.uid).toBe("[redacted]");
  });

  it("fails closed when no compliant provider is configured", async () => {
    mocks.providerConfigured = false;

    const response = await postAutocomplete(
      request({ front: "Solve $x^2 + 3x = 0$", deckId: "deck-1" })
    );

    expect(response.status).toBe(503);
    expect(mocks.generateText).not.toHaveBeenCalled();
  });
});
