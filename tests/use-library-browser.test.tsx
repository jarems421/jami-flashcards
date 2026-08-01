// @vitest-environment jsdom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Source } from "@/lib/material/sources";
import {
  useLibraryBrowser,
  type LibraryBrowserController,
} from "@/hooks/useLibraryBrowser";

const sources = [
  {
    id: "source-1",
    title: "Wave notes",
    type: "manual_note",
    status: "active",
    folderIds: ["folder-1"],
    topicIds: [],
    createdBy: "user-1",
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: "source-2",
    title: "Archived paper",
    type: "file",
    status: "archived",
    folderIds: [],
    topicIds: [],
    createdBy: "user-1",
    createdAt: 1,
    updatedAt: 2,
  },
] satisfies Source[];

let container: HTMLDivElement;
let root: Root;
let browser: LibraryBrowserController;

function Harness({
  loading = false,
  onSelectionChange,
}: {
  loading?: boolean;
  onSelectionChange?: () => void;
}) {
  const value = useLibraryBrowser(sources, loading, onSelectionChange);
  useEffect(() => {
    browser = value;
  });
  return null;
}

async function render(search = "", onSelectionChange?: () => void) {
  window.history.replaceState({}, "", `/dashboard/library${search}`);
  await act(async () => {
    root.render(<Harness onSelectionChange={onSelectionChange} />);
    await Promise.resolve();
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.history.replaceState({}, "", "/");
});

describe("useLibraryBrowser", () => {
  it("hydrates filters, selection, and the mobile pane from the URL", async () => {
    await render("?status=all&type=file&source=source-2&q=paper");

    expect(browser.searchTerm).toBe("paper");
    expect(browser.typeFilter).toBe("file");
    expect(browser.statusFilter).toBe("all");
    expect(browser.selectedSource?.id).toBe("source-2");
    expect(browser.mobileTab).toBe("source");
  });

  it("keeps browser changes in the canonical Library URL", async () => {
    await render();
    await act(async () => {
      browser.setSearchTerm("waves");
      browser.setFolderFilter("folder-1");
      browser.setTypeFilter("manual_note");
      await Promise.resolve();
    });

    const params = new URLSearchParams(window.location.search);
    expect(params.get("q")).toBe("waves");
    expect(params.get("folder")).toBe("folder-1");
    expect(params.get("type")).toBe("manual_note");
    expect(params.has("status")).toBe(false);
  });

  it("moves selection to a real result when filters hide the old source", async () => {
    await render("?source=source-1&status=all");
    expect(browser.selectedSource?.id).toBe("source-1");

    await act(async () => {
      browser.setStatusFilter("archived");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(browser.selectedSource?.id).toBe("source-2");
    expect(browser.selectedSourceId).toBe("source-2");
  });

  it("reports automatic selection changes when a filter hides the source", async () => {
    const onSelectionChange = vi.fn();
    await render("?source=source-1&status=all", onSelectionChange);
    onSelectionChange.mockClear();

    await act(async () => {
      browser.setStatusFilter("archived");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(browser.selectedSource?.id).toBe("source-2");
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
  });

  it("reports an explicit source selection immediately", async () => {
    const onSelectionChange = vi.fn();
    await render("?source=source-1&status=all", onSelectionChange);
    onSelectionChange.mockClear();

    act(() => browser.selectSource("source-2"));

    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    expect(browser.selectedSource?.id).toBe("source-2");
  });

  it("clears every non-default filter together", async () => {
    await render("?q=paper&folder=folder-1&type=file&status=all");
    act(() => browser.clearFilters());

    expect(browser.searchTerm).toBe("");
    expect(browser.folderFilter).toBe("");
    expect(browser.typeFilter).toBe("all");
    expect(browser.statusFilter).toBe("active");
  });
});
