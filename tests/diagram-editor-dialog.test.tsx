// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const detectDiagramLabels = vi.fn(async () => []);

vi.mock("@/services/ai/diagram-labels", () => ({ detectDiagramLabels }));
vi.mock("@/services/study/image-occlusion", () => ({
  saveDiagram: vi.fn(),
  deleteDiagram: vi.fn(),
}));
vi.mock("@/services/study/topics", () => ({ createOrGetTopic: vi.fn() }));
vi.mock("@/services/firebase/storage-files", () => ({
  createStorageFileId: vi.fn(() => "file-1"),
  deleteStorageFile: vi.fn(async () => undefined),
  getStorageFileDownloadUrl: vi.fn(async (path: string) => `https://files.test/${path}`),
  getStorageUploadErrorMessage: vi.fn(() => "upload failed"),
  sanitizeStorageFileName: vi.fn((name: string) => name),
  uploadStorageFile: vi.fn(async () => undefined),
}));
vi.mock("@/lib/app/feature-flags", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/app/feature-flags")>();
  return { ...actual, featureFlags: { ...actual.featureFlags, enableFlashcardAi: true } };
});

const { default: DiagramEditorDialog } = await import("@/components/decks/diagram/DiagramEditorDialog");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  detectDiagramLabels.mockClear();
  URL.createObjectURL = vi.fn(() => "blob:diagram");
  URL.revokeObjectURL = vi.fn();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function openNewDiagram() {
  const picture = { file: new File(["x"], "heart.png", { type: "image/png" }), width: 1000, height: 800 };
  await act(async () =>
    root.render(
      <DiagramEditorDialog
        start={{ kind: "new", picture }}
        userId="u"
        deckId="d"
        deckName="Anatomy"
        topics={[]}
        onTopicsChange={vi.fn()}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    )
  );
}

const buttonWithText = (text: string) =>
  [...document.querySelectorAll("button")].find((button) => button.textContent?.includes(text));
const toolbarButton = (label: string) => document.querySelector(`button[aria-label="${label}"]`);

describe("starting a diagram", () => {
  it("asks who covers printed labels before Jami reads the picture", async () => {
    await openNewDiagram();
    await act(async () => buttonWithText("It has labels")!.click());

    expect(document.body.textContent).toContain("Who covers the labels?");
    expect(detectDiagramLabels).not.toHaveBeenCalled();

    await act(async () => buttonWithText("I'll cover them myself")!.click());
    expect(detectDiagramLabels).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Cover the labels");
  });

  it("has Jami find the labels when the student asks it to", async () => {
    await openNewDiagram();
    await act(async () => buttonWithText("It has labels")!.click());
    await act(async () => buttonWithText("Jami covers them")!.click());
    expect(detectDiagramLabels).toHaveBeenCalledTimes(1);
  });

  it("goes back to the first question from the second", async () => {
    await openNewDiagram();
    await act(async () => buttonWithText("It has labels")!.click());
    await act(async () => buttonWithText("Back")!.click());
    expect(document.body.textContent).toContain("Are the labels written on the picture?");
  });

  it("offers a line to the part only when naming parts, and never a button to change the picture", async () => {
    await openNewDiagram();
    await act(async () => buttonWithText("It has no labels")!.click());
    expect(toolbarButton("Line to the part (L)")).not.toBeNull();
    expect(toolbarButton("Crop the picture")).not.toBeNull();
    expect(toolbarButton("Change the picture")).toBeNull();

    await act(async () => root.unmount());
    root = createRoot(host);
    await openNewDiagram();
    await act(async () => buttonWithText("It has labels")!.click());
    await act(async () => buttonWithText("I'll cover them myself")!.click());
    expect(toolbarButton("Line to the part (L)")).toBeNull();
  });
});

describe("the covers' colour", () => {
  it("is chosen from the toolbar and colours the editor's boxes", async () => {
    await openNewDiagram();
    await act(async () => buttonWithText("It has labels")!.click());
    await act(async () => buttonWithText("I'll cover them myself")!.click());

    const trigger = toolbarButton("Cover colour: Theme") as HTMLButtonElement;
    expect(trigger.closest('[role="toolbar"]')).not.toBeNull();
    await act(async () => trigger.click());
    const coral = document.querySelector<HTMLButtonElement>('[role="radiogroup"] button[aria-label="Coral"]')!;
    expect(document.querySelector('[role="radio"][aria-checked="true"]')?.getAttribute("aria-label")).toBe("Theme");
    await act(async () => coral.click());

    expect(document.querySelector('[role="radiogroup"][aria-label="Cover colour"]')).toBeNull();
    expect(toolbarButton("Cover colour: Coral")).not.toBeNull();
    expect(document.querySelector(".occlusion-cover--coral")).not.toBeNull();
  });
});
