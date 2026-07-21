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

  it("does not wait for Firebase before following the back link", () => {
    const editorSource = readFileSync(
      join(process.cwd(), "app/dashboard/notebooks/[notebookId]/page.tsx"),
      "utf8"
    );
    const inkEditorSource = readFileSync(
      join(process.cwd(), "components/workspace/NotebookInkEditor.tsx"),
      "utf8"
    );

    expect(editorSource).toContain(
      "const handleExitNotebook = (event: ReactMouseEvent<HTMLAnchorElement>) =>"
    );
    expect(editorSource).not.toContain("const handleExitNotebook = async");
    expect(editorSource).toContain("const saveQueued = queueCurrentPageSaveForExit()");
    expect(editorSource).not.toContain(
      "router.push(`/dashboard/folders/${notebook?.folderId ?? \"\"}`)"
    );
    expect(inkEditorSource).toContain("serialize(): string | null;");
    expect(inkEditorSource).toContain("const svg = editor.toSVG();");
  });
});
