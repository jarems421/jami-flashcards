"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useUser } from "@/lib/auth/user-context";
import type { Source, SourceType } from "@/lib/practice/sources";
import type { Topic } from "@/lib/practice/topics";
import type { Notebook } from "@/lib/workspace/notebooks";
import type { Deck } from "@/services/study/decks";
import {
  getGeneratedContentDrafts,
  type GeneratedContentDraft,
} from "@/services/study/generated-content";
import { getDecks } from "@/services/study/decks";
import { getActiveStudyFolders } from "@/services/study/folders";
import { getActiveNotebooks } from "@/services/study/notebooks";
import { getActiveTopics } from "@/services/study/topics";
import { isFirebasePermissionDenied } from "@/services/firebase/errors";
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
import type { StudyFolder } from "@/lib/workspace/study-folders";
import { addFolderId, removeFolderId } from "@/lib/workspace/folder-links";
import {
  buildLibraryBrowserSearch,
  getLibraryBrowserStateFromSearch,
  type LibrarySourceStatusFilter,
  type LibrarySourceTypeFilter,
} from "@/lib/study/library-navigation";
import {
  buildSourceComposerContent,
  clearFilenameDerivedTitle,
  getSourceTitleFromFileName,
  type SourceComposerKind,
} from "@/lib/study/source-composer";
import JamiAssistantDrawer from "@/components/ai/JamiAssistantDrawer";
import AppPage from "@/components/layout/AppPage";
import SourcePreview from "@/components/library/SourcePreview";
import SourceDetailsDrawer from "@/components/library/SourceDetailsDrawer";
import SourceDraftsDrawer from "@/components/library/SourceDraftsDrawer";
import {
  closeDisclosureAndFocusTrigger,
  sourceDisplayLabel,
  sourceTypeLabel,
  sourceTypes,
  SourceActionIcon,
  SourceFolderPicker,
  SourceTypeIcon,
} from "@/components/library/SourceWorkspace";
import type { SourceWorkspaceFeedback } from "@/components/library/source-workspace-types";
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

type LibraryMobileTab = "sources" | "source";
type SourceManagementAction = "archive" | "delete" | null;
type SourceWorkspacePanel = "tutor" | "details" | "drafts" | null;

const sourceComposerKinds: Array<{
  value: SourceComposerKind;
  label: string;
}> = [
  { value: "text", label: "Text" },
  { value: "link", label: "Link" },
  { value: "upload", label: "Upload" },
];

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
  const [feedback, setFeedback] = useState<SourceWorkspaceFeedback | null>(null);
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
  const sourceComposerPrefillHandledRef = useRef(false);
  const filterDisclosureRef = useRef<HTMLDetailsElement>(null);
  const sourceActionsDisclosureRef = useRef<HTMLDetailsElement>(null);
  const [sourceFileUrls, setSourceFileUrls] = useState<Record<string, string>>({});
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
  const closeWorkspacePanel = useCallback(() => {
    setActivePanel(null);
  }, []);

  useEffect(() => {
    const closeMenusOnOutsidePointer = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      for (const disclosure of [
        filterDisclosureRef.current,
        sourceActionsDisclosureRef.current,
      ]) {
        if (disclosure?.open && !disclosure.contains(event.target)) {
          disclosure.removeAttribute("open");
        }
      }
    };

    document.addEventListener("pointerdown", closeMenusOnOutsidePointer);
    return () =>
      document.removeEventListener("pointerdown", closeMenusOnOutsidePointer);
  }, []);

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
    if (loading || sourceComposerPrefillHandledRef.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("create") !== "1") return;

    sourceComposerPrefillHandledRef.current = true;
    const requestedFolderId = params.get("folderId")?.trim() ?? "";
    if (requestedFolderId && folders.some((folder) => folder.id === requestedFolderId)) {
      setSelectedFolderIds([requestedFolderId]);
    }
    setShowAddSource(true);

    params.delete("create");
    params.delete("folderId");
    const nextSearch = params.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`
    );
  }, [folders, loading]);

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
    } catch (error) {
      console.error(error);
      setSources([]);
      setTopics([]);
      setFolders([]);
      setDecks([]);
      setNotebooks([]);
      setDrafts([]);
      if (!isFirebasePermissionDenied(error)) {
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

  const openWorkspacePanel = (
    panel: Exclude<SourceWorkspacePanel, null | "tutor">
  ) => {
    setFeedback(null);
    setActivePanel(panel);
  };

  const openTutorForSelectedSource = () => {
    if (!selectedSource) return;
    setFeedback(null);
    setActivePanel("tutor");
  };

  const clearFilters = () => {
    setSearchTerm("");
    setFolderFilter("");
    setTypeFilter("all");
    setStatusFilter("active");
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

      <JamiAssistantDrawer
        open={activePanel === "tutor"}
        onOpenChange={(open) => {
          if (!open) closeWorkspacePanel();
        }}
        resetKey={selectedSource?.id ?? "no-source"}
        contextKey={`sources:${selectedSource?.id ?? ""}`}
        contextLabel="Current source"
        historyContextLabel={selectedSource?.title ?? "Source"}
        getContext={() => ({
          surface: "sources",
          sourceIds: selectedSource ? [selectedSource.id] : [],
        })}
        quickActions={[
          {
            label: "Explain key ideas",
            prompt: "Explain the key ideas in this source clearly.",
          },
          {
            label: "Revision summary",
            prompt: "Summarise this source for revision.",
          },
          {
            label: "Quiz me",
            prompt: "Quiz me on the most important ideas in this source.",
          },
        ]}
      />

      <SourceDetailsDrawer
        open={activePanel === "details"}
        source={selectedSource ?? null}
        folders={folders}
        topics={topics}
        userId={user.uid}
        feedback={feedback}
        busyAction={busyAction}
        onClose={closeWorkspacePanel}
        onDismissFeedback={() => setFeedback(null)}
        onToggleFolder={(folderId) => void toggleSourceFolder(folderId)}
        onUpdateTopics={(topicIds) =>
          void updateSelectedSourceTopics(topicIds)
        }
        onTopicsChange={setTopics}
      />

      <SourceDraftsDrawer
        open={activePanel === "drafts"}
        drafts={sourceDrafts}
        selectedDraft={selectedDraft ?? null}
        sourceTitle={selectedSource?.title ?? null}
        topics={topics}
        decks={decks}
        notebooks={notebooks}
        deckIdByDraft={deckIdByDraft}
        notebookIdByDraft={notebookIdByDraft}
        userId={user.uid}
        feedback={feedback}
        onClose={closeWorkspacePanel}
        onDismissFeedback={() => setFeedback(null)}
        onSelectDraft={setSelectedDraftId}
        onDeckChange={(draftId, deckId) =>
          setDeckIdByDraft((current) => ({
            ...current,
            [draftId]: deckId,
          }))
        }
        onNotebookChange={(draftId, notebookId) =>
          setNotebookIdByDraft((current) => ({
            ...current,
            [draftId]: notebookId,
          }))
        }
        onSaved={handleDraftSaved}
        onTopicsChange={setTopics}
      />

      <p className="px-1 text-sm leading-6 text-text-muted">
        Save references, read them here, and ask Jami when you need help.
      </p>

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
                <div className="flex items-center gap-2">
                  <Input
                    type="search"
                    aria-label="Search Sources"
                    placeholder="Search sources"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    containerClassName="min-w-0 flex-1"
                    className="!rounded-[1.1rem] !px-4 !py-3"
                  />
                  <details
                    ref={filterDisclosureRef}
                    className="group relative shrink-0"
                    onKeyDown={(event) => {
                      if (event.key !== "Escape") return;
                      event.preventDefault();
                      event.currentTarget.removeAttribute("open");
                      event.currentTarget
                        .querySelector<HTMLElement>("summary")
                        ?.focus();
                    }}
                  >
                    <summary
                      aria-label={
                        activeFilterCount > 0
                          ? `Filter sources, ${activeFilterCount} active ${
                              activeFilterCount === 1 ? "filter" : "filters"
                            }`
                          : "Filter sources"
                      }
                      className="app-button-secondary relative grid h-11 w-11 cursor-pointer list-none place-items-center rounded-full [&::-webkit-details-marker]:hidden"
                    >
                      <SourceActionIcon name="filter" />
                      {activeFilterCount > 0 ? (
                        <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full border border-[var(--color-surface-panel-strong)] bg-[var(--color-accent)] px-1 text-[0.62rem] font-semibold text-[var(--color-text-inverse)]">
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
                                {sourceTypeLabel(type.value)}
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
                            closeDisclosureAndFocusTrigger(event.currentTarget);
                          }}
                        >
                          Clear filters
                        </Button>
                      ) : null}
                    </div>
                  </details>
                </div>
                {searchTerm || activeFilterCount > 0 ? (
                  <p className="mt-2 px-1 text-xs text-text-muted" aria-live="polite">
                    {filteredSources.length} result
                    {filteredSources.length === 1 ? "" : "s"}
                  </p>
                ) : null}
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
                          "group relative flex min-h-[4.25rem] w-full items-center gap-2.5 border-b border-[var(--color-border)] px-4 py-2.5 text-left transition " +
                          (active
                            ? "bg-[var(--color-selected-bg)] text-text-primary"
                            : "text-text-secondary hover:bg-[var(--color-glass-subtle)]")
                        }
                      >
                        {active ? (
                          <span
                            aria-hidden="true"
                            className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-[var(--color-accent)]"
                          />
                        ) : null}
                        <SourceTypeIcon
                          type={source.type}
                          className="h-4 w-4 shrink-0 text-text-muted"
                        />
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
                  <header className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface-panel-strong)] px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
                    <div className="flex min-w-0 items-start gap-3">
                      <button
                        type="button"
                        aria-label="Back to all sources"
                        onClick={() => setMobileTab("sources")}
                        className={[
                          styles.mobileOnly,
                          "grid h-11 w-11 shrink-0 place-items-center rounded-full text-text-muted transition hover:bg-[var(--color-glass-subtle)] hover:text-text-primary",
                        ].join(" ")}
                      >
                        <SourceActionIcon
                          name="arrow-left"
                          className="h-5 w-5"
                        />
                      </button>
                      <div className="min-w-0 flex-1">
                        <h2 className="break-words text-lg font-semibold leading-6 text-text-primary sm:text-xl">
                          {selectedSource.title}
                        </h2>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
                          <span>{sourceDisplayLabel(selectedSource)}</span>
                          {selectedSource.status === "archived" ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-semibold text-text-secondary">
                                Archived
                              </span>
                            </>
                          ) : null}
                          {sourceDrafts.length > 0 ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <button
                                type="button"
                                aria-label={`Review ${sourceDrafts.length} ${
                                  sourceDrafts.length === 1 ? "draft" : "drafts"
                                } from this source`}
                                className="font-semibold text-text-secondary underline-offset-4 hover:text-text-primary hover:underline"
                                onClick={() => openWorkspacePanel("drafts")}
                              >
                                {sourceDrafts.length} draft
                                {sourceDrafts.length === 1 ? "" : "s"}
                              </button>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        className="min-h-11"
                        onClick={openTutorForSelectedSource}
                      >
                        <SourceActionIcon
                          name="sparkles"
                          className="mr-2 h-4 w-4"
                        />
                        Ask Jami about this
                      </Button>

                      <details
                        key={selectedSource.id}
                        ref={sourceActionsDisclosureRef}
                        className="group relative ml-auto"
                        onKeyDown={(event) => {
                          if (event.key !== "Escape") return;
                          event.preventDefault();
                          event.currentTarget.removeAttribute("open");
                          event.currentTarget
                            .querySelector<HTMLElement>("summary")
                            ?.focus();
                        }}
                      >
                        <summary
                          aria-label="More source actions"
                          className="grid h-11 w-11 cursor-pointer list-none place-items-center rounded-full text-text-muted transition hover:bg-[var(--color-glass-subtle)] hover:text-text-primary [&::-webkit-details-marker]:hidden"
                        >
                          <SourceActionIcon
                            name="more"
                            className="h-5 w-5"
                          />
                        </summary>
                        <div className="absolute right-0 top-[calc(100%+0.4rem)] z-40 grid min-w-48 gap-1 rounded-[1rem] border border-[var(--color-border-strong)] bg-[var(--color-surface-panel-strong)] p-1.5 shadow-[var(--shadow-shell)]">
                          {canOpenSelectedSource ? (
                            <button
                              type="button"
                              className="min-h-11 rounded-[0.75rem] px-3 text-left text-sm font-medium text-text-secondary hover:bg-[var(--color-glass-subtle)] hover:text-text-primary"
                              onClick={(event) => {
                                closeDisclosureAndFocusTrigger(event.currentTarget);
                                openSelectedSource();
                              }}
                            >
                              Open original
                              <span className="sr-only"> in a new tab</span>
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="min-h-11 rounded-[0.75rem] px-3 text-left text-sm font-medium text-text-secondary hover:bg-[var(--color-glass-subtle)] hover:text-text-primary"
                            onClick={(event) => {
                              closeDisclosureAndFocusTrigger(event.currentTarget);
                              openWorkspacePanel("details");
                            }}
                          >
                            Details and organisation
                          </button>
                          {sourceDrafts.length > 0 ? (
                            <button
                              type="button"
                              className="min-h-11 rounded-[0.75rem] px-3 text-left text-sm font-medium text-text-secondary hover:bg-[var(--color-glass-subtle)] hover:text-text-primary"
                              onClick={(event) => {
                                closeDisclosureAndFocusTrigger(event.currentTarget);
                                openWorkspacePanel("drafts");
                              }}
                            >
                              Drafts ({sourceDrafts.length})
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="min-h-11 rounded-[0.75rem] px-3 text-left text-sm font-medium text-text-secondary hover:bg-[var(--color-glass-subtle)] hover:text-text-primary"
                            onClick={(event) => {
                              closeDisclosureAndFocusTrigger(event.currentTarget);
                              setFeedback(null);
                              setRenameTitle(selectedSource.title);
                              setRenameOpen(true);
                            }}
                          >
                            Rename
                          </button>
                          <div
                            aria-hidden="true"
                            className="my-1 h-px bg-[var(--color-border)]"
                          />
                          <button
                            type="button"
                            disabled={busyAction === "restore-source"}
                            className="min-h-11 rounded-[0.75rem] px-3 text-left text-sm font-medium text-text-secondary hover:bg-[var(--color-glass-subtle)] hover:text-text-primary disabled:opacity-50"
                            onClick={(event) => {
                              closeDisclosureAndFocusTrigger(event.currentTarget);
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
                            className="min-h-11 rounded-[0.75rem] px-3 text-left text-sm font-semibold text-[var(--color-error-text)] hover:bg-[var(--color-error-muted)]"
                            onClick={(event) => {
                              closeDisclosureAndFocusTrigger(event.currentTarget);
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
                      "min-h-0 flex-1 bg-[var(--color-surface-panel-strong)]",
                    ].join(" ")}
                  >
                    <SourcePreview
                      source={selectedSource}
                      fileUrl={selectedSourceFileUrl}
                    />
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
