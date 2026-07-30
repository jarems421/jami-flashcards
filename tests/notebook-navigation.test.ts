import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildNotebookPageSearch,
  getNotebookPageIdFromSearch,
} from "@/lib/workspace/notebook-navigation";

describe("notebook URL state", () => {
  it("reads the selected page from search params", () => {
    expect(getNotebookPageIdFromSearch("?page=page-2")).toBe("page-2");
    expect(getNotebookPageIdFromSearch("mode=focus&page=page-3")).toBe("page-3");
    expect(getNotebookPageIdFromSearch("")).toBeNull();
  });

  it("updates the page while preserving other params", () => {
    expect(buildNotebookPageSearch("?mode=focus", "page-2")).toBe(
      "?mode=focus&page=page-2"
    );
    expect(buildNotebookPageSearch("?page=page-1&mode=focus", null)).toBe(
      "?mode=focus"
    );
  });

  it("keeps synchronous ink serialization available to exit saves", () => {
    const inkEditorSource = readFileSync(
      join(process.cwd(), "components/workspace/NotebookInkEditor.tsx"),
      "utf8"
    );

    expect(inkEditorSource).toContain("serialize(): string | null;");
    expect(inkEditorSource).toContain("const svg = editor.toSVG();");
  });
});
