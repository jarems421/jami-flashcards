import { describe, expect, it } from "vitest";
import { makeNotebookInkData } from "@/lib/workspace/notebook-ink-data";
import {
  buildNotebookPagePayload,
  MAX_NOTEBOOK_IMAGE_REFS,
  MAX_NOTEBOOK_INK_SVG_LENGTH,
  MAX_NOTEBOOK_STROKE_POINTS,
  MAX_NOTEBOOK_TEXT_BLOCKS,
  MAX_NOTEBOOK_TEXT_BLOCK_TEXT,
  NotebookPagePersistenceError,
  mapNotebookPageData,
  prepareNotebookPageSnapshotForPersistence,
  type NotebookTextBlock,
} from "@/lib/workspace/notebooks";

function makeTextBlock(index: number, text = "Notes"): NotebookTextBlock {
  return {
    id: `block-${index}`,
    x: 10,
    y: 10,
    width: 320,
    height: 120,
    text,
    outlineVisible: true,
  };
}

function expectPersistenceCode(run: () => unknown, code: string) {
  try {
    run();
    throw new Error("Expected the notebook snapshot to be rejected.");
  } catch (error) {
    expect(error).toBeInstanceOf(NotebookPagePersistenceError);
    expect((error as NotebookPagePersistenceError).code).toBe(code);
  }
}

describe("notebook page persistence contract", () => {
  it("keeps oversized legacy values visible instead of clipping them on load", () => {
    const longText = "t".repeat(MAX_NOTEBOOK_TEXT_BLOCK_TEXT + 25);
    const textBlocks = Array.from(
      { length: MAX_NOTEBOOK_TEXT_BLOCKS + 2 },
      (_, index) => makeTextBlock(index, index === 0 ? longText : "Notes")
    );
    const legacyInk = `<svg>${"x".repeat(MAX_NOTEBOOK_INK_SVG_LENGTH + 1)}</svg>`;
    const page = mapNotebookPageData("page-1", {
      notebookId: "notebook-1",
      folderId: "folder-1",
      pageNumber: 1,
      pageType: "blank",
      textBlocks,
      inkData: { version: 2, format: "js-draw-svg", svg: legacyInk },
    });

    expect(page.textBlocks).toHaveLength(MAX_NOTEBOOK_TEXT_BLOCKS + 2);
    expect(page.textBlocks[0]?.text).toBe(longText);
    expect(page.inkData?.svg).toBe(legacyInk);
  });

  it("rejects unsafe ink and text explicitly at the shared write boundary", () => {
    expectPersistenceCode(
      () =>
        makeNotebookInkData(
          `<svg>${"x".repeat(MAX_NOTEBOOK_INK_SVG_LENGTH)}</svg>`
        ),
      "ink-too-large"
    );
    expectPersistenceCode(
      () =>
        prepareNotebookPageSnapshotForPersistence({
          typedContent: "",
          textBlocks: Array.from(
            { length: MAX_NOTEBOOK_TEXT_BLOCKS + 1 },
            (_, index) => makeTextBlock(index)
          ),
          pageColor: "white",
          pageStyle: "plain",
          status: "working",
        }),
      "too-many-text-blocks"
    );
    expectPersistenceCode(
      () =>
        prepareNotebookPageSnapshotForPersistence({
          typedContent: "",
          textBlocks: [
            makeTextBlock(1, "x".repeat(MAX_NOTEBOOK_TEXT_BLOCK_TEXT + 1)),
          ],
          pageColor: "white",
          pageStyle: "plain",
          status: "working",
        }),
      "text-block-too-large"
    );
  });

  it("accounts for the complete UTF-8 snapshot before a Firestore write", () => {
    expectPersistenceCode(
      () =>
        prepareNotebookPageSnapshotForPersistence({
          typedContent: "x".repeat(30_000),
          textBlocks: Array.from({ length: 20 }, (_, index) =>
            makeTextBlock(index, "y".repeat(4_000))
          ),
          inkData: {
            version: 2,
            format: "js-draw-svg",
            svg: `<svg>${"z".repeat(820_000)}</svg>`,
          },
          pageColor: "white",
          pageStyle: "plain",
          status: "working",
        }),
      "snapshot-too-large"
    );
  });

  it("maps old pages to revision zero and preserves stored revisions", () => {
    expect(mapNotebookPageData("legacy", {}).contentRevision).toBe(0);
    expect(
      mapNotebookPageData("current", { contentRevision: 7 }).contentRevision
    ).toBe(7);
  });

  it("preserves legacy stroke points and image references but rejects new overflow writes", () => {
    const strokePoints = Array.from(
      { length: MAX_NOTEBOOK_STROKE_POINTS + 1 },
      (_, index) => ({ x: index, y: index })
    );
    const imageRefs = Array.from(
      { length: MAX_NOTEBOOK_IMAGE_REFS + 1 },
      (_, index) => ({ id: `image-${index}` })
    );
    const page = mapNotebookPageData("legacy", {
      strokeData: {
        version: 1,
        strokes: [
          { points: strokePoints, color: "black", width: 5, tool: "pen" },
        ],
      },
      imageRefs,
    });

    expect(page.strokeData?.strokes[0]?.points).toHaveLength(
      MAX_NOTEBOOK_STROKE_POINTS + 1
    );
    expect(page.imageRefs).toHaveLength(MAX_NOTEBOOK_IMAGE_REFS + 1);
    expectPersistenceCode(
      () =>
        buildNotebookPagePayload({
          notebookId: "notebook-1",
          folderId: "folder-1",
          pageNumber: 1,
          imageRefs,
        }),
      "too-many-images"
    );
  });
});
