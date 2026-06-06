import { describe, expect, it } from "vitest";
import {
  buildLibraryBrowserSearch,
  DEFAULT_LIBRARY_BROWSER_STATE,
  getLibraryBrowserStateFromSearch,
} from "@/lib/study/library-navigation";

describe("Library browser URL state", () => {
  it("reads supported filters and ignores unsupported values", () => {
    expect(
      getLibraryBrowserStateFromSearch(
        "?q=cell&folder=science&type=file&subject=Biology&recent=1&status=archived&source=abc"
      )
    ).toEqual({
      search: "cell",
      folderId: "science",
      type: "file",
      subject: "Biology",
      recent: true,
      status: "archived",
      sourceId: "abc",
    });

    expect(
      getLibraryBrowserStateFromSearch("?type=video&status=deleted")
    ).toEqual(DEFAULT_LIBRARY_BROWSER_STATE);
  });

  it("omits defaults and preserves unrelated parameters", () => {
    expect(
      buildLibraryBrowserSearch("?agent=1", {
        ...DEFAULT_LIBRARY_BROWSER_STATE,
        search: "enzyme",
        recent: true,
      })
    ).toBe("?agent=1&q=enzyme&recent=1");

    expect(
      buildLibraryBrowserSearch(
        "?agent=1&q=old&type=file&status=all",
        DEFAULT_LIBRARY_BROWSER_STATE
      )
    ).toBe("?agent=1");
  });
});
