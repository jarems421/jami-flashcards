// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FolderAssetPicker from "@/components/workspace/FolderAssetPicker";
import FolderEditor from "@/components/workspace/FolderEditor";
import type { StudyFolder } from "@/lib/workspace/study-folders";

const serviceMocks = vi.hoisted(() => ({
  archiveStudyFolder: vi.fn(),
  updateStudyFolder: vi.fn(),
}));

vi.mock("@/services/study/folders", () => ({
  archiveStudyFolder: serviceMocks.archiveStudyFolder,
  updateStudyFolder: serviceMocks.updateStudyFolder,
}));

let container: HTMLDivElement;
let root: Root;

const folder: StudyFolder = {
  id: "folder-1",
  name: "Physics",
  subject: "Mechanics",
  color: "violet",
  icon: "atom",
  topicIds: ["topic-1"],
  createdAt: 100,
  updatedAt: 200,
  archived: false,
};

async function render(node: ReactNode) {
  await act(async () => {
    root.render(node);
  });
}

function field(label: string) {
  const labelElement = [...document.querySelectorAll("label")].find(
    (element) => element.textContent === label
  );
  return labelElement
    ? document.getElementById(labelElement.htmlFor) as HTMLInputElement | null
    : null;
}

function selectField(label: string) {
  const labelElement = [...document.querySelectorAll("label")].find(
    (element) => element.textContent === label
  );
  return labelElement
    ? (document.getElementById(labelElement.htmlFor) as HTMLSelectElement | null)
    : null;
}

function button(label: string, within: ParentNode = document) {
  return [...within.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === label
  );
}

function type(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function select(input: HTMLSelectElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value"
    )?.set?.call(input, value);
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function click(target: HTMLButtonElement) {
  await act(async () => {
    target.click();
  });
}

beforeEach(() => {
  serviceMocks.archiveStudyFolder.mockReset().mockResolvedValue(undefined);
  serviceMocks.updateStudyFolder.mockReset().mockResolvedValue(undefined);
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

describe("FolderEditor", () => {
  it("saves edited folder details and reports the updated folder", async () => {
    const onSaved = vi.fn();
    const onArchived = vi.fn();
    const onCancel = vi.fn();
    const onError = vi.fn();
    await render(
      <FolderEditor
        userId="user-1"
        folder={folder}
        onSaved={onSaved}
        onArchived={onArchived}
        onCancel={onCancel}
        onError={onError}
      />
    );

    type(field("Folder name")!, "  Applied physics  ");
    type(field("Subject detail")!, "  Forces and motion  ");
    select(selectField("Study level")!, "post-16-equivalent");
    await click(button("Save folder")!);

    expect(serviceMocks.updateStudyFolder).toHaveBeenCalledWith(
      "user-1",
      "folder-1",
      expect.objectContaining({
        name: "  Applied physics  ",
        subject: "  Forces and motion  ",
        studyLevel: "post-16-equivalent",
      })
    );
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "folder-1",
        name: "Applied physics",
        subject: "Forces and motion",
        studyLevel: "post-16-equivalent",
        updatedAt: expect.any(Number),
      })
    );
    expect(onError).not.toHaveBeenCalled();
    expect(onArchived).not.toHaveBeenCalled();
  });

  it("archives only after confirmation and reports completion", async () => {
    const onSaved = vi.fn();
    const onArchived = vi.fn();
    await render(
      <FolderEditor
        userId="user-1"
        folder={folder}
        onSaved={onSaved}
        onArchived={onArchived}
        onCancel={vi.fn()}
        onError={vi.fn()}
      />
    );

    await click(button("Archive folder", container)!);
    expect(serviceMocks.archiveStudyFolder).not.toHaveBeenCalled();

    const confirmation = document.querySelector<HTMLElement>(
      '[role="alertdialog"]'
    );
    expect(confirmation?.textContent).toContain("does not delete the decks or sources");
    await click(button("Archive folder", confirmation!)!);

    expect(serviceMocks.archiveStudyFolder).toHaveBeenCalledWith(
      "user-1",
      "folder-1"
    );
    expect(onArchived).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("FolderAssetPicker", () => {
  it("attaches selected assets while detaching deselected assets from the pending batch", async () => {
    const onAdd = vi.fn().mockResolvedValue(true);
    await render(
      <FolderAssetPicker
        kind="deck"
        items={[
          { id: "deck-1", label: "Biology" },
          { id: "deck-2", label: "Chemistry" },
        ]}
        busy={false}
        onAdd={onAdd}
      />
    );

    const addButton = button("Add to folder")!;
    expect(addButton.disabled).toBe(true);

    await click(button("Biology")!);
    await click(button("Chemistry")!);
    expect(button("Biology")?.getAttribute("aria-pressed")).toBe("true");
    expect(button("Chemistry")?.getAttribute("aria-pressed")).toBe("true");

    await click(button("Biology")!);
    expect(button("Biology")?.getAttribute("aria-pressed")).toBe("false");
    await click(addButton);

    expect(onAdd).toHaveBeenCalledWith(["deck-2"]);
    expect(button("Chemistry")?.getAttribute("aria-pressed")).toBe("false");
    expect(button("Add to folder")?.disabled).toBe(true);
  });

  it("filters candidates and clears the search after a successful attach", async () => {
    const onAdd = vi.fn().mockResolvedValue(true);
    await render(
      <FolderAssetPicker
        kind="source"
        items={[
          { id: "source-1", label: "Cell structure" },
          { id: "source-2", label: "Organic chemistry" },
        ]}
        busy={false}
        onAdd={onAdd}
      />
    );

    const search = field("Find source")!;
    type(search, "organic");
    expect(button("Cell structure")).toBeUndefined();
    await click(button("Organic chemistry")!);
    await click(button("Add to folder")!);

    expect(onAdd).toHaveBeenCalledWith(["source-2"]);
    expect(search.value).toBe("");
    expect(button("Cell structure")).toBeDefined();
  });

  it("keeps the pending selection and search when attaching fails", async () => {
    const onAdd = vi.fn().mockResolvedValue(false);
    await render(
      <FolderAssetPicker
        kind="source"
        items={[
          { id: "source-1", label: "Cell structure" },
          { id: "source-2", label: "Organic chemistry" },
        ]}
        busy={false}
        onAdd={onAdd}
      />
    );

    const search = field("Find source")!;
    type(search, "organic");
    await click(button("Organic chemistry")!);
    await click(button("Add to folder")!);

    expect(onAdd).toHaveBeenCalledWith(["source-2"]);
    expect(search.value).toBe("organic");
    expect(button("Organic chemistry")?.getAttribute("aria-pressed")).toBe(
      "true"
    );
    expect(button("Add to folder")?.disabled).toBe(false);
  });
});
