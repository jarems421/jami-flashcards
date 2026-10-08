import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  uid: "student" as string | null,
  readOwnCardsPage: vi.fn(),
}));

vi.mock("@/services/auth/authenticate-request.server", () => ({
  authenticateRequest: async () => mocks.uid,
  apiFailure: (error: string, status: number, code: string) => Response.json({ error, code }, { status }),
}));
vi.mock("@/services/study/own-cards.server", () => ({ readOwnCardsPage: mocks.readOwnCardsPage }));
vi.mock("@/lib/observability/logger", () => ({ createLogger: () => ({ error: vi.fn(), warn: vi.fn() }) }));

const { GET } = await import("@/app/api/study/cards/route");

const request = (query = "") => new NextRequest(`https://jami.test/api/study/cards${query}`);

beforeEach(() => {
  mocks.uid = "student";
  mocks.readOwnCardsPage.mockReset();
});

describe("GET /api/study/cards", () => {
  it("refuses anyone not signed in", async () => {
    mocks.uid = null;
    expect((await GET(request())).status).toBe(401);
    expect(mocks.readOwnCardsPage).not.toHaveBeenCalled();
  });

  it("reads the caller's own cards, from where the last page ended", async () => {
    mocks.readOwnCardsPage.mockResolvedValue({ cards: [{ id: "c1" }], nextCursor: null });

    const response = await GET(request("?after=c0"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({ cards: [{ id: "c1" }], nextCursor: null });
    expect(mocks.readOwnCardsPage).toHaveBeenCalledWith("student", { after: "c0" });
  });

  it("compresses the page for a browser that accepts gzip", async () => {
    const { gunzipSync } = await import("node:zlib");
    mocks.readOwnCardsPage.mockResolvedValue({ cards: [{ id: "c1" }], nextCursor: "c1" });

    const response = await GET(
      new NextRequest("https://jami.test/api/study/cards", { headers: { "accept-encoding": "gzip, deflate, br" } })
    );

    expect(response.headers.get("content-encoding")).toBe("gzip");
    const body = gunzipSync(Buffer.from(await response.arrayBuffer())).toString("utf8");
    expect(JSON.parse(body)).toEqual({ cards: [{ id: "c1" }], nextCursor: "c1" });
  });

  it("says the cards could not be read, without the reason, when the read fails", async () => {
    mocks.readOwnCardsPage.mockRejectedValue(new Error("DEADLINE_EXCEEDED on projects/x"));

    const response = await GET(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Your cards could not be read just now.",
      code: "cards_unavailable",
    });
  });
});
