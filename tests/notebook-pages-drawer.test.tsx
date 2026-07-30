// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotebookPagesDrawer } from "@/components/workspace/NotebookPagesDrawer";
import type { Notebook, NotebookPage } from "@/lib/workspace/notebooks";

vi.mock("@/components/workspace/NotebookPageThumbnail", () => ({
  default: ({ page }: { page: NotebookPage }) => (
    <div data-thumbnail-page={page.id} />
  ),
}));

const NOTEBOOK = { id: "notebook-1", title: "Physics" } as Notebook;

function page(id: string, pageNumber: number): NotebookPage {
  return { id, notebookId: "notebook-1", pageNumber } as NotebookPage;
}

let container: HTMLDivElement;
let root: Root;

const onSelectPage = vi.fn();
const onCreatePage = vi.fn();
const onImportPages = vi.fn();
const onRequestDeletePage = vi.fn();

function render(
  overrides: Partial<{
    pages: NotebookPage[];
    selectedPageId: string | null;
    deletingPageId: string | null;
    editingEnabled: boolean;
    creatingPage: boolean;
    navigationBusy: boolean;
  }> = {}
) {
  act(() => {
    root.render(
      <NotebookPagesDrawer
        pages={overrides.pages ?? [page("p1", 1), page("p2", 2)]}
        notebook={NOTEBOOK}
        selectedPageId={
          overrides.selectedPageId === undefined
            ? "p1"
            : overrides.selectedPageId
        }
        deletingPageId={overrides.deletingPageId ?? null}
        editingEnabled={overrides.editingEnabled ?? true}
        creatingPage={overrides.creatingPage ?? false}
        navigationBusy={overrides.navigationBusy ?? false}
        resolvePageBackground={() => ({ file: null, url: undefined })}
        onSelectPage={onSelectPage}
        onCreatePage={onCreatePage}
        onImportPages={onImportPages}
        onRequestDeletePage={onRequestDeletePage}
      />
    );
  });
}

function byLabel(label: string) {
  return container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
}

function click(label: string) {
  const el = byLabel(label);
  if (!el) throw new Error(`no control labelled ${label}`);
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  onSelectPage.mockClear();
  onCreatePage.mockClear();
  onImportPages.mockClear();
  onRequestDeletePage.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe("NotebookPagesDrawer", () => {
  it("lists every page and marks the open one", () => {
    render({ selectedPageId: "p2" });
    expect(container.querySelectorAll("[data-thumbnail-page]")).toHaveLength(2);
    expect(byLabel("Open page 2")?.getAttribute("aria-current")).toBe("page");
    expect(byLabel("Open page 1")?.getAttribute("aria-current")).toBeNull();
  });

  it("reports the page the student picked", () => {
    render();
    click("Open page 2");
    expect(onSelectPage).toHaveBeenCalledWith("p2");
  });

  it("offers no delete when only one page is left", () => {
    render({ pages: [page("p1", 1)] });
    expect(byLabel("Delete Page 1")).toBeNull();
  });

  it("asks before deleting rather than deleting outright", () => {
    render();
    click("Delete Page 2");
    expect(onRequestDeletePage).toHaveBeenCalledTimes(1);
    expect(onRequestDeletePage.mock.calls[0]?.[0]?.id).toBe("p2");
    // Selecting the page must not fire from the same click.
    expect(onSelectPage).not.toHaveBeenCalled();
  });

  it("locks page controls while a swipe is settling", () => {
    render({ navigationBusy: true });
    expect(byLabel("Open page 1")?.disabled).toBe(true);
    expect(byLabel("Delete Page 2")?.disabled).toBe(true);
  });

  it("locks every delete while one is in flight", () => {
    render({ deletingPageId: "p1" });
    expect(byLabel("Delete Page 1")?.disabled).toBe(true);
    expect(byLabel("Delete Page 2")?.disabled).toBe(true);
  });

  it("hides editing actions in read-only mode", () => {
    render({ editingEnabled: false });
    const create = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("New page")
    );
    const importPages = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Import PDF or image")
    );
    expect(create?.disabled).toBe(true);
    expect(importPages?.disabled).toBe(true);
  });

  it("invites the student to start a page when the notebook is empty", () => {
    render({ pages: [], selectedPageId: null });
    expect(container.textContent).toContain("Start with a fresh page");
    expect(container.querySelectorAll("[data-thumbnail-page]")).toHaveLength(0);
  });

  it("keeps the page list clear of the device safe area", () => {
    render();
    const list = container.querySelector('[role="region"]') as HTMLElement;
    expect(list.className).toContain("env(safe-area-inset-bottom");
  });
});
