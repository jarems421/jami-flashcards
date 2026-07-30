// @vitest-environment jsdom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  useNotebookPageState,
  type UseNotebookPageStateResult,
} from "@/hooks/useNotebookPageState";
import type { NotebookPage, NotebookTextBlock } from "@/lib/workspace/notebooks";

let container: HTMLDivElement;
let root: Root;
let store: UseNotebookPageStateResult["store"];
let snapshot: UseNotebookPageStateResult["state"];
let renderCount = 0;

function page(id: string, contentRevision = 1): NotebookPage {
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

function Harness() {
  const value = useNotebookPageState();
  useEffect(() => {
    // One commit per render, which is what the re-render assertions measure.
    renderCount += 1;
    store = value.store;
    snapshot = value.state;
  });
  return null;
}

beforeEach(() => {
  renderCount = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root.render(<Harness />);
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe("useNotebookPageState", () => {
  it("exposes a stable write surface across renders", () => {
    const first = store;
    act(() => {
      store.setSaveStatus("unsaved");
    });
    // The store object itself must keep its identity: it sits in dependency
    // arrays across the notebook page, and a new object every render would
    // rebuild every callback that reads page state.
    expect(store).toBe(first);
    expect(store.setSaveStatus).toBe(first.setSaveStatus);
    expect(store.dispatch).toBe(first.dispatch);
    expect(store.read).toBe(first.read);
  });

  it("makes a write visible to read() before React re-renders", () => {
    let observedDuringWrite: string | undefined;
    act(() => {
      store.setSaveStatus("saving");
      // A handler continuing after the write must not see the old value.
      observedDuringWrite = store.read().saveStatus;
    });
    expect(observedDuringWrite).toBe("saving");
    expect(snapshot.saveStatus).toBe("saving");
  });

  it("keeps read() and the rendered snapshot in agreement", () => {
    act(() => {
      store.setPageColor("black");
      store.setPageStyle("lined");
      store.setTool("highlighter");
    });
    expect(store.read()).toEqual(snapshot);
    expect(snapshot.pageColor).toBe("black");
    expect(snapshot.pageStyle).toBe("lined");
    expect(snapshot.tool).toBe("highlighter");
  });

  it("supports functional text block updates against the newest value", () => {
    act(() => {
      store.setTextBlocks([textBlock("block-1")]);
    });
    act(() => {
      store.setTextBlocks((previous) => [...previous, textBlock("block-2")]);
      // Two updates in the same handler must compose, not clobber.
      store.setTextBlocks((previous) => [...previous, textBlock("block-3")]);
    });
    expect(store.read().textBlocks.map((block) => block.id)).toEqual([
      "block-1",
      "block-2",
      "block-3",
    ]);
    expect(snapshot.textBlocks).toHaveLength(3);
  });

  it("does not re-render when a write changes nothing", () => {
    act(() => {
      store.setSaveStatus("unsaved");
    });
    const rendersAfterChange = renderCount;
    act(() => {
      store.setSaveStatus("unsaved");
      store.setTool("pen");
    });
    expect(renderCount).toBe(rendersAfterChange);
  });

  it("moves hydration and content revision together", () => {
    act(() => {
      store.selectPage(page("page-1", 3));
      store.hydratePage("page-1", 3);
    });
    expect(store.read().hydratedPageId).toBe("page-1");
    expect(store.read().contentRevision).toBe(3);

    act(() => {
      store.resetHydration();
    });
    expect(store.read().hydratedPageId).toBeNull();
    expect(store.read().selectedPage?.id).toBe("page-1");
  });

  it("clears page content but keeps the tool when the notebook changes", () => {
    act(() => {
      store.setTool("eraser");
      store.setTextBlocks([textBlock("block-1")]);
      store.setSaveStatus("failed");
      store.hydratePage("page-1", 2);
    });

    act(() => {
      store.resetForNotebookChange();
    });

    const state = store.read();
    expect(state.tool).toBe("eraser");
    expect(state.textBlocks).toEqual([]);
    expect(state.saveStatus).toBe("saved");
    expect(state.hydratedPageId).toBeNull();
    expect(state.selectedPage).toBeNull();
  });
});
