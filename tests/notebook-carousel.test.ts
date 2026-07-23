import { describe, expect, it } from "vitest";
import {
  isNotebookPageSwipePreviewEnabled,
  resolveNotebookCarouselPages,
  shouldShowNotebookNewPagePreview,
  type NotebookPageSwipeMotion,
} from "@/lib/workspace/notebook-carousel";
import type { NotebookPage } from "@/lib/workspace/notebooks";

function makePage(id: string): NotebookPage {
  return {
    id,
    notebookId: "notebook-1",
    folderId: "folder-1",
    pageNumber: Number(id.slice(-1)) || 1,
    pageType: "blank",
    textBlocks: [],
    imageRefs: [],
    pageColor: "white",
    pageStyle: "plain",
    status: "blank",
    contentRevision: 0,
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeMotion(
  overrides: Partial<NotebookPageSwipeMotion> = {}
): NotebookPageSwipeMotion {
  return {
    phase: "settling",
    kind: "page",
    direction: "next",
    targetPage: makePage("page-3"),
    targetOffset: -400,
    durationMs: 200,
    ...overrides,
  };
}

describe("notebook carousel state", () => {
  it("uses ordinary adjacent pages while the track is idle", () => {
    const previousPage = makePage("page-1");
    const nextPage = makePage("page-3");
    expect(
      resolveNotebookCarouselPages({ motion: null, previousPage, nextPage })
    ).toEqual({ previousPage, nextPage });
  });

  it("freezes the incoming page in its physical slot during handoff", () => {
    const targetPage = makePage("page-3");
    expect(
      resolveNotebookCarouselPages({
        motion: makeMotion({ phase: "handoff", targetPage }),
        previousPage: makePage("page-1"),
        nextPage: null,
      })
    ).toEqual({ previousPage: null, nextPage: targetPage });

    expect(
      resolveNotebookCarouselPages({
        motion: makeMotion({
          phase: "handoff",
          direction: "previous",
          targetPage,
        }),
        previousPage: null,
        nextPage: makePage("page-4"),
      })
    ).toEqual({ previousPage: targetPage, nextPage: null });
  });

  it("reserves the next slot for a page-creation preview while settling", () => {
    expect(
      resolveNotebookCarouselPages({
        motion: makeMotion({ kind: "create" }),
        previousPage: makePage("page-1"),
        nextPage: makePage("page-3"),
      }).nextPage
    ).toBeNull();
  });

  it("only previews page swipes at fitted or undersized zoom", () => {
    expect(isNotebookPageSwipePreviewEnabled(0.92)).toBe(true);
    expect(isNotebookPageSwipePreviewEnabled(1.0001)).toBe(true);
    expect(isNotebookPageSwipePreviewEnabled(1.01)).toBe(false);
  });

  it("shows a new-page sheet only at the editable end of the notebook", () => {
    const base = {
      previewEnabled: true,
      hasNextPage: false,
      createPageActive: false,
      creatingPage: false,
      motionKind: null,
      fullEditingEnabled: true,
      selectedPageIndex: 2,
      pageCount: 3,
    } as const;
    expect(shouldShowNotebookNewPagePreview(base)).toBe(true);
    expect(
      shouldShowNotebookNewPagePreview({ ...base, hasNextPage: true })
    ).toBe(false);
    expect(
      shouldShowNotebookNewPagePreview({
        ...base,
        fullEditingEnabled: false,
        motionKind: "create",
      })
    ).toBe(true);
    expect(
      shouldShowNotebookNewPagePreview({ ...base, previewEnabled: false })
    ).toBe(false);
  });
});
