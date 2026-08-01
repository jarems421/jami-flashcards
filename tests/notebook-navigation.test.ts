import { describe, expect, it } from "vitest";
import {
  buildNotebookPageSearch,
  getNotebookPageIdFromSearch,
} from "@/lib/workspace/notebook-navigation";
import { serializeNotebookInkSynchronously } from "@/lib/workspace/notebook-js-draw";

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

  it("keeps synchronous ink serialization available to exit saves", () => {
    const toSVG = () => ({ outerHTML: "<svg>saved ink</svg>" });

    expect(
      serializeNotebookInkSynchronously({ toSVG }, true, () => false)
    ).toBe("<svg>saved ink</svg>");
  });

  it("does not serialize ink while the page is unready or interacting", () => {
    const toSVG = () => ({ outerHTML: "<svg>saved ink</svg>" });

    expect(
      serializeNotebookInkSynchronously({ toSVG }, false, () => false)
    ).toBeNull();
    expect(
      serializeNotebookInkSynchronously({ toSVG }, true, () => true)
    ).toBeNull();
  });

  it("drops a snapshot if interaction starts during export", () => {
    let interacting = false;
    const toSVG = () => {
      interacting = true;
      return { outerHTML: "<svg>stale ink</svg>" };
    };

    expect(
      serializeNotebookInkSynchronously(
        { toSVG },
        true,
        () => interacting
      )
    ).toBeNull();
  });
});
