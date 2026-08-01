// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CardPreviewDialog from "@/components/decks/CardPreviewDialog";
import InAppNotice from "@/components/layout/InAppNotice";
import { SourceWorkspaceDrawer } from "@/components/library/SourceWorkspace";
import NotebookAddPagesDialog from "@/components/workspace/NotebookAddPagesDialog";
import ObjectActionsSheet from "@/components/workspace/ObjectActionsSheet";
import type { Card } from "@/lib/study/cards";

const loadActiveInAppNotice = vi.fn();
const dismissInAppNotice = vi.fn();

vi.mock("@/components/providers/UserProvider", () => ({
  useUser: () => ({ user: { uid: "user-1" } }),
}));

vi.mock("@/services/profile/in-app-notice", () => ({
  loadActiveInAppNotice: (...args: unknown[]) =>
    loadActiveInAppNotice(...args),
  dismissInAppNotice: (...args: unknown[]) => dismissInAppNotice(...args),
}));

let container: HTMLDivElement;
let root: Root;

async function render(node: ReactNode) {
  await act(async () => {
    root.render(node);
  });
}

async function flushFocus() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

async function pressEscape() {
  await act(async () => {
    (document.activeElement ?? document).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    );
  });
}

async function pressBackdrop() {
  const backdrop = document.querySelector<HTMLElement>(
    '[data-dialog-backdrop="true"]'
  );
  expect(backdrop).not.toBeNull();
  await act(async () => {
    backdrop!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
  });
}

function button(label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === label
  );
}

beforeEach(() => {
  loadActiveInAppNotice.mockReset();
  dismissInAppNotice.mockReset().mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  document.body.style.overflow = "";
});

describe("migrated dialog surfaces", () => {
  it("keeps Add pages backdrop-safe and blocks dismissal during upload", async () => {
    const onCancel = vi.fn();
    await render(
      <NotebookAddPagesDialog
        open
        file={null}
        adding={false}
        progress={null}
        onFileChange={vi.fn()}
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />
    );
    await flushFocus();

    expect(document.activeElement).toBe(
      document.querySelector('input[type="file"]')
    );
    await pressBackdrop();
    expect(onCancel).not.toHaveBeenCalled();
    await pressEscape();
    expect(onCancel).toHaveBeenCalledTimes(1);

    onCancel.mockClear();
    await render(
      <NotebookAddPagesDialog
        open
        file={new File(["page"], "page.png", { type: "image/png" })}
        adding
        progress={40}
        onFileChange={vi.fn()}
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />
    );
    await pressEscape();
    await pressBackdrop();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("dismisses the update notice through persistence on Escape but not backdrop", async () => {
    loadActiveInAppNotice.mockResolvedValue({
      id: "notice-1",
      title: "A calmer notebook",
      message: "Notebook controls have moved.",
      createdAt: 1,
      active: true,
    });
    await render(<InAppNotice />);
    await flushFocus();

    expect(document.activeElement?.textContent).toBe("I saw this");
    await pressBackdrop();
    expect(dismissInAppNotice).not.toHaveBeenCalled();

    await pressEscape();
    expect(dismissInAppNotice).toHaveBeenCalledWith("user-1", "notice-1");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("focuses the safe action in a mobile object sheet", async () => {
    const onClose = vi.fn();
    const onDelete = vi.fn();
    await render(
      <ObjectActionsSheet
        open
        objectKind="notebook"
        title="Physics"
        actions={[
          {
            id: "delete",
            label: "Delete notebook",
            tone: "danger",
            onSelect: onDelete,
          },
        ]}
        onClose={onClose}
      />
    );
    await flushFocus();

    expect(document.activeElement?.textContent).toBe("Cancel");
    await act(async () => button("Delete notebook")?.click());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(
      onDelete.mock.invocationCallOrder[0]
    );
  });

  it("renders card metadata through the shared preview and hands Edit back", async () => {
    const card = {
      id: "card-1",
      deckId: "deck-1",
      userId: "user-1",
      front: "Ohm's law",
      back: "V = IR",
      tags: [],
      createdAt: 1,
    } satisfies Card;
    const onEdit = vi.fn();
    await render(
      <CardPreviewDialog
        card={card}
        deckName="Electricity"
        sourceNames={["Circuit notes"]}
        topicNames={["Resistance"]}
        onClose={vi.fn()}
        onEdit={onEdit}
      />
    );
    await flushFocus();

    expect(document.activeElement?.textContent).toBe("Close");
    expect(document.body.textContent).toContain("Based on: Circuit notes");
    expect(document.body.textContent).toContain("Resistance");
    await act(async () => button("Edit card")?.click());
    expect(onEdit).toHaveBeenCalledWith(card);
  });

  it("gives source drawers a generated label and restores Escape dismissal", async () => {
    const onClose = vi.fn();
    await render(
      <SourceWorkspaceDrawer
        open
        eyebrow="Source details"
        title="Lecture notes"
        onClose={onClose}
      >
        <button type="button">Source action</button>
      </SourceWorkspaceDrawer>
    );
    await flushFocus();

    const panel = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const title = [...document.querySelectorAll("h2")].find(
      (heading) => heading.textContent === "Lecture notes"
    )!;
    expect(panel.getAttribute("aria-labelledby")).toBe(title.id);
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Close Lecture notes"
    );
    await pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
