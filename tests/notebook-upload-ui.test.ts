import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("notebook upload UI", () => {
  it("shows blank-page controls only when no initial file is selected", () => {
    const folderPage = readFileSync(
      join(root, "app/dashboard/folders/[folderId]/page.tsx"),
      "utf8"
    );

    expect(folderPage).toContain("!notebookFile ?");
    expect(folderPage).toContain(
      "PDF and image pages use the file itself as their background."
    );
    expect(folderPage).toContain("Any blank pages added later will use white plain paper.");
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

  it("keeps uploads separate from notebook editing", () => {
    const notebookPage = readFileSync(
      join(root, "app/dashboard/notebooks/[notebookId]/page.tsx"),
      "utf8"
    );

    expect(notebookPage).toContain('label="Add PDF or image pages"');
    expect(notebookPage).not.toContain('label="Notebook settings"');
    expect(notebookPage).not.toContain("showNotebookSettings");
  });
});
