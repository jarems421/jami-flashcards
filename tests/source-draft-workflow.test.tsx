// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SourceDraftWorkflow from "@/components/library/SourceDraftWorkflow";
import type { Source } from "@/lib/material/sources";

const mocks = vi.hoisted(() => ({
  getThreads: vi.fn(),
  getMessages: vi.fn(),
}));

vi.mock("@/services/ai/jami-assistant-history", () => ({
  getJamiAssistantThreads: (...args: unknown[]) => mocks.getThreads(...args),
  getJamiAssistantThreadMessages: (...args: unknown[]) =>
    mocks.getMessages(...args),
}));

vi.mock("@/services/ai/source-drafts", () => ({
  generateSourceDrafts: vi.fn(),
}));

vi.mock("@/services/study/generated-content", () => ({
  getGeneratedContentDrafts: vi.fn().mockResolvedValue([]),
  updateGeneratedContentDraftStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/components/library/SourceDraftsDrawer", () => ({
  default: ({
    generation,
  }: {
    generation: { conversationFocusAvailable: boolean };
  }) => (
    <div data-testid="conversation-focus">
      {generation.conversationFocusAvailable ? "available" : "unavailable"}
    </div>
  ),
}));

const sourceA = {
  id: "source-a",
  title: "Source A",
  type: "manual_note",
  status: "active",
  folderIds: [],
  topicIds: [],
  createdBy: "user-1",
  createdAt: 1,
  updatedAt: 1,
} satisfies Source;

const sourceB = {
  ...sourceA,
  id: "source-b",
  title: "Source B",
} satisfies Source;

let container: HTMLDivElement;
let root: Root;

function render(source: Source) {
  root.render(
    <SourceDraftWorkflow
      open
      source={source}
      drafts={[]}
      referenceData={{ topics: [], decks: [], notebooks: [] }}
      userId="user-1"
      onClose={vi.fn()}
      onDraftsChange={vi.fn()}
      onReload={vi.fn().mockResolvedValue(undefined)}
      onTopicsChange={vi.fn()}
    />
  );
}

function focusAvailability() {
  return container.querySelector('[data-testid="conversation-focus"]')
    ?.textContent;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  mocks.getThreads.mockReset();
  mocks.getMessages.mockReset().mockResolvedValue([]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("SourceDraftWorkflow", () => {
  it("never exposes a previous source thread while the next lookup is pending", async () => {
    let resolveSourceA!: (threads: Array<{ id: string; contextKey: string }>) => void;
    let resolveSourceB!: (threads: Array<{ id: string; contextKey: string }>) => void;
    mocks.getThreads
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSourceA = resolve;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSourceB = resolve;
          })
      );

    await act(async () => {
      render(sourceA);
      await Promise.resolve();
    });
    expect(focusAvailability()).toBe("unavailable");

    await act(async () => {
      render(sourceB);
      await Promise.resolve();
    });
    expect(focusAvailability()).toBe("unavailable");

    await act(async () => {
      resolveSourceA([{ id: "thread-a", contextKey: "sources:source-a" }]);
      await Promise.resolve();
    });
    expect(focusAvailability()).toBe("unavailable");

    await act(async () => {
      resolveSourceB([{ id: "thread-b", contextKey: "sources:source-b" }]);
      await Promise.resolve();
    });
    expect(focusAvailability()).toBe("available");
  });
});
