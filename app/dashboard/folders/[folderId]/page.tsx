"use client";

import Link from "next/link";
import { FirebaseError } from "firebase/app";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppPage from "@/components/layout/AppPage";
import FolderObjectCard from "@/components/workspace/FolderObjectCard";
import { NotebookObjectCard } from "@/components/workspace/NotebookObjectCard";
import { ObjectStylePicker } from "@/components/workspace/ObjectStylePicker";
import type { ObjectColorId, ObjectIconId } from "@/components/workspace/object-card-styles";
import {
  Button,
  Card,
  EmptyState,
  FeedbackBanner,
  Input,
  SectionHeader,
  Skeleton,
} from "@/components/ui";
import { featureFlags } from "@/lib/app/feature-flags";
import { useUser } from "@/lib/auth/user-context";
import type { Source } from "@/lib/practice/sources";
import type { Notebook } from "@/lib/workspace/notebooks";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import { getDecks, updateDeckFolders, type Deck } from "@/services/study/decks";
import { getStudyFolderById } from "@/services/study/folders";
import {
  createNotebook,
  createNotebookPage,
  getNotebooksForFolder,
  updateNotebook,
} from "@/services/study/notebooks";
import { uploadNotebookFile } from "@/services/study/notebook-files";
import { getActiveSources, updateSource } from "@/services/study/sources";

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
  const [notebookIcon, setNotebookIcon] = useState<ObjectIconId>("book");
  const [notebookFile, setNotebookFile] = useState<File | null>(null);
  const [creatingNotebook, setCreatingNotebook] = useState(false);
  const [activeTab, setActiveTab] = useState<FolderTab>("notebooks");

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

  const folderTopicIds = useMemo(() => folder?.topicIds ?? [], [folder?.topicIds]);
  const mergeFolderId = (folderIds: string[], shouldLink: boolean) => {
    if (!folder) return folderIds;
    if (shouldLink) {
      return Array.from(new Set([...folderIds, folder.id]));
    }
    return folderIds.filter((id) => id !== folder.id);
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
        pageColor: "white",
      });
      await createNotebookPage(user.uid, {
        notebookId: notebook.id,
        folderId: folder.id,
        pageNumber: 1,
        pageType: notebookTemplate === "uploaded_file" ? "past_paper_page" : "free_working",
        title: "Page 1",
        pageColor: "white",
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
      setNotebookIcon("book");
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
              description="Question sets, papers, drills, and blank working books all start as notebooks. AI questions are planned, but the workspace comes first."
            />
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {[
                ["blank", "Blank notebook", "For free working, notes, and questions you write yourself."],
                ["uploaded_file", "Uploaded file / paper", "Upload a PDF or image, then work on notebook pages beside it."],
                ["ai_questions", "AI-created questions", "Placeholder for future question notebooks."],
              ].map(([value, title, detail]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    const template = value as NotebookTemplate;
                    setNotebookTemplate(template);
                    if (template === "uploaded_file") {
                      setNotebookColor("sky");
                      setNotebookIcon("file");
                    } else if (template === "ai_questions") {
                      setNotebookColor("indigo");
                      setNotebookIcon("star");
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
            <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_auto] lg:items-end">
              <Input
                label="Notebook title"
                value={notebookTitle}
                onChange={(event) => setNotebookTitle(event.target.value)}
                placeholder={
                  notebookTemplate === "uploaded_file"
                    ? "2024 Biology paper"
                    : notebookTemplate === "ai_questions"
                      ? "Biology exam questions"
                      : "Biology revision notes"
                }
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
                  className="block min-h-[2.75rem] w-full rounded-2xl border border-border bg-surface-panel-strong px-3 py-2 text-sm text-text-primary file:mr-3 file:rounded-full file:border-0 file:bg-warm-glow file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-warm-accent disabled:opacity-50"
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
                    setNotebookIcon("book");
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
                File saved to your notebook. Full paper annotation, OCR, and automatic reading come later.
              </p>
            ) : null}
            {notebookTemplate === "ai_questions" ? (
              <p className="mt-3 text-sm leading-6 text-text-muted">
                This template is intentionally a placeholder in Phase 6 so the notebook workflow stays stable before AI generation moves in.
              </p>
            ) : null}
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
            <SectionHeader eyebrow="Decks" title="Flashcard decks" />
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {decks.length > 0 ? (
                decks.map((deck) => {
                  const linked = deck.folderIds.includes(folder.id);
                  return (
                    <div
                      key={deck.id}
                      className="rounded-[1.1rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-text-primary">{deck.name}</div>
                          <div className="mt-1 text-xs text-text-muted">
                            {linked ? "In this folder" : "Global deck"}
                          </div>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant={linked ? "secondary" : "warm"}
                          disabled={busyAssetId === deck.id}
                          onClick={() => void toggleDeckFolder(deck)}
                        >
                          {linked ? "Unlink" : "Link"}
                        </Button>
                      </div>
                    </div>
                  );
                })
              ) : (
                <EmptyState
                  title="No decks yet"
                  description="Create decks globally, then link useful ones here."
                />
              )}
            </div>
          </section>
        ) : null}

        {activeTab === "sources" ? (
          <section className="space-y-4">
            <SectionHeader eyebrow="Sources" title="Library sources" />
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {sources.length > 0 ? (
                sources.map((source) => {
                  const linked = source.folderIds.includes(folder.id);
                  const suggested = !linked && source.topicIds.some((topicId) => folderTopicIds.includes(topicId));
                  return (
                    <div
                      key={source.id}
                      className="rounded-[1.1rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-text-primary">{source.title}</div>
                          <div className="mt-1 text-xs text-text-muted">
                            {linked ? "In this folder" : suggested ? "Suggested by topic" : "Library source"}
                          </div>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant={linked ? "secondary" : "warm"}
                          disabled={busyAssetId === source.id}
                          onClick={() => void toggleSourceFolder(source)}
                        >
                          {linked ? "Unlink" : "Link"}
                        </Button>
                      </div>
                    </div>
                  );
                })
              ) : (
                <EmptyState
                  title="No sources yet"
                  description="Add notes or references in Library, then link them here."
                />
              )}
            </div>
          </section>
        ) : null}
      </div>
    </AppPage>
  );
}
