import { describe, expect, it } from "vitest";
import {
  MAX_PICTURED_NOTEBOOK_PAGES,
  findNamedNotebookPages,
  selectNotebookPicturedPageNumbers,
} from "@/lib/ai/notebook-page-handwriting";

const base = {
  currentPageNumber: 5,
  availablePageNumbers: [1, 2, 3, 4, 5, 6, 7, 8],
  currentPageHasQuestion: true,
  earlierPageHasQuestion: true,
  currentPageTextLength: 400,
};

describe("which other notebook pages Tutor is shown", () => {
  it("always shows the page either side", () => {
    expect(
      selectNotebookPicturedPageNumbers({ ...base, message: "How do I start this?" })
    ).toEqual([4, 6]);
  });

  it("puts a page the student names first, however far away", () => {
    expect(
      selectNotebookPicturedPageNumbers({ ...base, message: "help with the question on page 2" })
    ).toEqual([2, 4, 6]);
  });

  it("reaches further back when the work carries on from earlier", () => {
    expect(
      selectNotebookPicturedPageNumbers({
        ...base,
        message: "this continues from the previous page",
      })
    ).toEqual([4, 6, 3, 2]);
  });

  it("never shows the current page twice or exceeds the cap", () => {
    const pages = selectNotebookPicturedPageNumbers({
      ...base,
      message: "pages 1, 2 and 3 and page 5, continued from before",
    });
    expect(pages).not.toContain(5);
    expect(pages.length).toBeLessThanOrEqual(MAX_PICTURED_NOTEBOOK_PAGES);
    expect(pages.slice(0, 2)).toEqual([1, 2]);
  });
});

describe("reading page numbers out of a message", () => {
  const all = [1, 2, 3, 4, 5, 6, 7, 8];

  it("reads single pages, pairs, ranges and the first page", () => {
    expect(findNamedNotebookPages("on page 3", all)).toEqual([3]);
    expect(findNamedNotebookPages("p7 please", all)).toEqual([7]);
    expect(findNamedNotebookPages("pages 2 and 6", all)).toEqual([2, 6]);
    expect(findNamedNotebookPages("pages 2-4", all)).toEqual([2, 3, 4]);
    expect(findNamedNotebookPages("the question on the first page", all)).toEqual([1]);
  });

  it("ignores pages that do not exist and words that only end in p", () => {
    expect(findNamedNotebookPages("page 40", all)).toEqual([]);
    expect(findNamedNotebookPages("step 3 then group 2", all)).toEqual([]);
  });
});
