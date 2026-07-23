import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getIdToken: vi.fn(async () => "test-token"),
}));

vi.mock("@/services/firebase/client", () => ({
  auth: {
    currentUser: {
      getIdToken: mocks.getIdToken,
    },
  },
}));

import { sendJamiAssistantMessage } from "@/services/ai/jami-assistant";

const input = {
  message: "Explain this card.",
  history: [],
  context: {
    surface: "learn" as const,
    cardId: "card-1",
    phase: "answer" as const,
  },
  useRelatedSources: true,
};

describe("Jami assistant client service", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends authenticated typed context and preserves the Used receipt", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        reply: "A clear explanation.",
        used: [
          { kind: "current-context", id: "card-1", label: "Current card" },
          { kind: "general-knowledge", label: "general knowledge" },
        ],
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendJamiAssistantMessage(input)).resolves.toEqual({
      reply: "A clear explanation.",
      used: [
        { kind: "current-context", id: "card-1", label: "Current card" },
        { kind: "general-knowledge", label: "general knowledge" },
      ],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/ai/assistant",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
        body: JSON.stringify(input),
      })
    );
  });

  it("does not turn a provider failure into an assistant message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: "Jami could not finish that answer just now." },
          { status: 502 }
        )
      )
    );
    await expect(sendJamiAssistantMessage(input)).rejects.toThrow(
      "Jami could not finish that answer just now."
    );
  });

  it("rejects successful responses that omit transparent usage data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ reply: "Incomplete", used: [] }))
    );
    await expect(sendJamiAssistantMessage(input)).rejects.toThrow(
      "Jami returned an incomplete answer"
    );
  });
});
