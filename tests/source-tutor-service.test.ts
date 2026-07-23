import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/firebase/client", () => ({
  auth: {
    currentUser: {
      getIdToken: vi.fn(async () => "test-token"),
    },
  },
}));

import {
  askSourceTutor,
  clearSourceTutorHistory,
  getSourceTutorHistory,
} from "@/services/ai/source";

describe("Source Tutor client contract", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves grounded response status and exact sources used", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          status: "grounded",
          reply: "Plants absorb light. [S1]",
          threadId: "thread-1",
          sourcesUsed: [{ id: "source-1", title: "Plant notes" }],
          sourceFailures: [],
        })
      )
    );

    await expect(
      askSourceTutor({
        sourceIds: ["source-1"],
        message: "What do plants absorb?",
      })
    ).resolves.toEqual({
      status: "grounded",
      reply: "Plants absorb light. [S1]",
      threadId: "thread-1",
      sourcesUsed: [{ id: "source-1", title: "Plant notes" }],
      sourceFailures: [],
    });
  });

  it("never converts a provider failure into a successful Tutor message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            status: "failure",
            code: "provider_failure",
            error: "Jami could not finish the answer just now.",
          },
          { status: 502 }
        )
      )
    );

    await expect(
      askSourceTutor({ sourceIds: ["source-1"], message: "Explain this." })
    ).rejects.toThrow("Jami could not finish the answer just now.");
  });

  it("loads and deletes the conversation for the exact source context", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          threadId: "thread-1",
          history: [
            { role: "user", text: "Explain this.", createdAt: 1 },
            {
              role: "model",
              text: "A grounded answer. [S1]",
              outcome: "grounded",
              sourcesUsed: [{ id: "source-1", title: "Notes" }],
              createdAt: 2,
            },
          ],
        })
      )
      .mockResolvedValueOnce(Response.json({ deleted: true }));
    vi.stubGlobal("fetch", fetchMock);

    const history = await getSourceTutorHistory(["source-1", "source-2"]);
    expect(history.history).toHaveLength(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/ai/source-tutor?sourceId=source-1&sourceId=source-2"
    );

    await clearSourceTutorHistory(["source-1", "source-2"]);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "DELETE",
      body: JSON.stringify({ sourceIds: ["source-1", "source-2"] }),
    });
  });
});
