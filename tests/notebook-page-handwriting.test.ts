import { describe, expect, it } from "vitest";
import {
  MAX_NEIGHBOUR_HANDWRITING_PAGES,
  selectNeighbourHandwritingPages,
} from "@/lib/ai/notebook-page-handwriting";

const base = {
  currentPageNumber: 5,
  availablePageNumbers: [1, 2, 3, 4, 5, 6, 7, 8],
  currentPageHasQuestion: true,
  earlierPageHasQuestion: true,
  currentPageTextLength: 400,
};

describe("deciding when Jami needs a neighbouring page's handwriting", () => {
  it("asks for nothing on an ordinary question about this page", () => {
    expect(
      selectNeighbourHandwritingPages({
        ...base,
        message: "Is my working for part ii correct?",
      })
    ).toBeNull();
  });

  it("reads backwards when the student says the work continues", () => {
    const request = selectNeighbourHandwritingPages({
      ...base,
      message: "This is carried on from the previous page, is it right?",
    });

    expect(request?.reason).toBe("continuation_phrase");
    expect(request?.pageNumbers).toEqual([4, 3, 2]);
  });

  it("never asks for more than the cap", () => {
    const request = selectNeighbourHandwritingPages({
      ...base,
      message: "continued from earlier",
    });

    expect(request?.pageNumbers.length).toBeLessThanOrEqual(
      MAX_NEIGHBOUR_HANDWRITING_PAGES
    );
  });

  it("falls forward only when there is nothing behind", () => {
    const request = selectNeighbourHandwritingPages({
      ...base,
      currentPageNumber: 1,
      message: "I continued this on the next page",
    });

    expect(request?.pageNumbers).toEqual([2, 3, 4]);
  });

  it("reads back for the question when this page only has working", () => {
    const request = selectNeighbourHandwritingPages({
      ...base,
      message: "Remind me what I was doing",
      currentPageHasQuestion: false,
      earlierPageHasQuestion: true,
    });

    expect(request?.reason).toBe("question_elsewhere");
    expect(request?.pageNumbers).toEqual([4, 3]);
  });

  it("checks one page back when the current page is nearly empty", () => {
    const request = selectNeighbourHandwritingPages({
      ...base,
      message: "Where had I got to?",
      currentPageTextLength: 0,
    });

    expect(request?.reason).toBe("sparse_current_page");
    expect(request?.pageNumbers).toEqual([4]);
  });

  it("asks for nothing when the notebook has no other pages", () => {
    expect(
      selectNeighbourHandwritingPages({
        ...base,
        currentPageNumber: 1,
        availablePageNumbers: [1],
        message: "continued from the previous page",
      })
    ).toBeNull();
  });

  it("skips page numbers the notebook does not have", () => {
    const request = selectNeighbourHandwritingPages({
      ...base,
      currentPageNumber: 5,
      availablePageNumbers: [1, 5, 6],
      message: "carried on from before",
    });

    // 4, 3 and 2 do not exist, so it takes what is actually there.
    expect(request?.pageNumbers).toEqual([6]);
  });

  it("takes the page behind for a marking request, which is the whole point", () => {
    // Working started at the bottom of page 4 and finished on page 5. Marking
    // page 5 alone reports errors that are not there.
    for (const message of [
      "Mark this please",
      "Can you check my working?",
      "Is this right?",
      "Where did I go wrong?",
    ]) {
      const request = selectNeighbourHandwritingPages({ ...base, message });
      expect(request?.reason).toBe("marking_request");
      expect(request?.pageNumbers).toEqual([4]);
    }
  });

  it("does not fire on questions answerable from this page alone", () => {
    for (const message of [
      "Draw me a diagram of this",
      "Explain the second line",
      "What does the discriminant tell me?",
    ]) {
      expect(
        selectNeighbourHandwritingPages({ ...base, message })
      ).toBeNull();
    }
  });
});
