import { describe, expect, it } from "vitest";
import { createNotebookPageDraft } from "@/lib/workspace/notebook-drafts";
import {
  applyNotebookDraftToPage,
  buildNotebookThumbnailPoints,
  clampNotebookTextBlock,
  getNotebookPageStyleBackground,
  getNotebookStrokePaintColor,
  getNotebookStrokePaintColorForPage,
  getNotebookTextBlockOptionsElementId,
  getNotebookWorkingPageStatus,
  normalizeNotebookStrokes,
} from "@/lib/workspace/notebook-page-content";
import type { NotebookPage } from "@/lib/workspace/notebooks";

function makePage(): NotebookPage {
  return {
    id: "page-1",
    notebookId: "notebook-1",
    folderId: "folder-1",
    pageNumber: 1,
    pageType: "blank",
    typedContent: "Old notes",
    textBlocks: [],
    strokeData: {
      version: 1,
      strokes: [
        { points: [{ x: 1, y: 2 }], color: "black", width: 5, tool: "pen" },
      ],
    },
    imageRefs: [],
    pageColor: "white",
    pageStyle: "plain",
    status: "working",
    contentRevision: 3,
    createdAt: 10,
    updatedAt: 20,
  };
}

describe("notebook page content", () => {
  it("normalizes legacy strokes without allowing invalid points or unsafe widths", () => {
    const strokes = normalizeNotebookStrokes([
      {
        points: [
          { x: 12, y: 20, pressure: 0.4, time: 7 },
          { x: Number.NaN, y: 30 },
        ],
        color: "not-a-color",
        tool: "unknown",
        width: 500,
      },
      { points: "not-points" },
    ]);

    expect(strokes).toHaveLength(1);
    expect(strokes[0]).toMatchObject({
      color: "black",
      tool: "pen",
      width: 96,
    });
    expect(strokes[0]?.points).toHaveLength(1);
    expect(strokes[0]?.points[0]).toMatchObject({ x: 12, y: 20 });
  });

  it("keeps text boxes inside the fixed notebook coordinate space", () => {
    expect(
      clampNotebookTextBlock({
        id: "text-1",
        x: 880,
        y: -50,
        width: 500,
        height: 20,
        text: "Notes",
        outlineVisible: true,
      })
    ).toEqual({
      id: "text-1",
      x: 400,
      y: 0,
      width: 500,
      height: 48,
      text: "Notes",
      outlineVisible: true,
    });
  });

  it("uses one paint and paper-style contract for previews and the live page", () => {
    expect(getNotebookStrokePaintColor("pink", "highlighter")).toBe("#f9a8d4");
    expect(
      getNotebookStrokePaintColorForPage(
        { points: [{ x: 0, y: 0 }], color: "red", width: 8, tool: "eraser" },
        "black"
      )
    ).toBe("#080a10");
    expect(getNotebookPageStyleBackground("white", "plain")).toBeUndefined();
    expect(
      getNotebookPageStyleBackground("black", "dot")?.backgroundSize
    ).toBe("28px 28px");
  });

  it("bounds thumbnail paths and produces stable accessible element ids", () => {
    const points = Array.from({ length: 100 }, (_, index) => ({
      x: index,
      y: index + 1,
    }));
    expect(buildNotebookThumbnailPoints(points).split(" ")).toHaveLength(80);
    expect(getNotebookTextBlockOptionsElementId("a/b", "menu")).toBe(
      "notebook-text-box-options-a%2Fb-menu"
    );
  });

  it("applies a recovery draft without altering page identity or revision metadata", () => {
    const draft = createNotebookPageDraft({
      userId: "user-1",
      notebookId: "notebook-1",
      pageId: "page-1",
      baseContentRevision: 3,
      remoteUpdatedAt: 20,
      localRevision: 2,
      savedAt: 30,
      textBlocks: [
        {
          id: "text-1",
          x: 10,
          y: 20,
          width: 200,
          height: 80,
          text: "Recovered notes",
          outlineVisible: false,
        },
      ],
      inkSvg: "<svg></svg>",
      pageColor: "black",
      pageStyle: "grid",
      status: "working",
    });

    const restored = applyNotebookDraftToPage(makePage(), draft);
    expect(restored.id).toBe("page-1");
    expect(restored.contentRevision).toBe(3);
    expect(restored.updatedAt).toBe(20);
    expect(restored.typedContent).toBe("Recovered notes");
    expect(restored.inkData?.svg).toBe("<svg></svg>");
    expect(restored.strokeData).toBeUndefined();
    expect(restored.pageColor).toBe("black");
    expect(restored.pageStyle).toBe("grid");
  });

  it("derives the same blank or working state for drafts and remote saves", () => {
    expect(getNotebookWorkingPageStatus({ typedContent: "  ", hasInk: false })).toBe(
      "blank"
    );
    expect(getNotebookWorkingPageStatus({ typedContent: "Notes", hasInk: false })).toBe(
      "working"
    );
    expect(getNotebookWorkingPageStatus({ typedContent: "", hasInk: true })).toBe(
      "working"
    );
  });
});
