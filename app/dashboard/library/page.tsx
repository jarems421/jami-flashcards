"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { FirebaseError } from "firebase/app";
import Link from "next/link";
import { useUser } from "@/lib/auth/user-context";
import type { Source, SourceType } from "@/lib/practice/sources";
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
} from "@/services/study/source-files";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import { addFolderId, removeFolderId } from "@/lib/workspace/folder-links";
import {
  buildLibraryBrowserSearch,
  getLibraryBrowserStateFromSearch,
  type LibrarySourceStatusFilter,
  type LibrarySourceTypeFilter,
} from "@/lib/study/library-navigation";
import {
  canRemoveSourceFromFilteredFolder,
  getLinkedSourceFolders,
} from "@/lib/study/library-management";
import { askSourceTutor, generateSourceDrafts } from "@/services/ai/source";
import AppPage from "@/components/layout/AppPage";
import {
  Button,
  ButtonLink,
  Card,
  ConfirmDialog,
  EmptyState,
  FeedbackBanner,
  Input,
  MetricStrip,
  SectionHeader,
  Skeleton,
  Textarea,
} from "@/components/ui";

type Feedback = { type: "success" | "error"; message: string };
type TutorMessage = { role: "user" | "model"; text: string };
type LibraryMobileTab = "sources" | "source" | "actions";
type SourceManagementAction = "archive" | "delete" | null;

function isPermissionDenied(error: unknown) {
  return error instanceof FirebaseError && error.code === "permission-denied";
}

const sourceTypes: Array<{ value: SourceType; label: string; helper: string }> = [
  { value: "pasted_text", label: "Paste text", helper: "Notes, extracts, worked examples." },
  { value: "manual_note", label: "Manual note", helper: "Your own summary or reminder." },
  { value: "link", label: "Link", helper: "Save the reference; parsing comes later." },
  { value: "file", label: "Upload file", helper: "Store a PDF or image for reference." },
];

function typeLabel(type: SourceType) {
  return sourceTypes.find((item) => item.value === type)?.label ?? "Source";
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

function topicNames(topicIds: string[], topics: Topic[]) {
  return topicIds
    .map((topicId) => topics.find((topic) => topic.id === topicId)?.name)
    .filter((name): name is string => Boolean(name));
}

function sourcePreview(source: Source) {
  if (source.contentText) return source.contentText;
  if (source.externalUrl) return source.externalUrl;
  if (source.fileName) return `${source.fileName}${source.fileType ? ` (${source.fileType})` : ""}`;
  return "No source text yet.";
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
  userId: string;
  sourceTitle?: string;
}) {
  const [front, setFront] = useState(draft.front ?? "");
  const [back, setBack] = useState(draft.back ?? "");
  const [questionText, setQuestionText] = useState(draft.questionText ?? "");
  const [answerText, setAnswerText] = useState(draft.answerText ?? "");
  const [solutionText, setSolutionText] = useState(draft.solutionText ?? "");
  const [busy, setBusy] = useState(false);
  const isFlashcard = draft.kind === "flashcard";

  useEffect(() => {
    setFront(draft.front ?? "");
    setBack(draft.back ?? "");
    setQuestionText(draft.questionText ?? "");
    setAnswerText(draft.answerText ?? "");
    setSolutionText(draft.solutionText ?? "");
  }, [draft]);

  return (
    <div className="rounded-[1.25rem] border border-white/[0.09] bg-white/[0.04] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-white">
            {isFlashcard ? "Flashcard draft" : "Notebook question draft"}
          </div>
          <div className="mt-1 text-xs text-text-muted">
            Draft - based on a saved source. Review before it enters Learn or a notebook.
          </div>
        </div>
        <span className="rounded-full border border-warm-border bg-warm-glow px-3 py-1 text-xs font-semibold text-warm-accent">
          Based on: {sourceTitle ?? "Library source"}
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
        <div className="flex flex-wrap gap-2">
          {topicNames(draft.topicIds, topics).map((name) => (
            <span key={name} className="rounded-full border border-white/[0.1] bg-white/[0.05] px-3 py-1 text-xs text-text-secondary">
              {name}
            </span>
          ))}
        </div>
        {isFlashcard ? (
          decks.length > 0 ? (
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">
                Destination deck
              </span>
              <select
                value={selectedDeckId}
                onChange={(event) => onDeckChange(event.target.value)}
                className="mt-2 min-h-[2.8rem] w-full rounded-2xl border border-white/[0.1] bg-surface-panel-strong px-3 text-sm text-white outline-none focus:border-warm-accent"
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
              <div className="font-semibold text-white">
                Create a deck before adding this flashcard.
              </div>
              <p className="mt-1">
                Drafts can stay here, but flashcards need a deck before they join Learn.
              </p>
              <Link
                href="/dashboard/decks"
                className="mt-3 inline-flex min-h-[2.4rem] items-center justify-center rounded-full border border-warm-border bg-white/[0.06] px-3 text-xs font-semibold text-warm-accent transition hover:bg-white/[0.1]"
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
                className="mt-2 min-h-[2.8rem] w-full rounded-2xl border border-white/[0.1] bg-surface-panel-strong px-3 text-sm text-white outline-none focus:border-warm-accent"
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
              <div className="font-semibold text-white">
                Create a notebook before approving this question draft.
              </div>
              <p className="mt-1">
                Question drafts become notebook pages so students can work naturally.
              </p>
              <Link
                href="/dashboard/folders"
                className="mt-3 inline-flex min-h-[2.4rem] items-center justify-center rounded-full border border-warm-border bg-white/[0.06] px-3 text-xs font-semibold text-warm-accent transition hover:bg-white/[0.1]"
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
                await updateGeneratedContentDraftContent(userId, draft.id, isFlashcard ? { front, back } : { questionText, answerText, solutionText });
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
                await updateGeneratedContentDraftContent(userId, draft.id, isFlashcard ? { front, back } : { questionText, answerText, solutionText });
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
  const [sourceType, setSourceType] = useState<SourceType>("pasted_text");
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([]);
  const [selectedFolderIds, setSelectedFolderIds] = useState<string[]>([]);
  const [contentText, setContentText] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileType, setFileType] = useState("");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceFileUrls, setSourceFileUrls] = useState<Record<string, string>>({});
  const [tutorMessage, setTutorMessage] = useState("Explain the key ideas in this source.");
  const [tutorMessages, setTutorMessages] = useState<TutorMessage[]>([]);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [deckIdByDraft, setDeckIdByDraft] = useState<Record<string, string>>({});
  const [notebookIdByDraft, setNotebookIdByDraft] = useState<Record<string, string>>({});
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [showTutorTranscript, setShowTutorTranscript] = useState(true);
  const [mobileTab, setMobileTab] = useState<LibraryMobileTab>("source");
  const [searchTerm, setSearchTerm] = useState("");
  const [folderFilter, setFolderFilter] = useState("");
  const [typeFilter, setTypeFilter] =
    useState<LibrarySourceTypeFilter>("all");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [recentOnly, setRecentOnly] = useState(false);
  const [statusFilter, setStatusFilter] =
    useState<LibrarySourceStatusFilter>("active");
  const [urlStateReady, setUrlStateReady] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTitle, setRenameTitle] = useState("");
  const [managementAction, setManagementAction] =
    useState<SourceManagementAction>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [removalChooserOpen, setRemovalChooserOpen] = useState(false);

  useEffect(() => {
    const applyUrlState = () => {
      const state = getLibraryBrowserStateFromSearch(window.location.search);
      setSearchTerm(state.search);
      setFolderFilter(state.folderId);
      setTypeFilter(state.type);
      setSubjectFilter(state.subject);
      setRecentOnly(state.recent);
      setStatusFilter(state.status);
      setSelectedSourceId(state.sourceId || null);
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
      subject: subjectFilter,
      recent: recentOnly,
      status: statusFilter,
      sourceId: selectedSourceId ?? "",
    });
    const nextUrl = `${window.location.pathname}${nextSearch}${window.location.hash}`;
    window.history.replaceState(window.history.state, "", nextUrl);
  }, [
    folderFilter,
    recentOnly,
    searchTerm,
    selectedSourceId,
    statusFilter,
    subjectFilter,
    typeFilter,
    urlStateReady,
  ]);

  useEffect(() => {
    if (!showAddSource && !renameOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busyAction) return;
      setShowAddSource(false);
      setRenameOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busyAction, renameOpen, showAddSource]);

  const subjects = useMemo(
    () =>
      Array.from(
        new Set(
          sources
            .map((source) => source.subject?.trim())
            .filter((value): value is string => Boolean(value))
        )
      ).sort((left, right) => left.localeCompare(right)),
    [sources]
  );
  const filteredSources = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const recentCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;

    return sources.filter((source) => {
      if (statusFilter !== "all" && source.status !== statusFilter) return false;
      if (typeFilter !== "all" && source.type !== typeFilter) return false;
      if (folderFilter && !source.folderIds.includes(folderFilter)) return false;
      if (subjectFilter && source.subject !== subjectFilter) return false;
      if (recentOnly && source.updatedAt < recentCutoff) return false;
      if (!normalizedSearch) return true;

      return [
        source.title,
        source.subject,
        source.contentText,
        source.externalUrl,
        source.fileName,
      ].some((value) => value?.toLowerCase().includes(normalizedSearch));
    });
  }, [
    folderFilter,
    recentOnly,
    searchTerm,
    sources,
    statusFilter,
    subjectFilter,
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
    const nextSelectedId = selectedSource?.id ?? null;
    if (selectedSourceId !== nextSelectedId) {
      setSelectedSourceId(nextSelectedId);
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
          : nextSources[0]?.id ?? null
      );
    } catch (error) {
      console.error(error);
      setSources([]);
      setTopics([]);
      setFolders([]);
      setDecks([]);
      setNotebooks([]);
      setDrafts([]);
      if (!isPermissionDenied(error)) {
        setFeedback({ type: "error", message: "Failed to load Library." });
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
    try {
      if (sourceType === "file" && !sourceFile) {
        setFeedback({ type: "error", message: "Choose a PDF or image to upload." });
        return;
      }
      const sourceId = await createSource(user.uid, {
        title: title.trim() || sourceFile?.name || title,
        type: sourceType,
        subject,
        topicIds: selectedTopicIds,
        folderIds: selectedFolderIds,
        contentText,
        externalUrl,
        fileName: sourceType === "file" ? sourceFile?.name ?? fileName : fileName,
        fileType: sourceType === "file" ? sourceFile?.type ?? fileType : fileType,
      });
      if (sourceType === "file" && sourceFile) {
        const upload = await uploadSourceFile({
          userId: user.uid,
          sourceId,
          file: sourceFile,
          onProgress: setUploadProgress,
        });
        await updateSource(user.uid, sourceId, {
          fileName: upload.fileName,
          fileType: upload.fileType,
          storagePath: upload.storagePath,
          sizeBytes: upload.sizeBytes,
        });
      }
      setTitle("");
      setSubject("");
      setSelectedTopicIds([]);
      setSelectedFolderIds([]);
      setContentText("");
      setExternalUrl("");
      setFileName("");
      setFileType("");
      setSourceFile(null);
      setShowAddSource(false);
      await loadAll();
      setSelectedSourceId(sourceId);
      setFeedback({ type: "success", message: sourceType === "file" ? "File uploaded to Library." : "Source saved." });
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Could not save source." });
    } finally {
      setBusyAction(null);
      setUploadProgress(null);
    }
  };

  const openSourceComposer = (type: SourceType) => {
    setSourceType(type);
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
        message: "Source deleted from Library and its folders.",
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
      return;
    }
    document.getElementById("selected-source-preview")?.scrollIntoView({
      block: "center",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  };

  const openFolderPlacement = () => {
    setRemovalChooserOpen(false);
    setMobileTab("actions");
    window.requestAnimationFrame(() => {
      document.getElementById("source-folder-placement")?.scrollIntoView({
        block: "center",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
    });
  };

  const clearFilters = () => {
    setSearchTerm("");
    setFolderFilter("");
    setTypeFilter("all");
    setSubjectFilter("");
    setRecentOnly(false);
    setStatusFilter("active");
  };

  const runSourceTutor = async () => {
    if (!selectedSource) return;
    setBusyAction("source-tutor");
    setFeedback(null);
    setTutorMessages((current) => [...current, { role: "user", text: tutorMessage }]);
    try {
      const response = await askSourceTutor({ sourceId: selectedSource.id, message: tutorMessage });
      setTutorMessages((current) => [...current, { role: "model", text: response.reply }]);
      setFeedback({ type: "success", message: "Tutor used this source as context." });
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Source Tutor failed." });
    } finally {
      setBusyAction(null);
    }
  };

  const generateDrafts = async (kind: "flashcard" | "practice-question") => {
    if (!selectedSource) return;
    setBusyAction(kind);
    setFeedback(null);
    try {
      const result = await generateSourceDrafts({ sourceId: selectedSource.id, kind });
      await loadAll();
      const removedMessage =
        result.removedDraftCount > 0
          ? ` ${result.removedDraftCount} weaker suggestion${result.removedDraftCount === 1 ? " was" : "s were"} removed.`
          : "";
      setFeedback({
        type: "success",
        message: `${result.drafts.length} source-grounded ${kind === "flashcard" ? "flashcard" : "practice question"} draft${result.drafts.length === 1 ? "" : "s"} created.${removedMessage} Review before approving.`,
      });
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Could not generate drafts." });
    } finally {
      setBusyAction(null);
    }
  };

  const toggleSourceTopic = async (topicId: string) => {
    if (!selectedSource) return;
    const nextTopicIds = selectedSource.topicIds.includes(topicId)
      ? selectedSource.topicIds.filter((id) => id !== topicId)
      : [...selectedSource.topicIds, topicId];
    await updateSource(user.uid, selectedSource.id, { topicIds: nextTopicIds });
    await loadAll();
  };

  const toggleSourceFolder = async (folderId: string) => {
    if (!selectedSource) return;
    const nextFolderIds = selectedSource.folderIds.includes(folderId)
      ? removeFolderId(selectedSource.folderIds, folderId)
      : addFolderId(selectedSource.folderIds, folderId);
    await updateSource(user.uid, selectedSource.id, { folderIds: nextFolderIds });
    await loadAll();
  };

  const handleDraftSaved = async (message: string) => {
    setFeedback({ type: "success", message });
    await loadAll();
  };

  const metrics = [
    { label: "Sources", value: sources.length, detail: "Saved study material." },
    {
      label: "Drafts waiting",
      value: drafts.filter((draft) => draft.sourceType === "source" && draft.contentStatus === "draft").length,
      detail: "Approve before study.",
      tone: "warm" as const,
    },
    {
      label: "Linked topics",
      value: new Set(sources.flatMap((source) => source.topicIds)).size,
      detail: "Connected to Progress.",
      tone: "good" as const,
    },
  ];
  const mobileTabs: Array<{ value: LibraryMobileTab; label: string }> = [
    { value: "sources", label: "Sources" },
    { value: "source", label: "Source" },
    { value: "actions", label: "Actions" },
  ];

  if (loading) {
    return (
      <AppPage title="Library" backHref="/dashboard" backLabel="Today">
        <div className="space-y-4">
          <Skeleton className="h-28" />
          <Skeleton className="h-80" />
        </div>
      </AppPage>
    );
  }

  return (
    <AppPage
      title="Library"
      backHref="/dashboard"
      backLabel="Today"
      width="study"
      action={
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => openSourceComposer("link")}
          >
            Add link
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => openSourceComposer("manual_note")}
          >
            Add note
          </Button>
          <Button type="button" onClick={() => openSourceComposer("file")}>
            Upload PDF
          </Button>
        </div>
      }
      contentClassName="space-y-4 sm:space-y-6"
    >
      {feedback ? <FeedbackBanner type={feedback.type} message={feedback.message} onDismiss={() => setFeedback(null)} /> : null}
      <Card tone="warm" padding="lg">
        <SectionHeader
          eyebrow="Library"
          title="Sources"
        />
        <div className="mt-5">
          <MetricStrip items={metrics} variant="compact" />
        </div>
      </Card>

      {showAddSource ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center px-4 py-5 sm:items-center">
          <button
            type="button"
            aria-label="Close add source"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowAddSource(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-library-source-title"
            className="relative max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-[1.6rem] border border-white/[0.12] bg-surface-panel-strong p-5 shadow-[0_24px_70px_rgba(0,0,0,0.42)]"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <SectionHeader
                eyebrow="Add source"
                title="Save study material"
              />
              <Button type="button" variant="secondary" onClick={() => setShowAddSource(false)}>
                Close
              </Button>
            </div>
            <div className="mt-5 grid gap-4 lg:grid-cols-[0.75fr_1.25fr]">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                {sourceTypes.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setSourceType(item.value)}
                    className={`w-full rounded-[1.2rem] border p-4 text-left transition ${
                      sourceType === item.value
                        ? "border-warm-border bg-warm-glow text-white"
                        : "border-white/[0.09] bg-white/[0.04] text-text-secondary hover:border-white/[0.16]"
                    }`}
                  >
                    <div className="font-semibold">{item.label}</div>
                  </button>
                ))}
              </div>
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input label="Title" value={title} onChange={(event) => setTitle(event.target.value)} />
                  <Input label="Subject" value={subject} onChange={(event) => setSubject(event.target.value)} />
                </div>
                {(sourceType === "pasted_text" || sourceType === "manual_note") ? (
                  <Textarea
                    label="Source text"
                    rows={8}
                    value={contentText}
                    onChange={(event) => setContentText(event.target.value)}
                  />
                ) : null}
                {sourceType === "link" ? (
                  <Input label="Source link" value={externalUrl} onChange={(event) => setExternalUrl(event.target.value)} />
                ) : null}
                {sourceType === "file" ? (
                  <div className="app-subtle-panel rounded-[1.25rem] p-4">
                    <label className="block text-sm font-semibold text-text-primary" htmlFor="library-source-file">
                      PDF or image
                    </label>
                    <input
                      id="library-source-file"
                      type="file"
                      accept="application/pdf,image/jpeg,image/png,image/webp"
                      onChange={(event) => {
                        const file = event.target.files?.[0] ?? null;
                        setSourceFile(file);
                        setFileName(file?.name ?? "");
                        setFileType(file?.type ?? "");
                        if (file && !title.trim()) {
                          setTitle(file.name.replace(/\.[^.]+$/, ""));
                        }
                      }}
                      className="mt-3 block w-full cursor-pointer rounded-[1rem] border border-[var(--color-field-border)] bg-[var(--color-field-bg)] p-3 text-sm text-[var(--color-field-text)] file:mr-3 file:rounded-full file:border-0 file:bg-[var(--button-secondary-bg)] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-[var(--button-secondary-text)]"
                    />
                    <p className="mt-2 text-xs leading-5 text-text-muted">
                      PDF, JPEG, PNG, or WebP. Stored for reference; no OCR or automatic reading.
                    </p>
                    {sourceFile ? (
                      <div className="mt-3 rounded-[1rem] border border-[var(--color-border)] bg-[var(--color-surface-panel)] px-3 py-2 text-sm text-text-secondary">
                        {sourceFile.name} · {Math.round(sourceFile.size / 1024)} KB
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">Topics</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {topics.length === 0 ? (
                      <span className="text-sm text-text-secondary">No topics yet.</span>
                    ) : (
                      topics.map((topic) => {
                        const active = selectedTopicIds.includes(topic.id);
                        return (
                          <button
                            key={topic.id}
                            type="button"
                            onClick={() =>
                              setSelectedTopicIds((current) =>
                                active ? current.filter((id) => id !== topic.id) : [...current, topic.id]
                              )
                            }
                            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                              active
                                ? "border-warm-border bg-warm-glow text-warm-accent"
                                : "border-white/[0.1] bg-white/[0.04] text-text-secondary"
                            }`}
                          >
                            {topic.name}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">Folders</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {folders.length === 0 ? (
                      <span className="text-sm text-text-secondary">No folders yet.</span>
                    ) : (
                      folders.map((folder) => {
                        const active = selectedFolderIds.includes(folder.id);
                        return (
                          <button
                            key={folder.id}
                            type="button"
                            onClick={() =>
                              setSelectedFolderIds((current) =>
                                active ? current.filter((id) => id !== folder.id) : [...current, folder.id]
                              )
                            }
                            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                              active
                                ? "border-warm-border bg-warm-glow text-warm-accent"
                                : "border-white/[0.1] bg-white/[0.04] text-text-secondary"
                            }`}
                          >
                            {folder.name}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
                <Button type="button" disabled={busyAction === "create-source"} onClick={createNextSource}>
                  {busyAction === "create-source"
                    ? sourceType === "file" && uploadProgress !== null
                      ? `Uploading ${uploadProgress}%`
                      : "Saving..."
                    : "Save source"}
                </Button>
                {busyAction === "create-source" &&
                sourceType === "file" &&
                uploadProgress !== null ? (
                  <div
                    role="progressbar"
                    aria-label="Source upload progress"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={uploadProgress}
                    className="h-2 overflow-hidden rounded-full bg-white/[0.08]"
                  >
                    <div
                      className="h-full rounded-full bg-[linear-gradient(90deg,var(--color-accent),var(--color-success))] transition-[width]"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {renameOpen && selectedSource ? (
        <div className="fixed inset-0 z-[65] flex items-end justify-center p-4 sm:items-center">
          <button
            type="button"
            aria-label="Close rename source"
            className="absolute inset-0 bg-black/65 backdrop-blur-sm"
            disabled={busyAction === "rename-source"}
            onClick={() => setRenameOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-source-title"
            className="app-panel relative w-full max-w-md rounded-[1.55rem] p-5 sm:p-6"
          >
            <h2 id="rename-source-title" className="text-xl font-semibold text-text-primary">
              Rename source
            </h2>
            <div className="mt-5">
              <Input
                label="Source title"
                value={renameTitle}
                autoFocus
                onChange={(event) => setRenameTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && renameTitle.trim()) {
                    void saveSourceRename();
                  }
                }}
              />
            </div>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="secondary"
                disabled={busyAction === "rename-source"}
                onClick={() => setRenameOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={
                  busyAction === "rename-source" || !renameTitle.trim()
                }
                onClick={() => void saveSourceRename()}
              >
                {busyAction === "rename-source" ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={managementAction === "archive"}
        title="Archive this source?"
        description="It will leave the active Library and its folders, but the source and uploaded file will be kept. You can restore it later."
        confirmLabel="Archive source"
        busy={busyAction === "archive-source"}
        tone="primary"
        onClose={() => setManagementAction(null)}
        onConfirm={() => void archiveSelectedSource()}
      />
      <ConfirmDialog
        open={managementAction === "delete"}
        title="Delete this source everywhere?"
        description="This permanently removes the source from Library and every folder. An uploaded file will also be deleted. This cannot be undone."
        confirmLabel="Delete source"
        busy={busyAction === "delete-source"}
        onClose={() => setManagementAction(null)}
        onConfirm={() => void deleteSelectedSource()}
      />
      {removalChooserOpen && selectedSource ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-source-folder-title"
            className="app-panel w-full max-w-md rounded-[1.55rem] p-5 sm:p-6"
          >
            <h2
              id="remove-source-folder-title"
              className="text-xl font-semibold text-text-primary"
            >
              Remove from a folder
            </h2>
            <p className="mt-2 text-sm leading-6 text-text-secondary">
              The source stays in Library and in any other folders.
            </p>
            <div className="mt-5 space-y-2">
              {getLinkedSourceFolders(selectedSource.folderIds, folders).map(
                (linkedFolder) => {
                return (
                  <button
                    key={linkedFolder.id}
                    type="button"
                    className="app-subtle-panel flex min-h-12 w-full items-center justify-between rounded-[1rem] px-4 text-left text-sm font-semibold text-text-primary transition hover:border-[var(--color-border-strong)]"
                    onClick={() => {
                      void toggleSourceFolder(linkedFolder.id).then(() => {
                        setRemovalChooserOpen(false);
                        setFeedback({
                          type: "success",
                          message: `Removed from ${linkedFolder.name}.`,
                        });
                      });
                    }}
                  >
                    <span>{linkedFolder.name}</span>
                    <span className="text-xs text-text-muted">Remove</span>
                  </button>
                );
                }
              )}
            </div>
            <div className="mt-6 flex justify-end">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setRemovalChooserOpen(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {sources.length > 0 ? (
        <Card padding="md">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(240px,1.35fr)_repeat(4,minmax(150px,0.75fr))]">
            <Input
              aria-label="Search Library"
              placeholder="Search titles and notes"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
            <label className="block">
              <span className="sr-only">Folder</span>
              <select
                value={folderFilter}
                onChange={(event) => setFolderFilter(event.target.value)}
                className="app-field min-h-[3.25rem] w-full rounded-[1.4rem] px-4 text-sm outline-none"
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
              <span className="sr-only">Source type</span>
              <select
                value={typeFilter}
                onChange={(event) =>
                  setTypeFilter(event.target.value as LibrarySourceTypeFilter)
                }
                className="app-field min-h-[3.25rem] w-full rounded-[1.4rem] px-4 text-sm outline-none"
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
              <span className="sr-only">Subject</span>
              <select
                value={subjectFilter}
                onChange={(event) => setSubjectFilter(event.target.value)}
                className="app-field min-h-[3.25rem] w-full rounded-[1.4rem] px-4 text-sm outline-none"
              >
                <option value="">All subjects</option>
                {subjects.map((nextSubject) => (
                  <option key={nextSubject} value={nextSubject}>
                    {nextSubject}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="sr-only">Source status</span>
              <select
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(
                    event.target.value as LibrarySourceStatusFilter
                  )
                }
                className="app-field min-h-[3.25rem] w-full rounded-[1.4rem] px-4 text-sm outline-none"
              >
                <option value="active">Active</option>
                <option value="archived">Archived</option>
                <option value="all">All statuses</option>
              </select>
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-pressed={recentOnly}
              onClick={() => setRecentOnly((value) => !value)}
              className={`min-h-10 rounded-full border px-3 text-xs font-semibold transition ${
                recentOnly
                  ? "app-selected"
                  : "border-white/[0.1] bg-white/[0.04] text-text-secondary"
              }`}
            >
              Added or updated recently
            </button>
            {searchTerm ? (
              <button
                type="button"
                className="app-chip min-h-10 rounded-full px-3 text-xs font-semibold"
                onClick={() => setSearchTerm("")}
              >
                Search: {searchTerm} x
              </button>
            ) : null}
            {folderFilter ? (
              <button
                type="button"
                className="app-chip min-h-10 rounded-full px-3 text-xs font-semibold"
                onClick={() => setFolderFilter("")}
              >
                Folder: {folders.find((folder) => folder.id === folderFilter)?.name ?? "Selected"} x
              </button>
            ) : null}
            {typeFilter !== "all" ? (
              <button
                type="button"
                className="app-chip min-h-10 rounded-full px-3 text-xs font-semibold"
                onClick={() => setTypeFilter("all")}
              >
                Type: {typeLabel(typeFilter)} x
              </button>
            ) : null}
            {subjectFilter ? (
              <button
                type="button"
                className="app-chip min-h-10 rounded-full px-3 text-xs font-semibold"
                onClick={() => setSubjectFilter("")}
              >
                Subject: {subjectFilter} x
              </button>
            ) : null}
            {statusFilter !== "active" ? (
              <button
                type="button"
                className="app-chip min-h-10 rounded-full px-3 text-xs font-semibold"
                onClick={() => setStatusFilter("active")}
              >
                Status: {statusFilter} x
              </button>
            ) : null}
            {searchTerm ||
            folderFilter ||
            typeFilter !== "all" ||
            subjectFilter ||
            recentOnly ||
            statusFilter !== "active" ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearFilters}
              >
                Clear all filters
              </Button>
            ) : null}
          </div>
        </Card>
      ) : null}

      {sources.length === 0 ? (
        <EmptyState
          emoji="Library"
          eyebrow="No sources yet"
          title="Build your study material hub."
          description="Upload a PDF or image, add a link, or write a note."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button type="button" onClick={() => openSourceComposer("file")}>
                Upload PDF
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => openSourceComposer("manual_note")}
              >
                Add note
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => openSourceComposer("link")}
              >
                Add link
              </Button>
            </div>
          }
        />
      ) : filteredSources.length === 0 ? (
        <EmptyState
          emoji="Search"
          eyebrow="No matching sources"
          title={
            searchTerm
              ? `No results for "${searchTerm}".`
              : "No sources match these filters."
          }
          description="Clear a filter or add another source."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button type="button" onClick={clearFilters}>
                Reset filters
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => openSourceComposer("manual_note")}
              >
                Add source
              </Button>
            </div>
          }
        />
      ) : (
        <>
        <div className="grid grid-cols-3 gap-2 rounded-[1.15rem] border border-white/[0.08] bg-white/[0.035] p-1.5 lg:hidden">
          {mobileTabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setMobileTab(tab.value)}
              className={`min-h-[2.4rem] rounded-[0.9rem] px-3 text-xs font-semibold transition ${
                mobileTab === tab.value
                  ? "bg-warm-glow text-warm-accent"
                  : "text-text-muted hover:bg-white/[0.05] hover:text-white"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(210px,0.72fr)_minmax(0,1.28fr)_minmax(230px,0.82fr)]">
          <Card
            padding="lg"
            className={`${mobileTab === "sources" ? "block" : "hidden"} lg:sticky lg:top-4 lg:block lg:self-start`}
          >
            <SectionHeader eyebrow="Sources" title="Saved material" />
            <div className="mt-5 space-y-3">
              {filteredSources.map((source) => {
                const active = source.id === selectedSource?.id;
                const linkedFolders = source.folderIds
                  .map(
                    (folderId) =>
                      folders.find((folder) => folder.id === folderId)?.name
                  )
                  .filter((name): name is string => Boolean(name));
                return (
                  <button
                    key={source.id}
                    type="button"
                    onClick={() => {
                      setSelectedSourceId(source.id);
                      setMobileTab("source");
                    }}
                    className={`w-full cursor-pointer rounded-[1.2rem] border p-4 text-left transition hover:-translate-y-px ${
                      active
                        ? "border-warm-border bg-warm-glow text-white"
                        : "border-white/[0.09] bg-white/[0.04] text-text-secondary hover:border-white/[0.16]"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span className="app-chip flex h-10 w-10 shrink-0 items-center justify-center rounded-[0.9rem]">
                        <SourceTypeIcon type={source.type} className="h-5 w-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">
                          {source.title}
                        </span>
                        <span className="mt-1 block text-xs text-text-muted">
                          {typeLabel(source.type)}
                          {linkedFolders[0] ? ` in ${linkedFolders[0]}` : ""}
                        </span>
                        <span className="mt-2 block text-[0.68rem] text-text-muted">
                          Added{" "}
                          {new Intl.DateTimeFormat("en", {
                            day: "numeric",
                            month: "short",
                            year:
                              new Date(source.createdAt).getFullYear() ===
                              new Date().getFullYear()
                                ? undefined
                                : "numeric",
                          }).format(source.createdAt)}
                        </span>
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>

          <div className={`${mobileTab === "source" ? "block" : "hidden"} min-w-0 space-y-4 lg:block`}>
            {selectedSource ? (
              <>
                <Card tone="warm" padding="lg">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="app-chip flex h-11 w-11 shrink-0 items-center justify-center rounded-[1rem]">
                        <SourceTypeIcon
                          type={selectedSource.type}
                          className="h-5 w-5"
                        />
                      </span>
                      <SectionHeader
                        eyebrow={typeLabel(selectedSource.type)}
                        title={selectedSource.title}
                        description={
                          selectedSource.subject || "No subject set yet."
                        }
                      />
                    </div>
                    {selectedSource.status === "archived" ? (
                      <span className="app-chip self-start rounded-full px-3 py-1.5 text-xs font-semibold">
                        Archived
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2 text-xs text-text-muted">
                    <span className="app-chip rounded-full px-3 py-1.5">
                      Added{" "}
                      {selectedSource.createdAt > 0
                        ? new Intl.DateTimeFormat("en", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          }).format(selectedSource.createdAt)
                        : "previously"}
                    </span>
                    {selectedSource.folderIds.slice(0, 2).map((folderId) => {
                      const folder = folders.find(
                        (candidate) => candidate.id === folderId
                      );
                      return folder ? (
                        <span
                          key={folder.id}
                          className="app-chip rounded-full px-3 py-1.5"
                        >
                          {folder.name}
                        </span>
                      ) : null;
                    })}
                    {topicNames(selectedSource.topicIds, topics).map((name) => (
                      <span key={name} className="app-chip rounded-full px-3 py-1.5">
                        {name}
                      </span>
                    ))}
                  </div>
                  <div
                    id="selected-source-preview"
                    className="mt-5 max-h-[24rem] scroll-mt-24 overflow-y-auto whitespace-pre-wrap rounded-[1.25rem] border border-white/[0.09] bg-white/[0.04] p-4 text-sm leading-6 text-text-secondary"
                  >
                    {sourcePreview(selectedSource)}
                  </div>
                  {selectedSource.type === "file" ? (
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      {selectedSourceFileUrl ? (
                        <ButtonLink
                          href={selectedSourceFileUrl}
                          target="_blank"
                          rel="noreferrer"
                          variant="secondary"
                          size="sm"
                        >
                          Open uploaded file
                        </ButtonLink>
                      ) : (
                        <span className="app-chip rounded-full px-3 py-1.5 text-xs font-semibold">
                          File saved
                        </span>
                      )}
                      {typeof selectedSource.sizeBytes === "number" ? (
                        <span className="app-chip rounded-full px-3 py-1.5 text-xs font-semibold">
                          {Math.round(selectedSource.sizeBytes / 1024)} KB
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="mt-5 flex flex-wrap gap-2 border-t border-white/[0.08] pt-4">
                    <Button type="button" onClick={openSelectedSource}>
                      Open
                    </Button>
                    {canRemoveSourceFromFilteredFolder(
                      folderFilter,
                      selectedSource.folderIds
                    ) ? (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          const folderName =
                            folders.find((folder) => folder.id === folderFilter)
                              ?.name ?? "folder";
                          void toggleSourceFolder(folderFilter).then(() =>
                            setFeedback({
                              type: "success",
                              message: `Removed from ${folderName}.`,
                            })
                          );
                        }}
                      >
                        Remove from{" "}
                        {folders.find((folder) => folder.id === folderFilter)
                          ?.name ?? "folder"}
                      </Button>
                    ) : null}
                    <details className="group/source-actions relative">
                      <summary className="app-button-secondary inline-flex min-h-[2.75rem] cursor-pointer list-none items-center justify-center rounded-[2rem] px-4 py-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
                        More actions
                      </summary>
                      <div className="absolute left-0 top-[calc(100%+0.5rem)] z-40 grid min-w-56 gap-1 rounded-[1rem] border border-[var(--color-border)] bg-[var(--color-surface-panel-strong)] p-2 shadow-[var(--shadow-shell)]">
                        <button
                          type="button"
                          className="rounded-xl px-3 py-2 text-left text-sm font-medium text-text-secondary hover:bg-[var(--color-glass-subtle)] hover:text-text-primary"
                          onClick={(event) => {
                            event.currentTarget
                              .closest("details")
                              ?.removeAttribute("open");
                            setRenameTitle(selectedSource.title);
                            setRenameOpen(true);
                          }}
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          className="rounded-xl px-3 py-2 text-left text-sm font-medium text-text-secondary hover:bg-[var(--color-glass-subtle)] hover:text-text-primary"
                          onClick={(event) => {
                            event.currentTarget
                              .closest("details")
                              ?.removeAttribute("open");
                            openFolderPlacement();
                          }}
                        >
                          Manage folders
                        </button>
                        {!folderFilter &&
                        selectedSource.folderIds.length > 0 ? (
                          <button
                            type="button"
                            className="rounded-xl px-3 py-2 text-left text-sm font-medium text-text-secondary hover:bg-[var(--color-glass-subtle)] hover:text-text-primary"
                            onClick={(event) => {
                              event.currentTarget
                                .closest("details")
                                ?.removeAttribute("open");
                              setRemovalChooserOpen(true);
                            }}
                          >
                            Remove from folder...
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={busyAction === "restore-source"}
                          className="rounded-xl px-3 py-2 text-left text-sm font-medium text-text-secondary hover:bg-[var(--color-glass-subtle)] hover:text-text-primary disabled:opacity-50"
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
                          className="rounded-xl px-3 py-2 text-left text-sm font-semibold text-[var(--color-error-text)] hover:bg-[var(--color-error-muted)]"
                          onClick={(event) => {
                            event.currentTarget
                              .closest("details")
                              ?.removeAttribute("open");
                            setManagementAction("delete");
                          }}
                        >
                          Delete from Library
                        </button>
                      </div>
                    </details>
                  </div>
                </Card>
                <Card padding="lg">
                  <SectionHeader
                    eyebrow="Draft review"
                    title="Source-generated drafts"
                  />
                  <div className="mt-5 space-y-3">
                    {sourceDrafts.length === 0 ? (
                      <p className="rounded-[1.2rem] border border-white/[0.09] bg-white/[0.035] p-4 text-sm leading-6 text-text-secondary">
                        No drafts waiting.
                      </p>
                    ) : (
                      <>
                        <div className="rounded-[1.15rem] border border-white/[0.09] bg-white/[0.035] p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <div className="text-sm font-semibold text-white">
                                Draft queue: {sourceDrafts.length}
                              </div>
                              <p className="mt-1 text-xs leading-5 text-text-muted">
                                Review one draft at a time so generated content does not flood Learn or Practice.
                              </p>
                            </div>
                            <span className="rounded-full border border-warm-border bg-warm-glow px-3 py-1 text-xs font-semibold text-warm-accent">
                              Draft-only
                            </span>
                          </div>
                          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                            {sourceDrafts.map((draft, index) => {
                              const active = selectedDraft?.id === draft.id;
                              return (
                                <button
                                  key={draft.id}
                                  type="button"
                                  onClick={() => setSelectedDraftId(draft.id)}
                                  className={`min-w-[13rem] rounded-[1rem] border p-3 text-left transition ${
                                    active
                                      ? "border-warm-border bg-warm-glow text-white"
                                      : "border-white/[0.09] bg-white/[0.04] text-text-secondary hover:border-white/[0.16]"
                                  }`}
                                >
                                  <div className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">
                                    Draft {index + 1}
                                  </div>
                                  <div className="mt-1 line-clamp-2 text-sm font-semibold text-white">
                                    {draft.kind === "flashcard"
                                      ? draft.front ?? "Flashcard draft"
                                      : draft.questionText ?? "Practice question draft"}
                                  </div>
                                  <div className="mt-2 text-xs text-text-muted">
                                    {draft.kind === "flashcard" ? "Flashcard" : "Notebook page"}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        {selectedDraft ? (
                          <DraftEditor
                            key={selectedDraft.id}
                            draft={selectedDraft}
                            topics={topics}
                            decks={decks}
                            notebooks={notebooks}
                            selectedDeckId={deckIdByDraft[selectedDraft.id] ?? decks[0]?.id ?? ""}
                            selectedNotebookId={notebookIdByDraft[selectedDraft.id] ?? notebooks[0]?.id ?? ""}
                            onDeckChange={(value) => setDeckIdByDraft((current) => ({ ...current, [selectedDraft.id]: value }))}
                            onNotebookChange={(value) => setNotebookIdByDraft((current) => ({ ...current, [selectedDraft.id]: value }))}
                            onSaved={handleDraftSaved}
                            userId={user.uid}
                            sourceTitle={selectedSource.title}
                          />
                        ) : null}
                      </>
                    )}
                  </div>
                </Card>
              </>
            ) : null}
          </div>

          <div className={`${mobileTab === "actions" ? "block" : "hidden"} space-y-4 lg:sticky lg:top-4 lg:block lg:self-start`}>
            <Card padding="lg">
              <SectionHeader
                eyebrow="Actions"
                title="Use this source"
              />
              {selectedSource ? (
                <div className="mt-5 space-y-3">
                  <Textarea
                    label="Tutor request"
                    rows={4}
                    value={tutorMessage}
                    onChange={(event) => setTutorMessage(event.target.value)}
                  />
                  <div className="grid gap-2">
                    <Button type="button" variant="secondary" disabled={busyAction === "source-tutor"} onClick={runSourceTutor}>
                      {busyAction === "source-tutor" ? "Asking..." : "Ask Tutor about source"}
                    </Button>
                    <Button type="button" variant="secondary" disabled={busyAction === "flashcard"} onClick={() => generateDrafts("flashcard")}>
                      {busyAction === "flashcard" ? "Generating..." : "Make up to 8 flashcards"}
                    </Button>
                    <Button type="button" variant="secondary" disabled={busyAction === "practice-question"} onClick={() => generateDrafts("practice-question")}>
                      {busyAction === "practice-question" ? "Generating..." : "Make up to 5 notebook questions"}
                    </Button>
                  </div>
                </div>
              ) : null}
            </Card>
            <Card padding="lg">
              <SectionHeader
                eyebrow="Topic links"
                title="Connect to Progress"
              />
              <div className="mt-5 flex flex-wrap gap-2">
                {selectedSource && topics.length > 0 ? (
                  topics.map((topic) => {
                    const active = selectedSource.topicIds.includes(topic.id);
                    return (
                      <button
                        key={topic.id}
                        type="button"
                        onClick={() => void toggleSourceTopic(topic.id)}
                        className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                          active
                            ? "border-warm-border bg-warm-glow text-warm-accent"
                            : "border-white/[0.1] bg-white/[0.04] text-text-secondary"
                        }`}
                      >
                        {topic.name}
                      </button>
                    );
                  })
                ) : (
                  <p className="text-sm leading-6 text-text-secondary">
                    No topics yet.
                  </p>
                )}
              </div>
            </Card>
            <Card
              id="source-folder-placement"
              className="scroll-mt-24"
              padding="lg"
            >
              <SectionHeader
                eyebrow="Folder placement"
                title="Place in folders"
              />
              <div className="mt-5 flex flex-wrap gap-2">
                {selectedSource && folders.length > 0 ? (
                  folders.map((folder) => {
                    const active = selectedSource.folderIds.includes(folder.id);
                    return (
                      <button
                        key={folder.id}
                        type="button"
                        onClick={() => void toggleSourceFolder(folder.id)}
                        className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                          active
                            ? "border-warm-border bg-warm-glow text-warm-accent"
                            : "border-white/[0.1] bg-white/[0.04] text-text-secondary"
                        }`}
                      >
                        {folder.name}
                      </button>
                    );
                  })
                ) : (
                  <p className="text-sm leading-6 text-text-secondary">
                    No folders yet.
                  </p>
                )}
              </div>
            </Card>
            <Card padding="lg">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <SectionHeader
                  eyebrow="Source Tutor"
                  title="Tutor transcript"
                />
                {tutorMessages.length > 0 ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setShowTutorTranscript((value) => !value)}
                  >
                    {showTutorTranscript ? "Collapse" : "Show"}
                  </Button>
                ) : null}
              </div>
              {showTutorTranscript ? (
                <div className="mt-5 max-h-80 space-y-3 overflow-y-auto pr-1">
                  {tutorMessages.length === 0 ? (
                    <p className="rounded-[1.2rem] border border-white/[0.09] bg-white/[0.035] p-4 text-sm leading-6 text-text-secondary">
                      No Tutor messages yet.
                    </p>
                  ) : (
                    tutorMessages.map((message, index) => (
                      <div
                        key={`${message.role}-${index}`}
                        className={`rounded-[1.1rem] border p-4 text-sm leading-6 ${
                          message.role === "model"
                            ? "border-warm-border bg-warm-glow text-white"
                            : "border-white/[0.09] bg-white/[0.04] text-text-secondary"
                        }`}
                      >
                        <div className="mb-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-text-muted">
                          {message.role === "model" ? "Jami Tutor" : "You"}
                        </div>
                        {message.text}
                      </div>
                    ))
                  )}
                </div>
              ) : (
                <p className="mt-4 rounded-[1.2rem] border border-white/[0.09] bg-white/[0.035] p-4 text-sm leading-6 text-text-secondary">
                  Transcript collapsed. Source Tutor has {tutorMessages.length} message{tutorMessages.length === 1 ? "" : "s"} in this session.
                </p>
              )}
            </Card>
          </div>
        </div>
        </>
      )}
      <div className="text-sm text-text-muted">
        Need cards instead? <Link className="text-warm-accent hover:text-white" href="/dashboard/cards">Open Cards</Link>.
      </div>
    </AppPage>
  );
}
