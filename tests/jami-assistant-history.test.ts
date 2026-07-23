import { describe, expect, it } from "vitest";
import {
  createJamiAssistantThreadTitle,
  getJamiAssistantContextKey,
  getJamiAssistantSavedContext,
  JAMI_ASSISTANT_MAX_THREAD_TITLE_LENGTH,
  mapJamiAssistantStoredMessage,
  mapJamiAssistantThread,
} from "@/lib/ai/jami-assistant-history";

describe("Jami assistant history", () => {
  it("stores only notebook identity and never the page snapshot or extracted text", () => {
    const saved = getJamiAssistantSavedContext({
      surface: "notebook",
      notebookId: "notebook-1",
      pageId: "page-4",
      typedText: "private working",
      questionPrompt: "private prompt",
      snapshot: {
        mimeType: "image/png",
        width: 100,
        height: 120,
        dataBase64: "snapshot-data",
      },
    });

    expect(saved).toEqual({
      surface: "notebook",
      notebookId: "notebook-1",
      pageId: "page-4",
    });
    expect(getJamiAssistantContextKey(saved)).toBe(
      "notebook:notebook-1:page:page-4"
    );
    expect(saved).not.toHaveProperty("typedText");
    expect(saved).not.toHaveProperty("questionPrompt");
    expect(saved).not.toHaveProperty("snapshot");
  });

  it("uses stable context keys for source selections regardless of order", () => {
    expect(
      getJamiAssistantContextKey({
        surface: "sources",
        sourceIds: ["source-b", "source-a"],
      })
    ).toBe("sources:source-a,source-b");
  });

  it("creates compact thread titles from the opening message", () => {
    expect(createJamiAssistantThreadTitle("  Explain   the chain rule  ")).toBe(
      "Explain the chain rule"
    );
    const title = createJamiAssistantThreadTitle("a".repeat(200));
    expect(title).toHaveLength(JAMI_ASSISTANT_MAX_THREAD_TITLE_LENGTH);
    expect(title.endsWith("...")).toBe(true);
  });

  it("rejects malformed stored records and normalizes safe receipts", () => {
    expect(mapJamiAssistantThread("bad", { title: "Missing context" })).toBeNull();
    expect(
      mapJamiAssistantThread("mismatched", {
        title: "Wrong binding",
        contextKey: "learn:another-card",
        context: { surface: "learn", cardId: "card-1" },
      })
    ).toBeNull();
    expect(
      mapJamiAssistantStoredMessage("bad", {
        threadId: "thread-1",
        role: "system",
        text: "Not an allowed role",
      })
    ).toBeNull();

    expect(
      mapJamiAssistantStoredMessage("message-1", {
        threadId: "thread-1",
        role: "assistant",
        text: "A concise answer.",
        used: [
          { kind: "source", label: "Lecture notes", id: "source-1" },
          { kind: "unsafe", label: "Ignore this" },
        ],
        followUps: [
          { label: "Show steps", prompt: "Show me the steps." },
          { label: "", prompt: "Ignore this." },
        ],
        createdAt: 10,
      })
    ).toMatchObject({
      id: "message-1",
      threadId: "thread-1",
      role: "assistant",
      used: [{ kind: "source", label: "Lecture notes", id: "source-1" }],
      followUps: [{ label: "Show steps", prompt: "Show me the steps." }],
      createdAt: 10,
    });
  });
});
