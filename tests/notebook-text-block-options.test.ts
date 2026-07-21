import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildNotebookPagePayload,
  createNotebookTextBlocksFromTypedContent,
  mapNotebookPageData,
  normalizeNotebookTextBlocks,
  resizeNotebookTextBlockFromEdge,
} from "@/lib/workspace/notebooks";

const notebookPageSource = readFileSync(
  join(process.cwd(), "app/dashboard/notebooks/[notebookId]/page.tsx"),
  "utf8"
);

const TEXT_BLOCK = {
  id: "block-1",
  x: 80,
  y: 92,
  width: 320,
  height: 120,
  text: "Move me later",
};

describe("notebook text-block outline options", () => {
  it("shows outlines for existing text blocks that predate the option", () => {
    expect(normalizeNotebookTextBlocks([TEXT_BLOCK])).toEqual([
      expect.objectContaining({
        id: "block-1",
        outlineVisible: true,
      }),
    ]);

    expect(
      normalizeNotebookTextBlocks([
        { ...TEXT_BLOCK, outlineVisible: "not-a-boolean" },
      ])[0]?.outlineVisible
    ).toBe(true);
  });

  it("creates legacy typed-content blocks with a discoverable outline", () => {
    expect(createNotebookTextBlocksFromTypedContent("Legacy notes")[0]).toMatchObject({
      id: "legacy-typed-content",
      outlineVisible: true,
    });
  });

  it("persists a valid empty text box but rejects missing or non-string text", () => {
    const emptyBlock = normalizeNotebookTextBlocks([
      { ...TEXT_BLOCK, text: "" },
    ])[0]!;

    expect(emptyBlock).toMatchObject({
      id: "block-1",
      text: "",
      outlineVisible: true,
    });

    const payload = buildNotebookPagePayload({
      notebookId: "notebook-1",
      folderId: "folder-1",
      pageNumber: 1,
      textBlocks: [emptyBlock],
      now: 1,
    });
    expect(mapNotebookPageData("page-1", payload).textBlocks[0]).toMatchObject({
      id: "block-1",
      text: "",
      outlineVisible: true,
    });

    expect(
      normalizeNotebookTextBlocks([
        { ...TEXT_BLOCK, text: 42 },
        {
          id: TEXT_BLOCK.id,
          x: TEXT_BLOCK.x,
          y: TEXT_BLOCK.y,
          width: TEXT_BLOCK.width,
          height: TEXT_BLOCK.height,
        },
      ])
    ).toEqual([]);
  });

  it("preserves an outline toggle through the page save/load boundary", () => {
    const payload = buildNotebookPagePayload({
      notebookId: "notebook-1",
      folderId: "folder-1",
      pageNumber: 1,
      textBlocks: [{ ...TEXT_BLOCK, outlineVisible: false }],
      now: 1,
    });
    const page = mapNotebookPageData("page-1", payload);

    expect(payload.textBlocks[0]?.outlineVisible).toBe(false);
    expect(page.textBlocks[0]?.outlineVisible).toBe(false);
  });

  it("keeps a hidden outline hidden when its text box is resized", () => {
    const resized = resizeNotebookTextBlockFromEdge({
      block: { ...TEXT_BLOCK, outlineVisible: false },
      edge: "right",
      deltaX: 40,
      deltaY: 0,
    });

    expect(resized).toMatchObject({
      width: 360,
      outlineVisible: false,
    });
  });

  it("exposes Pencil-friendly options with explicit menu semantics", () => {
    expect(notebookPageSource).toContain('aria-label="Text box options"');
    expect(notebookPageSource).toContain('aria-haspopup="menu"');
    expect(notebookPageSource).toContain('data-text-block-options-trigger="true"');
    expect(notebookPageSource).toContain('data-text-block-options-root');
    expect(notebookPageSource).toContain('role="menu"');
    expect(notebookPageSource).toContain('role="menuitemcheckbox"');
    expect(notebookPageSource).toContain('data-text-block-outline-toggle="true"');
    expect(notebookPageSource).toContain('role="menuitem"');
    expect(notebookPageSource).toContain('data-text-block-delete="true"');
    expect(notebookPageSource).toContain("Show outline");
    expect(notebookPageSource).toContain("Delete text box");
  });
});
