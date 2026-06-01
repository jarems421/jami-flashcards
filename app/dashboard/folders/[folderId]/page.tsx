"use client";

import Link from "next/link";
import { FirebaseError } from "firebase/app";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppPage from "@/components/layout/AppPage";
import FolderObjectCard from "@/components/workspace/FolderObjectCard";
import { NotebookObjectCard } from "@/components/workspace/NotebookObjectCard";
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
import { getDeckHref, getDeckStudyRouteHref } from "@/lib/app/routes";
import { useUser } from "@/lib/auth/user-context";
import type { Source, SourceType } from "@/lib/practice/sources";
import { addFolderId, removeFolderId } from "@/lib/workspace/folder-links";
import type { Notebook, NotebookPageColor } from "@/lib/workspace/notebooks";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import { getDecks, updateDeckFolders, type Deck } from "@/services/study/decks";
import { archiveStudyFolder, getStudyFolderById, updateStudyFolder } from "@/services/study/folders";
import {
  createNotebook,
  createNotebookPage,
  getNotebooksForFolder,
  updateNotebook,
} from "@/services/study/notebooks";
import { uploadNotebookFile } from "@/services/study/notebook-files";
import { createSource, getActiveSources, updateSource } from "@/services/study/sources";

type Feedback = { type: "success" | "error"; message: string };
type NotebookTemplate = "blank" | "uploaded_file" | "ai_questions";
type FolderTab = "notebooks" | "decks" | "sources";

function isPermissionDenied(error: unknown) {
  return error instanceof FirebaseError && error.code === "permission-denied";
}

function resultValue<T>(result: PromiseSettledResult<T>, fallback: T) {
  return result.status === "fulfilled" ? result.value : fallback;
}

function resultError(result: PromiseSettledResult<unknown>) {
  return result.status === "rejected" ? result.reason : null;
}

export default function FolderDetailPage() {
  const { user } = useUser();
  const params = useParams<{ folderId?: string | string[] }>();
  const folderId = Array.isArray(params.folderId) ? params.folderId[0] : params.folderId;
  const [folder, setFolder] = useState<StudyFolder | null>(null);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busyAssetId, setBusyAssetId] = useState<string | null>(null);
  const [showNotebookForm, setShowNotebookForm] = useState(false);
  const [notebookTitle, setNotebookTitle] = useState("");
  const [notebookTemplate, setNotebookTemplate] = useState<NotebookTemplate>("blank");
  const [notebookColor, setNotebookColor] = useState<ObjectColorId>("violet");
  const [notebookIcon, setNotebookIcon] = useState<ObjectIconId>("none");
  const [notebookPageColor, setNotebookPageColor] = useState<NotebookPageColor>("white");
  const [notebookFile, setNotebookFile] = useState<File | null>(null);
  const [creatingNotebook, setCreatingNotebook] = useState(false);
  const [activeTab, setActiveTab] = useState<FolderTab>("notebooks");
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
      ] = await Promise.allSettled([
        getStudyFolderById(user.uid, folderId),
        getDecks(user.uid),
        getActiveSources(user.uid),
        getNotebooksForFolder(user.uid, folderId),
      ]);

      if (folderResult.status === "rejected") {
        throw folderResult.reason;
      }

      const optionalErrors = [
        decksResult,
        sourcesResult,
        notebooksResult,
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

      setFolder(nextFolder);
      setDecks(nextDecks);
      setSources(nextSources);
      setNotebooks(nextNotebooks);
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
          ? `${deck.name} now appears in ${folder.name}.`
          : `${deck.name} was removed from ${folder.name}.`,
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
          ? `${source.title} now appears in ${folder.name}.`
          : `${source.title} was removed from ${folder.name}.`,
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
        subject: folder.subject,
        folderIds: [folder.id],
        topicIds: folder.topicIds,
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
        subject: folder.subject,
        folderIds: [folder.id],
        topicIds: folder.topicIds,
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
      setShowCreateSource(false);
      setFeedback({ type: "success", message: "Source created in this folder and Library." });
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
    if (notebookTemplate === "ai_questions") {
      setFeedback({
        type: "error",
        message:
          "AI-created question notebooks are planned, but Phase 6 is focused on the notebook workspace first.",
      });
      return;
    }
    if (notebookTemplate === "uploaded_file" && !notebookFile) {
      setFeedback({ type: "error", message: "Choose a PDF or image file for this notebook." });
      return;
    }

    setCreatingNotebook(true);
    try {
      const notebook = await createNotebook(user.uid, {
        folderId: folder.id,
        title,
        type: notebookTemplate === "uploaded_file" ? "uploaded_file" : "blank",
        topicIds: folder.topicIds,
        color: notebookColor,
        icon: notebookIcon,
        pageColor: notebookPageColor,
      });
      await createNotebookPage(user.uid, {
        notebookId: notebook.id,
        folderId: folder.id,
        pageNumber: 1,
        pageType: notebookTemplate === "uploaded_file" ? "past_paper_page" : "free_working",
        title: "Page 1",
        pageColor: notebookPageColor,
      });

      let uploadedFileId: string | undefined;
      if (notebookTemplate === "uploaded_file" && notebookFile) {
        const fileMetadata = await uploadNotebookFile({
          userId: user.uid,
          notebookId: notebook.id,
          folderId: folder.id,
          file: notebookFile,
        });
        uploadedFileId = fileMetadata.id;
        await updateNotebook(user.uid, notebook.id, { uploadedFileId });
      }

      setNotebooks((current) => [
        uploadedFileId ? { ...notebook, uploadedFileId } : notebook,
        ...current,
      ]);
      setNotebookTitle("");
      setNotebookTemplate("blank");
      setNotebookColor("violet");
      setNotebookIcon("none");
      setNotebookPageColor("white");
      setNotebookFile(null);
      setShowNotebookForm(false);
      setFeedback({
        type: "success",
        message:
          notebookTemplate === "uploaded_file"
            ? `${notebook.title} created and file saved. Full paper annotation comes later.`
            : `${notebook.title} created. Open it to type or draw on page 1.`,
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Could not create notebook.",
      });
    } finally {
      setCreatingNotebook(false);
    }
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

        <div className="flex flex-col gap-4 rounded-[1.6rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="w-32 shrink-0 sm:w-36">
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
            <Button type="button" onClick={() => setShowNotebookForm((current) => !current)}>
              Create notebook
            </Button>
            <Button type="button" variant="secondary" onClick={openEditFolder}>
              Edit folder
            </Button>
            <Link
              href="/dashboard/library"
              className="inline-flex min-h-[2.75rem] items-center justify-center rounded-full border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] px-4 text-sm font-medium text-[var(--button-secondary-text)] shadow-[var(--button-secondary-shadow)] transition hover:-translate-y-[1px]"
            >
              Library
            </Link>
          </div>
        </div>

        {showNotebookForm ? (
          <Card padding="md">
            <SectionHeader
              eyebrow="Notebook template"
              title="Add a notebook to this folder."
            />
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {[
                ["blank", "Blank notebook", "Free working, notes, and questions."],
                ["uploaded_file", "Uploaded file / paper", "Save a PDF or image reference."],
                ["ai_questions", "AI-created questions", "Coming later."],
              ].map(([value, title, detail]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    const template = value as NotebookTemplate;
                    setNotebookTemplate(template);
                    if (template === "uploaded_file") {
                      setNotebookColor("sky");
                      setNotebookIcon("none");
                    } else if (template === "ai_questions") {
                      setNotebookColor("indigo");
                      setNotebookIcon("none");
                    }
                  }}
                  className={`rounded-[1.25rem] border p-4 text-left transition ${
                    notebookTemplate === value
                      ? "border-warm-border bg-warm-glow"
                      : "border-white/[0.09] bg-white/[0.04] hover:border-white/[0.16]"
                  }`}
                >
                  <div className="text-sm font-semibold text-white">{title}</div>
                  <p className="mt-2 text-sm leading-6 text-text-secondary">{detail}</p>
                </button>
              ))}
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
            <div className="mt-5">
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
            <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_auto] lg:items-end">
              <Input
                label="Notebook title"
                value={notebookTitle}
                onChange={(event) => setNotebookTitle(event.target.value)}
              />
              <div>
                <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                  File
                </label>
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  disabled={notebookTemplate !== "uploaded_file" || creatingNotebook}
                  onChange={(event) => setNotebookFile(event.target.files?.[0] ?? null)}
                  className="block min-h-[2.75rem] w-full rounded-2xl border border-border bg-surface-panel-strong px-3 py-2 text-sm text-text-primary file:mr-3 file:rounded-full file:border-0 file:bg-warm-glow file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-warm-accent disabled:cursor-not-allowed disabled:saturate-[0.82]"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={creatingNotebook}
                  onClick={() => {
                    setShowNotebookForm(false);
                    setNotebookTitle("");
                    setNotebookTemplate("blank");
                    setNotebookColor("violet");
                    setNotebookIcon("none");
                    setNotebookPageColor("white");
                    setNotebookFile(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={creatingNotebook}
                  onClick={() => void handleCreateNotebook()}
                >
                  {creatingNotebook ? "Creating..." : "Create"}
                </Button>
              </div>
            </div>
            {notebookTemplate === "uploaded_file" ? (
              <p className="mt-3 text-sm leading-6 text-text-muted">
                File saved. Annotation and OCR come later.
              </p>
            ) : null}
            {notebookTemplate === "ai_questions" ? (
              <p className="mt-3 text-sm leading-6 text-text-muted">
                AI question notebooks are not active yet.
              </p>
            ) : null}
          </Card>
        ) : null}

        {showEditFolder ? (
          <Card padding="md">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <SectionHeader
                eyebrow="Edit folder"
                title="Edit folder"
              />
              <Button type="button" variant="secondary" onClick={() => setShowEditFolder(false)}>
                Close
              </Button>
            </div>
            <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
              <Input
                label="Folder name"
                value={editFolderName}
                onChange={(event) => setEditFolderName(event.target.value)}
              />
              <ObjectStylePicker
                color={editFolderColor}
                icon={editFolderIcon}
                onColorChange={setEditFolderColor}
                onIconChange={setEditFolderIcon}
                colorLabel="Folder colour"
                iconLabel="Folder icon"
              />
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={savingFolder || !editFolderName.trim()}
                onClick={() => void handleSaveFolder()}
              >
                {savingFolder ? "Saving..." : "Save folder"}
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={savingFolder}
                onClick={() => void handleArchiveFolder()}
              >
                Archive folder
              </Button>
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
                onClick={() => setActiveTab(value as FolderTab)}
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
            <SectionHeader eyebrow="Notebooks" title="Workbooks" />
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
                    updatedLabel="Open notebook"
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
                      <Button type="button" onClick={() => setShowNotebookForm(true)}>
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
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {folderDecks.length > 0 ? (
                folderDecks.map((deck) => {
                  return (
                    <div
                      key={deck.id}
                      className="group rounded-[1.1rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-3 transition duration-fast hover:-translate-y-[1px] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-glass)]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <Link
                          href={getDeckStudyRouteHref(deck.id)}
                          className="min-w-0 flex-1 rounded-[0.8rem] outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                          aria-label={`Practice ${deck.name}`}
                        >
                          <div className="text-sm font-semibold leading-5 text-text-primary [overflow-wrap:anywhere]">{deck.name}</div>
                          <div className="mt-1 text-xs text-text-muted">Practice deck</div>
                        </Link>
                        <div className="flex shrink-0 flex-col gap-2">
                          <Link
                            href={getDeckHref(deck.id)}
                            className="inline-flex min-h-[2.25rem] items-center justify-center rounded-[2rem] border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] px-3 py-1 text-sm font-medium text-[var(--button-secondary-text)] shadow-[var(--button-secondary-shadow)] transition duration-fast hover:-translate-y-[1px] hover:border-[var(--button-secondary-border-hover)] hover:bg-[var(--button-secondary-bg-hover)]"
                          >
                            View
                          </Link>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={busyAssetId === deck.id}
                            onClick={() => void toggleDeckFolder(deck)}
                          >
                            Remove
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })
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
              <SectionHeader eyebrow="Sources" title="Library sources" />
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
                    placeholder="Search Library sources"
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
                    <p className="text-sm text-text-muted">No Library sources to add.</p>
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
                          Remove
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
