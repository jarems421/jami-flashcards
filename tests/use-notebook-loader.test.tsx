// @vitest-environment jsdom

import { act, useCallback, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNotebookLoader, type NotebookLoader } from "@/hooks/useNotebookLoader";
import { useNotebookPageState } from "@/hooks/useNotebookPageState";
import type { Feedback } from "@/lib/app/feedback";
import type { NotebookPage } from "@/lib/workspace/notebooks";

const getNotebookById = vi.fn();
const getNotebookPages = vi.fn();
const getNotebookFiles = vi.fn();
const readNotebookPageDraft = vi.fn();
const deleteNotebookPageDraft = vi.fn();
const writeNotebookPageDraft = vi.fn();
const getNotebookDraftDecision = vi.fn();
const getNotebookFileDownloadUrl = vi.fn();
// Pages in these fixtures already carry whatever ink they have, so the real
// service would return them untouched.
const getNotebookPageWithInk = vi.fn((_userId: unknown, page: unknown) => page);

vi.mock("@/services/study/notebooks", () => ({
  getNotebookById: (...a: unknown[]) => getNotebookById(...a),
  getNotebookPages: (...a: unknown[]) => getNotebookPages(...a),
  getNotebookFiles: (...a: unknown[]) => getNotebookFiles(...a),
  getNotebookPageWithInk: (userId: unknown, page: unknown) =>
    getNotebookPageWithInk(userId, page),
}));

vi.mock("@/services/study/notebook-files", () => ({
  getNotebookFileDownloadUrl: (...a: unknown[]) =>
    getNotebookFileDownloadUrl(...a),
}));

vi.mock("@/lib/workspace/notebook-drafts", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/workspace/notebook-drafts")
  >("@/lib/workspace/notebook-drafts");
  return {
    ...actual,
    readNotebookPageDraft: (...a: unknown[]) => readNotebookPageDraft(...a),
    deleteNotebookPageDraft: (...a: unknown[]) => deleteNotebookPageDraft(...a),
    writeNotebookPageDraft: (...a: unknown[]) => writeNotebookPageDraft(...a),
    getNotebookDraftDecision: (...a: unknown[]) =>
      getNotebookDraftDecision(...a),
  };
});

const NOTEBOOK = { id: "notebook-1", title: "Physics" };
const PAGE_ONE = {
  id: "page-1",
  notebookId: "notebook-1",
  pageNumber: 1,
  contentRevision: 5,
  updatedAt: 1000,
} as NotebookPage;
const DRAFT = {
  version: 1,
  userId: "user-1",
  notebookId: "notebook-1",
  pageId: "page-1",
  baseContentRevision: 4,
  remoteUpdatedAt: 900,
  localRevision: 7,
  savedAt: 950,
  textBlocks: [],
  inkSvg: "<svg data-draft='true' />",
  pageColor: "white",
  pageStyle: "plain",
  status: "working",
} as const;

let container: HTMLDivElement;
let root: Root;
let loader: NotebookLoader;
let feedback: Feedback | null;
const onBeforeLoad = vi.fn();
const onDraftRestored = vi.fn();

function Harness() {
  const { store: pageState } = useNotebookPageState();
  const value = useNotebookLoader({
    userId: "user-1",
    notebookId: "notebook-1",
    pageState,
    onFeedback: useCallback((next: Feedback | null) => {
      feedback = next;
    }, []),
    onBeforeLoad,
    onDraftRestored,
  });
  useEffect(() => {
    loader = value;
  });
  return null;
}

async function mount() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<Harness />);
  });
}

beforeEach(() => {
  feedback = null;
  onBeforeLoad.mockClear();
  onDraftRestored.mockClear();
  getNotebookById.mockReset().mockResolvedValue(NOTEBOOK);
  getNotebookPages.mockReset().mockResolvedValue([PAGE_ONE]);
  getNotebookFiles.mockReset().mockResolvedValue([]);
  readNotebookPageDraft.mockReset().mockResolvedValue(null);
  deleteNotebookPageDraft.mockReset().mockResolvedValue(undefined);
  writeNotebookPageDraft.mockReset().mockResolvedValue(undefined);
  getNotebookDraftDecision.mockReset().mockReturnValue("discard");
  getNotebookFileDownloadUrl.mockReset().mockResolvedValue("https://cdn/img");
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe("useNotebookLoader", () => {
  it("loads the notebook and selects its first page", async () => {
    await mount();
    expect(loader.notebook?.id).toBe("notebook-1");
    expect(loader.pages).toHaveLength(1);
    expect(loader.selectedPageId).toBe("page-1");
    expect(loader.loading).toBe(false);
    expect(onBeforeLoad).toHaveBeenCalledTimes(1);
  });

  it("still opens the notebook when pages fail to load", async () => {
    getNotebookPages.mockRejectedValue(new Error("offline"));
    await mount();
    expect(loader.notebook?.id).toBe("notebook-1");
    expect(loader.pages).toEqual([]);
    expect(feedback?.type).toBe("error");
    expect(loader.loading).toBe(false);
  });

  it("surfaces a load failure instead of hanging on the spinner", async () => {
    getNotebookById.mockRejectedValue(new Error("no network"));
    await mount();
    expect(feedback?.message).toBe("no network");
    expect(loader.loading).toBe(false);
  });

  it("discards a stale draft without disturbing the page", async () => {
    readNotebookPageDraft.mockResolvedValue(DRAFT);
    getNotebookDraftDecision.mockReturnValue("discard");
    await mount();
    expect(deleteNotebookPageDraft).toHaveBeenCalledTimes(1);
    expect(loader.draftConflict).toBeNull();
    expect(loader.takeRecoveredDraft("page-1")).toBeNull();
  });

  it("hands a restored draft to the page that owns it, once", async () => {
    readNotebookPageDraft.mockResolvedValue(DRAFT);
    getNotebookDraftDecision.mockReturnValue("restore");
    await mount();

    expect(loader.takeRecoveredDraft("page-2")).toBeNull();
    const recovered = loader.takeRecoveredDraft("page-1");
    expect(recovered?.localRevision).toBe(7);
    // Consumed: a re-render must not replay the recovery.
    expect(loader.takeRecoveredDraft("page-1")).toBeNull();
  });

  it("raises a conflict for the student to resolve", async () => {
    readNotebookPageDraft.mockResolvedValue(DRAFT);
    getNotebookDraftDecision.mockReturnValue("conflict");
    await mount();
    expect(loader.draftConflict?.pageId).toBe("page-1");
    expect(deleteNotebookPageDraft).not.toHaveBeenCalled();
  });

  it("rebases the draft onto the served page when restoring a conflict", async () => {
    readNotebookPageDraft.mockResolvedValue(DRAFT);
    getNotebookDraftDecision.mockReturnValue("conflict");
    await mount();

    await act(async () => {
      loader.restoreLocalDraft();
    });

    expect(onDraftRestored).toHaveBeenCalledTimes(1);
    expect(loader.draftConflict).toBeNull();
    // The rebased draft must carry the revision that came back from the server.
    const written = writeNotebookPageDraft.mock.calls[0]?.[0];
    expect(written.baseContentRevision).toBe(5);
    expect(written.remoteUpdatedAt).toBe(1000);
    expect(loader.takeRecoveredDraft("page-1")?.localRevision).toBe(7);
  });

  it("deletes the draft when the student keeps the synced version", async () => {
    readNotebookPageDraft.mockResolvedValue(DRAFT);
    getNotebookDraftDecision.mockReturnValue("conflict");
    await mount();

    await act(async () => {
      loader.keepSavedVersion();
    });

    expect(deleteNotebookPageDraft).toHaveBeenCalledTimes(1);
    expect(loader.draftConflict).toBeNull();
    expect(feedback?.type).toBe("success");
  });

  it("resolves download URLs for image backgrounds only", async () => {
    getNotebookFiles.mockResolvedValue([
      { id: "img", fileType: "image/png", storagePath: "a.png" },
      { id: "pdf", fileType: "application/pdf", storagePath: "b.pdf" },
    ]);
    await mount();
    await act(async () => {});

    expect(getNotebookFileDownloadUrl).toHaveBeenCalledTimes(1);
    expect(loader.fileUrls).toEqual({ img: "https://cdn/img" });
    expect(loader.resolvedImageFileIds).toEqual({ img: true });
  });

  it("marks an image as resolved even when its URL cannot be fetched", async () => {
    getNotebookFiles.mockResolvedValue([
      { id: "img", fileType: "image/png", storagePath: "a.png" },
    ]);
    getNotebookFileDownloadUrl.mockRejectedValue(new Error("gone"));
    await mount();
    await act(async () => {});

    // A missing image must read as settled, or the page waits on it forever.
    expect(loader.fileUrls).toEqual({});
    expect(loader.resolvedImageFileIds).toEqual({ img: true });
  });
});
