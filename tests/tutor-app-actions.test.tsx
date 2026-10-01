// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TutorAppActions from "@/components/ai/TutorAppActions";

const mocks = vi.hoisted(() => ({ createDeck: vi.fn(), createNotebook: vi.fn() }));

vi.mock("@/services/ai/tutor-app-actions", () => ({
  createDeckFromTutor: mocks.createDeck,
  createNotebookFromTutor: mocks.createNotebook,
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

let container: HTMLDivElement;
let root: Root;

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("TutorAppActions", () => {
  it("adds the pages the student asked for straight away, and links where Tutor pointed", async () => {
    const addPages = vi.fn().mockResolvedValue(10);
    act(() =>
      root.render(
        <TutorAppActions
          userId="user-1"
          messageKey="m-auto"
          actions={[
            { type: "add_pages", count: 10, autoRun: true },
            { type: "open", destination: "flashcards", label: "Flashcards", href: "/dashboard/decks", autoRun: false },
          ]}
          scope={{ notebookId: "nb1" }}
          fresh
          readOnly={false}
          onAddNotebookPages={addPages}
        />
      )
    );
    await settle();

    expect(addPages).toHaveBeenCalledTimes(1);
    expect(addPages).toHaveBeenCalledWith(10);
    expect(container.textContent).toContain("Added 10 pages to the end of this notebook.");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/dashboard/decks");
  });

  it("only offers what was not asked for, and does it on a press", async () => {
    mocks.createDeck.mockResolvedValue({ id: "deck-9", name: "Enzymes" });
    act(() =>
      root.render(
        <TutorAppActions
          userId="user-1"
          messageKey="m-offer"
          actions={[{ type: "create_deck", name: "Enzymes", autoRun: false }]}
          scope={{ folderId: "bio" }}
          fresh
          readOnly={false}
        />
      )
    );
    await settle();
    expect(mocks.createDeck).not.toHaveBeenCalled();

    await act(async () => {
      container.querySelector("button")?.click();
    });
    await settle();
    expect(mocks.createDeck).toHaveBeenCalledWith("user-1", { name: "Enzymes", folderId: "bio" });
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/dashboard/decks/deck-9");
  });

  it("never runs an action again from a reopened chat, and hides pages outside a notebook", async () => {
    const addPages = vi.fn().mockResolvedValue(3);
    act(() =>
      root.render(
        <TutorAppActions
          userId="user-1"
          messageKey="m-old"
          actions={[{ type: "add_pages", count: 3, autoRun: true }]}
          scope={{}}
          fresh={false}
          readOnly={false}
          onAddNotebookPages={addPages}
        />
      )
    );
    await settle();
    expect(addPages).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Add 3 pages");

    act(() =>
      root.render(
        <TutorAppActions
          userId="user-1"
          messageKey="m-elsewhere"
          actions={[{ type: "add_pages", count: 3, autoRun: true }]}
          scope={{}}
          fresh
          readOnly={false}
        />
      )
    );
    expect(container.textContent).toBe("");
  });
});
