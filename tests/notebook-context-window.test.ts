import { describe, expect, it } from "vitest";
import {
  getNotebookContextPageTextLimit,
  NOTEBOOK_CONTEXT_WINDOW_RADIUS,
  selectNotebookContextWindow,
} from "@/lib/ai/notebook-context-window";

const pages = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `page-${index + 1}`,
    pageNumber: index + 1,
  }));

describe("choosing which notebook pages Jami is told about", () => {
  it("takes three either side of the current page", () => {
    const { nearby, distant } = selectNotebookContextWindow(
      pages(20),
      "page-10"
    );

    expect(nearby.map((page) => page.pageNumber)).toEqual([
      7, 8, 9, 10, 11, 12, 13,
    ]);
    expect(distant.map((page) => page.pageNumber)).not.toContain(9);
    expect(distant.map((page) => page.pageNumber)).toContain(1);
    expect(nearby.length + distant.length).toBe(20);
  });

  it("does not run off the start or the end", () => {
    expect(
      selectNotebookContextWindow(pages(20), "page-1").nearby.map(
        (page) => page.pageNumber
      )
    ).toEqual([1, 2, 3, 4]);
    expect(
      selectNotebookContextWindow(pages(20), "page-20").nearby.map(
        (page) => page.pageNumber
      )
    ).toEqual([17, 18, 19, 20]);
  });

  it("treats a short notebook as entirely nearby", () => {
    const { nearby, distant } = selectNotebookContextWindow(pages(3), "page-2");

    expect(nearby).toHaveLength(3);
    expect(distant).toHaveLength(0);
  });

  it("counts neighbours by position, so gaps in numbering do not shrink it", () => {
    const sparse = [
      { id: "a", pageNumber: 1 },
      { id: "b", pageNumber: 40 },
      { id: "c", pageNumber: 41 },
      { id: "d", pageNumber: 90 },
    ];

    expect(
      selectNotebookContextWindow(sparse, "c").nearby.map((page) => page.id)
    ).toEqual(["a", "b", "c", "d"]);
  });

  it("orders by page number rather than however the pages arrived", () => {
    const shuffled = [
      { id: "page-3", pageNumber: 3 },
      { id: "page-1", pageNumber: 1 },
      { id: "page-2", pageNumber: 2 },
    ];

    expect(
      selectNotebookContextWindow(shuffled, "page-1").nearby.map(
        (page) => page.pageNumber
      )
    ).toEqual([1, 2, 3]);
  });

  it("claims nothing is nearby when the current page was not loaded", () => {
    // A notebook longer than the page limit. Describing an arbitrary slice as
    // adjacent would be worse than saying nothing is.
    const { nearby, distant } = selectNotebookContextWindow(
      pages(5),
      "page-not-loaded"
    );

    expect(nearby).toHaveLength(0);
    expect(distant).toHaveLength(5);
  });

  it("gives a nearby page far more room than a distant one", () => {
    expect(getNotebookContextPageTextLimit(true)).toBeGreaterThan(
      getNotebookContextPageTextLimit(false) * 4
    );
    expect(NOTEBOOK_CONTEXT_WINDOW_RADIUS).toBe(3);
  });
});
