import { describe, expect, it } from "vitest";
import {
  getJamiAssistantContextKey,
  getLegacyJamiAssistantContextKeys,
  mapJamiAssistantThread,
} from "@/lib/ai/jami-assistant-history";

/**
 * What a saved chat belongs to. The stored key decides whether a thread is
 * visible at all, so widening the scope without a compatibility path would make
 * every existing notebook chat vanish from history.
 */

const notebookContext = {
  surface: "notebook" as const,
  notebookId: "notebook-1",
  pageId: "page-4",
};

function thread(overrides: Record<string, unknown>) {
  return mapJamiAssistantThread("thread-1", {
    title: "Ladder problem",
    contextLabel: "Mechanics",
    createdAt: 1,
    updatedAt: 2,
    messageCount: 4,
    ...overrides,
  });
}

describe("which chats a context can continue", () => {
  it("keys a notebook chat to the notebook, not the page", () => {
    expect(getJamiAssistantContextKey(notebookContext)).toBe("notebook:notebook-1");
    expect(
      getJamiAssistantContextKey({ ...notebookContext, pageId: "page-9" })
    ).toBe("notebook:notebook-1");
  });

  it("still keys a flashcard chat to the card", () => {
    expect(
      getJamiAssistantContextKey({ surface: "learn", cardId: "card-1" })
    ).toBe("learn:card-1");
  });

  it("keys a source chat to the selected source rather than the set", () => {
    expect(
      getJamiAssistantContextKey({ surface: "sources", sourceIds: ["s-2"] })
    ).toBe("sources:s-2");
    // Adding a second source no longer invalidates the thread.
    expect(
      getJamiAssistantContextKey({ surface: "sources", sourceIds: ["s-2", "s-9"] })
    ).toBe("sources:s-2");
  });
});

describe("chats saved before the scope changed", () => {
  it("opens a notebook chat stored under its old page-scoped key", () => {
    const saved = thread({
      context: notebookContext,
      contextKey: "notebook:notebook-1:page:page-4",
    });

    expect(saved).not.toBeNull();
    // Reported under the current key, so everything downstream compares equal.
    expect(saved?.contextKey).toBe("notebook:notebook-1");
  });

  it("opens a source chat stored under its old set key", () => {
    const saved = thread({
      context: { surface: "sources", sourceIds: ["s-2", "s-9"] },
      contextKey: "sources:s-2,s-9",
    });

    expect(saved).not.toBeNull();
    expect(saved?.contextKey).toBe("sources:s-2");
  });

  it("still refuses a key that belongs to different material", () => {
    expect(
      thread({ context: notebookContext, contextKey: "notebook:notebook-2" })
    ).toBeNull();
  });

  it("lists the old keys a context could have been stored under", () => {
    expect(getLegacyJamiAssistantContextKeys(notebookContext)).toContain(
      "notebook:notebook-1:page:page-4"
    );
    expect(
      getLegacyJamiAssistantContextKeys({ surface: "learn", cardId: "card-1" })
    ).toEqual([]);
  });
});
