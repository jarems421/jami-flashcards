"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useUser } from "@/lib/auth/user-context";
import { createStudyFolder, getActiveStudyFolders } from "@/services/study/folders";
import { getActiveNotebooks } from "@/services/study/notebooks";
import { getActiveTopics } from "@/services/study/topics";
import type { Topic } from "@/lib/practice/topics";
import type { Notebook } from "@/lib/workspace/notebooks";
import { getFolderNameValidationError } from "@/lib/workspace/folder-form";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import AppPage from "@/components/layout/AppPage";
import FolderObjectCard from "@/components/workspace/FolderObjectCard";
import NotebookEditorDialog from "@/components/workspace/NotebookEditorDialog";
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

type Feedback = { type: "success" | "error"; message: string };

function notebookTypeLabel(type: Notebook["type"]) {
  if (type === "uploaded_file") return "Uploaded file notebook";
  if (type === "ai_questions") return "AI questions notebook";
  if (type === "general_working" || type === "free_working") return "Working notebook";
  if (type === "source_notes") return "Source notes";
  if (type === "past_paper") return "Paper notebook";
  if (type === "practice") return "Practice notebook";
  return "Blank notebook";
}

function formatDate(value: number) {
  if (!value) return "Not opened yet";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function PracticePage() {
  const { user, isDemoUser } = useUser();
  const [folders, setFolders] = useState<StudyFolder[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [editingNotebook, setEditingNotebook] = useState<Notebook | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [folderSubject, setFolderSubject] = useState("");
  const [folderColor, setFolderColor] = useState<ObjectColorId>("sky");
  const [folderIcon, setFolderIcon] = useState<ObjectIconId>("none");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderNameTouched, setFolderNameTouched] = useState(false);
  const folderNameError = getFolderNameValidationError(folderName);
  const folderNameIsValid = folderNameError === null;
  const showFolderNameError = folderNameTouched && Boolean(folderNameError);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const [nextFolders, nextNotebooks, nextTopics] = await Promise.all([
        getActiveStudyFolders(user.uid),
        getActiveNotebooks(user.uid).catch(() => [] as Notebook[]),
        getActiveTopics(user.uid).catch(() => [] as Topic[]),
      ]);
      setFolders(nextFolders);
      setNotebooks(nextNotebooks);
      setTopics(nextTopics);
    } catch (error) {
      console.error(error);
      setFeedback({ type: "error", message: "Failed to load Practice workspace." });
    } finally {
      setLoading(false);
    }
  }, [user.uid]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const recentNotebooks = useMemo(
    () => [...notebooks].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, 3),
    [notebooks]
  );
  const handleCreateFolder = async () => {
    if (!folderNameIsValid) {
      setFolderNameTouched(true);
      return;
    }
    setCreatingFolder(true);
    setFeedback(null);
    try {
      const folder = await createStudyFolder(user.uid, {
        name: folderName,
        subject: folderSubject,
        color: folderColor,
        icon: folderIcon,
      });
      setFolderName("");
      setFolderSubject("");
      setFolderColor("sky");
      setFolderIcon("none");
      setFolderNameTouched(false);
      setShowCreateFolder(false);
      await loadAll();
      setFeedback({ type: "success", message: `"${folder.name}" created. Open it to add notebooks.` });
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Could not create folder.",
      });
    } finally {
      setCreatingFolder(false);
    }
  };

  return (
    <AppPage
      title="Practice"
      backHref="/dashboard"
      backLabel="Today"
      width="3xl"
      action={
        <Button type="button" onClick={() => setShowCreateFolder(true)}>
          Create folder
        </Button>
      }
      contentClassName="space-y-4 sm:space-y-6"
    >
      {feedback ? (
        <FeedbackBanner
          type={feedback.type}
          message={feedback.message}
          onDismiss={() => setFeedback(null)}
        />
      ) : null}

      {editingNotebook ? (
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

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">Practice</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-text-primary sm:text-4xl">
            Your study workspace
          </h1>
        </div>
        {recentNotebooks[0] ? (
          <Link
            href={`/dashboard/notebooks/${encodeURIComponent(recentNotebooks[0].id)}`}
            className="app-button-primary inline-flex min-h-[2.75rem] items-center justify-center rounded-[2rem] px-4 py-2 text-sm font-medium"
          >
            Continue notebook
          </Link>
        ) : null}
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-32 rounded-[1.4rem]" />
          <Skeleton className="h-44 rounded-[1.4rem]" />
        </div>
      ) : (
        <>
          {showCreateFolder ? (
            <Card tone="warm" padding="lg">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <SectionHeader
                  eyebrow="New folder"
                  title="Create a study space"
                />
                <Button type="button" variant="secondary" onClick={() => setShowCreateFolder(false)}>
                  Close
                </Button>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div>
                  <Input
                    label="Folder name"
                    value={folderName}
                    onBlur={() => setFolderNameTouched(true)}
                    onChange={(event) => {
                      setFolderName(event.target.value);
                      if (event.target.value.trim()) {
                        setFolderNameTouched(false);
                      }
                    }}
                    aria-invalid={showFolderNameError}
                  />
                  {showFolderNameError ? (
                    <p className="mt-2 text-sm font-medium text-danger-text">
                      {folderNameError}
                    </p>
                  ) : null}
                </div>
                <Input label="Subject" value={folderSubject} onChange={(event) => setFolderSubject(event.target.value)} />
              </div>
              <div className="mt-5">
                <ObjectStylePicker
                  color={folderColor}
                  icon={folderIcon}
                  onColorChange={setFolderColor}
                  onIconChange={setFolderIcon}
                  colorLabel="Folder colour"
                  iconLabel="Folder icon"
                />
              </div>
              <div className="mt-4">
                <Button type="button" disabled={creatingFolder || !folderNameIsValid} onClick={() => void handleCreateFolder()}>
                  {creatingFolder ? "Creating..." : "Create folder"}
                </Button>
              </div>
            </Card>
          ) : null}

          <section className="space-y-4">
            <SectionHeader
              eyebrow="Continue working"
              title="Recent notebooks"
            />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
              {recentNotebooks.length > 0 ? (
                recentNotebooks.map((notebook) => {
                  const folder = folders.find((item) => item.id === notebook.folderId);
                  return (
                    <NotebookObjectCard
                      key={notebook.id}
                      href={`/dashboard/notebooks/${encodeURIComponent(notebook.id)}`}
                      title={notebook.title}
                      typeLabel={notebookTypeLabel(notebook.type)}
                      color={notebook.color}
                      icon={notebook.icon}
                      pageColor={notebook.pageColor}
                      updatedLabel={folder?.name ?? formatDate(notebook.updatedAt)}
                      onEdit={
                        isDemoUser ? undefined : () => setEditingNotebook(notebook)
                      }
                      compact
                    />
                  );
                })
              ) : (
                <EmptyState
                  emoji="Notebook"
                  title="No notebooks yet"
                  description="Open a folder and create a notebook."
                    action={
                      <Link
                        href="/dashboard/folders"
                        className="app-button-primary inline-flex min-h-[2.75rem] items-center justify-center rounded-2xl px-4 py-2 text-sm font-medium"
                      >
                        Open folders
                    </Link>
                  }
                />
              )}
            </div>
          </section>

          <section className="space-y-4">
            <SectionHeader
              eyebrow="Folders"
              title="Study spaces"
            />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
              {folders.length > 0 ? (
                folders.map((folder) => (
                  <FolderObjectCard
                    key={folder.id}
                    href={`/dashboard/folders/${encodeURIComponent(folder.id)}`}
                    title={folder.name}
                    color={folder.color}
                    icon={folder.icon}
                  />
                ))
              ) : (
                <div className="col-span-full">
                  <EmptyState
                    emoji="Folder"
                    title="Create your first folder"
                    description="Create a folder to begin."
                    action={
                      <Button type="button" onClick={() => setShowCreateFolder(true)}>
                        Create folder
                      </Button>
                    }
                  />
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </AppPage>
  );
}
