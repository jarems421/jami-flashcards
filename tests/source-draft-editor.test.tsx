// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SourceDraftEditor from "@/components/library/SourceDraftEditor";
import type { GeneratedContentDraft } from "@/lib/material/generated-content";
import type { Deck } from "@/lib/study/decks";
import type { Notebook } from "@/lib/workspace/notebooks";

const updateGeneratedContentDraftContent = vi.fn();
const updateGeneratedContentDraftStatus = vi.fn();
const convertFlashcardDraftToCard = vi.fn();
const convertPracticeQuestionDraftToNotebookPage = vi.fn();

vi.mock("@/services/study/generated-content", () => ({
  updateGeneratedContentDraftContent: (...a: unknown[]) =>
    updateGeneratedContentDraftContent(...a),
  updateGeneratedContentDraftStatus: (...a: unknown[]) =>
    updateGeneratedContentDraftStatus(...a),
  convertFlashcardDraftToCard: (...a: unknown[]) =>
    convertFlashcardDraftToCard(...a),
  convertPracticeQuestionDraftToNotebookPage: (...a: unknown[]) =>
    convertPracticeQuestionDraftToNotebookPage(...a),
}));

// TopicPicker creates topics on the fly; this suite is about the draft editor.
vi.mock("@/services/study/topics", () => ({
  createOrGetTopic: vi.fn(),
}));

function flashcardDraft(
  overrides: Partial<GeneratedContentDraft> = {}
): GeneratedContentDraft {
  return {
    id: "draft-1",
    kind: "flashcard",
    title: "Ohm's law",
    front: "What is Ohm's law?",
    back: "V = IR",
    topicIds: [],
    origin: "ai",
    contentStatus: "draft",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as GeneratedContentDraft;
}

function questionDraft(
  overrides: Partial<GeneratedContentDraft> = {}
): GeneratedContentDraft {
  return flashcardDraft({
    id: "draft-q",
    kind: "practice-question",
    front: undefined,
    back: undefined,
    questionText: "Find the current.",
    answerText: "2 A",
    solutionText: "Divide voltage by resistance.",
    ...overrides,
  });
}

const deck = { id: "deck-1", name: "Physics" } as Deck;
const notebook = { id: "nb-1", title: "Circuits" } as Notebook;

let container: HTMLDivElement;
let root: Root;
const onSaved = vi.fn();

async function render(
  draft: GeneratedContentDraft,
  props: {
    decks?: Deck[];
    notebooks?: Notebook[];
    selectedDeckId?: string;
    selectedNotebookId?: string;
  } = {}
) {
  await act(async () => {
    root.render(
      <SourceDraftEditor
        draft={draft}
        topics={[]}
        decks={props.decks ?? [deck]}
        notebooks={props.notebooks ?? [notebook]}
        selectedDeckId={props.selectedDeckId ?? "deck-1"}
        selectedNotebookId={props.selectedNotebookId ?? "nb-1"}
        onDeckChange={vi.fn()}
        onNotebookChange={vi.fn()}
        onSaved={onSaved}
        onTopicsChange={vi.fn()}
        userId="user-1"
        sourceTitle="Chapter 3"
      />
    );
  });
}

const text = () => container.textContent ?? "";

/** The Textarea primitive binds its label with htmlFor rather than wrapping. */
function field(label: string) {
  const tag = [...container.querySelectorAll("label")].find(
    (node) => node.textContent?.trim() === label
  );
  const box = tag?.htmlFor
    ? (document.getElementById(tag.htmlFor) as HTMLTextAreaElement | null)
    : null;
  if (!box) throw new Error(`no textarea labelled ${label}`);
  return box;
}

function type(area: HTMLTextAreaElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    )?.set?.call(area, value);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function button(label: string) {
  return [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(label)
  );
}

/** Runs past the autosave debounce and lets the write settle. */
async function settleAutosave() {
  await act(async () => {
    vi.advanceTimersByTime(1500);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  updateGeneratedContentDraftContent.mockReset().mockResolvedValue(undefined);
  updateGeneratedContentDraftStatus.mockReset().mockResolvedValue(undefined);
  convertFlashcardDraftToCard.mockReset().mockResolvedValue(undefined);
  convertPracticeQuestionDraftToNotebookPage
    .mockReset()
    .mockResolvedValue(undefined);
  onSaved.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
});

describe("SourceDraftEditor autosave", () => {
  it("does not write a draft back just because it was opened", async () => {
    await render(flashcardDraft());
    await settleAutosave();
    // dirtyRef exists for exactly this: opening a draft is not an edit.
    expect(updateGeneratedContentDraftContent).not.toHaveBeenCalled();
  });

  it("saves an edit once the student pauses", async () => {
    await render(flashcardDraft());
    type(field("Back"), "V = I x R");

    expect(updateGeneratedContentDraftContent).not.toHaveBeenCalled();
    await settleAutosave();

    expect(updateGeneratedContentDraftContent).toHaveBeenCalledWith(
      "user-1",
      "draft-1",
      { front: "What is Ohm's law?", back: "V = I x R", topicIds: [] }
    );
    expect(text()).toContain("Saved");
  });

  it("costs one write for a burst of typing, not one per keystroke", async () => {
    await render(flashcardDraft());
    const back = field("Back");
    type(back, "V");
    type(back, "V =");
    type(back, "V = IR");
    await settleAutosave();

    expect(updateGeneratedContentDraftContent).toHaveBeenCalledTimes(1);
    expect(
      updateGeneratedContentDraftContent.mock.calls[0]?.[2]
    ).toMatchObject({ back: "V = IR" });
  });

  it("saves the question fields for a question draft", async () => {
    await render(questionDraft());
    type(field("Expected answer"), "3 A");
    await settleAutosave();

    expect(updateGeneratedContentDraftContent).toHaveBeenCalledWith(
      "user-1",
      "draft-q",
      {
        questionText: "Find the current.",
        answerText: "3 A",
        solutionText: "Divide voltage by resistance.",
        topicIds: [],
      }
    );
  });

  it("says so when a save fails and keeps the edit on screen", async () => {
    updateGeneratedContentDraftContent.mockRejectedValue(new Error("offline"));
    await render(flashcardDraft());
    type(field("Back"), "V = IR always");
    await settleAutosave();

    expect(text()).toContain("Could not save. Your edits are still here.");
    expect(field("Back").value).toBe("V = IR always");
  });

  it("loads a different draft without writing the previous one back", async () => {
    await render(flashcardDraft());
    type(field("Back"), "edited");

    // Switch before the debounce fires.
    await render(flashcardDraft({ id: "draft-2", back: "Second draft" }));
    await settleAutosave();

    expect(updateGeneratedContentDraftContent).not.toHaveBeenCalled();
    expect(field("Back").value).toBe("Second draft");
  });

  it("clears a stale save status when a new draft loads", async () => {
    await render(flashcardDraft());
    type(field("Back"), "edited");
    await settleAutosave();
    expect(text()).toContain("Saved");

    await render(flashcardDraft({ id: "draft-2", back: "Second draft" }));
    // "Saved" against an untouched draft would be a lie about the new one.
    expect(text()).not.toContain("Saved");
  });
});

describe("SourceDraftEditor approval", () => {
  it("adds a flashcard to the chosen deck", async () => {
    await render(flashcardDraft());
    await act(async () => {
      button("Add to deck")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
    });

    // Content is flushed before conversion so an unsaved edit is not lost.
    expect(updateGeneratedContentDraftContent).toHaveBeenCalled();
    expect(convertFlashcardDraftToCard).toHaveBeenCalledWith("user-1", {
      draftId: "draft-1",
      deckId: "deck-1",
    });
    expect(onSaved).toHaveBeenCalledWith(
      "Card added to your deck. You can review it in Learn."
    );
  });

  it("adds a question draft to the chosen notebook", async () => {
    await render(questionDraft());
    await act(async () => {
      button("Add to notebook")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
    });

    expect(convertPracticeQuestionDraftToNotebookPage).toHaveBeenCalledWith(
      "user-1",
      { draftId: "draft-q", notebookId: "nb-1" }
    );
    expect(convertFlashcardDraftToCard).not.toHaveBeenCalled();
  });

  it("will not approve a flashcard with no deck selected", async () => {
    await render(flashcardDraft(), { selectedDeckId: "" });
    expect(button("Add to deck")?.disabled).toBe(true);
  });

  it("will not approve a question with no notebook selected", async () => {
    await render(questionDraft(), { selectedNotebookId: "" });
    expect(button("Add to notebook")?.disabled).toBe(true);
  });

  it("rejects a draft without converting it", async () => {
    await render(flashcardDraft());
    const reject = container.querySelector<HTMLButtonElement>(
      '[aria-label="Reject this draft"]'
    );
    await act(async () => {
      reject!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(updateGeneratedContentDraftStatus).toHaveBeenCalledWith(
      "user-1",
      "draft-1",
      "rejected"
    );
    expect(convertFlashcardDraftToCard).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledWith("Draft rejected.");
  });
});

describe("SourceDraftEditor destinations", () => {
  it("points at deck creation instead of an empty picker", async () => {
    await render(flashcardDraft(), { decks: [] });
    expect(text()).toContain("Create a deck before adding this flashcard.");
    expect(container.querySelector("select")).toBeNull();
    expect(
      container.querySelector('a[href="/dashboard/decks"]')
    ).not.toBeNull();
  });

  it("points at folders when there is nowhere to put a question", async () => {
    await render(questionDraft(), { notebooks: [] });
    expect(text()).toContain(
      "Create a notebook before approving this question draft."
    );
    expect(
      container.querySelector('a[href="/dashboard/folders"]')
    ).not.toBeNull();
  });
});

describe("SourceDraftEditor preview", () => {
  it("previews the fields being edited, and only the filled ones", async () => {
    await render(questionDraft({ solutionText: "" }));
    const preview = [...container.querySelectorAll("div")].find((node) =>
      node.className.includes("app-subtle-panel")
    );
    expect(preview).toBeDefined();
    expect(preview!.textContent).toContain("Question");
    expect(preview!.textContent).toContain("Expected answer");
    // An empty field would render as a bare heading over nothing.
    expect(preview!.textContent).not.toContain("Solution notes");
  });

  it("keeps the preview in step with an edit", async () => {
    await render(flashcardDraft());
    type(field("Back"), "Voltage equals current times resistance");
    const preview = [...container.querySelectorAll("div")].find((node) =>
      node.className.includes("app-subtle-panel")
    );
    expect(preview!.textContent).toContain(
      "Voltage equals current times resistance"
    );
  });

  it("hides the preview entirely when both fields are empty", async () => {
    await render(flashcardDraft({ front: "", back: "" }));
    const preview = [...container.querySelectorAll("div")].find((node) =>
      node.className.includes("app-subtle-panel")
    );
    expect(preview).toBeUndefined();
  });
});
