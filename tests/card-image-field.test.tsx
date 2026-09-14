// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CardImageDraft } from "@/lib/study/card-images";

vi.mock("@/services/firebase/storage-files", () => ({
  createStorageFileId: vi.fn(() => "file-1"),
  deleteStorageFile: vi.fn(async () => undefined),
  getStorageFileDownloadUrl: vi.fn(async () => "https://files.test/image.png"),
  getStorageUploadErrorMessage: vi.fn(() => "upload failed"),
  sanitizeStorageFileName: vi.fn((name: string) => name),
  uploadStorageFile: vi.fn(async () => undefined),
}));

const { default: CardImageField } = await import("@/components/decks/CardImageField");

let container: HTMLDivElement;
let root: Root;
const onChange = vi.fn();
const revokeObjectURL = vi.fn();

async function render(value?: CardImageDraft) {
  await act(async () => {
    root.render(<CardImageField label="Front image" value={value} onChange={onChange} />);
  });
}

function pick(file: File) {
  const input = container.querySelector<HTMLInputElement>("input[type=file]")!;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  act(() => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function button(label: string) {
  return [...container.querySelectorAll("button")].find(
    (candidate) =>
      candidate.textContent?.trim() === label || candidate.getAttribute("aria-label") === label
  );
}

beforeEach(() => {
  onChange.mockReset();
  revokeObjectURL.mockReset();
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:preview"), revokeObjectURL });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("CardImageField", () => {
  it("offers to add an image to the side it names", async () => {
    await render();
    expect(button("Add front image")).toBeDefined();
  });

  it("stages a chosen image without uploading it", async () => {
    await render();
    const file = new File(["png"], "heart.png", { type: "image/png" });
    pick(file);

    expect(onChange).toHaveBeenCalledWith({ kind: "new", file, previewUrl: "blob:preview" });
  });

  it("says why a file cannot be used and stages nothing", async () => {
    await render();
    pick(new File(["gif"], "clip.gif", { type: "image/gif" }));

    expect(onChange).not.toHaveBeenCalled();
    expect(container.querySelector("[role=alert]")?.textContent).toBe(
      "Use a JPEG, PNG or WebP image."
    );
  });

  it("removes a staged image and frees its preview", async () => {
    await render({
      kind: "new",
      file: new File(["png"], "heart.png", { type: "image/png" }),
      previewUrl: "blob:preview",
    });
    expect(container.textContent).toContain("Uploads when you save");

    await act(async () => {
      button("Remove front image")!.click();
    });

    expect(onChange).toHaveBeenCalledWith(undefined);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });
});
