// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TutorDraftReviewDialog from "@/components/ai/TutorDraftReviewDialog";
import type { GeneratedContentDraft } from "@/lib/material/generated-content";

const mocks = vi.hoisted(() => ({
  getDecks: vi.fn(),
  createDeck: vi.fn(),
  convert: vi.fn(),
  updateStatus: vi.fn(),
}));

vi.mock("@/services/study/decks", () => ({
  getDecks: mocks.getDecks,
  createDeck: mocks.createDeck,
}));
vi.mock("@/services/study/generated-content", () => ({
  convertFlashcardDraftToCard: mocks.convert,
  updateGeneratedContentDraftStatus: mocks.updateStatus,
}));

function draft(over: Partial<GeneratedContentDraft>): GeneratedContentDraft {
  return {
    id: "d",
    kind: "flashcard",
    title: "Untitled",
    topicIds: [],
    origin: "ai-assisted",
    contentStatus: "draft",
    sourceType: "tutor",
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

let container: HTMLDivElement;
let root: Root;

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function button(name: RegExp) {
  return [...document.querySelectorAll("button")].find((candidate) =>
    name.test(candidate.getAttribute("aria-label") ?? candidate.textContent ?? "")
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDecks.mockResolvedValue([
    { id: "newest", name: "Everything", folderIds: [] },
    { id: "chem", name: "Chemistry", folderIds: ["chemistry"] },
  ]);
  mocks.convert.mockResolvedValue("card");
  mocks.updateStatus.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("TutorDraftReviewDialog", () => {
  it("reviews flashcards from a notebook chat, into the deck for the folder they came from", async () => {
    const onClose = vi.fn();
    act(() => {
      root.render(
        <TutorDraftReviewDialog
          userId="user-1"
          title="From your Tutor chats"
          drafts={[
            draft({ id: "a", front: "What is an ester?", back: "RCOOR'", folderId: "chemistry" }),
            draft({ id: "b", front: "Name the catalyst", back: "Concentrated sulfuric acid" }),
            draft({ id: "q", kind: "practice-question", questionText: "Explain esterification." }),
          ]}
          onClose={onClose}
        />
      );
    });
    await settle();

    expect(document.body.textContent).toContain("What is an ester?");
    expect(document.body.textContent).toContain("Explain esterification.");
    expect(document.querySelector<HTMLSelectElement>("select")?.value).toBe("chem");

    await act(async () => {
      button(/Add all/)?.click();
    });
    await settle();
    expect(mocks.convert).toHaveBeenCalledWith("user-1", { draftId: "a", deckId: "chem" });
    expect(mocks.convert).toHaveBeenCalledWith("user-1", { draftId: "b", deckId: "chem" });

    // An old notebook question can still be cleared from the queue.
    await act(async () => {
      button(/^Discard$/)?.click();
    });
    await settle();
    expect(mocks.updateStatus).toHaveBeenCalledWith("user-1", "q", "rejected");

    await act(async () => {
      button(/^Done$/)?.click();
    });
    expect(onClose).toHaveBeenCalled();
  });
});
