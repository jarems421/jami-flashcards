"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { FirebaseError } from "firebase/app";
import Link from "next/link";
import { useUser } from "@/lib/auth/user-context";
import {
  MAX_SOURCE_FOLDER_IDS,
  type Source,
  type SourceType,
} from "@/lib/practice/sources";
import type { Topic } from "@/lib/practice/topics";
import type { Notebook } from "@/lib/workspace/notebooks";
import type { Deck } from "@/services/study/decks";
import {
  convertFlashcardDraftToCard,
  convertPracticeQuestionDraftToNotebookPage,
  getGeneratedContentDrafts,
  updateGeneratedContentDraftContent,
  updateGeneratedContentDraftStatus,
  type GeneratedContentDraft,
} from "@/services/study/generated-content";
import { getDecks } from "@/services/study/decks";
import { getActiveStudyFolders } from "@/services/study/folders";
import { getActiveNotebooks } from "@/services/study/notebooks";
import { getActiveTopics } from "@/services/study/topics";
import {
  createSource,
  deleteSource,
  getSources,
  updateSource,
} from "@/services/study/sources";
import {
  deleteSourceFile,
  getSourceFileDownloadUrl,
  uploadSourceFile,
  validateSourceUploadFile,
} from "@/services/study/source-files";
import { getSourceFileTypeLabel } from "@/lib/practice/source-files";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import { addFolderId, removeFolderId } from "@/lib/workspace/folder-links";
import {
  buildLibraryBrowserSearch,
  getLibraryBrowserStateFromSearch,
  type LibrarySourceStatusFilter,
  type LibrarySourceTypeFilter,
} from "@/lib/study/library-navigation";
import {
  MAX_TUTOR_SOURCE_SELECTION,
  reconcileTutorSourceSelection,
  toggleTutorSourceSelection,
} from "@/lib/study/library-management";
import {
  buildSourceComposerContent,
  clearFilenameDerivedTitle,
  getSourceTitleFromFileName,
  type SourceComposerKind,
} from "@/lib/study/source-composer";
import { askSourceTutor } from "@/services/ai/source";
import AppPage from "@/components/layout/AppPage";
import SourcePreview from "@/components/library/SourcePreview";
import TopicPicker from "@/components/topics/TopicPicker";
import WorkspaceActionDialog from "@/components/workspace/WorkspaceActionDialog";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  FeedbackBanner,
  Input,
  Skeleton,
  Textarea,
} from "@/components/ui";
import styles from "./page.module.css";

type Feedback = { type: "success" | "error"; message: string };
type TutorMessage = { role: "user" | "model"; text: string };
type LibraryMobileTab = "sources" | "source";
type SourceManagementAction = "archive" | "delete" | null;
type SourceWorkspacePanel = "tutor" | "details" | "drafts" | null;
type SourceActionIconName =
  | "arrow-left"
  | "close"
  | "details"
  | "drafts"
  | "external"
  | "filter"
  | "more"
  | "sparkles";

function isPermissionDenied(error: unknown) {
  return error instanceof FirebaseError && error.code === "permission-denied";
}

const sourceTypes: Array<{ value: SourceType; label: string }> = [
  { value: "pasted_text", label: "Pasted text" },
  { value: "manual_note", label: "Text note" },
  { value: "link", label: "Link" },
  { value: "file", label: "File" },
];

const sourceComposerKinds: Array<{
  value: SourceComposerKind;
  label: string;
}> = [
  { value: "text", label: "Text" },
  { value: "link", label: "Link" },
  { value: "upload", label: "Upload" },
];

function typeLabel(type: SourceType) {
  return sourceTypes.find((item) => item.value === type)?.label ?? "Source";
}

function sourceDisplayLabel(source: Source) {
  return source.type === "file"
    ? getSourceFileTypeLabel(source.fileType)
    : typeLabel(source.type);
}

function SourceTypeIcon({
  type,
  className = "",
}: {
  type: SourceType;
  className?: string;
}) {
  const paths: Record<SourceType, ReactNode> = {
    pasted_text: (
      <>
        <path d="M7 4h10v16H7z" />
        <path d="M10 8h4M10 12h4M10 16h3" />
      </>
    ),
    manual_note: (
      <>
        <path d="M5 19l3.5-.8L18 8.7 15.3 6 5.8 15.5z" />
        <path d="M13.8 7.5l2.7 2.7" />
      </>
    ),
    link: (
      <>
        <path d="M9.5 14.5l5-5" />
        <path d="M7.2 16.8l-1 1a3 3 0 004.2 4.2l3-3a3 3 0 000-4.2" />
        <path d="M16.8 7.2l1-1A3 3 0 0013.6 2l-3 3a3 3 0 000 4.2" />
      </>
    ),
    file: (
      <>
        <path d="M7 3h7l4 4v14H7z" />
        <path d="M14 3v5h4M10 13h5M10 17h5" />
      </>
    ),
  };

  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[type]}
    </svg>
  );
}

function SourceActionIcon({
  name,
  className = "h-4 w-4",
}: {
  name: SourceActionIconName;
  className?: string;
}) {
  const paths: Record<SourceActionIconName, ReactNode> = {
    "arrow-left": <path d="m15 18-6-6 6-6" />,
    close: (
      <>
        <path d="m7 7 10 10" />
        <path d="M17 7 7 17" />
      </>
    ),
    details: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5" />
        <path d="M12 8h.01" />
      </>
    ),
    drafts: (
      <>
        <path d="M7 4h10v16H7z" />
        <path d="M10 8h4M10 12h4M10 16h3" />
      </>
    ),
    external: (
      <>
        <path d="M14 5h5v5" />
        <path d="m19 5-8 8" />
        <path d="M17 13v6H5V7h6" />
      </>
    ),
    filter: (
      <>
        <path d="M4 7h16" />
        <path d="M7 12h10" />
        <path d="M10 17h4" />
      </>
    ),
    more: (
      <>
        <circle cx="6" cy="12" r="1" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
        <circle cx="18" cy="12" r="1" fill="currentColor" stroke="none" />
      </>
    ),
    sparkles: (
      <>
        <path d="m12 3 1.1 3.2L16 7.5l-2.9 1.3L12 12l-1.1-3.2L8 7.5l2.9-1.3z" />
        <path d="m18 13 .8 2.2L21 16l-2.2.8L18 19l-.8-2.2L15 16l2.2-.8z" />
        <path d="m6 13 .6 1.7 1.7.6-1.7.6L6 17.5l-.6-1.6-1.7-.6 1.7-.6z" />
      </>
    ),
  };

  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

function SourceWorkspaceDrawer({
  open,
  eyebrow,
  title,
  wide = false,
  onClose,
  children,
}: {
  open: boolean;
  eyebrow: string;
  title: string;
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const frame = window.requestAnimationFrame(() => {
      const autofocusTarget = drawerRef.current?.querySelector<HTMLElement>(
        '[data-drawer-autofocus="true"]'
      );
      (autofocusTarget ?? closeButtonRef.current)?.focus();
    });
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = previousBodyOverflow;
      restoreFocusRef.current?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[75] flex justify-end">
      <button
        type="button"
        aria-label={`Close ${title}`}
        tabIndex={-1}
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`source-drawer-${eyebrow.toLowerCase().replaceAll(" ", "-")}`}
        className={`${styles.drawerPanel} relative flex h-full w-full flex-col border-l border-[var(--color-border-strong)] bg-[var(--color-surface-panel-strong)] shadow-[-24px_0_70px_rgba(0,0,0,0.34)] ${
          wide ? "max-w-3xl" : "max-w-lg"
        }`}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const focusable = Array.from(
            drawerRef.current?.querySelectorAll<HTMLElement>(
              'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            ) ?? []
          ).filter((element) => !element.hasAttribute("hidden"));
          if (focusable.length === 0) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] px-5 py-5 sm:px-7 sm:py-6">
          <div className="min-w-0">
            <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-warm-accent">
              {eyebrow}
            </div>
            <h2
              id={`source-drawer-${eyebrow.toLowerCase().replaceAll(" ", "-")}`}
              className="mt-1 truncate text-xl font-semibold text-text-primary sm:text-2xl"
            >
              {title}
            </h2>
          </div>
          <Button
            ref={closeButtonRef}
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Close ${title}`}
            onClick={onClose}
          >
            <SourceActionIcon name="close" className="h-5 w-5" />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
          {children}
        </div>
      </div>
    </div>
  );
}

function SourceFolderPicker({
  folders,
  selectedFolderIds,
  onChange,
}: {
  folders: StudyFolder[];
  selectedFolderIds: string[];
  onChange: (folderIds: string[]) => void;
}) {
  const selectedFolders = folders.filter((folder) =>
    selectedFolderIds.includes(folder.id)
  );
  const summary =
    selectedFolders.length === 0
      ? "No folders"
      : selectedFolders.length === 1
        ? selectedFolders[0].name
        : `${selectedFolders.length} folders`;

  return (
    <div className="block min-w-0">
      <span className="mb-2 block text-sm font-medium tracking-[0.01em] text-text-secondary">
        Folders
      </span>
      {folders.length === 0 ? (
        <div className="app-field flex min-h-[3.25rem] items-center rounded-[1.6rem] px-5 text-sm text-text-muted">
          No folders
        </div>
      ) : (
        <details className="group relative">
          <summary className="app-field flex min-h-[3.25rem] cursor-pointer list-none items-center justify-between gap-3 rounded-[1.6rem] px-5 text-sm text-text-primary outline-none transition focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-details-marker]:hidden">
            <span className="truncate">{summary}</span>
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="none"
              className="h-4 w-4 shrink-0 text-text-secondary transition group-open:rotate-180"
            >
              <path d="m6 8 4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </summary>
          <div className="absolute left-0 right-0 z-40 mt-2 max-h-60 overflow-y-auto rounded-[1.2rem] border border-[var(--color-border-strong)] bg-[var(--color-surface-panel-strong)] p-2 shadow-[0_18px_46px_rgba(0,0,0,0.28)]">
            {folders.map((folder) => {
              const checked = selectedFolderIds.includes(folder.id);
              const selectionLimitReached =
                !checked && selectedFolderIds.length >= MAX_SOURCE_FOLDER_IDS;

              return (
                <label
                  key={folder.id}
                  className={`flex min-h-11 items-center gap-3 rounded-[0.85rem] px-3 text-sm transition ${
                    selectionLimitReached
                      ? "cursor-not-allowed text-text-muted"
                      : "cursor-pointer text-text-primary hover:bg-[var(--color-glass-subtle)]"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={selectionLimitReached}
                    onChange={() =>
                      onChange(
                        checked
                          ? selectedFolderIds.filter((id) => id !== folder.id)
                          : [...selectedFolderIds, folder.id]
                      )
                    }
                    className="h-4 w-4 accent-[var(--color-accent)]"
                  />
                  <span className="min-w-0 truncate">{folder.name}</span>
                </label>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}

function DraftEditor({
  draft,
  topics,
  decks,
  notebooks,
  selectedDeckId,
  selectedNotebookId,
  onDeckChange,
  onNotebookChange,
  onSaved,
  onTopicsChange,
  userId,
  sourceTitle,
}: {
  draft: GeneratedContentDraft;
  topics: Topic[];
  decks: Deck[];
  notebooks: Notebook[];
  selectedDeckId: string;
  selectedNotebookId: string;
  onDeckChange: (value: string) => void;
  onNotebookChange: (value: string) => void;
  onSaved: (message: string) => void;
  onTopicsChange: (topics: Topic[]) => void;
  userId: string;
  sourceTitle?: string;
}) {
  const [front, setFront] = useState(draft.front ?? "");
  const [back, setBack] = useState(draft.back ?? "");
  const [questionText, setQuestionText] = useState(draft.questionText ?? "");
  const [answerText, setAnswerText] = useState(draft.answerText ?? "");
  const [solutionText, setSolutionText] = useState(draft.solutionText ?? "");
  const [topicIds, setTopicIds] = useState(draft.topicIds);
  const [busy, setBusy] = useState(false);
  const isFlashcard = draft.kind === "flashcard";

  useEffect(() => {
    setFront(draft.front ?? "");
    setBack(draft.back ?? "");
    setQuestionText(draft.questionText ?? "");
    setAnswerText(draft.answerText ?? "");
    setSolutionText(draft.solutionText ?? "");
    setTopicIds(draft.topicIds);
  }, [draft]);

  return (
    <div className="rounded-[1.25rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-text-primary">
            {isFlashcard ? "Flashcard draft" : "Notebook question draft"}
          </div>
          <div className="mt-1 text-xs text-text-muted">
            Draft - based on a saved source. Review before it enters Learn or a notebook.
          </div>
        </div>
        <span className="rounded-full border border-warm-border bg-warm-glow px-3 py-1 text-xs font-semibold text-warm-accent">
          Based on: {sourceTitle ?? "Saved source"}
        </span>
      </div>
      <div className="mt-4 space-y-3">
        {isFlashcard ? (
          <>
            <Textarea label="Front" rows={3} value={front} onChange={(event) => setFront(event.target.value)} />
            <Textarea label="Back" rows={4} value={back} onChange={(event) => setBack(event.target.value)} />
          </>
        ) : (
          <>
            <Textarea
              label="Question"
              rows={3}
              value={questionText}
              onChange={(event) => setQuestionText(event.target.value)}
            />
            <Textarea
              label="Expected answer"
              rows={3}
              value={answerText}
              onChange={(event) => setAnswerText(event.target.value)}
            />
            <Textarea
              label="Solution notes"
              rows={3}
              value={solutionText}
              onChange={(event) => setSolutionText(event.target.value)}
            />
          </>
        )}
        <TopicPicker
          userId={userId}
          topics={topics}
          selectedTopicIds={topicIds}
          onChange={setTopicIds}
          onTopicsChange={onTopicsChange}
          disabled={busy}
        />
        {isFlashcard ? (
          decks.length > 0 ? (
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">
                Destination deck
              </span>
              <select
                value={selectedDeckId}
                onChange={(event) => onDeckChange(event.target.value)}
                className="mt-2 min-h-[2.8rem] w-full rounded-2xl border border-[var(--color-border)] bg-surface-panel-strong px-3 text-sm text-text-primary outline-none focus:border-warm-accent"
              >
                {decks.map((deck) => (
                  <option key={deck.id} value={deck.id}>
                    {deck.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="rounded-[1.15rem] border border-warm-border bg-warm-glow p-3 text-sm leading-6 text-text-secondary">
              <div className="font-semibold text-text-primary">
                Create a deck before adding this flashcard.
              </div>
              <p className="mt-1">
                Drafts can stay here, but flashcards need a deck before they join Learn.
              </p>
              <Link
                href="/dashboard/decks"
                className="mt-3 inline-flex min-h-[2.4rem] items-center justify-center rounded-full border border-warm-border bg-[var(--color-glass-subtle)] px-3 text-xs font-semibold text-warm-accent transition hover:bg-[var(--color-glass-strong,var(--color-glass-subtle))]"
              >
                Create deck
              </Link>
            </div>
          )
        ) : (
          notebooks.length > 0 ? (
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">
                Destination notebook
              </span>
              <select
                value={selectedNotebookId}
                onChange={(event) => onNotebookChange(event.target.value)}
                className="mt-2 min-h-[2.8rem] w-full rounded-2xl border border-[var(--color-border)] bg-surface-panel-strong px-3 text-sm text-text-primary outline-none focus:border-warm-accent"
              >
                {notebooks.map((notebook) => (
                  <option key={notebook.id} value={notebook.id}>
                    {notebook.title}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="rounded-[1.15rem] border border-warm-border bg-warm-glow p-3 text-sm leading-6 text-text-secondary">
              <div className="font-semibold text-text-primary">
                Create a notebook before approving this question draft.
              </div>
              <p className="mt-1">
                Question drafts become notebook pages so students can work naturally.
              </p>
              <Link
                href="/dashboard/folders"
                className="mt-3 inline-flex min-h-[2.4rem] items-center justify-center rounded-full border border-warm-border bg-[var(--color-glass-subtle)] px-3 text-xs font-semibold text-warm-accent transition hover:bg-[var(--color-glass-strong,var(--color-glass-subtle))]"
              >
                Open folders
              </Link>
            </div>
          )
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await updateGeneratedContentDraftContent(
                  userId,
                  draft.id,
                  isFlashcard
                    ? { front, back, topicIds }
                    : { questionText, answerText, solutionText, topicIds }
                );
                onSaved("Draft edits saved.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Save edits
          </Button>
          <Button
            type="button"
            disabled={busy || (isFlashcard ? !selectedDeckId : !selectedNotebookId)}
            onClick={async () => {
              setBusy(true);
              try {
                await updateGeneratedContentDraftContent(
                  userId,
                  draft.id,
                  isFlashcard
                    ? { front, back, topicIds }
                    : { questionText, answerText, solutionText, topicIds }
                );
                if (isFlashcard) {
                  await convertFlashcardDraftToCard(userId, { draftId: draft.id, deckId: selectedDeckId });
                  onSaved("Card added to your deck. You can review it in Learn.");
                } else {
                  await convertPracticeQuestionDraftToNotebookPage(userId, { draftId: draft.id, notebookId: selectedNotebookId });
                  onSaved("Question page added to your notebook. Open it from Practice when you are ready.");
                }
              } finally {
                setBusy(false);
              }
            }}
          >
            {isFlashcard ? "Add to deck" : "Add to notebook"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await updateGeneratedContentDraftStatus(userId, draft.id, "rejected");
                onSaved("Draft rejected.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Reject
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function LibraryPage() {
  const { user } = useUser();
  const [sources, setSources] = useState<Source[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [folders, setFolders] = useState<StudyFolder[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [drafts, setDrafts] = useState<GeneratedContentDraft[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddSource, setShowAddSource] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [composerKind, setComposerKind] = useState<SourceComposerKind>("text");
  const [title, setTitle] = useState("");
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([]);
  const [selectedFolderIds, setSelectedFolderIds] = useState<string[]>([]);
  const [contentText, setContentText] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileType, setFileType] = useState("");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const filenameDerivedTitleRef = useRef("");
  const [sourceFileUrls, setSourceFileUrls] = useState<Record<string, string>>({});
  const [tutorMessage, setTutorMessage] = useState("Explain the key ideas in this source.");
  const [tutorMessages, setTutorMessages] = useState<TutorMessage[]>([]);
  const [tutorSourceIds, setTutorSourceIds] = useState<string[]>([]);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [deckIdByDraft, setDeckIdByDraft] = useState<Record<string, string>>({});
  const [notebookIdByDraft, setNotebookIdByDraft] = useState<Record<string, string>>({});
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<LibraryMobileTab>("sources");
  const [activePanel, setActivePanel] = useState<SourceWorkspacePanel>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [folderFilter, setFolderFilter] = useState("");
  const [typeFilter, setTypeFilter] =
    useState<LibrarySourceTypeFilter>("all");
  const [statusFilter, setStatusFilter] =
    useState<LibrarySourceStatusFilter>("active");
  const [urlStateReady, setUrlStateReady] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTitle, setRenameTitle] = useState("");
  const [managementAction, setManagementAction] =
    useState<SourceManagementAction>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const closeWorkspacePanel = useCallback(() => setActivePanel(null), []);

  useEffect(() => {
    const applyUrlState = () => {
      const state = getLibraryBrowserStateFromSearch(window.location.search);
      setSearchTerm(state.search);
      setFolderFilter(state.folderId);
      setTypeFilter(state.type);
      setStatusFilter(state.status);
      setSelectedSourceId(state.sourceId || null);
      setMobileTab(state.sourceId ? "source" : "sources");
      setUrlStateReady(true);
    };

    applyUrlState();
    window.addEventListener("popstate", applyUrlState);
    return () => window.removeEventListener("popstate", applyUrlState);
  }, []);

  useEffect(() => {
    if (!urlStateReady) return;
    const nextSearch = buildLibraryBrowserSearch(window.location.search, {
      search: searchTerm,
      folderId: folderFilter,
      type: typeFilter,
      recent: false,
      status: statusFilter,
      sourceId: selectedSourceId ?? "",
    });
    const nextUrl = `${window.location.pathname}${nextSearch}${window.location.hash}`;
    window.history.replaceState(window.history.state, "", nextUrl);
  }, [
    folderFilter,
    searchTerm,
    selectedSourceId,
    statusFilter,
    typeFilter,
    urlStateReady,
  ]);

  const sourceType: SourceType =
    composerKind === "text"
      ? "manual_note"
      : composerKind === "link"
        ? "link"
        : "file";
  const filteredSources = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return sources.filter((source) => {
      if (statusFilter !== "all" && source.status !== statusFilter) return false;
      if (typeFilter !== "all" && source.type !== typeFilter) return false;
      if (folderFilter && !source.folderIds.includes(folderFilter)) return false;
      if (!normalizedSearch) return true;

      return [
        source.title,
        source.contentText,
        source.externalUrl,
        source.fileName,
      ].some((value) => value?.toLowerCase().includes(normalizedSearch));
    });
  }, [
    folderFilter,
    searchTerm,
    sources,
    statusFilter,
    typeFilter,
  ]);

  const selectedSource = useMemo(
    () =>
      filteredSources.find((source) => source.id === selectedSourceId) ??
      filteredSources[0] ??
      null,
    [filteredSources, selectedSourceId]
  );
  const selectedSourceFileUrl = selectedSource ? sourceFileUrls[selectedSource.id] : undefined;
  const sourceDrafts = useMemo(
    () =>
      drafts.filter(
        (draft) =>
          draft.contentStatus === "draft" &&
          draft.sourceType === "source" &&
          selectedSource &&
          draft.sourceId === selectedSource.id
      ),
    [drafts, selectedSource]
  );
  const selectedDraft = useMemo(
    () =>
      sourceDrafts.find((draft) => draft.id === selectedDraftId) ??
      sourceDrafts[0] ??
      null,
    [selectedDraftId, sourceDrafts]
  );

  useEffect(() => {
    if (loading) return;
    if (selectedSourceId && selectedSourceId !== selectedSource?.id) {
      setSelectedSourceId(selectedSource?.id ?? null);
    }
    if (!selectedSource) {
      setMobileTab("sources");
      setActivePanel(null);
    }
  }, [loading, selectedSource, selectedSourceId]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const [nextSources, nextTopics, nextFolders, nextDecks, nextNotebooks, nextDrafts] = await Promise.all([
        getSources(user.uid),
        getActiveTopics(user.uid),
        getActiveStudyFolders(user.uid).catch(() => [] as StudyFolder[]),
        getDecks(user.uid),
        getActiveNotebooks(user.uid),
        getGeneratedContentDrafts(user.uid),
      ]);
      setSources(nextSources);
      setTopics(nextTopics);
      setFolders(nextFolders);
      setDecks(nextDecks);
      setNotebooks(nextNotebooks);
      setDrafts(nextDrafts);
      setSelectedSourceId((current) =>
        current && nextSources.some((source) => source.id === current)
          ? current
          : null
      );
      setTutorSourceIds((current) => {
        return reconcileTutorSourceSelection(
          current,
          nextSources.map((source) => source.id)
        );
      });
    } catch (error) {
      console.error(error);
      setSources([]);
      setTopics([]);
      setFolders([]);
      setDecks([]);
      setNotebooks([]);
      setDrafts([]);
      if (!isPermissionDenied(error)) {
        setFeedback({ type: "error", message: "Failed to load Sources." });
      }
    } finally {
      setLoading(false);
    }
  }, [user.uid]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (decks[0]?.id) {
      setDeckIdByDraft((current) => {
        const next = { ...current };
        for (const draft of drafts) {
          if (draft.kind === "flashcard" && !next[draft.id]) {
            next[draft.id] = decks[0].id;
          }
        }
        return next;
      });
    }
  }, [decks, drafts]);

  useEffect(() => {
    if (notebooks[0]?.id) {
      setNotebookIdByDraft((current) => {
        const next = { ...current };
        for (const draft of drafts) {
          if (draft.kind === "practice-question" && !next[draft.id]) {
            next[draft.id] = notebooks[0].id;
          }
        }
        return next;
      });
    }
  }, [drafts, notebooks]);

  useEffect(() => {
    setSelectedDraftId((current) =>
      current && sourceDrafts.some((draft) => draft.id === current)
        ? current
        : sourceDrafts[0]?.id ?? null
    );
  }, [sourceDrafts]);

  useEffect(() => {
    let cancelled = false;
    const fileSources = sources.filter((source) => source.storagePath);
    if (fileSources.length === 0) {
      setSourceFileUrls({});
      return;
    }

    const loadSourceFileUrls = async () => {
      const entries = await Promise.all(
        fileSources.map(async (source) => {
          try {
            return [source.id, await getSourceFileDownloadUrl(source.storagePath ?? "")] as const;
          } catch {
            return [source.id, ""] as const;
          }
        })
      );
      if (!cancelled) {
        setSourceFileUrls(Object.fromEntries(entries.filter(([, url]) => Boolean(url))));
      }
    };

    void loadSourceFileUrls();
    return () => {
      cancelled = true;
    };
  }, [sources]);

  const createNextSource = async () => {
    setBusyAction("create-source");
    setUploadProgress(null);
    setFeedback(null);
    let createdSourceId = "";
    let uploadedStoragePath = "";
    try {
      if (sourceType === "file" && !sourceFile) {
        setFeedback({ type: "error", message: "Choose a file to upload." });
        return;
      }
      const validatedFileType = sourceFile
        ? validateSourceUploadFile(sourceFile)
        : "";
      const modeContent = buildSourceComposerContent(composerKind, {
        contentText,
        externalUrl,
        fileName: sourceFile?.name ?? fileName,
        fileType: validatedFileType || sourceFile?.type || fileType,
      });
      const sourceId = await createSource(user.uid, {
        title: title.trim() || sourceFile?.name || title,
        type: sourceType,
        topicIds: selectedTopicIds,
        folderIds: selectedFolderIds,
        ...modeContent,
      });
      createdSourceId = sourceId;
      if (sourceType === "file" && sourceFile) {
        const upload = await uploadSourceFile({
          userId: user.uid,
          sourceId,
          file: sourceFile,
          onProgress: setUploadProgress,
        });
        uploadedStoragePath = upload.storagePath;
        await updateSource(user.uid, sourceId, {
          fileName: upload.fileName,
          fileType: upload.fileType,
          storagePath: upload.storagePath,
          sizeBytes: upload.sizeBytes,
        });
      }
      setTitle("");
      setSelectedTopicIds([]);
      setSelectedFolderIds([]);
      setContentText("");
      setExternalUrl("");
      setFileName("");
      setFileType("");
      setSourceFile(null);
      filenameDerivedTitleRef.current = "";
      setShowAddSource(false);
      await loadAll();
      setSelectedSourceId(sourceId);
      setMobileTab("source");
      setFeedback({ type: "success", message: sourceType === "file" ? "File uploaded to Sources." : "Source saved." });
    } catch (error) {
      if (uploadedStoragePath) {
        await deleteSourceFile(uploadedStoragePath).catch(() => undefined);
      }
      if (createdSourceId) {
        await deleteSource(user.uid, createdSourceId).catch(() => undefined);
      }
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Could not save source." });
    } finally {
      setBusyAction(null);
      setUploadProgress(null);
    }
  };

  const changeComposerKind = (kind: SourceComposerKind) => {
    if (kind === composerKind) return;

    setTitle((current) =>
      clearFilenameDerivedTitle(current, filenameDerivedTitleRef.current)
    );
    filenameDerivedTitleRef.current = "";
    setContentText("");
    setExternalUrl("");
    setSourceFile(null);
    setFileName("");
    setFileType("");
    setComposerKind(kind);
  };

  const openSourceComposer = (kind: SourceComposerKind = "text") => {
    changeComposerKind(kind);
    setFeedback(null);
    setShowAddSource(true);
  };

  const saveSourceRename = async () => {
    if (!selectedSource || !renameTitle.trim()) return;
    setBusyAction("rename-source");
    try {
      await updateSource(user.uid, selectedSource.id, {
        title: renameTitle,
      });
      await loadAll();
      setRenameOpen(false);
      setFeedback({ type: "success", message: "Source renamed." });
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error instanceof Error ? error.message : "Could not rename source.",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const archiveSelectedSource = async () => {
    if (!selectedSource) return;
    setBusyAction("archive-source");
    try {
      await updateSource(user.uid, selectedSource.id, { status: "archived" });
      setManagementAction(null);
      await loadAll();
      setFeedback({
        type: "success",
        message: "Source archived. Its folders and original file were kept.",
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error instanceof Error ? error.message : "Could not archive source.",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const restoreSelectedSource = async () => {
    if (!selectedSource) return;
    setBusyAction("restore-source");
    try {
      await updateSource(user.uid, selectedSource.id, { status: "active" });
      await loadAll();
      setStatusFilter("active");
      setFeedback({ type: "success", message: "Source restored." });
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error instanceof Error ? error.message : "Could not restore source.",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const deleteSelectedSource = async () => {
    if (!selectedSource) return;
    const sourceToDelete = selectedSource;
    setBusyAction("delete-source");
    try {
      await deleteSource(user.uid, sourceToDelete.id);
      if (sourceToDelete.storagePath) {
        try {
          await deleteSourceFile(sourceToDelete.storagePath);
        } catch (error) {
          console.warn("Source record deleted, but file cleanup failed.", error);
        }
      }
      setManagementAction(null);
      await loadAll();
      setFeedback({
        type: "success",
        message: "Source deleted from Sources and its folders.",
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error instanceof Error ? error.message : "Could not delete source.",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const openSelectedSource = () => {
    if (!selectedSource) return;
    const targetUrl =
      selectedSource.type === "link"
        ? selectedSource.externalUrl
        : selectedSourceFileUrl;
    if (targetUrl) {
      window.open(targetUrl, "_blank", "noopener,noreferrer");
    }
  };

  const openWorkspacePanel = (panel: Exclude<SourceWorkspacePanel, null>) => {
    setFeedback(null);
    setActivePanel(panel);
  };

  const clearFilters = () => {
    setSearchTerm("");
    setFolderFilter("");
    setTypeFilter("all");
    setStatusFilter("active");
  };

  const toggleTutorSource = (sourceId: string) => {
    setTutorSourceIds((current) => {
      const result = toggleTutorSourceSelection(current, sourceId);
      if (result.limitReached) {
        setFeedback({
          type: "error",
          message: `Tutor can use up to ${MAX_TUTOR_SOURCE_SELECTION} sources at once.`,
        });
      }
      return result.sourceIds;
    });
  };

  const runSourceTutor = async () => {
    if (tutorSourceIds.length === 0) {
      setFeedback({ type: "error", message: "Select at least one source for Tutor." });
      return;
    }
    setBusyAction("source-tutor");
    setFeedback(null);
    setTutorMessages((current) => [...current, { role: "user", text: tutorMessage }]);
    try {
      const response = await askSourceTutor({
        sourceIds: tutorSourceIds,
        message: tutorMessage,
      });
      setTutorMessages((current) => [...current, { role: "model", text: response.reply }]);
      setFeedback({
        type: "success",
        message:
          response.sourceFailures.length > 0
            ? `Tutor used ${response.sourcesUsed.length} source${response.sourcesUsed.length === 1 ? "" : "s"}. ${response.sourceFailures.length} could not be read.`
            : `Tutor used ${response.sourcesUsed.length} selected source${response.sourcesUsed.length === 1 ? "" : "s"}.`,
      });
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Source Tutor failed." });
    } finally {
      setBusyAction(null);
    }
  };

  const updateSelectedSourceTopics = async (nextTopicIds: string[]) => {
    if (!selectedSource) return;
    setBusyAction("source-topics");
    try {
      await updateSource(user.uid, selectedSource.id, { topicIds: nextTopicIds });
      setSources((current) =>
        current.map((source) =>
          source.id === selectedSource.id
            ? { ...source, topicIds: nextTopicIds, updatedAt: Date.now() }
            : source
        )
      );
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not update source Topics.",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const toggleSourceFolder = async (folderId: string) => {
    if (!selectedSource) return;
    const nextFolderIds = selectedSource.folderIds.includes(folderId)
      ? removeFolderId(selectedSource.folderIds, folderId)
      : addFolderId(selectedSource.folderIds, folderId);
    setBusyAction("source-folders");
    try {
      await updateSource(user.uid, selectedSource.id, { folderIds: nextFolderIds });
      setSources((current) =>
        current.map((source) =>
          source.id === selectedSource.id
            ? { ...source, folderIds: nextFolderIds, updatedAt: Date.now() }
            : source
        )
      );
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not update source folders.",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleDraftSaved = async (message: string) => {
    setFeedback({ type: "success", message });
    await loadAll();
  };

  const activeFilterCount =
    Number(Boolean(folderFilter)) +
    Number(typeFilter !== "all") +
    Number(statusFilter !== "active");
  const selectedSourceFolders = selectedSource
    ? selectedSource.folderIds
        .map((folderId) => folders.find((folder) => folder.id === folderId))
        .filter((folder): folder is StudyFolder => Boolean(folder))
    : [];
  const canOpenSelectedSource = Boolean(
    selectedSource &&
      ((selectedSource.type === "link" && selectedSource.externalUrl) ||
        (selectedSource.type === "file" && selectedSourceFileUrl))
  );

  if (loading) {
    return (
      <AppPage title="Sources" backHref="/dashboard" backLabel="Today">
        <div className="space-y-4">
          <Skeleton className="h-16" />
          <Skeleton className="h-80" />
        </div>
      </AppPage>
    );
  }
  return (
    <AppPage
      title="Sources"
      backHref="/dashboard"
      backLabel="Today"
      width="study"
      action={
        <Button type="button" onClick={() => openSourceComposer("text")}>
          Add source
        </Button>
      }
      contentClassName="space-y-4"
    >
      {feedback && !showAddSource && !renameOpen && !activePanel ? (
        <FeedbackBanner
          type={feedback.type}
          message={feedback.message}
          onDismiss={() => setFeedback(null)}
        />
      ) : null}

      <WorkspaceActionDialog
        open={showAddSource}
        title="Add source"
        description="Save the material first. You can organise it now or later."
        busy={busyAction === "create-source"}
        maxWidth="lg"
        onClose={() => setShowAddSource(false)}
      >
        {feedback ? (
          <div className="mb-4">
            <FeedbackBanner
              type={feedback.type}
              message={feedback.message}
              autoDismissMs={0}
              onDismiss={() => setFeedback(null)}
            />
          </div>
        ) : null}
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void createNextSource();
          }}
        >
          <div>
            <div className="mb-2 text-sm font-medium text-text-secondary">
              Source type
            </div>
            <div
              role="group"
              aria-label="Source type"
              className="app-subtle-panel grid grid-cols-3 gap-1 rounded-[1.15rem] p-1"
            >
              {sourceComposerKinds.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={composerKind === item.value}
                  onClick={() => changeComposerKind(item.value)}
                  className={
                    composerKind === item.value
                      ? "app-selected min-h-11 rounded-[0.9rem] px-3 text-sm font-semibold"
                      : "min-h-11 rounded-[0.9rem] px-3 text-sm font-medium text-text-muted transition hover:bg-[var(--color-glass-subtle)] hover:text-text-primary"
                  }
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <Input
            label="Title"
            value={title}
            data-dialog-autofocus="true"
            onChange={(event) => {
              setTitle(event.target.value);
              if (event.target.value !== filenameDerivedTitleRef.current) {
                filenameDerivedTitleRef.current = "";
              }
            }}
          />

          {composerKind === "text" ? (
            <Textarea
              label="Source text"
              rows={10}
              value={contentText}
              onChange={(event) => setContentText(event.target.value)}
            />
          ) : null}

          {composerKind === "link" ? (
            <Input
              label="Source link"
              type="url"
              placeholder="https://"
              value={externalUrl}
              onChange={(event) => setExternalUrl(event.target.value)}
            />
          ) : null}

          {composerKind === "upload" ? (
            <div className="app-subtle-panel rounded-[1.25rem] p-4">
              <label
                className="block text-sm font-medium text-text-secondary"
                htmlFor="library-source-file"
              >
                Choose a study file
              </label>
              <p className="mt-1 text-xs leading-5 text-text-muted">
                PDF, image, Word, PowerPoint, or plain text.
              </p>
              <input
                id="library-source-file"
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,.pdf,.docx,.pptx,.txt"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  setSourceFile(file);
                  setFileName(file?.name ?? "");
                  setFileType(file?.type ?? "");
                  if (
                    file &&
                    (!title.trim() || title === filenameDerivedTitleRef.current)
                  ) {
                    const nextTitle = getSourceTitleFromFileName(file.name);
                    filenameDerivedTitleRef.current = nextTitle;
                    setTitle(nextTitle);
                  } else if (!file) {
                    setTitle((current) =>
                      clearFilenameDerivedTitle(
                        current,
                        filenameDerivedTitleRef.current
                      )
                    );
                    filenameDerivedTitleRef.current = "";
                  }
                }}
                className="app-field mt-3 block w-full cursor-pointer rounded-[1rem] p-3 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-[var(--button-secondary-bg)] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-[var(--button-secondary-text)]"
              />
              {sourceFile ? (
                <div className="mt-3 text-sm text-text-secondary">
                  {sourceFile.name} · {Math.round(sourceFile.size / 1024)} KB
                </div>
              ) : null}
            </div>
          ) : null}

          <details className="group rounded-[1.2rem] border border-[var(--color-border)]">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-semibold text-text-secondary [&::-webkit-details-marker]:hidden">
              <span>Organise now (optional)</span>
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                fill="none"
                className="h-4 w-4 transition group-open:rotate-180"
              >
                <path
                  d="m6 8 4 4 4-4"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </summary>
            <div className="space-y-4 border-t border-[var(--color-border)] p-4">
              <SourceFolderPicker
                folders={folders}
                selectedFolderIds={selectedFolderIds}
                onChange={setSelectedFolderIds}
              />
              <TopicPicker
                userId={user.uid}
                topics={topics}
                selectedTopicIds={selectedTopicIds}
                onChange={setSelectedTopicIds}
                onTopicsChange={setTopics}
              />
            </div>
          </details>

          {busyAction === "create-source" &&
          sourceType === "file" &&
          uploadProgress !== null ? (
            <div>
              <div className="mb-2 flex items-center justify-between text-xs text-text-muted">
                <span>Uploading file</span>
                <span>{uploadProgress}%</span>
              </div>
              <div
                role="progressbar"
                aria-label="Source upload progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={uploadProgress}
                className="h-2 overflow-hidden rounded-full bg-[var(--color-glass-subtle)]"
              >
                <div
                  className="h-full rounded-full bg-[linear-gradient(90deg,var(--color-accent),var(--color-success))] transition-[width]"
                  style={{ width: String(uploadProgress) + "%" }}
                />
              </div>
            </div>
          ) : null}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="secondary"
              disabled={busyAction === "create-source"}
              onClick={() => setShowAddSource(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busyAction === "create-source"}
            >
              {busyAction === "create-source"
                ? sourceType === "file" && uploadProgress !== null
                  ? "Uploading..."
                  : "Saving..."
                : "Save source"}
            </Button>
          </div>
        </form>
      </WorkspaceActionDialog>

      <WorkspaceActionDialog
        open={renameOpen && Boolean(selectedSource)}
        title="Rename source"
        busy={busyAction === "rename-source"}
        onClose={() => setRenameOpen(false)}
      >
        {feedback ? (
          <div className="mb-4">
            <FeedbackBanner
              type={feedback.type}
              message={feedback.message}
              autoDismissMs={0}
              onDismiss={() => setFeedback(null)}
            />
          </div>
        ) : null}
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (renameTitle.trim()) void saveSourceRename();
          }}
        >
          <Input
            label="Source title"
            value={renameTitle}
            data-dialog-autofocus="true"
            onChange={(event) => setRenameTitle(event.target.value)}
          />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="secondary"
              disabled={busyAction === "rename-source"}
              onClick={() => setRenameOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busyAction === "rename-source" || !renameTitle.trim()}
            >
              {busyAction === "rename-source" ? "Saving..." : "Save"}
            </Button>
          </div>
        </form>
      </WorkspaceActionDialog>

      <ConfirmDialog
        open={managementAction === "archive"}
        title="Archive this source?"
        description="It will leave active Sources and its folders, but the source and uploaded file will be kept. You can restore it later."
        confirmLabel="Archive source"
        busy={busyAction === "archive-source"}
        tone="primary"
        onClose={() => setManagementAction(null)}
        onConfirm={() => void archiveSelectedSource()}
      />
      <ConfirmDialog
        open={managementAction === "delete"}
        title="Delete this source everywhere?"
        description="This permanently removes the source from Sources and every folder. An uploaded file will also be deleted. This cannot be undone."
        confirmLabel="Delete source"
        busy={busyAction === "delete-source"}
        onClose={() => setManagementAction(null)}
        onConfirm={() => void deleteSelectedSource()}
      />

      <SourceWorkspaceDrawer
        open={activePanel === "tutor"}
        eyebrow="Ask Jami"
        title="Tutor from your sources"
        onClose={closeWorkspacePanel}
      >
        <div className="space-y-6">
          {feedback ? (
            <FeedbackBanner
              type={feedback.type}
              message={feedback.message}
              autoDismissMs={0}
              onDismiss={() => setFeedback(null)}
            />
          ) : null}

          <section>
            <div className="flex items-end justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-text-primary">
                  Choose source context
                </h3>
                <p className="mt-1 text-xs leading-5 text-text-muted">
                  Jami only reads the sources you deliberately choose for this request.
                </p>
              </div>
              <span className="shrink-0 text-xs font-semibold text-text-muted">
                {tutorSourceIds.length}/{MAX_TUTOR_SOURCE_SELECTION}
              </span>
            </div>

            {selectedSource &&
            !tutorSourceIds.includes(selectedSource.id) &&
            tutorSourceIds.length < MAX_TUTOR_SOURCE_SELECTION ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-3"
                onClick={() => toggleTutorSource(selectedSource.id)}
              >
                Use current source
              </Button>
            ) : null}

            <div className="mt-4 overflow-hidden rounded-[1rem] border border-[var(--color-border)]">
              {sources.map((source) => {
                const checked = tutorSourceIds.includes(source.id);
                const limitReached =
                  !checked &&
                  tutorSourceIds.length >= MAX_TUTOR_SOURCE_SELECTION;
                return (
                  <label
                    key={source.id}
                    className={
                      "flex min-h-12 items-center gap-3 border-b border-[var(--color-border)] px-3 text-sm last:border-b-0 " +
                      (limitReached
                        ? "cursor-not-allowed text-text-muted"
                        : "cursor-pointer text-text-primary hover:bg-[var(--color-glass-subtle)]")
                    }
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={limitReached}
                      onChange={() => toggleTutorSource(source.id)}
                      className="h-4 w-4 shrink-0 accent-[var(--color-accent)]"
                    />
                    <SourceTypeIcon
                      type={source.type}
                      className="h-4 w-4 shrink-0 text-text-muted"
                    />
                    <span className="min-w-0 flex-1 truncate">{source.title}</span>
                  </label>
                );
              })}
            </div>
          </section>

          <Textarea
            label="What would you like help with?"
            rows={5}
            value={tutorMessage}
            data-drawer-autofocus="true"
            onChange={(event) => setTutorMessage(event.target.value)}
          />
          <Button
            type="button"
            className="w-full"
            disabled={
              busyAction === "source-tutor" ||
              tutorSourceIds.length === 0 ||
              !tutorMessage.trim()
            }
            onClick={() => void runSourceTutor()}
          >
            <SourceActionIcon name="sparkles" className="mr-2 h-4 w-4" />
            {busyAction === "source-tutor"
              ? "Reading selected sources..."
              : "Ask Jami"}
          </Button>

          <section className="border-t border-[var(--color-border)] pt-6">
            <h3 className="text-sm font-semibold text-text-primary">
              Conversation
            </h3>
            {tutorMessages.length === 0 ? (
              <p className="mt-3 text-sm leading-6 text-text-muted">
                Your response will appear here, directly beneath the request.
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                {tutorMessages.map((message, index) => (
                  <div
                    key={message.role + "-" + index}
                    className={
                      message.role === "model"
                        ? "rounded-[1.1rem] border border-[var(--color-selected-border)] bg-[var(--color-selected-bg)] p-4 text-sm leading-6 text-text-primary"
                        : "rounded-[1.1rem] bg-[var(--color-glass-subtle)] p-4 text-sm leading-6 text-text-secondary"
                    }
                  >
                    <div className="mb-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-text-muted">
                      {message.role === "model" ? "Jami" : "You"}
                    </div>
                    {message.text}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </SourceWorkspaceDrawer>

      <SourceWorkspaceDrawer
        open={activePanel === "details"}
        eyebrow="Source details"
        title={selectedSource?.title ?? "Source"}
        onClose={closeWorkspacePanel}
      >
        {selectedSource ? (
          <div className="space-y-7">
            {feedback ? (
              <FeedbackBanner
                type={feedback.type}
                message={feedback.message}
                autoDismissMs={0}
                onDismiss={() => setFeedback(null)}
              />
            ) : null}

            <section>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-text-primary">
                    Folders
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-text-muted">
                    Place this source in up to {MAX_SOURCE_FOLDER_IDS} study spaces.
                  </p>
                </div>
                <span className="shrink-0 text-xs font-semibold text-text-muted">
                  {selectedSource.folderIds.length}/{MAX_SOURCE_FOLDER_IDS}
                </span>
              </div>
              {folders.length === 0 ? (
                <p className="mt-3 text-sm leading-6 text-text-muted">
                  No folders yet.
                </p>
              ) : (
                <div className="mt-4 overflow-hidden rounded-[1rem] border border-[var(--color-border)]">
                  {folders.map((folder) => {
                    const checked = selectedSource.folderIds.includes(folder.id);
                    const limitReached =
                      !checked &&
                      selectedSource.folderIds.length >= MAX_SOURCE_FOLDER_IDS;
                    return (
                      <label
                        key={folder.id}
                        className={
                          "flex min-h-12 items-center gap-3 border-b border-[var(--color-border)] px-3 text-sm last:border-b-0 " +
                          (limitReached
                            ? "cursor-not-allowed text-text-muted"
                            : "cursor-pointer text-text-primary hover:bg-[var(--color-glass-subtle)]")
                        }
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={
                            limitReached || busyAction === "source-folders"
                          }
                          onChange={() => void toggleSourceFolder(folder.id)}
                          className="h-4 w-4 accent-[var(--color-accent)]"
                        />
                        <span className="min-w-0 truncate">{folder.name}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="border-t border-[var(--color-border)] pt-6">
              <TopicPicker
                userId={user.uid}
                topics={topics}
                selectedTopicIds={selectedSource.topicIds}
                onChange={(nextTopicIds) =>
                  void updateSelectedSourceTopics(nextTopicIds)
                }
                onTopicsChange={setTopics}
                disabled={busyAction !== null}
              />
            </section>

            <section className="border-t border-[var(--color-border)] pt-6">
              <h3 className="text-sm font-semibold text-text-primary">
                About this source
              </h3>
              <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-3 text-sm">
                <dt className="text-text-muted">Type</dt>
                <dd className="text-right text-text-secondary">
                  {sourceDisplayLabel(selectedSource)}
                </dd>
                <dt className="text-text-muted">Added</dt>
                <dd className="text-right text-text-secondary">
                  {selectedSource.createdAt > 0
                    ? new Intl.DateTimeFormat("en", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      }).format(selectedSource.createdAt)
                    : "Previously"}
                </dd>
                <dt className="text-text-muted">Status</dt>
                <dd className="text-right capitalize text-text-secondary">
                  {selectedSource.status}
                </dd>
                {selectedSource.fileName ? (
                  <>
                    <dt className="text-text-muted">File</dt>
                    <dd className="break-words text-right text-text-secondary">
                      {selectedSource.fileName}
                    </dd>
                  </>
                ) : null}
                {typeof selectedSource.sizeBytes === "number" ? (
                  <>
                    <dt className="text-text-muted">Size</dt>
                    <dd className="text-right text-text-secondary">
                      {Math.round(selectedSource.sizeBytes / 1024)} KB
                    </dd>
                  </>
                ) : null}
              </dl>
            </section>
          </div>
        ) : null}
      </SourceWorkspaceDrawer>

      <SourceWorkspaceDrawer
        open={activePanel === "drafts" && sourceDrafts.length > 0}
        eyebrow="Draft review"
        title={
          sourceDrafts.length === 1
            ? "1 draft from this source"
            : sourceDrafts.length + " drafts from this source"
        }
        wide
        onClose={closeWorkspacePanel}
      >
        <div className="space-y-5">
          {feedback ? (
            <FeedbackBanner
              type={feedback.type}
              message={feedback.message}
              autoDismissMs={0}
              onDismiss={() => setFeedback(null)}
            />
          ) : null}

          <p className="text-sm leading-6 text-text-muted">
            Review generated content before it enters Learn or a notebook.
          </p>

          <div className="flex gap-2 overflow-x-auto pb-1">
            {sourceDrafts.map((draft, index) => {
              const active = selectedDraft?.id === draft.id;
              return (
                <button
                  key={draft.id}
                  type="button"
                  onClick={() => setSelectedDraftId(draft.id)}
                  className={
                    "min-w-[13rem] rounded-[1rem] border p-3 text-left transition " +
                    (active
                      ? "border-[var(--color-selected-border)] bg-[var(--color-selected-bg)] text-text-primary"
                      : "border-[var(--color-border)] text-text-secondary hover:bg-[var(--color-glass-subtle)]")
                  }
                >
                  <div className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-text-muted">
                    Draft {index + 1}
                  </div>
                  <div className="mt-1 line-clamp-2 text-sm font-semibold text-text-primary">
                    {draft.kind === "flashcard"
                      ? draft.front ?? "Flashcard draft"
                      : draft.questionText ?? "Notebook question draft"}
                  </div>
                  <div className="mt-2 text-xs text-text-muted">
                    {draft.kind === "flashcard" ? "Flashcard" : "Notebook page"}
                  </div>
                </button>
              );
            })}
          </div>

          {selectedDraft && selectedSource ? (
            <DraftEditor
              key={selectedDraft.id}
              draft={selectedDraft}
              topics={topics}
              decks={decks}
              notebooks={notebooks}
              selectedDeckId={
                deckIdByDraft[selectedDraft.id] ?? decks[0]?.id ?? ""
              }
              selectedNotebookId={
                notebookIdByDraft[selectedDraft.id] ?? notebooks[0]?.id ?? ""
              }
              onDeckChange={(value) =>
                setDeckIdByDraft((current) => ({
                  ...current,
                  [selectedDraft.id]: value,
                }))
              }
              onNotebookChange={(value) =>
                setNotebookIdByDraft((current) => ({
                  ...current,
                  [selectedDraft.id]: value,
                }))
              }
              onSaved={handleDraftSaved}
              onTopicsChange={setTopics}
              userId={user.uid}
              sourceTitle={selectedSource.title}
            />
          ) : null}
        </div>
      </SourceWorkspaceDrawer>

      {sources.length === 0 ? (
        <EmptyState
          emoji="Sources"
          eyebrow="No sources yet"
          title="Build your reference library."
          description="Save notes, useful links, images, and study documents in one calm workspace."
          action={
            <Button type="button" onClick={() => openSourceComposer("text")}>
              Add source
            </Button>
          }
        />
      ) : (
        <div className={styles.workspaceFrame}>
          <section
            aria-label="Sources workspace"
            className={[
              styles.workspaceLayout,
              "app-panel !overflow-hidden !rounded-[1.7rem]",
            ].join(" ")}
          >
            <aside
              className={[
                styles.sourceRail,
                mobileTab === "sources" ? "flex" : "hidden",
                "relative z-20 border-r border-[var(--color-border)] bg-[var(--color-surface-panel)]",
              ].join(" ")}
            >
              <div className="relative shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface-panel-strong)] p-3.5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-text-primary">
                      Library
                    </h2>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {filteredSources.length} of {sources.length}
                    </p>
                  </div>
                  <details className="group relative">
                    <summary className="app-button-secondary inline-flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-full px-3 text-xs font-semibold [&::-webkit-details-marker]:hidden">
                      <SourceActionIcon name="filter" />
                      <span>Filters</span>
                      {activeFilterCount > 0 ? (
                        <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[var(--color-selected-bg)] px-1 text-[0.65rem] text-[var(--color-selected-text)]">
                          {activeFilterCount}
                        </span>
                      ) : null}
                    </summary>
                    <div className="absolute right-0 z-40 mt-2 w-[15rem] max-w-[calc(100vw-3rem)] rounded-[1.15rem] border border-[var(--color-border-strong)] bg-[var(--color-surface-panel-strong)] p-3 shadow-[var(--shadow-shell)]">
                      <div className="space-y-3">
                        <label className="block">
                          <span className="mb-1.5 block text-xs font-semibold text-text-muted">
                            Folder
                          </span>
                          <select
                            value={folderFilter}
                            onChange={(event) => setFolderFilter(event.target.value)}
                            className="app-field min-h-11 w-full rounded-[1rem] px-3 text-sm outline-none"
                          >
                            <option value="">All folders</option>
                            {folders.map((folder) => (
                              <option key={folder.id} value={folder.id}>
                                {folder.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block">
                          <span className="mb-1.5 block text-xs font-semibold text-text-muted">
                            Type
                          </span>
                          <select
                            value={typeFilter}
                            onChange={(event) =>
                              setTypeFilter(
                                event.target.value as LibrarySourceTypeFilter
                              )
                            }
                            className="app-field min-h-11 w-full rounded-[1rem] px-3 text-sm outline-none"
                          >
                            <option value="all">All types</option>
                            {sourceTypes.map((type) => (
                              <option key={type.value} value={type.value}>
                                {typeLabel(type.value)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block">
                          <span className="mb-1.5 block text-xs font-semibold text-text-muted">
                            Status
                          </span>
                          <select
                            value={statusFilter}
                            onChange={(event) =>
                              setStatusFilter(
                                event.target.value as LibrarySourceStatusFilter
                              )
                            }
                            className="app-field min-h-11 w-full rounded-[1rem] px-3 text-sm outline-none"
                          >
                            <option value="active">Active</option>
                            <option value="archived">Archived</option>
                            <option value="all">All statuses</option>
                          </select>
                        </label>
                      </div>
                      {activeFilterCount > 0 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="mt-3 w-full"
                          onClick={(event) => {
                            clearFilters();
                            event.currentTarget
                              .closest("details")
                              ?.removeAttribute("open");
                          }}
                        >
                          Clear filters
                        </Button>
                      ) : null}
                    </div>
                  </details>
                </div>
                <Input
                  type="search"
                  aria-label="Search Sources"
                  placeholder="Search sources"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  className="!rounded-[1.1rem] !px-4 !py-3"
                />
              </div>

              <nav
                aria-label="Saved sources"
                className={[styles.sourceList, "flex-1"].join(" ")}
              >
                {filteredSources.length === 0 ? (
                  <div className="px-5 py-10 text-center">
                    <div className="text-sm font-semibold text-text-primary">
                      No matching sources
                    </div>
                    <p className="mt-2 text-xs leading-5 text-text-muted">
                      Try another search or clear the filters.
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="mt-3"
                      onClick={clearFilters}
                    >
                      Reset
                    </Button>
                  </div>
                ) : (
                  filteredSources.map((source) => {
                    const active = source.id === selectedSource?.id;
                    const firstFolder = source.folderIds
                      .map(
                        (folderId) =>
                          folders.find((folder) => folder.id === folderId)?.name
                      )
                      .find(Boolean);
                    return (
                      <button
                        key={source.id}
                        type="button"
                        aria-current={active ? "page" : undefined}
                        onClick={() => {
                          setSelectedSourceId(source.id);
                          setMobileTab("source");
                        }}
                        className={
                          "group relative flex min-h-[4.75rem] w-full items-center gap-3 border-b border-[var(--color-border)] px-3.5 py-3 text-left transition " +
                          (active
                            ? "bg-[var(--color-selected-bg)] text-text-primary"
                            : "text-text-secondary hover:bg-[var(--color-glass-subtle)]")
                        }
                      >
                        {active ? (
                          <span
                            aria-hidden="true"
                            className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-[var(--color-accent)] shadow-[0_0_14px_color-mix(in_srgb,var(--color-accent)_55%,transparent)]"
                          />
                        ) : null}
                        <span
                          className={
                            "grid h-10 w-10 shrink-0 place-items-center rounded-[0.9rem] border " +
                            (active
                              ? "border-[var(--color-selected-border)] bg-[var(--color-surface-panel)]"
                              : "border-[var(--color-border)] bg-[var(--color-glass-subtle)]")
                          }
                        >
                          <SourceTypeIcon
                            type={source.type}
                            className="h-5 w-5"
                          />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-text-primary">
                            {source.title}
                          </span>
                          <span className="mt-1 block truncate text-xs text-text-muted">
                            {sourceDisplayLabel(source)}
                            {firstFolder ? " · " + firstFolder : ""}
                          </span>
                        </span>
                      </button>
                    );
                  })
                )}
              </nav>
            </aside>

            <article
              className={[
                styles.readerPane,
                mobileTab === "source" ? "flex" : "hidden",
                "relative z-10 bg-[var(--color-surface-panel)]",
              ].join(" ")}
            >
              {selectedSource ? (
                <>
                  <header className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface-panel-strong)]">
                    <div className="flex min-w-0 items-start gap-3 px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
                      <button
                        type="button"
                        aria-label="Back to all sources"
                        onClick={() => setMobileTab("sources")}
                        className={[
                          styles.mobileOnly,
                          "grid h-10 w-10 shrink-0 place-items-center rounded-full text-text-muted transition hover:bg-[var(--color-glass-subtle)] hover:text-text-primary",
                        ].join(" ")}
                      >
                        <SourceActionIcon
                          name="arrow-left"
                          className="h-5 w-5"
                        />
                      </button>
                      <span className="app-chip grid h-11 w-11 shrink-0 place-items-center rounded-[1rem]">
                        <SourceTypeIcon
                          type={selectedSource.type}
                          className="h-5 w-5"
                        />
                      </span>
                      <div className="min-w-0 flex-1">
                        <h2 className="break-words text-lg font-semibold leading-6 text-text-primary sm:text-xl">
                          {selectedSource.title}
                        </h2>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
                          <span>{sourceDisplayLabel(selectedSource)}</span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {selectedSource.createdAt > 0
                              ? new Intl.DateTimeFormat("en", {
                                  day: "numeric",
                                  month: "short",
                                  year: "numeric",
                                }).format(selectedSource.createdAt)
                              : "Saved source"}
                          </span>
                          {selectedSourceFolders[0] ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>
                                {selectedSourceFolders[0].name}
                                {selectedSourceFolders.length > 1
                                  ? " +" + (selectedSourceFolders.length - 1)
                                  : ""}
                              </span>
                            </>
                          ) : null}
                          {selectedSource.status === "archived" ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-semibold text-warm-accent">
                                Archived
                              </span>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] px-4 py-2.5 sm:px-5">
                      {canOpenSelectedSource ? (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={openSelectedSource}
                        >
                          <SourceActionIcon
                            name="external"
                            className="mr-2 h-4 w-4"
                          />
                          Open original
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => openWorkspacePanel("tutor")}
                      >
                        <SourceActionIcon
                          name="sparkles"
                          className="mr-2 h-4 w-4"
                        />
                        Ask Jami
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => openWorkspacePanel("details")}
                      >
                        <SourceActionIcon
                          name="details"
                          className="mr-2 h-4 w-4"
                        />
                        Details
                      </Button>
                      {sourceDrafts.length > 0 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => openWorkspacePanel("drafts")}
                        >
                          <SourceActionIcon
                            name="drafts"
                            className="mr-2 h-4 w-4"
                          />
                          Drafts ({sourceDrafts.length})
                        </Button>
                      ) : null}

                      <details className="group relative ml-auto">
                        <summary
                          aria-label="More source actions"
                          className="grid h-10 w-10 cursor-pointer list-none place-items-center rounded-full text-text-muted transition hover:bg-[var(--color-glass-subtle)] hover:text-text-primary [&::-webkit-details-marker]:hidden"
                        >
                          <SourceActionIcon
                            name="more"
                            className="h-5 w-5"
                          />
                        </summary>
                        <div className="absolute right-0 top-[calc(100%+0.4rem)] z-40 grid min-w-48 gap-1 rounded-[1rem] border border-[var(--color-border-strong)] bg-[var(--color-surface-panel-strong)] p-1.5 shadow-[var(--shadow-shell)]">
                          <button
                            type="button"
                            className="min-h-10 rounded-[0.75rem] px-3 text-left text-sm font-medium text-text-secondary hover:bg-[var(--color-glass-subtle)] hover:text-text-primary"
                            onClick={(event) => {
                              event.currentTarget
                                .closest("details")
                                ?.removeAttribute("open");
                              setFeedback(null);
                              setRenameTitle(selectedSource.title);
                              setRenameOpen(true);
                            }}
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            disabled={busyAction === "restore-source"}
                            className="min-h-10 rounded-[0.75rem] px-3 text-left text-sm font-medium text-text-secondary hover:bg-[var(--color-glass-subtle)] hover:text-text-primary disabled:opacity-50"
                            onClick={(event) => {
                              event.currentTarget
                                .closest("details")
                                ?.removeAttribute("open");
                              if (selectedSource.status === "active") {
                                setManagementAction("archive");
                              } else {
                                void restoreSelectedSource();
                              }
                            }}
                          >
                            {selectedSource.status === "active"
                              ? "Archive"
                              : "Restore"}
                          </button>
                          <button
                            type="button"
                            className="min-h-10 rounded-[0.75rem] px-3 text-left text-sm font-semibold text-[var(--color-error-text)] hover:bg-[var(--color-error-muted)]"
                            onClick={(event) => {
                              event.currentTarget
                                .closest("details")
                                ?.removeAttribute("open");
                              setManagementAction("delete");
                            }}
                          >
                            Delete source
                          </button>
                        </div>
                      </details>
                    </div>
                  </header>

                  <div
                    id="selected-source-preview"
                    className={[
                      styles.previewScroll,
                      "min-h-0 flex-1 bg-[var(--color-surface-base)] p-3 sm:p-5",
                    ].join(" ")}
                  >
                    <div className="overflow-hidden rounded-[1.2rem] bg-[var(--color-surface-panel-strong)]">
                      <SourcePreview
                        source={selectedSource}
                        fileUrl={selectedSourceFileUrl}
                      />
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex min-h-[34rem] flex-1 items-center justify-center px-6 text-center">
                  <div>
                    <div className="text-sm font-semibold text-text-primary">
                      No source selected
                    </div>
                    <p className="mt-2 text-sm leading-6 text-text-muted">
                      Choose a source or adjust your filters.
                    </p>
                  </div>
                </div>
              )}
            </article>
          </section>
        </div>
      )}
    </AppPage>
  );
}
