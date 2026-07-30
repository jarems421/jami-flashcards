import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("notebook upload UI", () => {
  it("shows blank-page controls when no initial file is selected", () => {
    const folderPage = readFileSync(
      join(process.cwd(), "app/dashboard/folders/[folderId]/page.tsx"),
      "utf8"
    );

    expect(folderPage).toContain("!notebookFile ?");
    expect(folderPage).toContain("pageColor={notebookPageColor}");
    expect(folderPage).toContain("pageStyle={notebookPageStyle}");
  });
});
