import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/*
 * Asking Jami to arrange a sky. The prompt, the reply parsing and the fitting
 * of the drawing to the stars are left real; only the provider, budget and
 * Firestore are stubbed.
 */

const mocks = vi.hoisted(() => {
  const constellationGet = vi.fn();
  const starsGet = vi.fn();
  const where = vi.fn(() => ({ get: starsGet }));
  return {
    constellationGet,
    starsGet,
    where,
    db: {
      doc: vi.fn(() => ({ get: constellationGet })),
      collection: vi.fn(() => ({ where })),
    },
    verifyIdToken: vi.fn(async () => ({ uid: "user-1" })),
    checkBudget: vi.fn(),
    refundBudget: vi.fn(),
    generateText: vi.fn(),
  };
});

vi.mock("@/services/firebase/admin", () => ({
  getAdminAuth: () => ({ verifyIdToken: mocks.verifyIdToken }),
  getAdminDb: () => mocks.db,
}));

vi.mock("@/services/ai/budgets", () => ({
  checkAiBudget: mocks.checkBudget,
  refundAiBudget: mocks.refundBudget,
  createAiBudgetLimitResponse: () => Response.json({ error: "limit" }, { status: 429 }),
  getAiTokenCap: () => 4_000,
}));

vi.mock("@/lib/ai/gemini", () => ({
  isGeminiTimeoutError: (error: unknown) =>
    error instanceof Error && error.message === "Request timed out",
}));

vi.mock("@/lib/ai/provider-router", () => ({
  generateAiText: mocks.generateText,
  isAnyAiProviderConfigured: () => true,
}));

let post: (request: NextRequest) => Promise<Response>;

function request(body: Record<string, unknown>, authorization = "Bearer test-token") {
  return new Request("http://localhost/api/ai/constellation-pattern", {
    method: "POST",
    headers: { Authorization: authorization, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function starDocs(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `star-${index}`,
    data: () => ({ goalId: `goal-${index}`, constellationId: "initial", size: 3, glow: 0.8, createdAt: index, position: { x: 50, y: 50 } }),
  }));
}

const triangle = JSON.stringify({
  reply: "A bright triangle.",
  idealStars: 3,
  area: { x: 50, y: 50, size: 0.9 },
  strokes: [{ points: [[50, 10], [90, 90], [10, 90]], closed: true }],
});

beforeAll(async () => {
  ({ POST: post } = await import("@/app/api/ai/constellation-pattern/route"));
}, 120_000);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verifyIdToken.mockResolvedValue({ uid: "user-1" });
  mocks.constellationGet.mockResolvedValue({ exists: true, data: () => ({ lines: [] }) });
  mocks.starsGet.mockResolvedValue({ docs: starDocs(3) });
  mocks.checkBudget.mockResolvedValue({
    allowed: true,
    reason: null,
    retryAfterSeconds: 0,
    grant: { uid: "user-1", action: "constellationPattern", dayKey: "2026-09-14", burstWindowStartedAt: 0 },
  });
});

describe("POST /api/ai/constellation-pattern", () => {
  it("needs a signed-in student", async () => {
    const response = await post(request({ constellationId: "initial", request: "a triangle" }, ""));
    expect(response.status).toBe(401);
  });

  it("refuses a constellation id that could reach another path", async () => {
    const response = await post(request({ constellationId: "../../other", request: "a triangle" }));
    expect(response.status).toBe(400);
    expect(mocks.db.doc).not.toHaveBeenCalled();
  });

  it("reads the student's own sky and charges nothing when it is missing", async () => {
    mocks.constellationGet.mockResolvedValue({ exists: false, data: () => undefined });
    const response = await post(request({ constellationId: "initial", request: "a triangle" }));

    expect(response.status).toBe(404);
    expect(mocks.db.doc).toHaveBeenCalledWith("users/user-1/constellations/initial");
    expect(mocks.where).toHaveBeenCalledWith("constellationId", "==", "initial");
    expect(mocks.checkBudget).not.toHaveBeenCalled();
  });

  it("fits Jami's drawing to exactly the stars in the sky, on the cheapest model thinking a little", async () => {
    mocks.generateText.mockResolvedValue(triangle);

    const response = await post(request({ constellationId: "initial", request: "a triangle", aspectRatio: 2 }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.reply).toBe("A bright triangle.");
    expect(Object.keys(body.positions).sort()).toEqual(["star-0", "star-1", "star-2"]);
    expect(body.lines).toHaveLength(3);
    expect(body.drawing.strokes).toHaveLength(1);

    const call = mocks.generateText.mock.calls[0][0];
    expect(call).toMatchObject({ role: "worker", allowRoleEscalation: false, reasoningEffort: "medium" });
    expect(call.request.contents[0].parts[0].text).toContain("The student has 3 stars, so use no more than 3 points");
    expect(call.request.contents[0].parts[0].text).not.toContain("star-0");
  });

  it("builds a follow-up on the drawing the page sends back", async () => {
    mocks.generateText.mockResolvedValue(triangle);
    await post(
      request({
        constellationId: "initial",
        request: "make it bigger",
        previousDrawing: { strokes: [{ points: [[20, 20], [80, 80]], closed: false }], area: { x: 50, y: 50, size: 0.5 } },
      })
    );
    expect(mocks.generateText.mock.calls[0][0].request.contents[0].parts[0].text).toContain(
      'Previous drawing: {"area":{"x":50,"y":50,"size":0.5}'
    );
  });

  it("says when the sky is short of stars for the picture", async () => {
    mocks.generateText.mockResolvedValue(
      JSON.stringify({
        reply: "Here's a cat.",
        idealStars: 14,
        strokes: [{ points: [[20, 20], [30, 5], [40, 20], [60, 20], [70, 5], [80, 20], [80, 70], [20, 70]], closed: true }],
      })
    );

    const body = await (await post(request({ constellationId: "initial", request: "a cat" }))).json();
    expect(body.reply).toBe("Here's a cat. You have 3 stars, so this is a simpler version. It will look fuller with about 14.");
    expect(Object.keys(body.positions)).toHaveLength(3);
  });

  it("answers without moving anything when Jami draws nothing", async () => {
    mocks.generateText.mockResolvedValue('{"reply": "I can only draw pictures with your stars.", "strokes": []}');
    const body = await (await post(request({ constellationId: "initial", request: "do my homework" }))).json();
    expect(body).toEqual({ reply: "I can only draw pictures with your stars.", positions: {}, lines: null, drawing: null });
  });

  it("hands the request back when Jami's answer is unusable", async () => {
    mocks.generateText.mockResolvedValue("I would love to help!");
    const response = await post(request({ constellationId: "initial", request: "a triangle" }));

    expect(response.status).toBe(502);
    expect(mocks.refundBudget).toHaveBeenCalledTimes(1);
  });

  it("does not ask Jami about a sky with fewer than two stars", async () => {
    mocks.starsGet.mockResolvedValue({ docs: starDocs(1) });
    const response = await post(request({ constellationId: "initial", request: "a triangle" }));

    expect(response.status).toBe(400);
    expect(mocks.generateText).not.toHaveBeenCalled();
  });
});
