import { describe, expect, it } from "vitest";
import {
  getNotebookInkColor,
  legacyStrokesToJsDrawSvg,
  makeNotebookInkData,
} from "@/lib/workspace/notebook-ink-data";
import { mapNotebookPageData } from "@/lib/workspace/notebooks";

describe("notebook js-draw ink data", () => {
  it("converts legacy pen and highlighter strokes to importable SVG", () => {
    const svg = legacyStrokesToJsDrawSvg(
      [
        {
          color: "red",
          points: [
            { x: 10, y: 20 },
            { x: 40, y: 50 },
          ],
          tool: "pen",
          width: 5,
        },
        {
          color: "yellow",
          points: [
            { x: 80, y: 90 },
            { x: 120, y: 110 },
          ],
          tool: "highlighter",
          width: 24,
        },
      ],
      900,
      1240
    );

    expect(svg).toContain('viewBox="0 0 900 1240"');
    expect(svg).toContain('stroke="#ef4444"');
    expect(svg).toContain('stroke="#fde047"');
    expect(svg).toContain('opacity="0.42"');
  });

  it("normalizes a versioned js-draw SVG payload on reload", () => {
    const inkData = makeNotebookInkData(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 1240"><path d="M0 0L10 10"/></svg>'
    );
    const page = mapNotebookPageData("page-1", {
      notebookId: "notebook-1",
      folderId: "folder-1",
      pageNumber: 1,
      pageType: "blank",
      inkData,
    });

    expect(page.inkData).toEqual(inkData);
    expect(page.strokeData).toBeUndefined();
  });

  it("maps every Jami toolbar colour without falling back to purple", () => {
    expect(getNotebookInkColor("black", "pen")).toEqual({
      color: "#111827",
      opacity: 1,
    });
    expect(getNotebookInkColor("white", "pen").color).toBe("#f8fafc");
    expect(getNotebookInkColor("red", "pen").color).toBe("#ef4444");
    expect(getNotebookInkColor("green", "pen").color).toBe("#22c55e");
    expect(getNotebookInkColor("#123abc", "pen").color).toBe("#123abc");
    expect(getNotebookInkColor("yellow", "highlighter")).toEqual({
      color: "#fde047",
      opacity: 0.42,
    });
  });
});
