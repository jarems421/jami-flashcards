"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppPage from "@/components/layout/AppPage";
import FolderObjectCard from "@/components/workspace/FolderObjectCard";
import DeckObjectCard from "@/components/workspace/DeckObjectCard";
import FolderEditor from "@/components/workspace/FolderEditor";
import FolderAssetPicker from "@/components/workspace/FolderAssetPicker";
import FolderNotebookCreator from "@/components/workspace/FolderNotebookCreator";
import NotebookEditorDialog from "@/components/workspace/NotebookEditorDialog";
import { NotebookObjectCard } from "@/components/workspace/NotebookObjectCard";
import {
  Button,
  ButtonLink,
  Card,
  ConfirmDialog,
  EmptyState,
  FeedbackBanner,
  SectionHeader,
  Skeleton,
} from "@/components/ui";
import { featureFlags } from "@/lib/app/feature-flags";
import { getDeckHref } from "@/lib/app/routes";
import { useUser } from "@/components/providers/UserProvider";
import { useFeedback } from "@/hooks/useFeedback";
import type { Source } from "@/lib/material/sources";
import type { Topic } from "@/lib/material/topics";
import type { Deck } from "@/lib/study/decks";
import { addFolderId, removeFolderId } from "@/lib/workspace/folder-links";
import {
  buildFolderTabSearch,
  getFolderTabFromSearch,
  type FolderWorkspaceTab,
} from "@/lib/workspace/folder-navigation";
import type { Notebook } from "@/lib/workspace/notebooks";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import {
  getDecks,
  getDecksForFolderPage,
  type DeckFolderPageCursor,
  updateDeckFolders,
} from "@/services/study/decks";
import { getStudyFolderById } from "@/services/study/folders";
import {
  getNotebooksForFolderPage,
  type NotebookFolderPageCursor,
  updateNotebook,
} from "@/services/study/notebooks";
import {
  getActiveSources,
  getActiveSourcesForFolderPage,
  type SourceFolderPageCursor,
  updateSource,
} from "@/services/study/sources";
import { getActiveTopics } from "@/services/study/topics";
import { isFirebasePermissionDenied } from "@/services/firebase/errors";
import { deletePracticePaper } from "@/services/study/practice-papers";

const FOLDER_ASSET_PAGE_SIZE = 30;

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

function mergeUniqueById<T extends { id: string }>(current: T[], next: T[]) {
  const items = new Map(current.map((item) => [item.id, item]));
  next.forEach((item) => items.set(item.id, item));
  return Array.from(items.values());
}

export default function FolderDetailPage() {
  const { user } = useUser();
  const router = useRouter();
  const params = useParams<{ folderId?: string | string[] }>();
  const folderId = Array.isArray(params.folderId) ? params.folderId[0] : params.folderId;
  const [folder, setFolder] = useState<StudyFolder | null>(null);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [decksLoaded, setDecksLoaded] = useState(false);
  const [sourcesLoaded, setSourcesLoaded] = useState(false);
  const [loadingAssetTab, setLoadingAssetTab] = useState<"decks" | "sources" | null>(null);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [editingNotebook, setEditingNotebook] = useState<Notebook | null>(null);
  const [notebookPendingDelete, setNotebookPendingDelete] =
    useState<Notebook | null>(null);
  const [deletingNotebookId, setDeletingNotebookId] = useState<string | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [folderLoadState, setFolderLoadState] = useState<
    "loading" | "ready" | "not-found" | "unavailable"
  >("loading");
  const [notebooksAvailability, setNotebooksAvailability] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");
  const [retryingNotebooks, setRetryingNotebooks] = useState(false);
  const {
    feedback,
    success,
    showError,
    showThrownError,
    clear: clearFeedback,
  } = useFeedback();
  const [busyAssetId, setBusyAssetId] = useState<string | null>(null);
  const [showNotebookForm, setShowNotebookForm] = useState(false);
  const [activeTab, setActiveTab] = useState<FolderWorkspaceTab>(() =>
    typeof window === "undefined"
      ? "notebooks"
      : getFolderTabFromSearch(window.location.search)
  );
  const [showEditFolder, setShowEditFolder] = useState(false);
  const [showDeckPicker, setShowDeckPicker] = useState(false);
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [notebookCursor, setNotebookCursor] =
    useState<NotebookFolderPageCursor | null>(null);
  const [deckCursor, setDeckCursor] =
    useState<DeckFolderPageCursor | null>(null);
  const [sourceCursor, setSourceCursor] =
    useState<SourceFolderPageCursor | null>(null);
  const [loadingMoreTab, setLoadingMoreTab] =
    useState<FolderWorkspaceTab | null>(null);
  const loadedFolderIdRef = useRef<string | null>(null);
  const assetRequestGenerationRef = useRef({ decks: 0, sources: 0 });

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
    setFolderLoadState("loading");
    setNotebooksAvailability("loading");
    assetRequestGenerationRef.current.decks += 1;
    assetRequestGenerationRef.current.sources += 1;

    if (loadedFolderIdRef.current !== folderId) {
      setFolder(null);
      setNotebooks([]);
      setTopics([]);
      setDecks([]);
      setSources([]);
      setDecksLoaded(false);
      setSourcesLoaded(false);
      setNotebookCursor(null);
      setDeckCursor(null);
      setSourceCursor(null);
    }
    try {
      const [folderResult, notebooksResult, topicsResult] = await Promise.allSettled([
        getStudyFolderById(user.uid, folderId),
        getNotebooksForFolderPage(user.uid, folderId, {
          pageSize: FOLDER_ASSET_PAGE_SIZE,
        }),
        getActiveTopics(user.uid),
      ]);

      if (folderResult.status === "rejected") {
        throw folderResult.reason;
      }

      const optionalErrors = [
        notebooksResult,
        topicsResult,
      ]
        .map(resultError)
        .filter(Boolean);

      if (optionalErrors.length > 0) {
        console.warn("Some folder sections could not load.", optionalErrors);
        showError("This folder opened, but one section is still syncing. Refresh in a moment if something looks missing.");
      }

      const nextFolder = folderResult.value;
      loadedFolderIdRef.current = folderId;
      setFolder(nextFolder);
      setFolderLoadState(nextFolder ? "ready" : "not-found");

      if (notebooksResult.status === "fulfilled") {
        setNotebooks(notebooksResult.value.items);
        setNotebookCursor(notebooksResult.value.nextCursor);
        setNotebooksAvailability("ready");
      } else {
        setNotebooksAvailability("unavailable");
      }

      if (topicsResult.status === "fulfilled") {
        setTopics(topicsResult.value);
      }
    } catch (error) {
      console.error(error);
      setFolderLoadState("unavailable");
      showError(isFirebasePermissionDenied(error)
          ? "Could not open this folder yet. Refresh once the workspace has finished syncing."
          : "Could not load this folder. Try refreshing in a moment.");
    } finally {
      setLoading(false);
    }
  }, [folderId, showError, user?.uid]);

  useEffect(() => {
    void loadFolder();
  }, [loadFolder]);

  const loadAssetTab = useCallback(
    async (tab: "decks" | "sources") => {
      if (!user?.uid) return;
      if ((tab === "decks" && decksLoaded) || (tab === "sources" && sourcesLoaded)) return;
      if (
        (tab === "decks" && showDeckPicker) ||
        (tab === "sources" && showSourcePicker)
      ) {
        return;
      }
      const generation = assetRequestGenerationRef.current[tab] + 1;
      assetRequestGenerationRef.current[tab] = generation;
      setLoadingAssetTab(tab);
      try {
        if (tab === "decks") {
          const page = await getDecksForFolderPage(user.uid, folderId ?? "", {
            pageSize: FOLDER_ASSET_PAGE_SIZE,
          });
          if (assetRequestGenerationRef.current[tab] !== generation) return;
          setDecks(page.items);
          setDeckCursor(page.nextCursor);
          setDecksLoaded(true);
        } else {
          const page = await getActiveSourcesForFolderPage(
            user.uid,
            folderId ?? "",
            { pageSize: FOLDER_ASSET_PAGE_SIZE }
          );
          if (assetRequestGenerationRef.current[tab] !== generation) return;
          setSources(page.items);
          setSourceCursor(page.nextCursor);
          setSourcesLoaded(true);
        }
      } catch (error) {
        if (assetRequestGenerationRef.current[tab] !== generation) return;
        console.error(error);
        showError(`Could not load this folder’s ${tab}. Try again in a moment.`);
      } finally {
        if (assetRequestGenerationRef.current[tab] === generation) {
          setLoadingAssetTab((current) => (current === tab ? null : current));
        }
      }
    },
    [
      decksLoaded,
      folderId,
      showDeckPicker,
      showError,
      showSourcePicker,
      sourcesLoaded,
      user?.uid,
    ]
  );

  useEffect(() => {
    if (activeTab === "decks" || activeTab === "sources") {
      void loadAssetTab(activeTab);
    }
  }, [activeTab, loadAssetTab]);

  const loadMore = useCallback(
    async (tab: FolderWorkspaceTab) => {
      if (!user?.uid || !folderId) return;
      setLoadingMoreTab(tab);
      try {
        if (tab === "notebooks" && notebookCursor) {
          const page = await getNotebooksForFolderPage(user.uid, folderId, {
            cursor: notebookCursor,
            pageSize: FOLDER_ASSET_PAGE_SIZE,
          });
          setNotebooks((current) =>
            mergeUniqueById(current, page.items).sort(
              (left, right) => right.updatedAt - left.updatedAt
            )
          );
          setNotebookCursor(page.nextCursor);
        } else if (tab === "decks" && deckCursor) {
          const page = await getDecksForFolderPage(user.uid, folderId, {
            cursor: deckCursor,
            pageSize: FOLDER_ASSET_PAGE_SIZE,
          });
          setDecks((current) =>
            mergeUniqueById(current, page.items).sort(
              (left, right) => right.createdAt - left.createdAt
            )
          );
          setDeckCursor(page.nextCursor);
        } else if (tab === "sources" && sourceCursor) {
          const page = await getActiveSourcesForFolderPage(user.uid, folderId, {
            cursor: sourceCursor,
            pageSize: FOLDER_ASSET_PAGE_SIZE,
          });
          setSources((current) =>
            mergeUniqueById(current, page.items).sort(
              (left, right) => right.updatedAt - left.updatedAt
            )
          );
          setSourceCursor(page.nextCursor);
        }
      } catch (error) {
        console.error(`Failed to load more folder ${tab}.`, error);
        showError(`Could not load more ${tab}. Try again in a moment.`);
      } finally {
        setLoadingMoreTab((current) => (current === tab ? null : current));
      }
    },
    [
      deckCursor,
      folderId,
      notebookCursor,
      showError,
      sourceCursor,
      user?.uid,
    ]
  );

  const folderDecks = useMemo(
    () => decks.filter((deck) => folder && deck.folderIds.includes(folder.id)),
    [decks, folder]
  );
  const availableDecks = useMemo(
    () =>
      decks.filter(
        (deck) =>
          folder &&
          !deck.folderIds.includes(folder.id)
      ),
    [decks, folder]
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
          !source.folderIds.includes(folder.id)
      ),
    [folder, sources]
  );
  const mergeFolderId = (folderIds: string[], shouldLink: boolean) => {
    if (!folder) return folderIds;
    return shouldLink ? addFolderId(folderIds, folder.id) : removeFolderId(folderIds, folder.id);
  };

  const openEditFolder = () => {
    if (!folder) return;
    setShowEditFolder(true);
  };

  const toggleDeckPicker = async () => {
    if (showDeckPicker) {
      assetRequestGenerationRef.current.decks += 1;
      setShowDeckPicker(false);
      return;
    }
    if (!user?.uid) return;
    const generation = assetRequestGenerationRef.current.decks + 1;
    assetRequestGenerationRef.current.decks = generation;
    setLoadingAssetTab("decks");
    try {
      // Firestore cannot express "folderIds does not contain this folder".
      // Load the compatibility list only when the student explicitly opens
      // the existing-deck picker; normal folder browsing stays membership-
      // filtered through getDecksForFolder.
      const nextDecks = await getDecks(user.uid);
      if (assetRequestGenerationRef.current.decks !== generation) return;
      setDecks(nextDecks);
      setDeckCursor(null);
      setDecksLoaded(true);
      setShowDeckPicker(true);
    } catch (error) {
      if (assetRequestGenerationRef.current.decks !== generation) return;
      console.error("Failed to load the existing-deck picker.", error);
      showError("Could not load decks to add. Try again in a moment.");
    } finally {
      if (assetRequestGenerationRef.current.decks === generation) {
        setLoadingAssetTab((current) =>
          current === "decks" ? null : current
        );
      }
    }
  };

  const toggleSourcePicker = async () => {
    if (showSourcePicker) {
      assetRequestGenerationRef.current.sources += 1;
      setShowSourcePicker(false);
      return;
    }
    if (!user?.uid) return;
    const generation = assetRequestGenerationRef.current.sources + 1;
    assetRequestGenerationRef.current.sources = generation;
    setLoadingAssetTab("sources");
    try {
      // As with decks, negative array membership is unsupported. This full
      // compatibility read happens only on an explicit picker action.
      const nextSources = await getActiveSources(user.uid);
      if (assetRequestGenerationRef.current.sources !== generation) return;
      setSources(nextSources);
      setSourceCursor(null);
      setSourcesLoaded(true);
      setShowSourcePicker(true);
    } catch (error) {
      if (assetRequestGenerationRef.current.sources !== generation) return;
      console.error("Failed to load the existing-source picker.", error);
      showError("Could not load sources to add. Try again in a moment.");
    } finally {
      if (assetRequestGenerationRef.current.sources === generation) {
        setLoadingAssetTab((current) =>
          current === "sources" ? null : current
        );
      }
    }
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
      success(shouldLink
          ? `${deck.name} now appears in ${folder.name}`
          : `${deck.name} was removed from ${folder.name}`);
    } catch (error) {
      showThrownError(error, "Could not update deck folder link.");
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
      success(shouldLink
          ? `${source.title} now appears in ${folder.name}`
          : `${source.title} was removed from ${folder.name}`);
    } catch (error) {
      showThrownError(error, "Could not update source folder link.");
    } finally {
      setBusyAssetId(null);
    }
  };

  const handleDeleteNotebook = async () => {
    if (!user?.uid || !notebookPendingDelete) return;
    const notebook = notebookPendingDelete;
    setDeletingNotebookId(notebook.id);
    clearFeedback();
    try {
      if (notebook.type === "practice_paper") {
        await deletePracticePaper(user.uid, notebook.pastPaperId ?? notebook.id);
      } else {
        await updateNotebook(user.uid, notebook.id, { archived: true });
      }
      setNotebooks((current) =>
        current.filter((item) => item.id !== notebook.id)
      );
      setNotebookPendingDelete(null);
      success(`${notebook.title} deleted.`);
    } catch (error) {
      showThrownError(error, "Could not delete notebook.");
    } finally {
      setDeletingNotebookId(null);
    }
  };

  const handleAddDecksToFolder = async (selectedDeckIds: string[]) => {
    if (!user?.uid || !folder || selectedDeckIds.length === 0) return false;
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
      setShowDeckPicker(false);
      success("Decks added to this folder.");
      return true;
    } catch (error) {
      showThrownError(error, "Could not add decks.");
      return false;
    } finally {
      setBusyAssetId(null);
    }
  };

  const handleAddSourcesToFolder = async (selectedSourceIds: string[]) => {
    if (!user?.uid || !folder || selectedSourceIds.length === 0) return false;
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
      setShowSourcePicker(false);
      success("Sources added to this folder.");
      return true;
    } catch (error) {
      showThrownError(error, "Could not add sources.");
      return false;
    } finally {
      setBusyAssetId(null);
    }
  };

  const retryNotebooks = useCallback(async () => {
    if (!user?.uid || !folderId) return;
    setRetryingNotebooks(true);
    try {
      const page = await getNotebooksForFolderPage(user.uid, folderId, {
        pageSize: FOLDER_ASSET_PAGE_SIZE,
      });
      setNotebooks(page.items);
      setNotebookCursor(page.nextCursor);
      setNotebooksAvailability("ready");
    } catch (error) {
      console.error("Failed to reload this folder's notebooks.", error);
      setNotebooksAvailability("unavailable");
      showThrownError(error, "Could not load this folder's notebooks.");
    } finally {
      setRetryingNotebooks(false);
    }
  }, [folderId, showThrownError, user?.uid]);

  const openNotebookForm = () => {
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
          <Skeleton className="h-56 rounded-2xl" />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-40 rounded-xl" />
            ))}
          </div>
        </div>
      </AppPage>
    );
  }

  if (!folder && folderLoadState === "unavailable") {
    return (
      <AppPage title="Folder" backHref="/dashboard/folders" backLabel="Folders">
        <div className="space-y-4">
          {feedback ? (
            <FeedbackBanner
              type={feedback.type}
              message={feedback.message}
              onDismiss={clearFeedback}
            />
          ) : null}
          <EmptyState
            emoji="Folder"
            title="Folder unavailable"
            description="We could not load this folder right now. Your workspace has not been treated as empty."
            action={
              <Button type="button" onClick={() => void loadFolder()}>
                Try again
              </Button>
            }
          />
        </div>
      </AppPage>
    );
  }

  if (!folder && folderLoadState === "not-found") {
    return (
      <AppPage title="Folder" backHref="/dashboard/folders" backLabel="Folders">
        <EmptyState
          emoji="Folder"
          title="Folder not found"
          description="This folder may have been archived or removed."
          action={
            <Link
              href="/dashboard/folders"
              className="inline-flex min-h-[2.75rem] items-center justify-center rounded-full border border-[var(--button-primary-border)] bg-[var(--button-primary-bg)] px-4 text-sm font-medium text-[var(--button-primary-text)] shadow-button-primary"
            >
              Back to folders
            </Link>
          }
        />
      </AppPage>
    );
  }

  if (!folder) {
    return (
      <AppPage title="Folder" backHref="/dashboard/folders" backLabel="Folders">
        <EmptyState
          emoji="Folder"
          title="Folder unavailable"
          description="We could not finish opening this folder. Try again in a moment."
          action={
            <Button type="button" onClick={() => void loadFolder()}>
              Try again
            </Button>
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
            onDismiss={() => clearFeedback()}
          />
        ) : null}

        <ConfirmDialog
          open={notebookPendingDelete !== null}
          title={`Delete ${notebookPendingDelete?.title ?? "this notebook"}?`}
          description={
            notebookPendingDelete?.type === "practice_paper"
              ? "This permanently deletes the paper, its attempts, saved pages, marking data, and attached files. This cannot be undone."
              : "This removes the notebook from your workspace. Its saved pages are retained so it can be recovered later."
          }
          confirmLabel={
            notebookPendingDelete?.type === "practice_paper"
              ? "Delete paper permanently"
              : "Delete notebook"
          }
          busy={
            notebookPendingDelete !== null &&
            deletingNotebookId === notebookPendingDelete.id
          }
          onConfirm={() => void handleDeleteNotebook()}
          onClose={() => setNotebookPendingDelete(null)}
        />

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
              success("Notebook updated.");
            }}
            onArchived={(notebookId) => {
              const archivedTitle = editingNotebook.title;
              setNotebooks((current) =>
                current.filter((item) => item.id !== notebookId)
              );
              setEditingNotebook(null);
              success(`${archivedTitle} archived.`);
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

        <div className="flex flex-col gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="w-[7.25rem] shrink-0">
              <FolderObjectCard title={folder.name} color={folder.color} icon={folder.icon} />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
                Study folder
              </p>
              <h2 className="mt-1 truncate text-2xl font-semibold text-text-primary sm:text-3xl">
                {folder.name}
              </h2>
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
          <FolderNotebookCreator
            userId={user.uid}
            folder={folder}
            topics={topics}
            onTopicsChange={setTopics}
            onCreated={(notebook, message) => {
              setNotebooks((current) => [notebook, ...current]);
              setShowNotebookForm(false);
              success(message);
            }}
            onCancel={() => setShowNotebookForm(false)}
            onError={showThrownError}
          />
        ) : null}

        {showEditFolder ? (
          <FolderEditor
            userId={user.uid}
            folder={folder}
            onSaved={(updatedFolder) => {
              setFolder(updatedFolder);
              setShowEditFolder(false);
              success("Folder updated.");
            }}
            onArchived={() => {
              success("Folder archived. Decks and sources were not deleted.");
              setShowEditFolder(false);
              router.push("/dashboard/folders");
            }}
            onCancel={() => setShowEditFolder(false)}
            onError={showThrownError}
          />
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
                    ? "bg-accent text-[var(--color-text-inverse)] shadow-accent"
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
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <SectionHeader title="Notebooks" />
              <div className="flex flex-wrap gap-2">
                <ButtonLink
                  href={`/dashboard/practice/new?folder=${encodeURIComponent(folder.id)}`}
                  size="sm"
                >
                  New practice paper
                </ButtonLink>
                <Button type="button" size="sm" onClick={openNotebookForm}>
                  Create notebook
                </Button>
              </div>
            </div>
            {notebooksAvailability === "unavailable" ? (
              <Card
                padding="sm"
                className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-sm font-semibold text-text-primary">
                    Notebooks are temporarily unavailable
                  </p>
                  <p className="mt-1 text-sm text-text-secondary">
                    We kept any notebooks already shown and will not treat this section as empty.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={retryingNotebooks}
                  aria-busy={retryingNotebooks}
                  onClick={() => void retryNotebooks()}
                >
                  {retryingNotebooks ? "Retrying..." : "Retry notebooks"}
                </Button>
              </Card>
            ) : null}
            {notebooks.length > 0 || notebooksAvailability === "ready" ? (
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
                    onEdit={() => setEditingNotebook(notebook)}
                    onDelete={() => setNotebookPendingDelete(notebook)}
                    deleting={deletingNotebookId === notebook.id}
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
                      <Button type="button" onClick={openNotebookForm}>
                        Create notebook
                      </Button>
                    }
                  />
                </div>
              )}
              </div>
            ) : null}
            {notebookCursor ? (
              <div className="flex justify-center">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={loadingMoreTab === "notebooks"}
                  aria-busy={loadingMoreTab === "notebooks"}
                  onClick={() => void loadMore("notebooks")}
                >
                  {loadingMoreTab === "notebooks" ? "Loading..." : "Load more notebooks"}
                </Button>
              </div>
            ) : null}
          </section>
        ) : null}

        {activeTab === "decks" ? (
          <section className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <SectionHeader title="Decks" />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={loadingAssetTab === "decks"}
                  aria-busy={loadingAssetTab === "decks"}
                  onClick={() => void toggleDeckPicker()}
                >
                  Add existing deck
                </Button>
              </div>
            </div>
            {loadingAssetTab === "decks" ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <Skeleton className="h-28" />
                <Skeleton className="h-28" />
              </div>
            ) : null}
            {showDeckPicker ? (
              <FolderAssetPicker
                kind="deck"
                items={availableDecks.map((deck) => ({ id: deck.id, label: deck.name }))}
                busy={busyAssetId === "deck-picker"}
                onAdd={handleAddDecksToFolder}
              />
            ) : null}
            {loadingAssetTab !== "decks" ? (
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
            ) : null}
            {deckCursor && !showDeckPicker ? (
              <div className="flex justify-center">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={loadingMoreTab === "decks"}
                  aria-busy={loadingMoreTab === "decks"}
                  onClick={() => void loadMore("decks")}
                >
                  {loadingMoreTab === "decks" ? "Loading..." : "Load more decks"}
                </Button>
              </div>
            ) : null}
          </section>
        ) : null}

        {activeTab === "sources" ? (
          <section className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <SectionHeader title="Sources" />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={loadingAssetTab === "sources"}
                  aria-busy={loadingAssetTab === "sources"}
                  onClick={() => void toggleSourcePicker()}
                >
                  Add existing source
                </Button>
                <ButtonLink
                  href={`/dashboard/library?create=1&folderId=${encodeURIComponent(folder.id)}`}
                >
                  Create in Sources
                </ButtonLink>
              </div>
            </div>
            {loadingAssetTab === "sources" ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <Skeleton className="h-28" />
                <Skeleton className="h-28" />
              </div>
            ) : null}
            {showSourcePicker ? (
              <FolderAssetPicker
                kind="source"
                items={availableSources.map((source) => ({ id: source.id, label: source.title }))}
                busy={busyAssetId === "source-picker"}
                onAdd={handleAddSourcesToFolder}
              />
            ) : null}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {folderSources.length > 0 ? (
                folderSources.map((source) => {
                  return (
                    <div
                      key={source.id}
                      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-3"
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
            {sourceCursor && !showSourcePicker ? (
              <div className="flex justify-center">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={loadingMoreTab === "sources"}
                  aria-busy={loadingMoreTab === "sources"}
                  onClick={() => void loadMore("sources")}
                >
                  {loadingMoreTab === "sources" ? "Loading..." : "Load more sources"}
                </Button>
              </div>
            ) : null}
          </section>
        ) : null}

      </div>
    </AppPage>
  );
}
