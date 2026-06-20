"use client";

import Link from "next/link";
import { FirebaseError } from "firebase/app";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppPage from "@/components/layout/AppPage";
import FolderObjectCard from "@/components/workspace/FolderObjectCard";
import DeckObjectCard from "@/components/workspace/DeckObjectCard";
import NotebookEditorDialog from "@/components/workspace/NotebookEditorDialog";
import { NotebookObjectCard } from "@/components/workspace/NotebookObjectCard";
import TopicPicker from "@/components/topics/TopicPicker";
import { ObjectStylePicker } from "@/components/workspace/ObjectStylePicker";
import {
  normalizeObjectColor,
  normalizeObjectIcon,
  type ObjectColorId,
  type ObjectIconId,
} from "@/components/workspace/object-card-styles";
import {
  Button,
  Card,
  EmptyState,
  FeedbackBanner,
  Input,
  SectionHeader,
  Skeleton,
  Textarea,
} from "@/components/ui";
import { featureFlags } from "@/lib/app/feature-flags";
import { getDeckHref } from "@/lib/app/routes";
import { useUser } from "@/lib/auth/user-context";
import type { Source, SourceType } from "@/lib/practice/sources";
import type { Topic } from "@/lib/practice/topics";
import { addFolderId, removeFolderId } from "@/lib/workspace/folder-links";
import {
  buildFolderTabSearch,
  getFolderTabFromSearch,
  type FolderWorkspaceTab,
} from "@/lib/workspace/folder-navigation";
import type { Notebook, NotebookPageColor, NotebookPageStyle } from "@/lib/workspace/notebooks";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import { getDecks, updateDeckFolders, type Deck } from "@/services/study/decks";
import { archiveStudyFolder, getStudyFolderById, updateStudyFolder } from "@/services/study/folders";
import {
  createNotebook,
  createNotebookPage,
  getNotebooksForFolder,
} from "@/services/study/notebooks";
import { importUploadedNotebook } from "@/services/study/notebook-import";
import { createSource, getActiveSources, updateSource } from "@/services/study/sources";
import { getActiveTopics } from "@/services/study/topics";

type Feedback = { type: "success" | "error"; message: string };
function isPermissionDenied(error: unknown) {
  return error instanceof FirebaseError && error.code === "permission-denied";
}

function resultValue<T>(result: PromiseSettledResult<T>, fallback: T) {
  return result.status === "fulfilled" ? result.value : fallback;
}

function resultError(result: PromiseSettledResult<unknown>) {
  return result.status === "rejected" ? result.reason : null;
}

function formatEditedLabel(updatedAt: number) {
  const elapsed = Math.max(0, Date.now() - updatedAt);
  const hours = Math.floor(elapsed / 3_600_000);
  if (hours < 1) return "Edited recently";
  if (hours < 24) return `Edited ${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Edited ${days}d ago`;
  return `Edited ${new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
  }).format(updatedAt)}`;
}

export default function FolderDetailPage() {
  const { user, isDemoUser } = useUser();
  const router = useRouter();
  const params = useParams<{ folderId?: string | string[] }>();
  const folderId = Array.isArray(params.folderId) ? params.folderId[0] : params.folderId;
  const [folder, setFolder] = useState<StudyFolder | null>(null);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [editingNotebook, setEditingNotebook] = useState<Notebook | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busyAssetId, setBusyAssetId] = useState<string | null>(null);
  const [showNotebookForm, setShowNotebookForm] = useState(false);
  const [notebookTitle, setNotebookTitle] = useState("");
  const [notebookColor, setNotebookColor] = useState<ObjectColorId>("violet");
  const [notebookIcon, setNotebookIcon] = useState<ObjectIconId>("none");
  const [notebookPageColor, setNotebookPageColor] = useState<NotebookPageColor>("white");
  const [notebookPageStyle, setNotebookPageStyle] = useState<NotebookPageStyle>("plain");
  const [notebookFile, setNotebookFile] = useState<File | null>(null);
  const [notebookTopicIds, setNotebookTopicIds] = useState<string[]>([]);
  const [creatingNotebook, setCreatingNotebook] = useState(false);
  const [notebookUploadProgress, setNotebookUploadProgress] = useState<
    number | null
  >(null);
  const [activeTab, setActiveTab] = useState<FolderWorkspaceTab>(() =>
    typeof window === "undefined"
      ? "notebooks"
      : getFolderTabFromSearch(window.location.search)
  );
  const [showEditFolder, setShowEditFolder] = useState(false);
  const [editFolderName, setEditFolderName] = useState("");
  const [editFolderColor, setEditFolderColor] = useState<ObjectColorId>("sky");
  const [editFolderIcon, setEditFolderIcon] = useState<ObjectIconId>("none");
  const [savingFolder, setSavingFolder] = useState(false);
  const [showDeckPicker, setShowDeckPicker] = useState(false);
  const [deckSearch, setDeckSearch] = useState("");
  const [selectedDeckIds, setSelectedDeckIds] = useState<string[]>([]);
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  const [sourceSearch, setSourceSearch] = useState("");
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [showCreateSource, setShowCreateSource] = useState(false);
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceType, setSourceType] = useState<SourceType>("pasted_text");
  const [sourceText, setSourceText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceFileName, setSourceFileName] = useState("");
  const [sourceTopicIds, setSourceTopicIds] = useState<string[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);

  useEffect(() => {
    const handlePopState = () => {
      setActiveTab(getFolderTabFromSearch(window.location.search));
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const selectFolderTab = (tab: FolderWorkspaceTab) => {
    setActiveTab(tab);
    const nextSearch = buildFolderTabSearch(window.location.search, tab);
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${nextSearch}${window.location.hash}`
    );
  };

  const loadFolder = useCallback(async () => {
    if (!user?.uid || !folderId || !featureFlags.enableFolders) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [
        folderResult,
        decksResult,
        sourcesResult,
        notebooksResult,
        topicsResult,
      ] = await Promise.allSettled([
        getStudyFolderById(user.uid, folderId),
        getDecks(user.uid),
        getActiveSources(user.uid),
        getNotebooksForFolder(user.uid, folderId),
        getActiveTopics(user.uid),
      ]);

      if (folderResult.status === "rejected") {
        throw folderResult.reason;
      }

      const optionalErrors = [
        decksResult,
        sourcesResult,
        notebooksResult,
        topicsResult,
      ]
        .map(resultError)
        .filter(Boolean);

      if (optionalErrors.length > 0) {
        console.warn("Some folder sections could not load.", optionalErrors);
        setFeedback({
          type: "error",
          message:
            "This folder opened, but one section is still syncing. Refresh in a moment if something looks missing.",
        });
      }

      const nextFolder = folderResult.value;
      const nextDecks = resultValue<Deck[]>(decksResult, []);
      const nextSources = resultValue<Source[]>(sourcesResult, []);
      const nextNotebooks = resultValue<Notebook[]>(notebooksResult, []);
      const nextTopics = resultValue<Topic[]>(topicsResult, []);

      setFolder(nextFolder);
      setDecks(nextDecks);
      setSources(nextSources);
      setNotebooks(nextNotebooks);
      setTopics(nextTopics);
    } catch (error) {
      console.error(error);
      setFeedback({
        type: "error",
        message: isPermissionDenied(error)
          ? "Could not open this folder yet. Refresh once the workspace has finished syncing."
          : "Could not load this folder. Try refreshing in a moment.",
      });
    } finally {
      setLoading(false);
    }
  }, [folderId, user?.uid]);

  useEffect(() => {
    void loadFolder();
  }, [loadFolder]);

  const folderDecks = useMemo(
    () => decks.filter((deck) => folder && deck.folderIds.includes(folder.id)),
    [decks, folder]
  );
  const availableDecks = useMemo(
    () =>
      decks.filter(
        (deck) =>
          folder &&
          !deck.folderIds.includes(folder.id) &&
          deck.name.toLowerCase().includes(deckSearch.trim().toLowerCase())
      ),
    [deckSearch, decks, folder]
  );
  const folderSources = useMemo(
    () => sources.filter((source) => folder && source.folderIds.includes(folder.id)),
    [folder, sources]
  );
  const availableSources = useMemo(
    () =>
      sources.filter(
        (source) =>
          folder &&
          !source.folderIds.includes(folder.id) &&
          source.title.toLowerCase().includes(sourceSearch.trim().toLowerCase())
      ),
    [folder, sourceSearch, sources]
  );
  const mergeFolderId = (folderIds: string[], shouldLink: boolean) => {
    if (!folder) return folderIds;
    return shouldLink ? addFolderId(folderIds, folder.id) : removeFolderId(folderIds, folder.id);
  };

  const openEditFolder = () => {
    if (!folder) return;
    setEditFolderName(folder.name);
    setEditFolderColor(normalizeObjectColor(folder.color));
    setEditFolderIcon(normalizeObjectIcon(folder.icon));
    setShowEditFolder(true);
  };

  const toggleDeckFolder = async (deck: Deck) => {
    if (!user?.uid || !folder) return;
    const shouldLink = !deck.folderIds.includes(folder.id);
    setBusyAssetId(deck.id);
    try {
      const folderIds = mergeFolderId(deck.folderIds, shouldLink);
      await updateDeckFolders(user.uid, deck.id, folderIds);
      setDecks((current) =>
        current.map((item) => (item.id === deck.id ? { ...item, folderIds } : item))
      );
      setFeedback({
        type: "success",
        message: shouldLink
          ? `${deck.name} now appears in ${folder.name}`
          : `${deck.name} was removed from ${folder.name}`,
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Could not update deck folder link.",
      });
    } finally {
      setBusyAssetId(null);
    }
  };

  const toggleSourceFolder = async (source: Source) => {
    if (!user?.uid || !folder) return;
    const shouldLink = !source.folderIds.includes(folder.id);
    setBusyAssetId(source.id);
    try {
      const folderIds = mergeFolderId(source.folderIds, shouldLink);
      await updateSource(user.uid, source.id, { folderIds });
      setSources((current) =>
        current.map((item) => (item.id === source.id ? { ...item, folderIds } : item))
      );
      setFeedback({
        type: "success",
        message: shouldLink
          ? `${source.title} now appears in ${folder.name}`
          : `${source.title} was removed from ${folder.name}`,
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Could not update source folder link.",
      });
    } finally {
      setBusyAssetId(null);
    }
  };

  const handleSaveFolder = async () => {
    if (!user?.uid || !folder) return;
    setSavingFolder(true);
    setFeedback(null);
    try {
      await updateStudyFolder(user.uid, folder.id, {
        name: editFolderName,
        color: editFolderColor,
        icon: editFolderIcon,
      });
      setFolder((current) =>
        current
          ? { ...current, name: editFolderName.trim() || current.name, color: editFolderColor, icon: editFolderIcon, updatedAt: Date.now() }
          : current
      );
      setShowEditFolder(false);
      setFeedback({ type: "success", message: "Folder updated." });
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Could not update folder.",
      });
    } finally {
      setSavingFolder(false);
    }
  };

  const handleArchiveFolder = async () => {
    if (!user?.uid || !folder) return;
    const confirmed = window.confirm(
      "Archive this folder? This removes the folder view, but does not delete the decks or sources inside it."
    );
    if (!confirmed) return;
    setSavingFolder(true);
    try {
      await archiveStudyFolder(user.uid, folder.id);
      setFeedback({ type: "success", message: "Folder archived. Decks and sources were not deleted." });
      setShowEditFolder(false);
      router.push("/dashboard/folders");
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Could not archive folder.",
      });
    } finally {
      setSavingFolder(false);
    }
  };

  const handleAddDecksToFolder = async () => {
    if (!user?.uid || !folder || selectedDeckIds.length === 0) return;
    setBusyAssetId("deck-picker");
    try {
      await Promise.all(
        selectedDeckIds.map((deckId) => {
          const deck = decks.find((item) => item.id === deckId);
          if (!deck) return Promise.resolve();
          return updateDeckFolders(user.uid, deck.id, mergeFolderId(deck.folderIds, true));
        })
      );
      setDecks((current) =>
        current.map((deck) =>
          selectedDeckIds.includes(deck.id)
            ? { ...deck, folderIds: mergeFolderId(deck.folderIds, true) }
            : deck
        )
      );
      setSelectedDeckIds([]);
      setShowDeckPicker(false);
      setFeedback({ type: "success", message: "Decks added to this folder." });
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Could not add decks.",
      });
    } finally {
      setBusyAssetId(null);
    }
  };

  const handleAddSourcesToFolder = async () => {
    if (!user?.uid || !folder || selectedSourceIds.length === 0) return;
    setBusyAssetId("source-picker");
    try {
      await Promise.all(
        selectedSourceIds.map((sourceId) => {
          const source = sources.find((item) => item.id === sourceId);
          if (!source) return Promise.resolve();
          return updateSource(user.uid, source.id, {
            folderIds: mergeFolderId(source.folderIds, true),
          });
        })
      );
      setSources((current) =>
        current.map((source) =>
          selectedSourceIds.includes(source.id)
            ? { ...source, folderIds: mergeFolderId(source.folderIds, true) }
            : source
        )
      );
      setSelectedSourceIds([]);
      setShowSourcePicker(false);
      setFeedback({ type: "success", message: "Sources added to this folder." });
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Could not add sources.",
      });
    } finally {
      setBusyAssetId(null);
    }
  };

  const handleCreateFolderSource = async () => {
    if (!user?.uid || !folder || !sourceTitle.trim()) return;
    setBusyAssetId("new-source");
    try {
      const sourceId = await createSource(user.uid, {
        title: sourceTitle,
        type: sourceType,
        folderIds: [folder.id],
        topicIds: sourceTopicIds,
        contentText: sourceType === "pasted_text" || sourceType === "manual_note" ? sourceText : undefined,
        externalUrl: sourceType === "link" ? sourceUrl : undefined,
        fileName: sourceType === "file" ? sourceFileName : undefined,
        fileType: sourceType === "file" ? "Reference" : undefined,
      });
      const now = Date.now();
      const nextSource: Source = {
        id: sourceId,
        title: sourceTitle.trim(),
        type: sourceType,
        folderIds: [folder.id],
        topicIds: sourceTopicIds,
        contentText: sourceType === "pasted_text" || sourceType === "manual_note" ? sourceText.trim() || undefined : undefined,
        externalUrl: sourceType === "link" ? sourceUrl.trim() || undefined : undefined,
        fileName: sourceType === "file" ? sourceFileName.trim() || undefined : undefined,
        fileType: sourceType === "file" ? "Reference" : undefined,
        status: "active",
        createdBy: user.uid,
        createdAt: now,
        updatedAt: now,
      };
      setSources((current) => [nextSource, ...current]);
      setSourceTitle("");
      setSourceText("");
      setSourceUrl("");
      setSourceFileName("");
      setSourceTopicIds([]);
      setShowCreateSource(false);
      setFeedback({ type: "success", message: "Source created in this folder and Sources." });
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Could not create source.",
      });
    } finally {
      setBusyAssetId(null);
    }
  };

  const handleCreateNotebook = async () => {
    if (!user?.uid || !folder) return;
    const title = notebookTitle.trim();
    if (!title) {
      setFeedback({ type: "error", message: "Name the notebook before creating it." });
      return;
    }
    setCreatingNotebook(true);
    setNotebookUploadProgress(null);
    try {
      if (notebookFile) {
        const imported = await importUploadedNotebook({
          userId: user.uid,
          folderId: folder.id,
          title,
          file: notebookFile,
          topicIds: notebookTopicIds,
          color: notebookColor,
          icon: notebookIcon,
          onProgress: setNotebookUploadProgress,
        });
        setNotebooks((current) => [imported.notebook, ...current]);
        setNotebookTitle("");
        setNotebookColor("violet");
        setNotebookIcon("none");
        setNotebookPageColor("white");
        setNotebookPageStyle("plain");
        setNotebookFile(null);
        setNotebookTopicIds([]);
        setShowNotebookForm(false);
        setFeedback({
          type: "success",
          message: `${imported.notebook.title} created with ${imported.pages.length} ${imported.pages.length === 1 ? "page" : "pages"}.`,
        });
        return;
      }

      const notebook = await createNotebook(user.uid, {
        folderId: folder.id,
        title,
        type: "blank",
        topicIds: notebookTopicIds,
        color: notebookColor,
        icon: notebookIcon,
        pageColor: notebookPageColor,
        pageStyle: notebookPageStyle,
      });
      await createNotebookPage(user.uid, {
        notebookId: notebook.id,
        folderId: folder.id,
        pageNumber: 1,
        pageType: "free_working",
        title: "Page 1",
        pageColor: notebookPageColor,
        pageStyle: notebookPageStyle,
      });

      setNotebooks((current) => [notebook, ...current]);
      setNotebookTitle("");
      setNotebookColor("violet");
      setNotebookIcon("none");
      setNotebookPageColor("white");
      setNotebookPageStyle("plain");
      setNotebookFile(null);
      setNotebookTopicIds([]);
      setShowNotebookForm(false);
      setFeedback({
        type: "success",
        message: `${notebook.title} created. Open it to type or draw on page 1.`,
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Could not create notebook.",
      });
    } finally {
      setCreatingNotebook(false);
      setNotebookUploadProgress(null);
    }
  };

  const openNotebookForm = () => {
    if (isDemoUser) {
      setFeedback({
        type: "error",
        message: "Exit the shared demo to create notebooks or upload PDF and image files.",
      });
      return;
    }
    setShowNotebookForm(true);
  };

  if (!featureFlags.enableFolders) {
    return (
      <AppPage title="Folder" backHref="/dashboard/folders" backLabel="Folders">
        <EmptyState
          emoji="Soon"
          title="Folders are not enabled yet"
          description="The folder workspace is behind a feature flag in this environment."
        />
      </AppPage>
    );
  }

  if (loading) {
    return (
      <AppPage title="Folder" backHref="/dashboard/folders" backLabel="Folders">
        <div className="space-y-5">
          <Skeleton className="h-56 rounded-[1.9rem]" />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-40 rounded-[1.45rem]" />
            ))}
          </div>
        </div>
      </AppPage>
    );
  }

  if (!folder) {
    return (
      <AppPage title="Folder" backHref="/dashboard/folders" backLabel="Folders">
        <EmptyState
          emoji="Folder"
          title="Folder not found"
          description="This folder may have been archived or removed."
          action={
            <Link
              href="/dashboard/folders"
              className="inline-flex min-h-[2.75rem] items-center justify-center rounded-full border border-[var(--button-primary-border)] bg-[var(--button-primary-bg)] px-4 text-sm font-medium text-[var(--button-primary-text)] shadow-[var(--button-primary-shadow)]"
            >
              Back to folders
            </Link>
          }
        />
      </AppPage>
    );
  }

  return (
    <AppPage
      title={folder.name}
      backHref="/dashboard/folders"
      backLabel="Folders"
      width="3xl"
    >
      <div className="space-y-6">
        {feedback ? (
          <FeedbackBanner
            type={feedback.type}
            message={feedback.message}
            onDismiss={() => setFeedback(null)}
          />
        ) : null}

        {editingNotebook && user?.uid ? (
          <NotebookEditorDialog
            userId={user.uid}
            notebook={editingNotebook}
            topics={topics}
            onTopicsChange={setTopics}
            onClose={() => setEditingNotebook(null)}
            onSaved={(updatedNotebook) => {
              setNotebooks((current) =>
                current.map((item) =>
                  item.id === updatedNotebook.id ? updatedNotebook : item
                )
              );
              setEditingNotebook(null);
              setFeedback({ type: "success", message: "Notebook updated." });
            }}
            onArchived={(notebookId) => {
              const archivedTitle = editingNotebook.title;
              setNotebooks((current) =>
                current.filter((item) => item.id !== notebookId)
              );
              setEditingNotebook(null);
              setFeedback({
                type: "success",
                message: `${archivedTitle} archived.`,
              });
            }}
          />
        ) : null}

        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-text-muted">
          <Link href="/dashboard/folders" className="font-medium transition hover:text-text-primary">
            Folders
          </Link>
          <span aria-hidden="true">/</span>
          <span className="truncate text-text-secondary">{folder.name}</span>
        </nav>

        <div className="flex flex-col gap-4 rounded-[1.35rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="w-[7.25rem] shrink-0">
              <FolderObjectCard title={folder.name} color={folder.color} icon={folder.icon} />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
                Study folder
              </p>
              <h1 className="mt-1 truncate text-2xl font-semibold text-text-primary sm:text-3xl">
                {folder.name}
              </h1>
              {folder.subject ? (
                <p className="mt-1 text-sm text-text-muted">{folder.subject}</p>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <Button type="button" variant="secondary" onClick={openEditFolder}>
              Edit folder
            </Button>
          </div>
        </div>

        {showNotebookForm ? (
          <Card padding="md">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8.5rem] sm:items-start">
              <div className="min-w-0">
                <SectionHeader
                  eyebrow="Create notebook"
                  title="Set up your notebook."
                />
                <div className="mt-4 max-w-xl">
                  <Input
                    label="Notebook title"
                    value={notebookTitle}
                    onChange={(event) => setNotebookTitle(event.target.value)}
                  />
                </div>
              </div>
              <div className="app-subtle-panel mx-auto w-full max-w-[8.5rem] rounded-[1rem] p-2 sm:mx-0">
                <NotebookObjectCard
                  title={notebookTitle.trim() || "Notebook preview"}
                  color={notebookColor}
                  icon={notebookIcon}
                  pageColor={notebookPageColor}
                  pageStyle={notebookPageStyle}
                  updatedLabel="Notebook preview"
                  compact
                  editorPreview
                />
              </div>
            </div>
            <div className="mt-5">
              <ObjectStylePicker
                color={notebookColor}
                icon={notebookIcon}
                onColorChange={setNotebookColor}
                onIconChange={setNotebookIcon}
                colorLabel="Cover colour"
                iconLabel="Cover icon"
              />
            </div>
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div className="rounded-[1.2rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4 lg:col-span-2">
                <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                  Start with a PDF or image <span className="text-text-muted">(optional)</span>
                </label>
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  disabled={creatingNotebook}
                  onChange={(event) => setNotebookFile(event.target.files?.[0] ?? null)}
                  className="block min-h-[2.75rem] w-full rounded-2xl border border-border bg-surface-panel-strong px-3 py-2 text-sm text-text-primary file:mr-3 file:rounded-full file:border-0 file:bg-warm-glow file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-warm-accent disabled:cursor-not-allowed disabled:saturate-[0.82]"
                />
              </div>
              {!notebookFile ? (
                <>
                  <div>
                    <div className="text-sm font-medium text-text-secondary">Page colour</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(["white", "black"] as NotebookPageColor[]).map((color) => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => setNotebookPageColor(color)}
                          className={`min-h-[2.35rem] rounded-full border px-4 text-sm font-semibold capitalize transition ${
                            notebookPageColor === color ? "app-selected" : "app-chip"
                          }`}
                        >
                          {color}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-text-secondary">Page style</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(["plain", "lined", "grid", "dot"] as NotebookPageStyle[]).map((style) => (
                        <button
                          key={style}
                          type="button"
                          onClick={() => setNotebookPageStyle(style)}
                          className={`min-h-[2.35rem] rounded-full border px-4 text-sm font-semibold capitalize transition ${
                            notebookPageStyle === style ? "app-selected" : "app-chip"
                          }`}
                        >
                          {style}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : null}
              <div className="lg:col-span-2">
                <TopicPicker
                  userId={user.uid}
                  topics={topics}
                  selectedTopicIds={notebookTopicIds}
                  onChange={setNotebookTopicIds}
                  onTopicsChange={setTopics}
                  disabled={creatingNotebook}
                />
              </div>
              <div className="flex gap-2 lg:col-span-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={creatingNotebook}
                  onClick={() => {
                    setShowNotebookForm(false);
                    setNotebookTitle("");
                    setNotebookColor("violet");
                    setNotebookIcon("none");
                    setNotebookPageColor("white");
                    setNotebookPageStyle("plain");
                    setNotebookFile(null);
                    setNotebookTopicIds([]);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={creatingNotebook}
                  onClick={() => void handleCreateNotebook()}
                >
                  {creatingNotebook
                    ? notebookUploadProgress !== null
                      ? `Adding pages ${notebookUploadProgress}%`
                      : "Creating..."
                    : "Create notebook"}
                </Button>
              </div>
            </div>
            {notebookFile && creatingNotebook && notebookUploadProgress !== null ? (
              <div
                role="progressbar"
                aria-label="Notebook file import progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={notebookUploadProgress}
                className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.08]"
              >
                <div
                  className="h-full rounded-full bg-[linear-gradient(90deg,var(--color-accent),var(--color-success))] transition-[width]"
                  style={{ width: `${notebookUploadProgress}%` }}
                />
              </div>
            ) : null}
          </Card>
        ) : null}

        {showEditFolder ? (
          <Card padding="sm" className="mx-auto max-w-[44rem]">
            <div className="text-center sm:text-left">
              <div className="text-sm font-semibold text-text-primary">Edit folder</div>
              <p className="mt-0.5 text-xs text-text-muted">
                Update the folder name, colour, or icon.
              </p>
            </div>
            <div className="mx-auto mt-4 grid max-w-[28rem] gap-3 sm:grid-cols-[minmax(0,18rem)_8.5rem] sm:items-start">
              <Input
                label="Folder name"
                value={editFolderName}
                onChange={(event) => setEditFolderName(event.target.value)}
                containerClassName="w-full max-w-[18rem]"
              />
              <div className="app-subtle-panel rounded-[1rem] p-2">
                <FolderObjectCard
                  title={editFolderName.trim() || "Folder preview"}
                  color={editFolderColor}
                  icon={editFolderIcon}
                />
              </div>
              <div className="sm:col-span-2">
                <ObjectStylePicker
                  color={editFolderColor}
                  icon={editFolderIcon}
                  onColorChange={setEditFolderColor}
                  onIconChange={setEditFolderIcon}
                  colorLabel="Folder colour"
                  iconLabel="Folder icon"
                  compact
                  centered
                />
              </div>
            </div>
            <div className="mt-4 flex min-h-[3.25rem] flex-wrap items-center justify-center gap-3 border-t border-[var(--color-border)] px-1 pt-3 sm:justify-between sm:px-2">
              <Button
                type="button"
                variant="danger"
                size="sm"
                disabled={savingFolder}
                onClick={() => void handleArchiveFolder()}
              >
                Archive folder
              </Button>
              <div className="flex flex-wrap items-center justify-center gap-2.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={savingFolder}
                  onClick={() => setShowEditFolder(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={savingFolder || !editFolderName.trim()}
                  onClick={() => void handleSaveFolder()}
                >
                  {savingFolder ? "Saving..." : "Save folder"}
                </Button>
              </div>
            </div>
          </Card>
        ) : null}

        <div className="flex gap-2 overflow-x-auto rounded-full border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-1">
          {[
            ["notebooks", "Notebooks"],
            ["decks", "Decks"],
            ["sources", "Sources"],
          ].map(([value, label]) => {
            const selected = activeTab === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => selectFolderTab(value as FolderWorkspaceTab)}
                className={`min-h-[2.4rem] rounded-full px-4 text-sm font-semibold transition ${
                  selected
                    ? "bg-accent text-white shadow-[var(--shadow-accent)]"
                    : "text-text-secondary hover:bg-[var(--color-glass-subtle)] hover:text-text-primary"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {activeTab === "notebooks" ? (
          <section className="space-y-4">
            {isDemoUser ? (
              <div className="app-warning rounded-[1.2rem] px-4 py-3 text-sm leading-6">
                Exit the shared demo to create notebooks or upload PDF and image files.
              </div>
            ) : null}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <SectionHeader eyebrow="Notebooks" title="Workbooks" />
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={openNotebookForm} disabled={isDemoUser}>
                  Create notebook
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
              {notebooks.length > 0 ? (
                notebooks.map((notebook) => (
                  <NotebookObjectCard
                    key={notebook.id}
                    href={`/dashboard/notebooks/${notebook.id}`}
                    title={notebook.title}
                    typeLabel={notebook.type.replace("_", " ")}
                    color={notebook.color}
                    icon={notebook.icon}
                    pageColor={notebook.pageColor}
                    pageStyle={notebook.pageStyle}
                    previewInkSvg={notebook.previewInkSvg}
                    updatedLabel={formatEditedLabel(notebook.updatedAt)}
                    onEdit={
                      isDemoUser ? undefined : () => setEditingNotebook(notebook)
                    }
                    compact
                  />
                ))
              ) : (
                <div className="col-span-full">
                  <EmptyState
                    emoji="Notebook"
                    title="No notebooks yet"
                    description="Create a notebook to start working in this folder."
                    action={
                      <Button type="button" onClick={openNotebookForm} disabled={isDemoUser}>
                        Create notebook
                      </Button>
                    }
                  />
                </div>
              )}
            </div>
          </section>
        ) : null}

        {activeTab === "decks" ? (
          <section className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <SectionHeader eyebrow="Decks" title="Flashcard decks" />
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" onClick={() => setShowDeckPicker((value) => !value)}>
                  Add existing deck
                </Button>
              </div>
            </div>
            {showDeckPicker ? (
              <Card padding="sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <Input
                    label="Find deck"
                    placeholder="Search global decks"
                    value={deckSearch}
                    onChange={(event) => setDeckSearch(event.target.value)}
                    containerClassName="sm:max-w-sm"
                  />
                  <Button
                    type="button"
                    disabled={selectedDeckIds.length === 0 || busyAssetId === "deck-picker"}
                    onClick={() => void handleAddDecksToFolder()}
                  >
                    {busyAssetId === "deck-picker" ? "Adding..." : "Add to folder"}
                  </Button>
                </div>
                <div className="mt-4 grid gap-2 md:grid-cols-2">
                  {availableDecks.length > 0 ? (
                    availableDecks.map((deck) => {
                      const selected = selectedDeckIds.includes(deck.id);
                      return (
                        <button
                          key={deck.id}
                          type="button"
                          onClick={() =>
                            setSelectedDeckIds((current) =>
                              selected ? current.filter((id) => id !== deck.id) : [...current, deck.id]
                            )
                          }
                          className={`rounded-[1rem] border px-3 py-3 text-left text-sm transition ${
                            selected
                              ? "border-warm-border bg-warm-glow text-white"
                              : "border-[var(--color-border)] bg-[var(--color-glass-subtle)] text-text-secondary"
                          }`}
                        >
                          {deck.name}
                        </button>
                      );
                    })
                  ) : (
                    <p className="text-sm text-text-muted">No global decks to add.</p>
                  )}
                </div>
              </Card>
            ) : null}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {folderDecks.length > 0 ? (
                folderDecks.map((deck) => (
                  <DeckObjectCard
                    key={deck.id}
                    href={getDeckHref(deck.id)}
                    title={deck.name}
                    colorPreset={deck.colorPreset}
                    iconPreset={deck.iconPreset}
                    removing={busyAssetId === deck.id}
                    onRemoveFromFolder={() => void toggleDeckFolder(deck)}
                  />
                ))
              ) : (
                <EmptyState
                  title="No decks in this folder yet"
                  description="Add an existing deck."
                />
              )}
            </div>
          </section>
        ) : null}

        {activeTab === "sources" ? (
          <section className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <SectionHeader eyebrow="Sources" title="Saved sources" />
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" onClick={() => setShowSourcePicker((value) => !value)}>
                  Add existing source
                </Button>
                <Button type="button" onClick={() => setShowCreateSource((value) => !value)}>
                  Create source
                </Button>
              </div>
            </div>
            {showSourcePicker ? (
              <Card padding="sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <Input
                    label="Find source"
                    placeholder="Search saved sources"
                    value={sourceSearch}
                    onChange={(event) => setSourceSearch(event.target.value)}
                    containerClassName="sm:max-w-sm"
                  />
                  <Button
                    type="button"
                    disabled={selectedSourceIds.length === 0 || busyAssetId === "source-picker"}
                    onClick={() => void handleAddSourcesToFolder()}
                  >
                    {busyAssetId === "source-picker" ? "Adding..." : "Add to folder"}
                  </Button>
                </div>
                <div className="mt-4 grid gap-2 md:grid-cols-2">
                  {availableSources.length > 0 ? (
                    availableSources.map((source) => {
                      const selected = selectedSourceIds.includes(source.id);
                      return (
                        <button
                          key={source.id}
                          type="button"
                          onClick={() =>
                            setSelectedSourceIds((current) =>
                              selected ? current.filter((id) => id !== source.id) : [...current, source.id]
                            )
                          }
                          className={`rounded-[1rem] border px-3 py-3 text-left text-sm transition ${
                            selected
                              ? "border-warm-border bg-warm-glow text-white"
                              : "border-[var(--color-border)] bg-[var(--color-glass-subtle)] text-text-secondary"
                          }`}
                        >
                          {source.title}
                        </button>
                      );
                    })
                  ) : (
                    <p className="text-sm text-text-muted">No saved sources to add.</p>
                  )}
                </div>
              </Card>
            ) : null}
            {showCreateSource ? (
              <Card padding="sm">
                <div className="grid gap-3 md:grid-cols-2">
                  <Input label="Source title" value={sourceTitle} onChange={(event) => setSourceTitle(event.target.value)} />
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-text-secondary">Type</span>
                    <select
                      value={sourceType}
                      onChange={(event) => setSourceType(event.target.value as SourceType)}
                      className="min-h-[2.75rem] w-full rounded-2xl border border-border bg-surface-panel-strong px-3 text-sm text-text-primary"
                    >
                      <option value="pasted_text">Pasted text</option>
                      <option value="manual_note">Manual note</option>
                      <option value="link">Link</option>
                      <option value="file">File reference</option>
                    </select>
                  </label>
                </div>
                {sourceType === "link" ? (
                  <Input label="URL" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} containerClassName="mt-3" />
                ) : sourceType === "file" ? (
                  <Input label="File name" value={sourceFileName} onChange={(event) => setSourceFileName(event.target.value)} containerClassName="mt-3" />
                ) : (
                  <Textarea label="Source text" value={sourceText} onChange={(event) => setSourceText(event.target.value)} rows={5} containerClassName="mt-3" />
                )}
                <div className="mt-3">
                  <TopicPicker
                    userId={user.uid}
                    topics={topics}
                    selectedTopicIds={sourceTopicIds}
                    onChange={setSourceTopicIds}
                    onTopicsChange={setTopics}
                    disabled={busyAssetId === "new-source"}
                  />
                </div>
                <div className="mt-3">
                  <Button
                    type="button"
                    disabled={!sourceTitle.trim() || busyAssetId === "new-source"}
                    onClick={() => void handleCreateFolderSource()}
                  >
                    {busyAssetId === "new-source" ? "Creating..." : "Create source"}
                  </Button>
                </div>
              </Card>
            ) : null}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {folderSources.length > 0 ? (
                folderSources.map((source) => {
                  return (
                    <div
                      key={source.id}
                      className="rounded-[1.1rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-text-primary">{source.title}</div>
                          <div className="mt-1 text-xs text-text-muted">{source.type.replace("_", " ")}</div>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={busyAssetId === source.id}
                          onClick={() => void toggleSourceFolder(source)}
                        >
                          Remove from folder
                        </Button>
                      </div>
                    </div>
                  );
                })
              ) : (
                <EmptyState
                  title="No sources in this folder yet"
                  description="Add or create a source."
                />
              )}
            </div>
          </section>
        ) : null}

      </div>
    </AppPage>
  );
}
