"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useUser } from "@/lib/auth/user-context";
import { createStudyFolder, getActiveStudyFolders } from "@/services/study/folders";
import { getActiveNotebooks } from "@/services/study/notebooks";
import type { Notebook } from "@/lib/workspace/notebooks";
import type { StudyFolder } from "@/lib/workspace/study-folders";
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
  const { user } = useUser();
  const [folders, setFolders] = useState<StudyFolder[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [folderSubject, setFolderSubject] = useState("");
  const [folderDescription, setFolderDescription] = useState("");
  const [folderColor, setFolderColor] = useState<ObjectColorId>("sky");
  const [folderIcon, setFolderIcon] = useState<ObjectIconId>("none");
  const [creatingFolder, setCreatingFolder] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const [nextFolders, nextNotebooks] = await Promise.all([
        getActiveStudyFolders(user.uid),
        getActiveNotebooks(user.uid).catch(() => [] as Notebook[]),
      ]);
      setFolders(nextFolders);
      setNotebooks(nextNotebooks);
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
    setCreatingFolder(true);
    setFeedback(null);
    try {
      const folder = await createStudyFolder(user.uid, {
        name: folderName,
        subject: folderSubject,
        description: folderDescription,
        color: folderColor,
        icon: folderIcon,
      });
      setFolderName("");
      setFolderSubject("");
      setFolderDescription("");
      setFolderColor("sky");
      setFolderIcon("none");
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
            className="inline-flex min-h-[2.75rem] items-center justify-center rounded-[2rem] bg-accent px-4 py-2 text-sm font-medium text-white shadow-[var(--shadow-accent)] transition duration-fast hover:-translate-y-[1px] hover:bg-accent-hover"
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
                <Input label="Folder name" value={folderName} onChange={(event) => setFolderName(event.target.value)} />
                <Input label="Subject" value={folderSubject} onChange={(event) => setFolderSubject(event.target.value)} />
              </div>
              <Input
                label="Description"
                value={folderDescription}
                onChange={(event) => setFolderDescription(event.target.value)}
                containerClassName="mt-3"
              />
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
                <Button type="button" disabled={creatingFolder || !folderName.trim()} onClick={() => void handleCreateFolder()}>
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
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
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
                      className="inline-flex min-h-[2.75rem] items-center justify-center rounded-2xl bg-accent px-4 py-2 text-sm font-medium text-white shadow-[var(--shadow-accent)] transition hover:-translate-y-[1px] hover:bg-accent-hover"
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
