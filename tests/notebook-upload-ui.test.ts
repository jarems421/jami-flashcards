import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("notebook upload UI", () => {
  it("shows blank-page controls only when no initial file is selected without extra upload explanations", () => {
    const folderPage = readFileSync(
      join(root, "app/dashboard/folders/[folderId]/page.tsx"),
      "utf8"
    );

    expect(folderPage).toContain("!notebookFile ?");
    expect(folderPage).toContain("pageColor={notebookPageColor}");
    expect(folderPage).toContain("pageStyle={notebookPageStyle}");
    expect(folderPage).not.toContain("File pages become the notebook");
    expect(folderPage).not.toContain(
      "PDF and image pages use the file itself as their background."
    );
    expect(folderPage).not.toContain("The PDF or image stays locked");
  });

  it("keeps notebook creation free of demo-mode gating", () => {
    const folderPage = readFileSync(
      join(root, "app/dashboard/folders/[folderId]/page.tsx"),
      "utf8"
    );
    const notebookPage = readFileSync(
      join(root, "app/dashboard/notebooks/[notebookId]/page.tsx"),
      "utf8"
    );

    expect(folderPage).not.toContain("isDemoUser");
    expect(notebookPage).not.toContain("isDemoUser");
  });

  it("keeps notebook settings and duplicate add-page controls out of the toolbar", () => {
    const notebookPage = readFileSync(
      join(root, "app/dashboard/notebooks/[notebookId]/page.tsx"),
      "utf8"
    );

    expect(notebookPage).not.toContain('label="Add PDF or image pages"');
    expect(notebookPage).not.toContain('label="Add page"');
    expect(notebookPage).not.toContain('"+ Page"');
    expect(notebookPage).not.toContain('label="Notebook settings"');
    expect(notebookPage).not.toContain("showNotebookSettings");
  });

  it("keeps the pages drawer list within its available height", () => {
    const notebookPage = readFileSync(
      join(root, "app/dashboard/notebooks/[notebookId]/page.tsx"),
      "utf8"
    );

    expect(notebookPage).toContain(
      "flex min-h-0 w-64 flex-col"
    );
    expect(notebookPage).toContain(
      "min-h-0 flex-1 space-y-2 overflow-y-auto"
    );
    expect(notebookPage).not.toContain("max-h-[calc(100vh-7rem)]");
  });

  it("keeps bottom controls compositing-safe without reserving a page lane", () => {
    const notebookPage = readFileSync(
      join(root, "app/dashboard/notebooks/[notebookId]/page.tsx"),
      "utf8"
    );
    const globalStyles = readFileSync(
      join(root, "app/globals.css"),
      "utf8"
    );

    expect(notebookPage.match(/notebook-floating-control/g)?.length).toBe(3);
    expect(notebookPage).not.toContain(
      "shadow-[0_14px_34px_rgba(0,0,0,0.28)]"
    );
    expect(notebookPage).toContain("data-notebook-page-frame");
    expect(notebookPage).toContain('className="absolute inset-0 overflow-hidden"');
    expect(notebookPage).not.toContain("notebook-page-y-offset");
    expect(notebookPage).not.toContain("notebook-control-y-offset");
    expect(globalStyles).toContain(".notebook-floating-control");
    expect(globalStyles).toContain("-webkit-backdrop-filter: none");
    expect(globalStyles).toContain("box-shadow: none");
    expect(globalStyles).not.toContain("--notebook-control-y-offset");
    expect(globalStyles).not.toContain("--notebook-page-y-offset");
  });
});
