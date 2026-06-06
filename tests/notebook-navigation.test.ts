import { describe, expect, it } from "vitest";
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
});
