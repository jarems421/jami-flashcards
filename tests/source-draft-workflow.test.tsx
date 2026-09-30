// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SourceDraftWorkflow from "@/components/library/SourceDraftWorkflow";
import type { Source } from "@/lib/material/sources";

const mocks = vi.hoisted(() => ({
  getThreads: vi.fn(),
  getMessages: vi.fn(),
  generateSourceDrafts: vi.fn(),
  createSourcePracticeSet: vi.fn(),
}));

vi.mock("@/services/ai/jami-assistant-history", () => ({
  getJamiAssistantThreads: (...args: unknown[]) => mocks.getThreads(...args),
  getJamiAssistantThreadMessages: (...args: unknown[]) =>
    mocks.getMessages(...args),
}));

vi.mock("@/services/ai/source-drafts", () => ({
  generateSourceDrafts: (...args: unknown[]) => mocks.generateSourceDrafts(...args),
}));

vi.mock("@/services/practice/practice-sets", () => ({
  createSourcePracticeSet: (...args: unknown[]) => mocks.createSourcePracticeSet(...args),
}));

vi.mock("@/services/study/generated-content", () => ({
  getGeneratedContentDrafts: vi.fn().mockResolvedValue([]),
  updateGeneratedContentDraftStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/components/library/SourceDraftsDrawer", () => ({
  default: ({
    generation,
  }: {
    generation: {
      conversationFocusAvailable: boolean;
      onBriefChange: (brief: string) => void;
      onGenerate: (kind: string, depth: string) => void;
      madePracticeSet: { title: string; sessionId: string } | null;
    };
  }) => (
    <div>
      <div data-testid="conversation-focus">
        {generation.conversationFocusAvailable ? "available" : "unavailable"}
      </div>
      <button type="button" onClick={() => generation.onBriefChange("Only section 3, skip history")}>
        brief
      </button>
      <button type="button" onClick={() => generation.onGenerate("practice-question", "low")}>
        practice
      </button>
      <button type="button" onClick={() => generation.onGenerate("flashcard", "medium")}>
        flashcards
      </button>
      <div data-testid="made-set">{generation.madePracticeSet?.title ?? ""}</div>
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
  mocks.generateSourceDrafts.mockReset().mockResolvedValue({ drafts: [], removedDraftCount: 0 });
  mocks.createSourcePracticeSet.mockReset();
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

  it("makes practice questions as a marked set in Practice, following the agreed brief", async () => {
    mocks.getThreads.mockResolvedValue([]);
    mocks.createSourcePracticeSet.mockResolvedValue({
      id: "session-1",
      questions: [{}, {}, {}],
      maxTotal: 9,
      practiceSet: { title: "Only section 3" },
    });
    await act(async () => {
      render(sourceA);
      await Promise.resolve();
    });

    const click = async (label: string) =>
      act(async () => {
        [...container.querySelectorAll("button")]
          .find((candidate) => candidate.textContent?.trim() === label)
          ?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    await click("brief");
    await click("practice");

    expect(mocks.createSourcePracticeSet).toHaveBeenCalledWith({
      sourceId: "source-a",
      depth: "low",
      focus: "Only section 3, skip history",
    });
    expect(mocks.generateSourceDrafts).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="made-set"]')?.textContent).toBe("Only section 3");

    await click("flashcards");
    expect(mocks.generateSourceDrafts).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "flashcard", instructions: "Only section 3, skip history" })
    );
  });
});
