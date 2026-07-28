import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The drafting client. Its job is small but load-bearing: it is the only
 * caller of /api/ai/source-drafts, and the library page shows whatever error
 * message it produces directly to the student.
 */

const mocks = vi.hoisted(() => ({
  auth: { currentUser: null as { getIdToken: () => Promise<string> } | null },
}));

vi.mock("@/services/firebase/client", () => ({ auth: mocks.auth }));

const { generateSourceDrafts } = await import("@/services/ai/source-drafts");

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.auth.currentUser = { getIdToken: async () => "test-token" };
});

describe("generateSourceDrafts", () => {
  it("sends an authenticated request and returns the drafts", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        drafts: [{ id: "draft-1", kind: "flashcard" }],
        removedDraftCount: 2,
        requestedCount: 5,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generateSourceDrafts({ sourceId: "source-1", kind: "flashcard" })
    ).resolves.toEqual({
      drafts: [{ id: "draft-1", kind: "flashcard" }],
      removedDraftCount: 2,
      requestedCount: 5,
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/ai/source-drafts");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-token"
    );
    expect(JSON.parse(init.body as string)).toEqual({
      sourceId: "source-1",
      kind: "flashcard",
    });
  });

  it("defaults the counts when the route omits them", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { drafts: [] })));

    await expect(
      generateSourceDrafts({ sourceId: "source-1", kind: "flashcard" })
    ).resolves.toEqual({
      drafts: [],
      removedDraftCount: 0,
      requestedCount: undefined,
    });
  });

  it("explains a spent budget rather than surfacing a raw status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(429, {})));

    await expect(
      generateSourceDrafts({ sourceId: "source-1", kind: "flashcard" })
    ).rejects.toThrow(/today's draft limit/i);
  });

  it("explains an unconfigured deployment", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(503, {})));

    await expect(
      generateSourceDrafts({ sourceId: "source-1", kind: "flashcard" })
    ).rejects.toThrow(/not configured/i);
  });

  it("passes through the route's message when nothing usable was found", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      jsonResponse(422, { error: "Try a longer pasted source." })
    ));

    await expect(
      generateSourceDrafts({ sourceId: "source-1", kind: "practice-question" })
    ).rejects.toThrow("Try a longer pasted source.");
  });

  it("stays readable when the error body is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>500</html>", { status: 500 }))
    );

    await expect(
      generateSourceDrafts({ sourceId: "source-1", kind: "flashcard" })
    ).rejects.toThrow(/could not generate drafts/i);
  });

  it("refuses before making a request when nobody is signed in", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mocks.auth.currentUser = null;

    await expect(
      generateSourceDrafts({ sourceId: "source-1", kind: "flashcard" })
    ).rejects.toThrow("Not signed in");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
