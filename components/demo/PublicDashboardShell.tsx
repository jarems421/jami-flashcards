"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
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
  return `inline-flex min-h-[2.75rem] items-center justify-center rounded-[2rem] border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] px-4 py-2 text-sm font-medium text-[var(--button-secondary-text)] shadow-[var(--button-secondary-shadow)] transition duration-fast hover:-translate-y-[1px] hover:bg-[var(--button-secondary-bg-hover)] ${className}`;
}

function PublicBadge() {
  return (
    <Card tone="subtle" padding="sm">
      <div className="text-sm text-text-secondary">
        Public walkthrough mode. Everything here is seeded, local-only, and simulated. Sign in to use Firebase-backed data.
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
        description="The public walkthrough now mirrors the notebook-first direction: folders, notebooks, pages, decks, and sources. Old question-bank attempts are not part of this demo."
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
            <div className="text-sm font-semibold text-white">Create local notebook</div>
            <p className="mt-1 text-sm text-text-secondary">
              Public mode simulates notebook templates locally. Signed-in users save real folders and notebooks to Firebase.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => onCreateNotebook(selectedFolderId || folders[0]?.id, "blank")}>
              Blank notebook
            </Button>
            <Button variant="secondary" onClick={() => onCreateNotebook(selectedFolderId || folders[0]?.id, "uploaded_file")}>
              Uploaded paper
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
              <h3 className="mt-2 text-2xl font-semibold text-white">{selectedFolder.name}</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => props.onCreateNotebook(selectedFolder.id, "blank")}>
                Blank notebook
              </Button>
              <Button variant="secondary" onClick={() => props.onCreateNotebook(selectedFolder.id, "uploaded_file")}>
                Uploaded paper
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
                className={`min-h-[2.35rem] rounded-full px-4 text-sm font-semibold ${
                  activeTab === value ? "bg-accent text-white" : "text-text-secondary"
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
  const [status, setStatus] = useState("Saved locally");

  if (!notebook || !selectedPage) {
    return <EmptyState title="No notebook found" description="Open Practice to create a local walkthrough notebook." />;
  }

  function savePage() {
    const now = Date.now();
    onPagesChange(
      pages.map((page) =>
        page.id === selectedPage.id ? { ...page, typedContent: draftText, updatedAt: now } : page
      )
    );
    onNotebooksChange(
      notebooks.map((item) => (item.id === notebook.id ? { ...item, updatedAt: now } : item))
    );
    setStatus("Saved locally just now");
  }

  function addPage() {
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
        description="Public notebook editing is local-only. Type on the page, save, add pages, and navigate without touching Firebase."
        action={<Button onClick={savePage}>Save page</Button>}
        secondaryAction={<Button variant="secondary" onClick={addPage}>+ Page</Button>}
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
                  setSelectedPageId(page.id);
                  setDraftText(page.typedContent ?? "");
                }}
                className={`w-full rounded-[1rem] border px-3 py-3 text-left text-sm transition ${
                  page.id === selectedPage.id
                    ? "border-warm-border bg-warm-glow text-white"
                    : "border-white/[0.09] bg-white/[0.04] text-text-secondary hover:bg-white/[0.07]"
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
            <div>
              <div className="text-xs uppercase tracking-[0.18em] text-text-muted">Working page</div>
              <div className="mt-1 text-sm text-text-secondary">Notebook editing works best on iPad or desktop.</div>
            </div>
            {notebook.uploadedFileName ? (
              <span className="rounded-full border border-white/[0.09] bg-white/[0.05] px-3 py-1 text-xs text-text-secondary">
                File saved: {notebook.uploadedFileName}. Full annotation comes later.
              </span>
            ) : null}
          </div>
          {selectedPage.questionPrompt ? (
            <div className="mb-4 rounded-[1rem] border border-white/[0.09] bg-white/[0.04] p-4 text-sm text-white">
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
            placeholder="Write your working, notes, or question response here..."
            className="min-h-[24rem]"
          />
        </Card>
      </div>
    </div>
  );
}

function NotebookGrid({ notebooks, compact = false }: { notebooks: WalkthroughNotebook[]; compact?: boolean }) {
  if (notebooks.length === 0) {
    return <EmptyState title="No notebooks yet" description="Create a notebook inside a folder to start working on pages." />;
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
            <div key={item} className="rounded-[1rem] border border-white/[0.09] bg-white/[0.04] px-3 py-3 text-sm text-text-secondary">
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
    <Panel title="Learn" description="Review flashcards from global decks. Folder links help decks appear in study spaces too.">
      <NotebookStatusCards />
    </Panel>
  );
}

function DecksPanel() {
  return (
    <Panel title="Decks" description="Decks remain globally accessible while also living inside folders.">
      <div className="grid gap-3 md:grid-cols-3">
        {WALKTHROUGH_DECKS.map((deck) => (
          <Card key={deck.id} padding="sm">
            <div className="font-semibold text-white">{deck.name}</div>
            <div className="mt-2 text-sm text-text-secondary">{deck.cardCount} cards - {deck.weakCount} weak</div>
          </Card>
        ))}
      </div>
    </Panel>
  );
}

function CardsPanel() {
  return (
    <Panel title="Cards" description="Search and inspect cards across decks. The public walkthrough is read-only.">
      <div className="space-y-2">
        {WALKTHROUGH_CARDS.map((card) => (
          <Card key={card.id} padding="sm">
            <div className="text-sm font-semibold text-white">{card.front}</div>
            <div className="mt-1 text-sm text-text-secondary">{card.back}</div>
          </Card>
        ))}
      </div>
    </Panel>
  );
}

function LibraryPanel({ drafts, onApprove }: { drafts: WalkthroughDraft[]; onApprove: (draft: WalkthroughDraft) => void }) {
  return (
    <Panel title="Library" description="Sources still exist globally and inside folders. Draft approvals are simulated locally here.">
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-2">
          <SectionHeader eyebrow="Sources" title="Saved study material" />
          {WALKTHROUGH_SOURCES.map((source) => (
            <Card key={source.id} padding="sm">
              <div className="font-semibold text-white">{source.title}</div>
              <div className="mt-1 text-sm text-text-secondary">
                {source.type.replace(/_/g, " ")} - {source.fileName ?? source.contentText ?? source.externalUrl}
              </div>
            </Card>
          ))}
        </div>
        <div className="space-y-2">
          <SectionHeader eyebrow="Drafts" title="Review queue" />
          {drafts.filter((draft) => draft.contentStatus === "draft").map((draft) => (
            <Card key={draft.id} padding="sm">
              <div className="text-sm font-semibold text-white">
                {draft.kind === "flashcard" ? draft.front : draft.questionText}
              </div>
              <p className="mt-1 text-sm text-text-secondary">
                {draft.kind === "flashcard" ? draft.back : "Approves into a notebook page, not the old questions collection."}
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
    <Panel title="Progress" description="Progress is now based on cards, folders, notebooks, sources, and drafts rather than legacy attempts.">
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

function ProfilePanel({
  theme,
  onThemeChange,
}: {
  theme: AppThemePreference;
  onThemeChange: (theme: AppThemePreference) => void;
}) {
  return (
    <Panel title="Account" description="Theme changes are stored locally in public walkthrough mode.">
      <div className="flex flex-wrap gap-3">
        {APP_THEME_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onThemeChange(option.value)}
            className={`rounded-full border px-4 py-2 text-sm ${
              theme === option.value
                ? "border-warm-border bg-warm-glow text-white"
                : "border-white/[0.09] bg-white/[0.04] text-text-secondary"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </Panel>
  );
}

function Panel({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="space-y-5">
      <PageHero eyebrow="Public walkthrough" title={title} description={description} />
      {children}
    </div>
  );
}

function NotebookStatusCards() {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <Card padding="sm">
        <div className="text-sm text-text-muted">Due cards</div>
        <div className="mt-2 text-2xl font-semibold text-white">{WALKTHROUGH_CARDS.filter((card) => card.due).length}</div>
      </Card>
      <Card padding="sm">
        <div className="text-sm text-text-muted">Weak cards</div>
        <div className="mt-2 text-2xl font-semibold text-white">{WALKTHROUGH_CARDS.filter((card) => card.weak).length}</div>
      </Card>
      <Card padding="sm">
        <div className="text-sm text-text-muted">Linked folders</div>
        <div className="mt-2 text-2xl font-semibold text-white">{WALKTHROUGH_FOLDERS.length}</div>
      </Card>
    </div>
  );
}

function AgentNotes() {
  return (
    <Card tone="subtle">
      <div className="text-sm font-semibold text-white">Agent checklist</div>
      <ul className="mt-3 space-y-2 text-sm text-text-secondary">
        <li>Open Practice and confirm it only shows Continue working, Folders, and notebook template entry points.</li>
        <li>Open a notebook, type on a page, save, add a page, and switch pages.</li>
        <li>Open Library and approve a practice draft; it should become a notebook page in local state.</li>
        <li>Confirm no old question bank, old attempt form, confidence block, or Practice Tutor panel appears.</li>
      </ul>
    </Card>
  );
}
