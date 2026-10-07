// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FolderDetailPage from "@/app/dashboard/folders/[folderId]/page";
import type { Source } from "@/lib/material/sources";
import type { Deck } from "@/lib/study/decks";
import type { Notebook } from "@/lib/workspace/notebooks";
import type { StudyFolder } from "@/lib/workspace/study-folders";

/**
 * A study folder, driven the way a student uses it: opening it, the states it
 * can open into, its notebooks, and the decks and sources linked to it.
 */

const UID = "user-1";
const FOLDER_ID = "biology";

const services = vi.hoisted(() => ({
  getStudyFolderById: vi.fn(),
  getNotebooksForFolderPage: vi.fn(),
  updateNotebook: vi.fn(),
  getActiveTopics: vi.fn(),
  getDecks: vi.fn(),
  getDecksForFolderPage: vi.fn(),
  updateDeckFolders: vi.fn(),
  getActiveSources: vi.fn(),
  getActiveSourcesForFolderPage: vi.fn(),
  updateSource: vi.fn(),
  deletePracticePaper: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ folderId: FOLDER_ID }),
  useRouter: () => ({ push: services.push, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => `/dashboard/folders/${FOLDER_ID}`,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/providers/UserProvider", () => ({
  useUser: () => ({ user: { uid: UID } }),
}));
vi.mock("@/services/study/folders", () => ({ getStudyFolderById: services.getStudyFolderById }));
vi.mock("@/services/study/notebooks", () => ({
  getNotebooksForFolderPage: services.getNotebooksForFolderPage,
  updateNotebook: services.updateNotebook,
}));
vi.mock("@/services/study/topics", () => ({ getActiveTopics: services.getActiveTopics }));
vi.mock("@/services/study/decks", () => ({
  getDecks: services.getDecks,
  getDecksForFolderPage: services.getDecksForFolderPage,
  updateDeckFolders: services.updateDeckFolders,
}));
vi.mock("@/services/study/sources", () => ({
  getActiveSources: services.getActiveSources,
  getActiveSourcesForFolderPage: services.getActiveSourcesForFolderPage,
  updateSource: services.updateSource,
}));
vi.mock("@/services/study/practice-papers", () => ({
  deletePracticePaper: services.deletePracticePaper,
}));
// The editors and the practice history are screens of their own.
vi.mock("@/components/workspace/FolderEditor", () => ({ default: () => <div data-folder-editor /> }));
vi.mock("@/components/workspace/FolderNotebookCreator", () => ({
  default: () => <div data-notebook-creator />,
}));
vi.mock("@/components/workspace/NotebookEditorDialog", () => ({ default: () => null }));
vi.mock("@/components/practice/ExamPracticeHistory", () => ({
  default: () => <div data-practice-history />,
}));

const NOW = Date.now();

function folder(): StudyFolder {
  return { id: FOLDER_ID, name: "Biology", subject: "GCSE Biology", topicIds: [] } as unknown as StudyFolder;
}

function notebook(id: string, title: string, updatedAt: number, extra: Partial<Notebook> = {}): Notebook {
  return {
    id,
    folderId: FOLDER_ID,
    title,
    type: "notebook",
    topicIds: [],
    sourceIds: [],
    pageColor: "white",
    pageStyle: "lined",
    createdAt: updatedAt,
    updatedAt,
    archived: false,
    ...extra,
  } as Notebook;
}

function deck(id: string, name: string, folderIds: string[], createdAt = 1): Deck {
  return { id, name, folderIds, createdAt } as unknown as Deck;
}

function source(id: string, title: string, folderIds: string[], updatedAt = 1): Source {
  return { id, title, folderIds, updatedAt, type: "text_note" } as unknown as Source;
}

let container: HTMLDivElement;
let root: Root;

async function settle() {
  for (let pass = 0; pass < 4; pass += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function renderPage() {
  await act(async () => {
    root.render(<FolderDetailPage />);
  });
  await settle();
}

function buttonByText(text: string, scope: ParentNode = document) {
  return [...scope.querySelectorAll("button")].find((button) => button.textContent?.trim() === text);
}

async function click(element: Element | null | undefined) {
  expect(element).toBeTruthy();
  await act(async () => {
    element!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState(null, "", `/dashboard/folders/${FOLDER_ID}`);
  for (const mock of Object.values(services)) mock.mockReset();
  services.getStudyFolderById.mockResolvedValue(folder());
  services.getNotebooksForFolderPage.mockResolvedValue({
    items: [notebook("n1", "Cells", NOW - 2 * 3_600_000), notebook("n2", "Enzymes", NOW - 30 * 60_000)],
    nextCursor: null,
  });
  services.getActiveTopics.mockResolvedValue([]);
  services.getDecksForFolderPage.mockResolvedValue({
    items: [deck("d1", "Cell biology", [FOLDER_ID])],
    nextCursor: null,
  });
  services.getActiveSourcesForFolderPage.mockResolvedValue({
    items: [source("r1", "Chapter 2 notes", [FOLDER_ID])],
    nextCursor: null,
  });
  services.updateDeckFolders.mockResolvedValue(undefined);
  services.updateSource.mockResolvedValue(undefined);
  services.updateNotebook.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("a study folder", () => {
  it("opens on its notebooks, with when each was last edited", async () => {
    await renderPage();

    expect(container.querySelector("h2")?.textContent).toBe("Biology");
    expect(container.textContent).toContain("GCSE Biology");
    expect(container.textContent).toContain("Cells");
    expect(container.textContent).toContain("Edited 2h ago");
    expect(container.textContent).toContain("Edited recently");
    expect(services.getDecksForFolderPage).not.toHaveBeenCalled();
  });

  it("says when the folder is gone rather than showing an empty one", async () => {
    services.getStudyFolderById.mockResolvedValue(null);
    await renderPage();

    expect(container.textContent).toContain("Folder not found");
  });

  it("says when the folder could not load, and tries again", async () => {
    services.getStudyFolderById.mockRejectedValueOnce(new Error("offline"));
    await renderPage();

    expect(container.textContent).toContain("Folder unavailable");
    expect(container.textContent).toContain("Could not load this folder.");
    await click(buttonByText("Try again"));

    expect(container.querySelector("h2")?.textContent).toBe("Biology");
  });

  it("keeps the folder open when only its notebooks fail, and retries them", async () => {
    services.getNotebooksForFolderPage.mockRejectedValueOnce(new Error("index building"));
    await renderPage();

    expect(container.textContent).toContain("Notebooks are temporarily unavailable");
    expect(container.textContent).not.toContain("No notebooks yet");
    await click(buttonByText("Retry notebooks"));

    expect(container.textContent).not.toContain("Notebooks are temporarily unavailable");
    expect(container.textContent).toContain("Enzymes");
  });

  it("loads more notebooks, newest edit first", async () => {
    services.getNotebooksForFolderPage
      .mockResolvedValueOnce({ items: [notebook("n1", "Cells", NOW - 5_000)], nextCursor: { id: "n1" } })
      .mockResolvedValueOnce({ items: [notebook("n3", "Osmosis", NOW - 1_000)], nextCursor: null });
    await renderPage();
    await click(buttonByText("Load more notebooks"));

    const titles = [...container.querySelectorAll("a[href^='/dashboard/notebooks/']")].map((link) =>
      link.getAttribute("href")
    );
    expect(titles).toEqual(["/dashboard/notebooks/n3", "/dashboard/notebooks/n1"]);
    expect(buttonByText("Load more notebooks")).toBeUndefined();
  });

  it("deletes a notebook after asking, by archiving it", async () => {
    await renderPage();
    const card = container.querySelector('[aria-label="Notebook actions for Cells"]')!.closest("details")!;
    await click(buttonByText("Delete notebook", card));

    expect(document.body.textContent).toContain("Delete Cells?");
    const dialogConfirm = [...document.querySelectorAll('[role="dialog"] button, [role="alertdialog"] button')].find(
      (button) => button.textContent?.trim() === "Delete notebook"
    );
    await click(dialogConfirm);

    expect(services.updateNotebook).toHaveBeenCalledWith(UID, "n1", { archived: true });
    expect(container.textContent).toContain("Cells deleted.");
    expect(container.querySelector('[aria-label="Notebook actions for Cells"]')).toBeNull();
  });

  it("deletes a practice paper for good", async () => {
    services.getNotebooksForFolderPage.mockResolvedValue({
      items: [notebook("p1", "Paper 1", NOW, { type: "practice_paper", pastPaperId: "paper-1" })],
      nextCursor: null,
    });
    services.deletePracticePaper.mockResolvedValue(undefined);
    await renderPage();
    const card = container.querySelector('[aria-label="Notebook actions for Paper 1"]')!.closest("details")!;
    await click(buttonByText("Delete notebook", card));
    await click(buttonByText("Delete paper permanently"));

    expect(services.deletePracticePaper).toHaveBeenCalledWith(UID, "paper-1");
    expect(services.updateNotebook).not.toHaveBeenCalled();
  });

  it("loads the decks tab once, and remembers the tab in the address", async () => {
    await renderPage();
    await click(buttonByText("Decks"));

    expect(window.location.search).toContain("tab=decks");
    expect(services.getDecksForFolderPage).toHaveBeenCalledTimes(1);
    expect(services.getDecksForFolderPage).toHaveBeenCalledWith(UID, FOLDER_ID, { pageSize: 30 });
    expect(container.textContent).toContain("Cell biology");

    await click(buttonByText("Notebooks"));
    await click(buttonByText("Decks"));
    expect(services.getDecksForFolderPage).toHaveBeenCalledTimes(1);
  });

  it("takes a deck out of the folder without deleting it", async () => {
    await renderPage();
    await click(buttonByText("Decks"));
    await click(buttonByText("Remove from folder"));

    expect(services.updateDeckFolders).toHaveBeenCalledWith(UID, "d1", []);
    expect(container.textContent).toContain("Cell biology was removed from Biology");
    expect(container.textContent).toContain("No decks in this folder yet");
  });

  it("adds existing decks from the full list", async () => {
    services.getDecks.mockResolvedValue([
      deck("d1", "Cell biology", [FOLDER_ID]),
      deck("d2", "Genetics", ["chemistry"]),
    ]);
    await renderPage();
    await click(buttonByText("Decks"));
    await click(buttonByText("Add existing deck"));

    expect(services.getDecks).toHaveBeenCalledWith(UID);
    await click(buttonByText("Genetics"));
    await click(buttonByText("Add to folder"));

    expect(services.updateDeckFolders).toHaveBeenCalledWith(UID, "d2", ["chemistry", FOLDER_ID]);
    expect(container.textContent).toContain("Decks added to this folder.");
    expect(buttonByText("Add to folder")).toBeUndefined();
  });

  it("loads more decks, newest first", async () => {
    services.getDecksForFolderPage
      .mockResolvedValueOnce({ items: [deck("d1", "Cell biology", [FOLDER_ID], 10)], nextCursor: { id: "d1" } })
      .mockResolvedValueOnce({ items: [deck("d3", "Ecology", [FOLDER_ID], 20)], nextCursor: null });
    await renderPage();
    await click(buttonByText("Decks"));
    await click(buttonByText("Load more decks"));

    const text = container.textContent ?? "";
    expect(text.indexOf("Ecology")).toBeLessThan(text.indexOf("Cell biology"));
    expect(buttonByText("Load more decks")).toBeUndefined();
  });

  it("lists the folder's sources and takes one out", async () => {
    await renderPage();
    await click(buttonByText("Sources"));

    expect(services.getActiveSourcesForFolderPage).toHaveBeenCalledWith(UID, FOLDER_ID, { pageSize: 30 });
    expect(container.textContent).toContain("Chapter 2 notes");
    await click(buttonByText("Remove from folder"));

    expect(services.updateSource).toHaveBeenCalledWith(UID, "r1", { folderIds: [] });
    expect(container.textContent).toContain("Chapter 2 notes was removed from Biology");
  });

  it("adds existing sources from the full list", async () => {
    services.getActiveSources.mockResolvedValue([
      source("r1", "Chapter 2 notes", [FOLDER_ID]),
      source("r2", "Lecture slides", []),
    ]);
    await renderPage();
    await click(buttonByText("Sources"));
    await click(buttonByText("Add existing source"));
    await click(buttonByText("Lecture slides"));
    await click(buttonByText("Add to folder"));

    expect(services.updateSource).toHaveBeenCalledWith(UID, "r2", { folderIds: [FOLDER_ID] });
    expect(container.textContent).toContain("Sources added to this folder.");
  });

  it("says when a tab's list could not load", async () => {
    services.getDecksForFolderPage.mockRejectedValueOnce(new Error("offline"));
    await renderPage();
    await click(buttonByText("Decks"));

    expect(container.textContent).toContain("Could not load this folder’s decks.");
  });
});
