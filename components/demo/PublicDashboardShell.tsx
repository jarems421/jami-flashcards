"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import AppPage from "@/components/layout/AppPage";
import TabBar from "@/components/layout/TabBar";
import FolderObjectCard from "@/components/workspace/FolderObjectCard";
import { NotebookObjectCard } from "@/components/workspace/NotebookObjectCard";
import {
  Button,
  Card,
  EmptyState,
  FeedbackBanner,
  MetricStrip,
  PageHero,
  ProgressBar,
  SectionHeader,
  Textarea,
} from "@/components/ui";
import {
  WALKTHROUGH_CARDS,
  WALKTHROUGH_DECKS,
  WALKTHROUGH_FOLDERS,
  WALKTHROUGH_INITIAL_DRAFTS,
  WALKTHROUGH_NOTEBOOKS,
  WALKTHROUGH_NOTEBOOK_PAGES,
  WALKTHROUGH_SOURCES,
  type WalkthroughDeck,
  getWalkthroughTopicNames,
  type WalkthroughDraft,
  type WalkthroughNotebook,
  type WalkthroughNotebookPage,
  type WalkthroughSource,
  type WalkthroughStudyFolder,
} from "@/lib/demo/public-walkthrough";
import {
  APP_THEME_OPTIONS,
  readAppThemePreference,
  saveAppThemePreference,
  type AppThemePreference,
} from "@/lib/app/theme-preference";
import {
  readSidebarHiddenPreference,
  saveSidebarHiddenPreference,
} from "@/lib/app/sidebar-preference";

type Surface =
  | "home"
  | "learn"
  | "practice"
  | "progress"
  | "decks"
  | "cards"
  | "folders"
  | "notebook"
  | "library"
  | "goals"
  | "stars"
  | "profile";

type Feedback = { type: "success" | "error"; message: string };

function getSurface(pathname: string): Surface {
  if (pathname.startsWith("/dashboard/study")) return "learn";
  if (pathname.startsWith("/dashboard/practise") || pathname.startsWith("/dashboard/practice")) return "practice";
  if (pathname.startsWith("/dashboard/progress")) return "progress";
  if (pathname.startsWith("/dashboard/decks")) return "decks";
  if (pathname.startsWith("/dashboard/cards")) return "cards";
  if (pathname.startsWith("/dashboard/folders")) return "folders";
  if (pathname.startsWith("/dashboard/notebooks")) return "notebook";
  if (pathname.startsWith("/dashboard/library")) return "library";
  if (pathname.startsWith("/dashboard/goals")) return "goals";
  if (pathname.startsWith("/dashboard/constellation") || pathname.startsWith("/dashboard/stars")) return "stars";
  if (pathname.startsWith("/dashboard/profile")) return "profile";
  return "home";
}

function formatNotebookType(type: WalkthroughNotebook["type"]) {
  if (type === "uploaded_file" || type === "past_paper") return "Uploaded paper notebook";
  if (type === "ai_questions" || type === "generated_drill") return "AI-created questions notebook";
  if (type === "source_notes") return "Source notes notebook";
  return "Working notebook";
}

function timeLabel(updatedAt: number) {
  const minutes = Math.max(1, Math.round((Date.now() - updatedAt) / 60000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function linkClass(className = "") {
  return `app-button-secondary inline-flex min-h-[2.75rem] items-center justify-center rounded-[2rem] px-4 py-2 text-sm font-medium ${className}`;
}

function PublicBadge() {
  return (
    <Card tone="subtle" padding="sm">
      <div className="text-sm text-text-secondary">
        Demo data stays on this device. Sign in to save your own workspace.
      </div>
    </Card>
  );
}

export default function PublicDashboardShell() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const surface = getSurface(pathname);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [drafts, setDrafts] = useState<WalkthroughDraft[]>(WALKTHROUGH_INITIAL_DRAFTS);
  const [notebooks, setNotebooks] = useState<WalkthroughNotebook[]>(WALKTHROUGH_NOTEBOOKS);
  const [pages, setPages] = useState<WalkthroughNotebookPage[]>(WALKTHROUGH_NOTEBOOK_PAGES);
  const [selectedFolderId, setSelectedFolderId] = useState(WALKTHROUGH_FOLDERS[0]?.id ?? "");
  const [theme, setTheme] = useState<AppThemePreference>(() => readAppThemePreference());
  const [sidebarHidden, setSidebarHidden] = useState(() => readSidebarHiddenPreference());

  const handleSidebarHiddenChange = (hidden: boolean) => {
    setSidebarHidden(hidden);
    saveSidebarHiddenPreference(hidden);
  };

  const recentNotebooks = useMemo(
    () => [...notebooks].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3),
    [notebooks]
  );
  const activeDrafts = drafts.filter((draft) => draft.contentStatus === "draft");

  function show(message: string, type: Feedback["type"] = "success") {
    setFeedback({ type, message });
  }

  function createLocalNotebook(folderId: string, type: WalkthroughNotebook["type"] = "blank") {
    const now = Date.now();
    const style =
      type === "uploaded_file"
        ? { color: "sky", icon: "none" }
        : type === "ai_questions"
          ? { color: "indigo", icon: "none" }
          : { color: "violet", icon: "none" };
    const nextNotebook: WalkthroughNotebook = {
      id: `local-notebook-${now}`,
      folderId,
      title: type === "uploaded_file" ? "Uploaded paper working" : "New working notebook",
      type,
      topicIds: WALKTHROUGH_FOLDERS.find((folder) => folder.id === folderId)?.topicIds ?? [],
      sourceIds: [],
      color: style.color,
      icon: style.icon,
      pageColor: "white",
      uploadedFileName: type === "uploaded_file" ? "example-paper.pdf" : undefined,
      updatedAt: now,
    };
    const nextPage: WalkthroughNotebookPage = {
      id: `local-page-${now}`,
      notebookId: nextNotebook.id,
      folderId,
      pageNumber: 1,
      pageType: type === "uploaded_file" ? "past_paper_page" : "blank",
      pageColor: "white",
      typedContent:
        type === "uploaded_file"
          ? "File saved as a local walkthrough reference. Full PDF annotation and OCR come later."
          : "",
      questionPrompt:
        type === "ai_questions"
          ? "AI-created question notebooks are planned. This public walkthrough keeps the placeholder local-only."
          : undefined,
      updatedAt: now,
    };
    setNotebooks((current) => [nextNotebook, ...current]);
    setPages((current) => [nextPage, ...current]);
    show("Local notebook created. This did not write to Firebase.");
  }

  function approveDraft(draft: WalkthroughDraft) {
    if (draft.kind === "flashcard") {
      setDrafts((current) =>
        current.map((item) =>
          item.id === draft.id ? { ...item, contentStatus: "approved", addedDeckId: WALKTHROUGH_DECKS[0]?.id } : item
        )
      );
      show("Local flashcard draft approved into the seeded deck.");
      return;
    }
    const targetNotebook = recentNotebooks[0] ?? notebooks[0];
    if (!targetNotebook) {
      show("Create a notebook before adding this draft as a page.", "error");
      return;
    }
    const now = Date.now();
    const nextPageNumber = pages.filter((page) => page.notebookId === targetNotebook.id).length + 1;
    const nextPage: WalkthroughNotebookPage = {
      id: `local-draft-page-${now}`,
      notebookId: targetNotebook.id,
      folderId: targetNotebook.folderId,
      pageNumber: nextPageNumber,
      pageType: "question",
      pageColor: targetNotebook.pageColor ?? "white",
      questionPrompt: draft.questionText ?? "Notebook question draft",
      typedContent: [draft.answerText ? `Expected idea: ${draft.answerText}` : "", draft.solutionText ? `Notes: ${draft.solutionText}` : ""]
        .filter(Boolean)
        .join("\n"),
      updatedAt: now,
    };
    setPages((current) => [...current, nextPage]);
    setNotebooks((current) =>
      current.map((notebook) => (notebook.id === targetNotebook.id ? { ...notebook, updatedAt: now } : notebook))
    );
    setDrafts((current) =>
      current.map((item) =>
        item.id === draft.id ? { ...item, contentStatus: "approved", addedNotebookId: targetNotebook.id } : item
      )
    );
    show("Local practice draft added as a notebook page.");
  }

  const title =
    surface === "practice"
      ? "Practice"
      : surface === "learn"
        ? "Learn"
        : surface === "notebook"
          ? "Notebook"
          : surface.charAt(0).toUpperCase() + surface.slice(1);

  return (
    <>
      <div
        className={`pb-32 transition-[padding] duration-300 md:pb-0 ${
          sidebarHidden ? "md:pl-0" : "md:pl-24 lg:pl-72"
        }`}
      >
        <AppPage title={title} width="3xl">
          <div className="space-y-5">
            <PublicBadge />
            {feedback ? <FeedbackBanner type={feedback.type} message={feedback.message} onDismiss={() => setFeedback(null)} /> : null}
            {surface === "home" ? <HomePanel recentNotebooks={recentNotebooks} activeDrafts={activeDrafts.length} /> : null}
            {surface === "practice" ? (
              <PracticePanel
                folders={WALKTHROUGH_FOLDERS}
                notebooks={notebooks}
                pages={pages}
                selectedFolderId={selectedFolderId}
                onSelectFolder={setSelectedFolderId}
                onCreateNotebook={createLocalNotebook}
              />
            ) : null}
            {surface === "folders" ? (
              <FoldersPanel
                folders={WALKTHROUGH_FOLDERS}
                notebooks={notebooks}
                pages={pages}
                selectedFolderId={selectedFolderId}
                onSelectFolder={setSelectedFolderId}
                onCreateNotebook={createLocalNotebook}
              />
            ) : null}
            {surface === "notebook" ? (
              <NotebookPanel notebooks={notebooks} pages={pages} onPagesChange={setPages} onNotebooksChange={setNotebooks} />
            ) : null}
            {surface === "learn" ? <LearnPanel /> : null}
            {surface === "decks" ? <DecksPanel /> : null}
            {surface === "cards" ? <CardsPanel /> : null}
            {surface === "library" ? <LibraryPanel drafts={drafts} onApprove={approveDraft} /> : null}
            {surface === "progress" ? <ProgressPanel notebooks={notebooks} drafts={activeDrafts.length} /> : null}
            {surface === "goals" ? <GoalsPanel /> : null}
            {surface === "stars" ? <StarsPanel /> : null}
            {surface === "profile" ? (
              <ProfilePanel
                theme={theme}
                onThemeChange={(nextTheme) => {
                  setTheme(nextTheme);
                  saveAppThemePreference(nextTheme);
                  show("Theme saved locally for this device.");
                }}
              />
            ) : null}
            {searchParams.get("agent") === "1" ? <AgentNotes /> : null}
          </div>
        </AppPage>
      </div>
      <TabBar
        desktopHidden={sidebarHidden}
        onDesktopHiddenChange={handleSidebarHiddenChange}
      />
    </>
  );
}

function HomePanel({ recentNotebooks, activeDrafts }: { recentNotebooks: WalkthroughNotebook[]; activeDrafts: number }) {
  const dueCards = WALKTHROUGH_CARDS.filter((card) => card.due).length;
  return (
    <div className="space-y-5">
      <PageHero
        eyebrow="Today"
        title="Continue your latest notebook work."
        description="Public walkthrough mode uses local-only data."
        action={<Link href="/dashboard/practise?agent=1" className={linkClass()}>Open Practice</Link>}
        secondaryAction={<Link href="/dashboard/folders?agent=1" className={linkClass()}>Browse folders</Link>}
        aside={
          <MetricStrip
            items={[
              { label: "Due", value: dueCards },
              { label: "Drafts", value: activeDrafts },
              { label: "Notebooks", value: recentNotebooks.length },
            ]}
          />
        }
      />
      <SectionHeader eyebrow="Continue working" title="Recent notebooks" />
      <NotebookGrid notebooks={recentNotebooks} />
    </div>
  );
}

function PracticePanel({
  folders,
  notebooks,
  pages,
  selectedFolderId,
  onSelectFolder,
  onCreateNotebook,
}: {
  folders: WalkthroughStudyFolder[];
  notebooks: WalkthroughNotebook[];
  pages: WalkthroughNotebookPage[];
  selectedFolderId: string;
  onSelectFolder: (folderId: string) => void;
  onCreateNotebook: (folderId: string, type?: WalkthroughNotebook["type"]) => void;
}) {
  const recentNotebooks = [...notebooks].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3);
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">Practice</p>
          <h2 className="mt-2 text-3xl font-semibold text-text-primary">Study workspace</h2>
        </div>
        <Link href="/dashboard/folders?agent=1" className={linkClass()}>Open folders</Link>
      </div>
      <SectionHeader eyebrow="Continue working" title="Pick up a notebook" />
      <NotebookGrid notebooks={recentNotebooks} />
      <SectionHeader eyebrow="Folders" title="Study spaces" />
      <FolderGrid folders={folders} notebooks={notebooks} pages={pages} onSelectFolder={onSelectFolder} />
      <Card>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-sm font-semibold text-text-primary">Create local notebook</div>
            <p className="mt-1 text-sm text-text-secondary">
              Local-only in public mode.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => onCreateNotebook(selectedFolderId || folders[0]?.id, "blank")}>
              Create notebook
            </Button>
            <Button variant="secondary" onClick={() => onCreateNotebook(selectedFolderId || folders[0]?.id, "ai_questions")}>
              AI questions placeholder
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function FoldersPanel(props: {
  folders: WalkthroughStudyFolder[];
  notebooks: WalkthroughNotebook[];
  pages: WalkthroughNotebookPage[];
  selectedFolderId: string;
  onSelectFolder: (folderId: string) => void;
  onCreateNotebook: (folderId: string, type?: WalkthroughNotebook["type"]) => void;
}) {
  const [activeTab, setActiveTab] = useState<"notebooks" | "decks" | "sources">("notebooks");
  const [demoDecks, setDemoDecks] = useState<WalkthroughDeck[]>(WALKTHROUGH_DECKS);
  const [demoSources, setDemoSources] = useState<WalkthroughSource[]>(WALKTHROUGH_SOURCES);
  const [showAddSource, setShowAddSource] = useState(false);
  const [newSourceTitle, setNewSourceTitle] = useState("");
  const selectedFolder = props.folders.find((folder) => folder.id === props.selectedFolderId) ?? props.folders[0];
  const folderNotebooks = props.notebooks.filter((notebook) => notebook.folderId === selectedFolder?.id);
  const folderDecks = demoDecks.filter((deck) => deck.folderId === selectedFolder?.id);
  const folderSources = demoSources.filter((source) => source.folderId === selectedFolder?.id);
  const availableDeck = demoDecks.find((deck) => deck.folderId !== selectedFolder?.id);
  const availableSource = demoSources.find((source) => source.folderId !== selectedFolder?.id);
  const addExistingDeck = () => {
    if (!selectedFolder || !availableDeck) return;
    setDemoDecks((current) =>
      current.map((deck) => deck.id === availableDeck.id ? { ...deck, folderId: selectedFolder.id } : deck)
    );
  };
  const addExistingSource = () => {
    if (!selectedFolder || !availableSource) return;
    setDemoSources((current) =>
      current.map((source) => source.id === availableSource.id ? { ...source, folderId: selectedFolder.id } : source)
    );
  };
  const createLocalSource = () => {
    if (!selectedFolder || !newSourceTitle.trim()) return;
    setDemoSources((current) => [
      {
        id: `local-source-${Date.now()}`,
        title: newSourceTitle.trim(),
        type: "manual_note",
        subject: selectedFolder.subject,
        folderId: selectedFolder.id,
        topicIds: selectedFolder.topicIds,
        contentText: "Local-only walkthrough source. Signed-in users save this in Library.",
        status: "active",
      },
      ...current,
    ]);
    setNewSourceTitle("");
    setShowAddSource(false);
  };
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">Folders</p>
          <h2 className="mt-2 text-3xl font-semibold text-text-primary">Study spaces</h2>
        </div>
        <Link href="/dashboard/practise?agent=1" className={linkClass()}>Back to Practice</Link>
      </div>
      <FolderGrid folders={props.folders} notebooks={props.notebooks} pages={props.pages} onSelectFolder={props.onSelectFolder} />
      {selectedFolder ? (
        <section className="space-y-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-xs uppercase tracking-[0.18em] text-text-muted">Opened folder</div>
              <h3 className="mt-2 text-2xl font-semibold text-text-primary">{selectedFolder.name}</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => props.onCreateNotebook(selectedFolder.id, "blank")}>
                Create notebook
              </Button>
            </div>
          </div>
          <div className="flex gap-2 overflow-x-auto rounded-full border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-1">
            {[
              ["notebooks", "Notebooks"],
              ["decks", "Decks"],
              ["sources", "Sources"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setActiveTab(value as "notebooks" | "decks" | "sources")}
                className={`min-h-[2.35rem] rounded-full px-4 text-sm font-semibold transition ${
                  activeTab === value ? "app-selected" : "app-chip"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {activeTab === "notebooks" ? (
            <NotebookGrid notebooks={folderNotebooks} compact />
          ) : null}
          {activeTab === "decks" ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {availableDeck ? (
                  <Button variant="secondary" onClick={addExistingDeck}>
                    Add {availableDeck.name}
                  </Button>
                ) : null}
              </div>
              <AssetList title="Decks" items={folderDecks.map((deck) => `${deck.name} - ${deck.cardCount} cards`)} empty="No decks in this demo folder yet." />
            </div>
          ) : null}
          {activeTab === "sources" ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setShowAddSource((value) => !value)}>
                  Create source
                </Button>
                {availableSource ? (
                  <Button variant="secondary" onClick={addExistingSource}>
                    Add {availableSource.title}
                  </Button>
                ) : null}
              </div>
              {showAddSource ? (
                <Card padding="sm">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      value={newSourceTitle}
                      onChange={(event) => setNewSourceTitle(event.target.value)}
                      placeholder="New local source"
                      className="min-h-[2.5rem] flex-1 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-panel)] px-3 text-sm text-[var(--color-text-primary)]"
                    />
                    <Button disabled={!newSourceTitle.trim()} onClick={createLocalSource}>
                      Create local source
                    </Button>
                  </div>
                </Card>
              ) : null}
              <AssetList title="Sources" items={folderSources.map((source) => source.title)} empty="No sources in this demo folder yet." />
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function NotebookPanel({
  notebooks,
  pages,
  onPagesChange,
  onNotebooksChange,
}: {
  notebooks: WalkthroughNotebook[];
  pages: WalkthroughNotebookPage[];
  onPagesChange: (pages: WalkthroughNotebookPage[]) => void;
  onNotebooksChange: (notebooks: WalkthroughNotebook[]) => void;
}) {
  const pathname = usePathname();
  const routeNotebookId = pathname.split("/").filter(Boolean).pop();
  const notebook = notebooks.find((entry) => entry.id === routeNotebookId) ?? notebooks[0];
  const notebookPages = pages.filter((page) => page.notebookId === notebook?.id).sort((a, b) => a.pageNumber - b.pageNumber);
  const [selectedPageId, setSelectedPageId] = useState(notebookPages[0]?.id ?? "");
  const selectedPage = notebookPages.find((page) => page.id === selectedPageId) ?? notebookPages[0];
  const [draftText, setDraftText] = useState(selectedPage?.typedContent ?? "");
  const [status, setStatus] = useState("Autosaved locally");

  const savePage = useCallback(() => {
    if (!notebook || !selectedPage) return;
    if ((selectedPage.typedContent ?? "") === draftText) {
      setStatus("Autosaved locally");
      return;
    }
    const now = Date.now();
    onPagesChange(
      pages.map((page) =>
        page.id === selectedPage.id ? { ...page, typedContent: draftText, updatedAt: now } : page
      )
    );
    onNotebooksChange(
      notebooks.map((item) => (item.id === notebook.id ? { ...item, updatedAt: now } : item))
    );
    setStatus("Autosaved locally");
  }, [draftText, notebook, notebooks, onNotebooksChange, onPagesChange, pages, selectedPage]);

  useEffect(() => {
    if (!notebook || !selectedPage) return;
    const timeoutId = window.setTimeout(() => {
      savePage();
    }, 700);
    return () => window.clearTimeout(timeoutId);
  }, [notebook, savePage, selectedPage]);

  if (!notebook || !selectedPage) {
    return <EmptyState title="No notebook found" description="Open Practice to create a local walkthrough notebook." />;
  }

  function addPage() {
    savePage();
    const now = Date.now();
    const nextPage: WalkthroughNotebookPage = {
      id: `local-page-${now}`,
      notebookId: notebook.id,
      folderId: notebook.folderId,
      pageNumber: notebookPages.length + 1,
      pageType: "blank",
      pageColor: notebook.pageColor ?? "white",
      typedContent: "",
      updatedAt: now,
    };
    onPagesChange([...pages, nextPage]);
    setSelectedPageId(nextPage.id);
    setDraftText("");
    setStatus("New page ready");
  }

  return (
    <div className="space-y-5">
      <PageHero
        eyebrow="Notebook"
        title={notebook.title}
        description="Local-only notebook editing."
        action={<Button onClick={addPage}>+ Page</Button>}
        aside={<MetricStrip items={[{ label: "Pages", value: notebookPages.length }, { label: "Status", value: status }]} />}
      />
      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <Card>
          <SectionHeader eyebrow="Pages" title="Page list" />
          <div className="mt-4 space-y-2">
            {notebookPages.map((page) => (
              <button
                key={page.id}
                type="button"
                onClick={() => {
                  savePage();
                  setSelectedPageId(page.id);
                  setDraftText(page.typedContent ?? "");
                }}
                className={`w-full rounded-[1rem] px-3 py-3 text-left text-sm transition ${
                  page.id === selectedPage.id ? "app-selected" : "app-chip hover:border-border-strong"
                }`}
              >
                Page {page.pageNumber}
                <div className="mt-1 text-xs text-text-muted">{page.pageType.replace(/_/g, " ")}</div>
              </button>
            ))}
          </div>
        </Card>
        <Card className="min-h-[32rem]">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs uppercase tracking-[0.18em] text-text-muted">Working page</div>
            {notebook.uploadedFileName ? (
              <span className="app-chip rounded-full px-3 py-1 text-xs">
                File saved: {notebook.uploadedFileName}. Full annotation comes later.
              </span>
            ) : null}
          </div>
          {selectedPage.questionPrompt ? (
            <div className="app-subtle-panel mb-4 rounded-[1rem] p-4 text-sm text-text-primary">
              {selectedPage.questionPrompt}
            </div>
          ) : null}
          <Textarea
            value={draftText}
            onChange={(event) => {
              setDraftText(event.target.value);
              setStatus("Unsaved local changes");
            }}
            rows={16}
            placeholder="Write here..."
            className="min-h-[24rem]"
          />
        </Card>
      </div>
    </div>
  );
}

function NotebookGrid({ notebooks, compact = false }: { notebooks: WalkthroughNotebook[]; compact?: boolean }) {
  if (notebooks.length === 0) {
    return <EmptyState title="No notebooks yet" description="Create a notebook to begin." />;
  }
  return (
    <div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 ${compact ? "md:grid-cols-4 xl:grid-cols-5" : "md:grid-cols-4 xl:grid-cols-5"}`}>
      {notebooks.map((notebook) => {
        const topics = getWalkthroughTopicNames(notebook.topicIds);
        const folder = WALKTHROUGH_FOLDERS.find((item) => item.id === notebook.folderId);
        return (
          <NotebookObjectCard
            key={notebook.id}
            href={`/dashboard/notebooks/${notebook.id}?agent=1`}
            title={notebook.title}
            subtitle={topics.join(", ") || "General study"}
            typeLabel={formatNotebookType(notebook.type)}
            folderName={folder?.name ?? "Folder"}
            color={notebook.color}
            icon={notebook.icon}
            pageColor={notebook.pageColor}
            updatedLabel={`Edited ${timeLabel(notebook.updatedAt)}`}
            compact={compact}
          />
        );
      })}
    </div>
  );
}

function FolderGrid({
  folders,
  onSelectFolder,
}: {
  folders: WalkthroughStudyFolder[];
  notebooks: WalkthroughNotebook[];
  pages: WalkthroughNotebookPage[];
  onSelectFolder: (folderId: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
      {folders.map((folder) => {
        return (
          <FolderObjectCard
            key={folder.id}
            onClick={() => onSelectFolder(folder.id)}
            title={folder.name}
            color={folder.color}
            icon={folder.icon}
          />
        );
      })}
    </div>
  );
}

function AssetList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div>
      <SectionHeader eyebrow="Folder asset" title={title} />
      <div className="mt-4 space-y-2">
        {items.length === 0 ? (
          <p className="text-sm text-text-muted">{empty}</p>
        ) : (
          items.map((item) => (
            <div key={item} className="app-chip rounded-[1rem] px-3 py-3 text-sm">
              {item}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function LearnPanel() {
  return (
    <Panel title="Learn">
      <NotebookStatusCards />
    </Panel>
  );
}

function DecksPanel() {
  return (
    <Panel title="Decks">
      <div className="grid gap-3 md:grid-cols-3">
        {WALKTHROUGH_DECKS.map((deck) => (
          <Link
            key={deck.id}
            href="/dashboard/study?agent=1"
            className="app-panel block rounded-[1.25rem] p-4 transition duration-fast hover:-translate-y-[1px]"
          >
            <div className="font-semibold text-text-primary">{deck.name}</div>
            <div className="mt-2 text-sm text-text-secondary">{deck.cardCount} cards - {deck.weakCount} weak</div>
            <div className="mt-3 inline-flex rounded-full px-3 py-1 text-xs font-semibold app-chip">Study demo deck</div>
          </Link>
        ))}
      </div>
    </Panel>
  );
}

function CardsPanel() {
  return (
    <Panel title="Cards">
      <div className="space-y-2">
        {WALKTHROUGH_CARDS.map((card) => (
          <Card key={card.id} padding="sm">
            <div className="text-sm font-semibold text-text-primary">{card.front}</div>
            <div className="mt-1 text-sm text-text-secondary">{card.back}</div>
          </Card>
        ))}
      </div>
    </Panel>
  );
}

function LibraryPanel({ drafts, onApprove }: { drafts: WalkthroughDraft[]; onApprove: (draft: WalkthroughDraft) => void }) {
  const [selectedSourceId, setSelectedSourceId] = useState(WALKTHROUGH_SOURCES[0]?.id ?? "");
  const selectedSource = WALKTHROUGH_SOURCES.find((source) => source.id === selectedSourceId);
  return (
    <Panel title="Library">
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-2">
          <SectionHeader eyebrow="Sources" title="Saved study material" />
          {WALKTHROUGH_SOURCES.map((source) => (
            <button
              key={source.id}
              type="button"
              onClick={() => setSelectedSourceId(source.id)}
              className={`w-full rounded-[1.15rem] p-4 text-left transition duration-fast ${
                selectedSourceId === source.id ? "app-selected" : "app-panel hover:-translate-y-[1px]"
              }`}
            >
              <div className="font-semibold text-text-primary">{source.title}</div>
              <div className="mt-1 text-sm text-text-secondary">
                {source.type.replace(/_/g, " ")} - {source.fileName ?? source.contentText ?? source.externalUrl}
              </div>
            </button>
          ))}
          {selectedSource ? (
            <div className="app-subtle-panel rounded-[1.2rem] p-4 text-sm leading-6 text-text-secondary">
              <div className="mb-1 font-semibold text-text-primary">Preview only</div>
              {selectedSource.contentText ?? selectedSource.fileName ?? selectedSource.externalUrl}
            </div>
          ) : null}
        </div>
        <div className="space-y-2">
          <SectionHeader eyebrow="Drafts" title="Review queue" />
          {drafts.filter((draft) => draft.contentStatus === "draft").map((draft) => (
            <Card key={draft.id} padding="sm">
              <div className="text-sm font-semibold text-text-primary">
                {draft.kind === "flashcard" ? draft.front : draft.questionText}
              </div>
              <p className="mt-1 text-sm text-text-secondary">
                {draft.kind === "flashcard" ? draft.back : "Adds to a notebook page."}
              </p>
              <Button className="mt-3" variant="secondary" size="sm" onClick={() => onApprove(draft)}>
                {draft.kind === "flashcard" ? "Approve card" : "Add to notebook"}
              </Button>
            </Card>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function ProgressPanel({ notebooks, drafts }: { notebooks: WalkthroughNotebook[]; drafts: number }) {
  return (
    <Panel title="Progress">
      <MetricStrip
        variant="full"
        items={[
          { label: "Weak cards", value: WALKTHROUGH_CARDS.filter((card) => card.weak).length },
          { label: "Recent notebooks", value: notebooks.length },
          { label: "Drafts", value: drafts },
          { label: "Sources", value: WALKTHROUGH_SOURCES.length },
        ]}
      />
    </Panel>
  );
}

function GoalsPanel() {
  return (
    <Panel title="Goals">
      <div className="grid gap-4 lg:grid-cols-[1fr_0.9fr]">
        <Card tone="warm" padding="lg">
          <SectionHeader eyebrow="Sample goal" title="Review 20 cards this week" />
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between text-sm text-text-secondary">
              <span>Goal progress</span>
              <span className="font-semibold text-text-primary">12 / 20</span>
            </div>
            <ProgressBar progress={60} />
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/dashboard/study?agent=1" className={linkClass()}>
              Study cards
            </Link>
            <Link href="/dashboard/constellation?agent=1" className={linkClass()}>
              View stars
            </Link>
          </div>
        </Card>
        <Card padding="lg">
          <SectionHeader eyebrow="Reward preview" title="Stars earned from goals" />
          <div className="mt-5 rounded-[1.4rem] border border-[rgba(255,255,255,0.16)] bg-[#110b2c] p-5 text-[#fff7d9] shadow-card">
            <div className="relative h-44 overflow-hidden rounded-[1rem] bg-[radial-gradient(circle_at_25%_25%,rgba(255,226,126,0.26),transparent_22%),radial-gradient(circle_at_72%_52%,rgba(255,226,126,0.18),transparent_18%),linear-gradient(160deg,#181040,#070514)]">
              <span className="absolute left-[22%] top-[28%] text-3xl">✦</span>
              <span className="absolute right-[24%] top-[42%] text-xl">✦</span>
              <span className="absolute bottom-[22%] left-[52%] text-2xl">✦</span>
            </div>
          </div>
        </Card>
      </div>
    </Panel>
  );
}

function StarsPanel() {
  return (
    <Panel title="Stars">
      <div className="grid gap-4 lg:grid-cols-[1fr_0.85fr]">
        <Card padding="lg">
          <SectionHeader eyebrow="Constellation" title="Sample reward sky" />
          <div className="mt-5 rounded-[1.6rem] border border-[rgba(255,255,255,0.16)] bg-[#0d0824] p-5 text-[#fff7d9]">
            <div className="relative h-64 overflow-hidden rounded-[1.2rem] bg-[radial-gradient(circle_at_18%_24%,rgba(255,231,136,0.34),transparent_20%),radial-gradient(circle_at_62%_34%,rgba(255,231,136,0.18),transparent_17%),radial-gradient(circle_at_76%_76%,rgba(255,231,136,0.3),transparent_18%),linear-gradient(160deg,#191146,#070512)]">
              {["left-[18%] top-[22%]", "left-[54%] top-[32%]", "left-[72%] top-[70%]", "left-[35%] top-[62%]"].map((position, index) => (
                <span key={position} className={`absolute ${position} text-2xl drop-shadow-[0_0_18px_rgba(255,226,126,0.7)]`}>
                  ✦
                  <span className="sr-only">Sample star {index + 1}</span>
                </span>
              ))}
            </div>
          </div>
        </Card>
        <Card padding="lg">
          <SectionHeader eyebrow="Demo" title="Rewards are local here" />
          <p className="mt-4 text-sm leading-6 text-text-secondary">
            Signed-in goals can add stars to your constellation. The public walkthrough shows a sample only.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/dashboard/goals?agent=1" className={linkClass()}>
              Open goals
            </Link>
            <span className="app-chip rounded-full px-3 py-2 text-xs font-semibold">Preview only</span>
          </div>
        </Card>
      </div>
    </Panel>
  );
}

function ProfilePanel({
  theme,
  onThemeChange,
}: {
  theme: AppThemePreference;
  onThemeChange: (theme: AppThemePreference) => void;
}) {
  return (
    <Panel title="Account">
      <div className="flex flex-wrap gap-3">
        {APP_THEME_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onThemeChange(option.value)}
            className={`min-h-[2.75rem] rounded-full px-4 py-2 text-sm font-semibold ${
              theme === option.value
                ? "app-selected"
                : "app-chip hover:border-border-strong"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </Panel>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-5">
      <PageHero eyebrow="Public walkthrough" title={title} />
      {children}
    </div>
  );
}

function NotebookStatusCards() {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <Card padding="sm">
        <div className="text-sm text-text-muted">Due cards</div>
        <div className="mt-2 text-2xl font-semibold text-text-primary">{WALKTHROUGH_CARDS.filter((card) => card.due).length}</div>
      </Card>
      <Card padding="sm">
        <div className="text-sm text-text-muted">Weak cards</div>
        <div className="mt-2 text-2xl font-semibold text-text-primary">{WALKTHROUGH_CARDS.filter((card) => card.weak).length}</div>
      </Card>
      <Card padding="sm">
        <div className="text-sm text-text-muted">Linked folders</div>
        <div className="mt-2 text-2xl font-semibold text-text-primary">{WALKTHROUGH_FOLDERS.length}</div>
      </Card>
    </div>
  );
}

function AgentNotes() {
  return (
    <Card tone="subtle">
      <div className="text-sm font-semibold text-text-primary">Agent checklist</div>
      <ul className="mt-3 space-y-2 text-sm text-text-secondary">
        <li>Open Practice and confirm it only shows Continue working, Folders, and notebook template entry points.</li>
        <li>Open a notebook, type on a page, save, add a page, and switch pages.</li>
        <li>Open Library and approve a practice draft; it should become a notebook page in local state.</li>
        <li>Confirm no old question bank, old attempt form, confidence block, or Practice Tutor panel appears.</li>
      </ul>
    </Card>
  );
}
