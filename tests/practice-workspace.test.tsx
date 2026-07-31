// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PracticeWorkspace from "@/components/workspace/PracticeWorkspace";
import type { Notebook } from "@/lib/workspace/notebooks";
import type { StudyFolder } from "@/lib/workspace/study-folders";

const getActiveStudyFolders = vi.fn();
const getActiveNotebooks = vi.fn();
const getActiveTopics = vi.fn();
const updateNotebook = vi.fn();

vi.mock("@/services/study/folders", () => ({
  getActiveStudyFolders: (...a: unknown[]) => getActiveStudyFolders(...a),
  createStudyFolder: vi.fn(),
}));

vi.mock("@/services/study/notebooks", () => ({
  getActiveNotebooks: (...a: unknown[]) => getActiveNotebooks(...a),
  updateNotebook: (...a: unknown[]) => updateNotebook(...a),
}));

vi.mock("@/services/study/topics", () => ({
  getActiveTopics: (...a: unknown[]) => getActiveTopics(...a),
}));

vi.mock("@/components/providers/UserProvider", () => ({
  useUser: () => ({ user: { uid: "user-1" } }),
}));

function folder(id: string, name: string): StudyFolder {
  return { id, name, subject: "Testing", createdAt: 1, updatedAt: 1 } as StudyFolder;
}

function notebook(id: string, title: string, updatedAt: number): Notebook {
  return { id, title, updatedAt, createdAt: 1, type: "blank" } as Notebook;
}

let container: HTMLDivElement;
let root: Root;

async function render() {
  await act(async () => {
    root.render(<PracticeWorkspace />);
  });
}

const text = () => container.textContent ?? "";

beforeEach(() => {
  getActiveStudyFolders.mockReset().mockResolvedValue([folder("f1", "Physics")]);
  getActiveNotebooks.mockReset().mockResolvedValue([]);
  getActiveTopics.mockReset().mockResolvedValue([]);
  updateNotebook.mockReset().mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  document.body.innerHTML = "";
});

describe("PracticeWorkspace", () => {
  it("lists the folders it loaded", async () => {
    await render();
    expect(text()).toContain("Physics");
  });

  it("still opens when notebooks or topics fail to load", async () => {
    getActiveNotebooks.mockRejectedValue(new Error("offline"));
    getActiveTopics.mockRejectedValue(new Error("offline"));
    await render();
    // Folders are the point of this screen; a failing side query must not
    // take the whole page down with it.
    expect(text()).toContain("Physics");
  });

  it("reports a failure to load folders rather than showing an empty desk", async () => {
    getActiveStudyFolders.mockRejectedValue(new Error("offline"));
    await render();
    expect(text()).toContain("Failed to load your folders and notebooks.");
  });

  it("shows only the three most recently touched notebooks, newest first", async () => {
    getActiveNotebooks.mockResolvedValue([
      notebook("n1", "Oldest notebook", 1),
      notebook("n2", "Middle notebook", 5),
      notebook("n3", "Newest notebook", 9),
      notebook("n4", "Stale notebook", 0),
    ]);
    await render();

    const body = text();
    expect(body).toContain("Newest notebook");
    expect(body).toContain("Middle notebook");
    expect(body).toContain("Oldest notebook");
    expect(body).not.toContain("Stale notebook");
    expect(body.indexOf("Newest notebook")).toBeLessThan(
      body.indexOf("Oldest notebook")
    );
  });

  it("archives rather than destroys a deleted notebook", async () => {
    getActiveNotebooks.mockResolvedValue([notebook("n1", "Waves", 5)]);
    await render();

    // Delete sits behind the card's actions menu.
    const menu = container.querySelector<HTMLElement>(
      '[aria-label="Notebook actions for Waves"]'
    );
    expect(menu).not.toBeNull();
    await act(async () => {
      menu!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // The card renders a desktop dropdown and a mobile sheet; either entry
    // opens the same confirmation, and both read "Delete notebook".
    const remove = [...container.querySelectorAll("button")].find((b) =>
      /delete notebook/i.test(b.textContent ?? "")
    );
    expect(remove).toBeDefined();
    await act(async () => {
      remove!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Nothing is written until the student confirms.
    expect(updateNotebook).not.toHaveBeenCalled();

    const dialog = document.querySelector("[role=alertdialog]");
    expect(dialog).not.toBeNull();
    const confirm = [...dialog!.querySelectorAll("button")].find((b) =>
      /delete notebook/i.test(b.textContent ?? "")
    );
    expect(confirm).toBeDefined();
    await act(async () => {
      confirm!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // A student's notebook is archived, never hard-deleted: its pages have to
    // stay recoverable.
    expect(updateNotebook).toHaveBeenCalledWith("user-1", "n1", {
      archived: true,
    });
    // The card goes without a refetch, and the title survives only in the
    // confirmation message.
    expect(
      container.querySelector('[aria-label="Notebook actions for Waves"]')
    ).toBeNull();
    expect(document.querySelector("[role=alertdialog]")).toBeNull();
    expect(text()).toContain("Waves deleted.");
  });

  it("offers a way to create the first folder", async () => {
    getActiveStudyFolders.mockResolvedValue([]);
    await render();
    const create = [...container.querySelectorAll("button")].find((b) =>
      /create folder/i.test(b.textContent ?? "")
    );
    expect(create).toBeDefined();
  });
});
