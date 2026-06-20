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

  it("blocks demo notebook uploads with clear copy", () => {
    const folderPage = readFileSync(
      join(root, "app/dashboard/folders/[folderId]/page.tsx"),
      "utf8"
    );
    const notebookPage = readFileSync(
      join(root, "app/dashboard/notebooks/[notebookId]/page.tsx"),
      "utf8"
    );

    expect(folderPage).toContain(
      "Exit the shared demo to create notebooks or upload PDF and image files."
    );
    expect(notebookPage).toContain(
      "Exit the shared demo to upload PDF or image pages."
    );
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
});
