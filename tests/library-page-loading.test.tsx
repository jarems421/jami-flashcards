// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LibraryPage from "@/app/dashboard/library/page";
import type { Source } from "@/lib/material/sources";

const mocks = vi.hoisted(() => ({
  getSources: vi.fn(),
  getTopics: vi.fn(),
  getFolders: vi.fn(),
  getDecks: vi.fn(),
  getNotebooks: vi.fn(),
  getDrafts: vi.fn(),
  draftReload: null as null | (() => Promise<void>),
}));

vi.mock("@/components/providers/UserProvider", () => ({
  useUser: () => ({ user: { uid: "user-1" } }),
}));

vi.mock("@/services/study/sources", () => ({
  getSources: (...args: unknown[]) => mocks.getSources(...args),
}));

vi.mock("@/services/study/topics", () => ({
  getActiveTopics: (...args: unknown[]) => mocks.getTopics(...args),
}));

vi.mock("@/services/study/folders", () => ({
  getActiveStudyFolders: (...args: unknown[]) => mocks.getFolders(...args),
}));

vi.mock("@/services/study/decks", () => ({
  getDecks: (...args: unknown[]) => mocks.getDecks(...args),
}));

vi.mock("@/services/study/notebooks", () => ({
  getActiveNotebooks: (...args: unknown[]) => mocks.getNotebooks(...args),
}));

vi.mock("@/services/study/generated-content", () => ({
  getGeneratedContentDrafts: (...args: unknown[]) => mocks.getDrafts(...args),
}));

vi.mock("@/services/study/source-files", () => ({
  getSourceFileDownloadUrl: vi.fn(),
}));

vi.mock("@/hooks/useSourceManagement", () => ({
  useSourceManagement: () => ({
    renameOpen: false,
    busyAction: null,
    openRename: vi.fn(),
    requestArchive: vi.fn(),
    requestDelete: vi.fn(),
    restore: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@/components/layout/AppPage", () => ({
  default: ({
    title,
    action,
    children,
  }: {
    title: string;
    action?: ReactNode;
    children: ReactNode;
  }) => (
    <main>
      <h1>{title}</h1>
      {action}
      {children}
    </main>
  ),
}));

vi.mock("@/components/ai/JamiAssistantDrawer", () => ({
  default: () => null,
}));

vi.mock("@/components/library/SourceComposerDialog", () => ({
  default: () => null,
}));

vi.mock("@/components/library/SourceDetailsWorkflow", () => ({
  default: () => null,
}));

vi.mock("@/components/library/SourceManagementDialogs", () => ({
  default: () => null,
}));

vi.mock("@/components/library/SourceDraftWorkflow", () => ({
  default: ({
    open,
    onReload,
  }: {
    open: boolean;
    onReload: () => Promise<void>;
  }) => {
    mocks.draftReload = onReload;
    return open ? <div data-testid="draft-feedback">Draft saved.</div> : null;
  },
}));

vi.mock("@/components/library/LibraryWorkspace", () => ({
  default: ({
    browser,
    actions,
  }: {
    browser: { selectedSource: Source | null };
    actions: { openDrafts: () => void };
  }) => (
    <section data-testid="library-workspace">
      <span>{browser.selectedSource?.title ?? "No source"}</span>
      <button type="button" onClick={actions.openDrafts}>
        Open drafts
      </button>
    </section>
  ),
}));

const source = {
  id: "source-1",
  title: "Wave notes",
  type: "manual_note",
  status: "active",
  folderIds: [],
  topicIds: [],
  createdBy: "user-1",
  createdAt: 1,
  updatedAt: 1,
} satisfies Source;

let container: HTMLDivElement;
let root: Root;
let consoleError: ReturnType<typeof vi.spyOn>;

async function flush() {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

async function renderPage() {
  await act(async () => {
    root.render(<LibraryPage />);
  });
  await flush();
}

function button(label: string) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === label
  );
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  mocks.getSources.mockReset().mockResolvedValue([source]);
  mocks.getTopics.mockReset().mockResolvedValue([]);
  mocks.getFolders.mockReset().mockResolvedValue([]);
  mocks.getDecks.mockReset().mockResolvedValue([]);
  mocks.getNotebooks.mockReset().mockResolvedValue([]);
  mocks.getDrafts.mockReset().mockResolvedValue([]);
  mocks.draftReload = null;
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  window.history.replaceState({}, "", "/dashboard/library");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  consoleError.mockRestore();
  window.history.replaceState({}, "", "/");
});

describe("LibraryPage loading", () => {
  it("shows an explicit retry state after an initial failure", async () => {
    mocks.getSources
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([source]);

    await renderPage();

    expect(container.textContent).toContain("Your sources could not be loaded");
    expect(container.textContent).not.toContain("No source");
    expect(button("Try again")).toBeDefined();

    await act(async () => {
      button("Try again")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(container.querySelector('[data-testid="library-workspace"]')).not.toBeNull();
    expect(container.textContent).toContain("Wave notes");
  });

  it("keeps the draft workflow mounted while refreshing successful data", async () => {
    let resolveRefresh!: (sources: Source[]) => void;
    mocks.getSources
      .mockResolvedValueOnce([source])
      .mockImplementationOnce(
        () =>
          new Promise<Source[]>((resolve) => {
            resolveRefresh = resolve;
          })
      );

    await renderPage();
    await act(async () => {
      button("Open drafts")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true })
      );
    });
    const feedbackBeforeReload = container.querySelector(
      '[data-testid="draft-feedback"]'
    );
    expect(feedbackBeforeReload).not.toBeNull();
    expect(mocks.draftReload).not.toBeNull();

    let refreshPromise!: Promise<void>;
    act(() => {
      refreshPromise = mocks.draftReload!();
    });
    await flush();

    const feedbackDuringReload = container.querySelector(
      '[data-testid="draft-feedback"]'
    );
    expect(feedbackDuringReload).toBe(feedbackBeforeReload);

    await act(async () => {
      resolveRefresh([source]);
      await refreshPromise;
    });
    expect(container.querySelector('[data-testid="draft-feedback"]')).toBe(
      feedbackBeforeReload
    );
  });
});
