// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NotebookEditorDialog from "@/components/workspace/NotebookEditorDialog";
import type { Notebook } from "@/lib/workspace/notebooks";

const updateNotebook = vi.fn();

vi.mock("@/services/study/notebooks", () => ({
  updateNotebook: (...a: unknown[]) => updateNotebook(...a),
}));

// TopicPicker creates topics on the fly; this suite is about the dialog.
vi.mock("@/services/study/topics", () => ({
  createOrGetTopic: vi.fn(),
}));

function notebook(overrides: Partial<Notebook> = {}): Notebook {
  return {
    id: "nb-1",
    folderId: "f-1",
    title: "Circuits",
    type: "blank",
    topicIds: ["t-1"],
    sourceIds: [],
    color: "amber",
    icon: "notebook",
    pageColor: "cream",
    pageStyle: "lined",
    createdAt: 1,
    updatedAt: 2,
    archived: false,
    ...overrides,
  } as Notebook;
}

let container: HTMLDivElement;
let root: Root;
const onClose = vi.fn();
const onSaved = vi.fn();
const onArchived = vi.fn();

async function render(book: Notebook = notebook()) {
  await act(async () => {
    root.render(
      <NotebookEditorDialog
        userId="user-1"
        notebook={book}
        topics={[]}
        onTopicsChange={vi.fn()}
        onClose={onClose}
        onSaved={onSaved}
        onArchived={onArchived}
      />
    );
  });
}

const dialog = () => document.querySelector("[role=dialog]");
const confirmDialog = () => document.querySelector("[role=alertdialog]");

/** The Input primitive binds its label with htmlFor rather than wrapping. */
function titleInput() {
  const tag = [...document.querySelectorAll("label")].find(
    (node) => node.textContent?.trim() === "Notebook title"
  );
  const box = tag?.htmlFor ? document.getElementById(tag.htmlFor) : null;
  if (!box) throw new Error("no notebook title input");
  return box as HTMLInputElement;
}

function type(field: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function button(label: string, scope: ParentNode = document) {
  return [...scope.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label
  );
}

async function click(target: HTMLElement | undefined) {
  expect(target).toBeDefined();
  await act(async () => {
    target!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function pressEscape() {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
}

/** Holds a service call open so the saving state can be observed. */
function deferUpdate() {
  let release: () => void = () => undefined;
  let fail: (error: Error) => void = () => undefined;
  updateNotebook.mockImplementation(
    () =>
      new Promise<void>((resolve, reject) => {
        release = resolve;
        fail = reject;
      })
  );
  return {
    release: () => act(async () => release()),
    fail: (error: Error) => act(async () => fail(error)),
  };
}

beforeEach(() => {
  updateNotebook.mockReset().mockResolvedValue(undefined);
  onClose.mockClear();
  onSaved.mockClear();
  onArchived.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  document.body.innerHTML = "";
});

describe("NotebookEditorDialog saving", () => {
  it("saves the edited title, trimmed", async () => {
    await render();
    type(titleInput(), "  Circuits and fields  ");
    await click(button("Save notebook"));

    expect(updateNotebook).toHaveBeenCalledWith("user-1", "nb-1", {
      title: "Circuits and fields",
      topicIds: ["t-1"],
      color: "amber",
      icon: "notebook",
    });
  });

  it("hands the updated notebook back so the list need not refetch", async () => {
    await render();
    type(titleInput(), "Waves");
    await click(button("Save notebook"));

    const saved = onSaved.mock.calls[0]?.[0] as Notebook;
    expect(saved.id).toBe("nb-1");
    expect(saved.title).toBe("Waves");
    expect(saved.folderId).toBe("f-1");
    // A fresh timestamp keeps "recently touched" ordering honest.
    expect(saved.updatedAt).toBeGreaterThan(2);
  });

  it("will not save an empty or whitespace title", async () => {
    await render();
    type(titleInput(), "   ");
    // The button is the guard here; handleSave's own empty-title branch is not
    // reachable from the UI while that stays true.
    expect(button("Save notebook")?.disabled).toBe(true);
    expect(updateNotebook).not.toHaveBeenCalled();
  });

  it("locks the dialog while a save is in flight", async () => {
    const pending = deferUpdate();
    await render();
    await click(button("Save notebook"));

    expect(button("Saving...")?.disabled).toBe(true);
    expect(button("Cancel")?.disabled).toBe(true);
    expect(button("Archive notebook")?.disabled).toBe(true);
    expect(titleInput().disabled).toBe(true);

    await pending.release();
  });

  it("shows why a save failed and stays open to retry", async () => {
    updateNotebook.mockRejectedValue(new Error("Notebook name already used."));
    await render();
    await click(button("Save notebook"));

    expect(document.body.textContent).toContain("Notebook name already used.");
    expect(onSaved).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
    // The dialog has to be usable again, not stuck behind a spent save.
    expect(button("Save notebook")?.disabled).toBe(false);
  });

  it("clears a previous error when the retry succeeds", async () => {
    updateNotebook.mockRejectedValueOnce(new Error("Temporary failure."));
    await render();
    await click(button("Save notebook"));
    expect(document.body.textContent).toContain("Temporary failure.");

    updateNotebook.mockResolvedValue(undefined);
    await click(button("Save notebook"));
    expect(document.body.textContent).not.toContain("Temporary failure.");
  });
});

describe("NotebookEditorDialog dismissal", () => {
  it("closes on Escape", async () => {
    await render();
    await pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when the backdrop is clicked", async () => {
    await render();
    await click(
      document.querySelector<HTMLElement>('[aria-label="Close notebook editor"]')!
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores Escape and the backdrop while saving", async () => {
    const pending = deferUpdate();
    await render();
    await click(button("Save notebook"));

    await pressEscape();
    // Closing mid-write would leave the student unsure whether it landed.
    expect(onClose).not.toHaveBeenCalled();
    expect(
      document.querySelector<HTMLButtonElement>(
        '[aria-label="Close notebook editor"]'
      )?.disabled
    ).toBe(true);

    await pending.release();
  });

  it("lets Escape reach the archive confirmation rather than the editor", async () => {
    await render();
    await click(button("Archive notebook"));
    await pressEscape();
    // Escape belongs to the topmost dialog; closing the editor underneath it
    // would leave the confirmation orphaned.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("stops listening for Escape once it unmounts", async () => {
    await render();
    act(() => {
      root.unmount();
    });
    await pressEscape();
    expect(onClose).not.toHaveBeenCalled();

    root = createRoot(container);
  });
});

describe("NotebookEditorDialog archiving", () => {
  it("asks before archiving", async () => {
    await render();
    await click(button("Archive notebook"));

    expect(confirmDialog()).not.toBeNull();
    expect(updateNotebook).not.toHaveBeenCalled();
    expect(onArchived).not.toHaveBeenCalled();
  });

  it("archives rather than deleting once confirmed", async () => {
    await render();
    await click(button("Archive notebook"));
    await click(button("Archive notebook", confirmDialog()!));

    expect(updateNotebook).toHaveBeenCalledWith("user-1", "nb-1", {
      archived: true,
    });
    expect(onArchived).toHaveBeenCalledWith("nb-1");
  });

  it("drops the confirmation and reports a failed archive", async () => {
    updateNotebook.mockRejectedValue(new Error("Archive failed."));
    await render();
    await click(button("Archive notebook"));
    await click(button("Archive notebook", confirmDialog()!));

    expect(document.body.textContent).toContain("Archive failed.");
    expect(confirmDialog()).toBeNull();
    expect(onArchived).not.toHaveBeenCalled();
  });

  it("does not archive when the confirmation is dismissed", async () => {
    await render();
    await click(button("Archive notebook"));
    await click(button("Cancel", confirmDialog()!));

    expect(confirmDialog()).toBeNull();
    expect(updateNotebook).not.toHaveBeenCalled();
  });
});

describe("NotebookEditorDialog preview", () => {
  it("follows the title as it is typed", async () => {
    await render();
    type(titleInput(), "Magnetism");
    expect(dialog()?.textContent).toContain("Magnetism");
  });

  it("falls back to a placeholder rather than an empty cover", async () => {
    await render();
    type(titleInput(), "   ");
    expect(dialog()?.textContent).toContain("Notebook preview");
  });
});
