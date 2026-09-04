// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SourceComposerDialog from "@/components/library/SourceComposerDialog";
import type { StudyFolder } from "@/lib/workspace/study-folders";

const createSource = vi.fn();
const updateSource = vi.fn();
const deleteSource = vi.fn();
const uploadSourceFile = vi.fn();
const deleteSourceFile = vi.fn();
const validateSourceUploadFile = vi.fn();

vi.mock("@/services/study/sources", () => ({
  createSource: (...args: unknown[]) => createSource(...args),
  updateSource: (...args: unknown[]) => updateSource(...args),
  deleteSource: (...args: unknown[]) => deleteSource(...args),
}));

vi.mock("@/services/study/source-files", () => ({
  uploadSourceFile: (...args: unknown[]) => uploadSourceFile(...args),
  deleteSourceFile: (...args: unknown[]) => deleteSourceFile(...args),
  validateSourceUploadFile: (...args: unknown[]) =>
    validateSourceUploadFile(...args),
}));

vi.mock("@/components/topics/TopicPicker", () => ({
  default: () => <div>Topic picker</div>,
}));

vi.mock("@/components/workspace/WorkspaceActionDialog", () => ({
  default: ({
    open,
    children,
  }: {
    open: boolean;
    children: React.ReactNode;
  }) => (open ? <section aria-label="Add source dialog">{children}</section> : null),
}));

let container: HTMLDivElement;
let root: Root;
const onClose = vi.fn();
const onCreated = vi.fn();
const biologyFolder = {
  id: "folder-1",
  name: "Biology",
  topicIds: [],
  tutorInstructions: "",
  tutorInstructionsUpdatedAt: 0,
  createdAt: 1,
  updatedAt: 1,
  archived: false,
} satisfies StudyFolder;

function fieldForLabel<T extends HTMLInputElement | HTMLTextAreaElement>(
  labelText: string
) {
  const label = [...container.querySelectorAll("label")].find(
    (candidate) => candidate.textContent?.trim() === labelText
  );
  return label?.htmlFor
    ? (document.getElementById(label.htmlFor) as T | null)
    : null;
}

async function render({
  open = true,
  folders = [],
  initialFolderId = "",
}: {
  open?: boolean;
  folders?: StudyFolder[];
  initialFolderId?: string;
} = {}) {
  await act(async () => {
    root.render(
      <SourceComposerDialog
        open={open}
        userId="user-1"
        folders={folders}
        topics={[]}
        initialFolderId={initialFolderId}
        onClose={onClose}
        onTopicsChange={vi.fn()}
        onCreated={onCreated}
      />
    );
  });
}

function setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  createSource.mockReset().mockResolvedValue("source-1");
  updateSource.mockReset().mockResolvedValue(undefined);
  deleteSource.mockReset().mockResolvedValue(undefined);
  uploadSourceFile.mockReset().mockResolvedValue({});
  deleteSourceFile.mockReset().mockResolvedValue(undefined);
  validateSourceUploadFile.mockReset();
  onClose.mockReset();
  onCreated.mockReset().mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("SourceComposerDialog", () => {
  it("persists a text source and reports the created selection", async () => {
    await render();
    const title = fieldForLabel<HTMLInputElement>("Title");
    const text = fieldForLabel<HTMLTextAreaElement>("Source text");
    expect(title).not.toBeNull();
    expect(text).not.toBeNull();

    await act(async () => {
      setValue(title!, "Wave summary");
      setValue(text!, "Diffraction and interference notes");
    });
    await act(async () => {
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(createSource).toHaveBeenCalledWith("user-1", {
      title: "Wave summary",
      type: "manual_note",
      topicIds: [],
      folderIds: [],
      contentText: "Diffraction and interference notes",
      externalUrl: undefined,
      fileName: undefined,
      fileType: undefined,
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith("source-1", "Source saved.");
  });

  it("keeps upload mode inside the dialog when no file is selected", async () => {
    await render();
    const upload = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Upload"
    );
    expect(upload).toBeDefined();
    act(() => upload!.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    await act(async () => {
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(createSource).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Choose a file to upload.");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("resets cancelled work and reapplies an empty folder prefill on reopen", async () => {
    await render({ folders: [biologyFolder], initialFolderId: biologyFolder.id });
    expect(container.textContent).toContain("Biology");

    const title = fieldForLabel<HTMLInputElement>("Title");
    const link = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Link"
    );
    expect(title).not.toBeNull();
    expect(link).toBeDefined();

    await act(async () => {
      setValue(title!, "Work in progress");
      link!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(fieldForLabel<HTMLInputElement>("Source link")).not.toBeNull();

    const cancel = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Cancel"
    );
    await act(async () => {
      cancel!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    await render({
      open: false,
      folders: [biologyFolder],
      initialFolderId: biologyFolder.id,
    });
    await render({ folders: [biologyFolder], initialFolderId: "" });

    expect(fieldForLabel<HTMLInputElement>("Title")?.value).toBe("");
    expect(fieldForLabel<HTMLTextAreaElement>("Source text")).not.toBeNull();
    expect(container.textContent).toContain("No folders");
    expect(
      [...container.querySelectorAll("button")].find(
        (button) => button.textContent === "Text"
      )?.getAttribute("aria-pressed")
    ).toBe("true");
  });
});
