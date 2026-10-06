// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FolderNotebookCreator from "@/components/workspace/FolderNotebookCreator";

const createNotebook = vi.fn();
const createNotebookPage = vi.fn();
const importUploadedNotebook = vi.fn();

vi.mock("@/services/study/notebooks", () => ({
  createNotebook: (...args: unknown[]) => createNotebook(...args),
  createNotebookPage: (...args: unknown[]) => createNotebookPage(...args),
}));
vi.mock("@/services/study/notebook-import", () => ({
  importUploadedNotebook: (...args: unknown[]) => importUploadedNotebook(...args),
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

async function chooseFile(file: File) {
  const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(fileInput, "files", {
    configurable: true,
    value: [file],
  });
  await act(async () => {
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function typeTitle(value: string) {
  const title = document.querySelector<HTMLInputElement>(
    '[data-dialog-autofocus="true"]'
  )!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
      title,
      value
    );
    title.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function clickButton(label: string) {
  const target = Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === label
  )!;
  await act(async () => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("folder notebook creation", () => {
  it("keeps the paper controls for added pages once a file is selected", async () => {
    await renderCreator();
    expect(document.body.textContent).toContain("Page colour");
    expect(document.body.textContent).toContain("Page style");

    await chooseFile(new File(["image"], "page.png", { type: "image/png" }));

    expect(document.body.textContent).toContain("The paper for pages you add");
    expect(document.body.textContent).toContain("Page colour");
    expect(document.body.textContent).toContain("Page style");
  });

  it("gives an imported notebook the paper chosen for pages added later", async () => {
    importUploadedNotebook.mockReset().mockResolvedValue({
      notebook: { id: "notebook-1", title: "Past paper" },
      pages: [{ id: "page-1" }],
    });
    await renderCreator();
    typeTitle("Past paper");
    await chooseFile(new File(["pdf"], "paper.pdf", { type: "application/pdf" }));
    await clickButton("Cream");
    await clickButton("Grid");
    await clickButton("Create notebook");

    expect(importUploadedNotebook).toHaveBeenCalledWith(
      expect.objectContaining({ pageColor: "cream", pageStyle: "grid" })
    );
    expect(onCreated).toHaveBeenCalledOnce();
  });

  it("creates a blank notebook and its first page with the selected paper defaults", async () => {
    await renderCreator();
    typeTitle("Biology notes");
    await clickButton("Create notebook");

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

