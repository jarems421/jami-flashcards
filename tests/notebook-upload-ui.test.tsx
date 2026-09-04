// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FolderNotebookCreator from "@/components/workspace/FolderNotebookCreator";

const createNotebook = vi.fn();
const createNotebookPage = vi.fn();

vi.mock("@/services/study/notebooks", () => ({
  createNotebook: (...args: unknown[]) => createNotebook(...args),
  createNotebookPage: (...args: unknown[]) => createNotebookPage(...args),
}));
vi.mock("@/services/study/notebook-import", () => ({
  importUploadedNotebook: vi.fn(),
}));
vi.mock("@/components/topics/TopicPicker", () => ({
  default: () => <div data-testid="topic-picker" />,
}));
vi.mock("@/components/workspace/NotebookObjectCard", () => ({
  NotebookObjectCard: () => <div data-testid="notebook-preview" />,
}));
vi.mock("@/components/workspace/ObjectStylePicker", () => ({
  ObjectStylePicker: () => <div data-testid="style-picker" />,
}));

let container: HTMLDivElement;
let root: Root;
const onCreated = vi.fn();
const onCancel = vi.fn();
const onError = vi.fn();

async function renderCreator() {
  await act(async () => {
    root.render(
      <FolderNotebookCreator
        userId="user-1"
        folder={{
          id: "folder-1",
          name: "Biology",
          archived: false,
          topicIds: [],
          tutorInstructions: "",
          tutorInstructionsUpdatedAt: 0,
          createdAt: 1,
          updatedAt: 1,
        }}
        topics={[]}
        onTopicsChange={() => undefined}
        onCreated={onCreated}
        onCancel={onCancel}
        onError={onError}
      />
    );
  });
}

beforeEach(() => {
  createNotebook.mockReset().mockResolvedValue({
    id: "notebook-1",
    title: "Biology notes",
  });
  createNotebookPage.mockReset().mockResolvedValue({ id: "page-1" });
  onCreated.mockClear();
  onCancel.mockClear();
  onError.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("folder notebook creation", () => {
  it("shows blank-page controls until an initial file is selected", async () => {
    await renderCreator();
    expect(document.body.textContent).toContain("Page colour");
    expect(document.body.textContent).toContain("Page style");

    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(["image"], "page.png", { type: "image/png" });
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [file],
    });
    await act(async () => {
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(document.body.textContent).not.toContain("Page colour");
    expect(document.body.textContent).not.toContain("Page style");
  });

  it("creates a blank notebook and its first page with the selected paper defaults", async () => {
    await renderCreator();
    const title = document.querySelector<HTMLInputElement>(
      '[data-dialog-autofocus="true"]'
    )!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        title,
        "Biology notes"
      );
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const createButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Create notebook"
    )!;
    await act(async () => {
      createButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(createNotebook).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        folderId: "folder-1",
        title: "Biology notes",
        pageColor: "white",
        pageStyle: "plain",
      })
    );
    expect(createNotebookPage).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ notebookId: "notebook-1", pageNumber: 1 })
    );
    expect(onCreated).toHaveBeenCalledOnce();
  });
});

