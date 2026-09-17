import { describe, expect, it } from "vitest";
import {
  EXAM_SHEET_A4_PAGE_HEIGHT,
  EXAM_SHEET_MAX_CONTINUATION_PAGES,
  EXAM_SHEET_MAX_PAGES,
  EXAM_SHEET_PAGE_WIDTH,
  examSheetContinuationRoom,
  examSheetOpeningContinuations,
  examSheetPageAssetId,
  examSheetPageAssetNumber,
  examSheetPageCaption,
  examSheetPages,
  examSheetPrintedPages,
} from "@/lib/practice/exam-question-sheet";
import {
  answerSpacePagesAfter,
  mergeAdjacentRegions,
  regionsForQuestion,
  type PdfPageText,
} from "@/lib/practice/exam-page-regions";
import type { PracticePaperQuestionAsset } from "@/lib/practice/practice-papers";

function pageAsset(number: number, size: { width: number; height: number }) {
  return {
    id: examSheetPageAssetId(number - 1),
    type: "image",
    title: `Page ${number}`,
    content: "",
    altText: `Page ${number}`,
    width: size.width,
    height: size.height,
  } as PracticePaperQuestionAsset;
}

const A4 = { width: 1428, height: 2020 };

describe("which assets make a sheet", () => {
  it("reads the pages in printed order rather than stored order", () => {
    const assets = [
      { id: "question-extract", type: "image", title: "", content: "", altText: "", width: 10, height: 10 },
      pageAsset(10, A4),
      pageAsset(2, A4),
      pageAsset(1, A4),
    ] as PracticePaperQuestionAsset[];
    expect(examSheetPrintedPages({ assets }).map((asset) => asset.id)).toEqual([
      "question-page-1",
      "question-page-2",
      "question-page-10",
    ]);
  });

  it("ignores a page with no dimensions, which cannot be given a shape", () => {
    const assets = [
      { ...pageAsset(1, A4), width: undefined, height: undefined },
      pageAsset(2, A4),
    ] as PracticePaperQuestionAsset[];
    expect(examSheetPrintedPages({ assets })).toHaveLength(1);
  });

  it.each(["question-extract", "scheme-extract", "question-page-0", "question-page-99"])(
    "does not mistake %s for a page of the sheet",
    (id) => {
      expect(examSheetPageAssetNumber(id)).toBeNull();
    }
  );
});

describe("the shape of a sheet", () => {
  it("keeps each printed page's own proportions at the sheet's width", () => {
    const pages = examSheetPages({
      // A first page that is a third of a sheet: the question started low down.
      printedPages: [pageAsset(1, { width: 1428, height: 700 }), pageAsset(2, A4)],
      continuationCount: 0,
    });
    expect(pages).toHaveLength(2);
    expect(pages[0]).toMatchObject({ kind: "printed", width: EXAM_SHEET_PAGE_WIDTH });
    expect(pages[0].height).toBeCloseTo((EXAM_SHEET_PAGE_WIDTH * 700) / 1428, 0);
    expect(pages[1].height).toBeCloseTo((EXAM_SHEET_PAGE_WIDTH * 2020) / 1428, 0);
  });

  it("gives a question with no paper one blank page of its own", () => {
    const pages = examSheetPages({ printedPages: [], continuationCount: 0 });
    expect(pages).toEqual([
      {
        kind: "continuation",
        number: 1,
        width: EXAM_SHEET_PAGE_WIDTH,
        height: EXAM_SHEET_A4_PAGE_HEIGHT,
      },
    ]);
  });

  it("never grows past the pages a submission can carry", () => {
    const printedPages = Array.from({ length: 12 }, (_unused, index) => pageAsset(index + 1, A4));
    const pages = examSheetPages({ printedPages, continuationCount: 40 });
    expect(pages.length).toBeLessThanOrEqual(EXAM_SHEET_MAX_PAGES);
    expect(examSheetContinuationRoom(12)).toBe(EXAM_SHEET_MAX_PAGES - 12);
  });
});

/**
 * The room a student opens with, which is the room the board left them.
 *
 * Mid-paper questions need none: their answer lines sit between their own
 * label and the next question's, so the crop already carries every one.
 */
describe("room to answer in", () => {
  it("restores the ruled pages the crop dropped", () => {
    expect(examSheetOpeningContinuations({ answerSpacePages: 6, printedPageCount: 2 })).toBe(6);
  });

  it("opens flush with the paper when the paper left no extra room", () => {
    expect(examSheetOpeningContinuations({ answerSpacePages: 0, printedPageCount: 3 })).toBe(0);
    expect(examSheetOpeningContinuations({ printedPageCount: 3 })).toBe(0);
  });

  it("opens a question with no paper on a single blank page", () => {
    expect(examSheetOpeningContinuations({ printedPageCount: 0 })).toBe(1);
  });

  it("bounds a paper whose end matter was never found", () => {
    expect(examSheetOpeningContinuations({ answerSpacePages: 30, printedPageCount: 1 })).toBe(
      EXAM_SHEET_MAX_CONTINUATION_PAGES
    );
  });
});

describe("telling the marker which page is which", () => {
  const printed = { kind: "printed" as const, number: 2 };
  it("names the printed page the ink was written on", () => {
    expect(
      examSheetPageCaption({ page: printed, questionLabel: "04.1", printedPageCount: 3 })
    ).toBe("04.1 — written on printed page 2 of 3");
  });

  it("does not count pages when there is only one", () => {
    expect(
      examSheetPageCaption({
        page: { kind: "printed", number: 1 },
        questionLabel: "7",
        printedPageCount: 1,
      })
    ).toBe("7 — written on the printed page");
  });

  it("says when an answer ran past the room the paper left", () => {
    expect(
      examSheetPageCaption({
        page: { kind: "continuation", number: 1 },
        questionLabel: "5",
        printedPageCount: 2,
      })
    ).toBe("5 — extra answer sheet 1");
  });
});

/* --- what ingestion measures -------------------------------------------- */

function prosePage(page: number): PdfPageText {
  return {
    page,
    width: 595,
    height: 842,
    items: [
      { text: "Explain how the writer uses language here", x: 80, y: 700, height: 11 },
      { text: "to describe the approaching storm and its", x: 80, y: 680, height: 11 },
    ],
  };
}

/** Ruled answer space: a box instruction, a page number and rows of dots. */
function ruledPage(page: number): PdfPageText {
  return {
    page,
    width: 595,
    height: 842,
    items: [
      { text: "12", x: 300, y: 40, height: 9 },
      { text: "..........................................", x: 80, y: 700, height: 9 },
      { text: "..........................................", x: 80, y: 660, height: 9 },
    ],
  };
}

function endPage(page: number): PdfPageText {
  return {
    page,
    width: 595,
    height: 842,
    items: [{ text: "END OF QUESTIONS", x: 250, y: 500, height: 11 }],
  };
}

describe("the answer space a paper leaves after its last question", () => {
  const starts = [
    { label: "4", page: 1, top: 120 },
    { label: "5", page: 2, top: 100 },
  ];
  const pages = [prosePage(1), prosePage(2), ruledPage(3), ruledPage(4), ruledPage(5), endPage(6)];

  it("counts the ruled pages the crop deliberately stops short of", () => {
    expect(answerSpacePagesAfter({ label: "5", starts, pages })).toBe(3);
    /*
     * The two have to agree: a page inside the crop is not also answer space,
     * or the last question would be given its own printed pages twice.
     */
    const regions = regionsForQuestion({ label: "5", starts, pages });
    expect(regions.every((region) => region.page <= 2)).toBe(true);
  });

  it("gives a mid-paper question nothing, because its crop already has it", () => {
    expect(answerSpacePagesAfter({ label: "4", starts, pages })).toBe(0);
  });

  it("stops where the paper says it has finished asking", () => {
    expect(
      answerSpacePagesAfter({
        label: "5",
        starts,
        pages: [prosePage(1), prosePage(2), ruledPage(3), endPage(4), ruledPage(5)],
      })
    ).toBe(1);
  });
});

describe("slices of one page", () => {
  it("joins a stem to the part printed under it", () => {
    expect(
      mergeAdjacentRegions([
        { page: 3, fromRatio: 0.1, toRatio: 0.4 },
        { page: 3, fromRatio: 0.4, toRatio: 0.7 },
      ])
    ).toEqual([{ page: 3, fromRatio: 0.1, toRatio: 0.7 }]);
  });

  it("leaves slices that are genuinely apart alone", () => {
    const regions = [
      { page: 3, fromRatio: 0.1, toRatio: 0.3 },
      { page: 3, fromRatio: 0.6, toRatio: 0.9 },
      { page: 4, fromRatio: 0, toRatio: 0.5 },
    ];
    expect(mergeAdjacentRegions(regions)).toEqual(regions);
  });
});
