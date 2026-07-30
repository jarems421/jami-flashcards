import { describe, expect, it } from "vitest";
import {
  applyNotebookPageStateAction,
  INITIAL_NOTEBOOK_PAGE_STATE,
  isNotebookPageHydrated,
  notebookPageHasPendingWork,
  type NotebookPageState,
} from "@/lib/workspace/notebook-page-state";
import type { NotebookPage, NotebookTextBlock } from "@/lib/workspace/notebooks";

function page(id: string, contentRevision = 4): NotebookPage {
  return {
    id,
    notebookId: "notebook-1",
    pageNumber: 1,
    contentRevision,
  } as NotebookPage;
}

function textBlock(id: string): NotebookTextBlock {
  return { id, text: "note", x: 0, y: 0, width: 10, height: 10 } as NotebookTextBlock;
}

describe("applyNotebookPageStateAction", () => {
  it("returns the same object when nothing changes, so React can skip a render", () => {
    const state = INITIAL_NOTEBOOK_PAGE_STATE;
    expect(
      applyNotebookPageStateAction(state, {
        type: "setSaveStatus",
        saveStatus: "saved",
      })
    ).toBe(state);
    expect(
      applyNotebookPageStateAction(state, { type: "setTool", tool: "pen" })
    ).toBe(state);
    expect(applyNotebookPageStateAction(state, { type: "resetHydration" })).toBe(
      state
    );
  });

  it("moves hydratedPageId and contentRevision together", () => {
    const next = applyNotebookPageStateAction(INITIAL_NOTEBOOK_PAGE_STATE, {
      type: "hydratePage",
      pageId: "page-1",
      contentRevision: 7,
    });
    expect(next.hydratedPageId).toBe("page-1");
    expect(next.contentRevision).toBe(7);
  });

  it("clears hydration without disturbing the selected page", () => {
    const selected = applyNotebookPageStateAction(INITIAL_NOTEBOOK_PAGE_STATE, {
      type: "selectPage",
      page: page("page-1"),
    });
    const hydrated = applyNotebookPageStateAction(selected, {
      type: "hydratePage",
      pageId: "page-1",
      contentRevision: 4,
    });
    const reset = applyNotebookPageStateAction(hydrated, {
      type: "resetHydration",
    });
    expect(reset.hydratedPageId).toBeNull();
    expect(reset.selectedPage?.id).toBe("page-1");
    expect(reset.contentRevision).toBe(4);
  });

  it("keeps the chosen tool across a notebook change but drops page content", () => {
    let state = applyNotebookPageStateAction(INITIAL_NOTEBOOK_PAGE_STATE, {
      type: "setTool",
      tool: "highlighter",
    });
    state = applyNotebookPageStateAction(state, {
      type: "setTextBlocks",
      textBlocks: [textBlock("block-1")],
    });
    state = applyNotebookPageStateAction(state, {
      type: "setSaveStatus",
      saveStatus: "unsaved",
    });
    state = applyNotebookPageStateAction(state, {
      type: "hydratePage",
      pageId: "page-1",
      contentRevision: 9,
    });

    const reset = applyNotebookPageStateAction(state, {
      type: "resetForNotebookChange",
    });

    expect(reset.tool).toBe("highlighter");
    expect(reset.textBlocks).toEqual([]);
    expect(reset.saveStatus).toBe("saved");
    expect(reset.hydratedPageId).toBeNull();
    expect(reset.contentRevision).toBe(0);
  });

  it("treats each page appearance as a distinct selection", () => {
    const first = page("page-1");
    const selected = applyNotebookPageStateAction(INITIAL_NOTEBOOK_PAGE_STATE, {
      type: "selectPage",
      page: first,
    });
    // Same identity is a no-op; a refreshed object is not, because callers
    // depend on reading the newest page fields after a save.
    expect(
      applyNotebookPageStateAction(selected, { type: "selectPage", page: first })
    ).toBe(selected);
    const refreshed = applyNotebookPageStateAction(selected, {
      type: "selectPage",
      page: page("page-1", 5),
    });
    expect(refreshed).not.toBe(selected);
    expect(refreshed.selectedPage?.contentRevision).toBe(5);
  });
});

describe("notebook page state predicates", () => {
  it("only reports hydrated when the loaded page matches the selection", () => {
    const base: NotebookPageState = {
      ...INITIAL_NOTEBOOK_PAGE_STATE,
      selectedPage: page("page-1"),
    };
    expect(isNotebookPageHydrated(base)).toBe(false);
    expect(
      isNotebookPageHydrated({ ...base, hydratedPageId: "page-2" })
    ).toBe(false);
    expect(
      isNotebookPageHydrated({ ...base, hydratedPageId: "page-1" })
    ).toBe(true);
    expect(
      isNotebookPageHydrated({
        ...INITIAL_NOTEBOOK_PAGE_STATE,
        hydratedPageId: "page-1",
      })
    ).toBe(false);
  });

  it("counts unsaved and failed as work still worth flushing", () => {
    const withStatus = (saveStatus: NotebookPageState["saveStatus"]) =>
      notebookPageHasPendingWork({
        ...INITIAL_NOTEBOOK_PAGE_STATE,
        saveStatus,
      });
    expect(withStatus("unsaved")).toBe(true);
    expect(withStatus("failed")).toBe(true);
    expect(withStatus("saved")).toBe(false);
    expect(withStatus("saving")).toBe(false);
  });
});
