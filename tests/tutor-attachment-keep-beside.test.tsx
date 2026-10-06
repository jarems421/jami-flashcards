// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TutorMessageAttachments } from "@/components/ai/TutorAttachments";
import type { TutorAttachment } from "@/lib/ai/tutor-attachments";

vi.mock("@/services/ai/tutor-attachments", () => ({
  getTutorAttachmentUrl: vi.fn(() => new Promise(() => undefined)),
  saveTutorAttachmentAsSource: vi.fn(),
}));
vi.mock("@/services/study/folders", () => ({ getActiveStudyFolders: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SHEET: TutorAttachment = {
  storagePath: "users/u1/sourceFiles/chat-1/Question sheet.pdf",
  fileName: "Question sheet.pdf",
  fileType: "application/pdf",
  sizeBytes: 1_000,
};
const NOTES: TutorAttachment = {
  storagePath: "users/u1/sourceFiles/chat-2/notes.txt",
  fileName: "notes.txt",
  fileType: "text/plain",
  sizeBytes: 100,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("keeping a file from the chat beside the page", () => {
  it("offers it for a PDF in a notebook and hands that file over", () => {
    const onKeepBeside = vi.fn();
    act(() => {
      root.render(
        <TutorMessageAttachments attachments={[SHEET, NOTES]} previewUrlFor={() => undefined} onKeepBeside={onKeepBeside} />
      );
    });
    const buttons = [...container.querySelectorAll("button")].filter((button) =>
      button.textContent?.includes("Keep beside page")
    );
    expect(buttons).toHaveLength(1);
    act(() => buttons[0]?.click());
    expect(onKeepBeside).toHaveBeenCalledWith(SHEET);
  });

  it("offers nothing outside a notebook", () => {
    act(() => {
      root.render(<TutorMessageAttachments attachments={[SHEET]} previewUrlFor={() => undefined} />);
    });
    expect(container.textContent).not.toContain("Keep beside page");
  });
});
