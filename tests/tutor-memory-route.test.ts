import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { TutorMemoryState } from "@/lib/ai/tutor-memory";

const NOW = Date.now();

const mocks = vi.hoisted(() => ({
  writer: vi.fn(),
  reader: vi.fn(),
  stored: { current: null as TutorMemoryState | null },
}));

vi.mock("@/services/ai/assistant-assets.server", () => ({
  authenticateAssistantWriter: mocks.writer,
  authenticateAssistantAssetRequest: mocks.reader,
  assistantAssetError: (message: string, status: number, code: string) =>
    Response.json({ error: message, code }, { status }),
}));
vi.mock("@/lib/app/feature-flags", () => ({
  featureFlags: { enableTutorMemory: true },
}));
/** The transaction, as a plain read-modify-write over one stored document. */
vi.mock("@/services/ai/tutor-memory.server", () => ({
  loadTutorMemory: async () => mocks.stored.current,
  updateTutorMemory: async (_uid: string, change: (state: TutorMemoryState) => TutorMemoryState | null) => {
    const current = mocks.stored.current as TutorMemoryState;
    const next = change(current);
    if (next) mocks.stored.current = next;
    return mocks.stored.current;
  },
}));

const { GET, PATCH } = await import("@/app/api/ai/assistant/memory/route");

function patch(body: unknown) {
  return new NextRequest("https://jami.test/api/ai/assistant/memory", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.writer.mockResolvedValue({ uid: "student-1", isDemo: false });
  mocks.reader.mockResolvedValue("student-1");
  mocks.stored.current = {
    enabled: true,
    updatedAt: NOW - 1_000,
    items: [
      { id: "a", kind: "struggle", text: "Finds moles hard", topicIds: ["moles"], createdAt: NOW - 5_000, updatedAt: NOW - 5_000, reinforced: 0 },
      { id: "b", kind: "preference", text: "Likes worked examples", topicIds: [], createdAt: NOW - 9_000, updatedAt: NOW - 2_000, reinforced: 0 },
      { id: "lapsed", kind: "plan", text: "About to do rates", topicIds: [], createdAt: 1, updatedAt: 1, reinforced: 0 },
    ],
  };
});

describe("what Jami remembers, as the student sees it", () => {
  it("shows the memories still in force, newest first, and nothing about topics", async () => {
    const response = await GET(new NextRequest("https://jami.test/api/ai/assistant/memory"));
    const body = await response.json();
    expect(body.enabled).toBe(true);
    expect(body.items.map((item: { id: string }) => item.id)).toEqual(["b", "a"]);
    expect(body.items[1]).not.toHaveProperty("topicIds");
  });

  it("refuses anyone not signed in", async () => {
    mocks.reader.mockResolvedValue(null);
    expect((await GET(new NextRequest("https://jami.test/api/ai/assistant/memory"))).status).toBe(401);
  });
});

describe("the student's changes", () => {
  it("turns memory off, keeping what was saved", async () => {
    const response = await PATCH(patch({ target: "enabled", enabled: false }));
    expect((await response.json()).enabled).toBe(false);
    expect(mocks.stored.current?.enabled).toBe(false);
    expect(mocks.stored.current?.items).toHaveLength(3);
  });

  it("corrects a note, and refuses a correction that is not a study note", async () => {
    const response = await PATCH(patch({ target: "edit", id: "a", text: "Finds limiting reagents hard" }));
    expect(response.status).toBe(200);
    expect(mocks.stored.current?.items.find((item) => item.id === "a")?.text).toBe(
      "Finds limiting reagents hard"
    );

    const refused = await PATCH(patch({ target: "edit", id: "a", text: "See https://example.com" }));
    expect(refused.status).toBe(400);
    expect((await PATCH(patch({ target: "edit", id: "gone", text: "Finds rates hard" }))).status).toBe(404);
  });

  it("forgets one note, or all of them", async () => {
    await PATCH(patch({ target: "forget", id: "a" }));
    expect(mocks.stored.current?.items.map((item) => item.id)).toEqual(["b", "lapsed"]);
    const response = await PATCH(patch({ target: "forget-all" }));
    expect((await response.json()).items).toEqual([]);
    expect(mocks.stored.current?.items).toEqual([]);
  });

  it.each([null, { uid: "demo", isDemo: true }])("blocks unauthenticated and demo changes", async (writer) => {
    mocks.writer.mockResolvedValue(writer);
    const response = await PATCH(patch({ target: "forget-all" }));
    expect(response.status).toBe(writer ? 403 : 401);
    expect(mocks.stored.current?.items).toHaveLength(3);
  });

  it("rejects an unknown change", async () => {
    expect((await PATCH(patch({ target: "remember", text: "x" }))).status).toBe(400);
    expect((await PATCH(patch({ target: "enabled", enabled: "yes" }))).status).toBe(400);
  });
});
