"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AppPage from "@/components/layout/AppPage";
import {
  Button,
  ButtonLink,
  ConfirmDialog,
  EmptyState,
  FeedbackBanner,
  SectionHeader,
  Skeleton,
} from "@/components/ui";
import { useUser } from "@/lib/auth/user-context";
import type { Topic } from "@/lib/practice/topics";
import type { Notebook } from "@/lib/workspace/notebooks";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import { getActiveStudyFolders } from "@/services/study/folders";
import { getActiveNotebooks, updateNotebook } from "@/services/study/notebooks";
import { getActiveTopics } from "@/services/study/topics";
import CreateFolderDialog from "./CreateFolderDialog";
import FolderObjectCard from "./FolderObjectCard";
import NotebookEditorDialog from "./NotebookEditorDialog";
import { NotebookObjectCard } from "./NotebookObjectCard";

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
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export default function PracticeWorkspace() {
  const { user } = useUser();
  const [folders, setFolders] = useState<StudyFolder[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [editingNotebook, setEditingNotebook] = useState<Notebook | null>(null);
  const [notebookPendingDelete, setNotebookPendingDelete] =
    useState<Notebook | null>(null);
  const [deletingNotebookId, setDeletingNotebookId] = useState<string | null>(
    null
  );
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const loadWorkspace = useCallback(async () => {
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
      setFeedback({
        type: "error",
        message: "Failed to load your folders and notebooks.",
      });
    } finally {
      setLoading(false);
    }
  }, [user.uid]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const recentNotebooks = useMemo(
    () =>
      [...notebooks]
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, 3),
    [notebooks]
  );

  const firstFolderHref = folders[0]
    ? `/dashboard/folders/${encodeURIComponent(folders[0].id)}`
    : null;

  const handleDeleteNotebook = async () => {
    if (!notebookPendingDelete) return;
    const notebook = notebookPendingDelete;
    setDeletingNotebookId(notebook.id);
    setFeedback(null);
    try {
      await updateNotebook(user.uid, notebook.id, { archived: true });
      setNotebooks((current) =>
        current.filter((item) => item.id !== notebook.id)
      );
      setNotebookPendingDelete(null);
      setFeedback({
        type: "success",
        message: `${notebook.title} deleted.`,
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not delete notebook.",
      });
    } finally {
      setDeletingNotebookId(null);
    }
  };

  return (
    <AppPage
      title="Folders"
      backHref="/dashboard"
      backLabel="Today"
      width="3xl"
      action={
        <Button type="button" onClick={() => setCreateFolderOpen(true)}>
          Create folder
        </Button>
      }
      contentClassName="space-y-7 sm:space-y-9"
    >
      <CreateFolderDialog
        open={createFolderOpen}
        userId={user.uid}
        onClose={() => setCreateFolderOpen(false)}
        onCreated={(folder) => {
          setFolders((current) => [
            folder,
            ...current.filter((item) => item.id !== folder.id),
          ]);
          setFeedback({
            type: "success",
            message: `“${folder.name}” is ready. Open it to add a notebook.`,
          });
        }}
      />

      <ConfirmDialog
        open={notebookPendingDelete !== null}
        title={`Delete ${notebookPendingDelete?.title ?? "this notebook"}?`}
        description="This removes the notebook from your workspace. Its saved pages are retained so it can be recovered later."
        confirmLabel="Delete notebook"
        busy={
          notebookPendingDelete !== null &&
          deletingNotebookId === notebookPendingDelete.id
        }
        onConfirm={() => void handleDeleteNotebook()}
        onClose={() => setNotebookPendingDelete(null)}
      />

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

      {feedback ? (
        <FeedbackBanner
          type={feedback.type}
          message={feedback.message}
          onDismiss={() => setFeedback(null)}
        />
      ) : null}

      {loading ? (
        <div className="space-y-7 sm:space-y-9" aria-label="Loading folders and notebooks">
          <section className="space-y-4">
            <Skeleton className="h-7 w-48 rounded-full" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-40 rounded-[1.4rem]" />
              ))}
            </div>
          </section>
          <section className="space-y-4">
            <Skeleton className="h-7 w-36 rounded-full" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-36 rounded-[1.4rem]" />
              ))}
            </div>
          </section>
        </div>
      ) : (
        <>
          <section className="space-y-4">
            <SectionHeader eyebrow="Continue working" title="Recent notebooks" />
            {recentNotebooks.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
                {recentNotebooks.map((notebook) => {
                  const folder = folders.find(
                    (item) => item.id === notebook.folderId
                  );
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
                      onEdit={() => setEditingNotebook(notebook)}
                      onDelete={() => setNotebookPendingDelete(notebook)}
                      deleting={deletingNotebookId === notebook.id}
                      compact
                    />
                  );
                })}
              </div>
            ) : (
              <EmptyState
                emoji="📓"
                eyebrow="Ready when you are"
                title="Your first notebook starts inside a folder"
                description="Choose a subject folder, then create a blank notebook, working book, or paper notebook."
                variant="compact"
                action={
                  firstFolderHref ? (
                    <ButtonLink href={firstFolderHref}>Open a folder</ButtonLink>
                  ) : (
                    <Button
                      type="button"
                      onClick={() => setCreateFolderOpen(true)}
                    >
                      Create folder
                    </Button>
                  )
                }
              />
            )}
          </section>

          <section className="space-y-4">
            <SectionHeader
              eyebrow="Folders"
              title="Study spaces"
              description="Keep each subject’s notebooks, decks, and sources together."
              action={
                folders.length > 0 ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setCreateFolderOpen(true)}
                  >
                    New folder
                  </Button>
                ) : null
              }
            />
            {folders.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
                {folders.map((folder) => (
                  <FolderObjectCard
                    key={folder.id}
                    href={`/dashboard/folders/${encodeURIComponent(folder.id)}`}
                    title={folder.name}
                    color={folder.color}
                    icon={folder.icon}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                emoji="📁"
                title="Create your first study space"
                description="Start with one broad subject. You can organise the details inside it later."
                action={
                  <Button
                    type="button"
                    onClick={() => setCreateFolderOpen(true)}
                  >
                    Create folder
                  </Button>
                }
              />
            )}
          </section>
        </>
      )}
    </AppPage>
  );
}
