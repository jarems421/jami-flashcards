"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useUser } from "@/lib/auth/user-context";
import type { Deck } from "@/services/study/decks";
import { getDecks } from "@/services/study/decks";
import { createStudyFolder, getActiveStudyFolders } from "@/services/study/folders";
import { getActiveNotebooks } from "@/services/study/notebooks";
import { getActiveSources } from "@/services/study/sources";
import type { Source } from "@/lib/practice/sources";
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
  MetricStrip,
  PageHero,
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
  const [decks, setDecks] = useState<Deck[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [folderSubject, setFolderSubject] = useState("");
  const [folderDescription, setFolderDescription] = useState("");
  const [folderColor, setFolderColor] = useState<ObjectColorId>("sky");
  const [folderIcon, setFolderIcon] = useState<ObjectIconId>("book");
  const [creatingFolder, setCreatingFolder] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const [nextFolders, nextNotebooks, nextDecks, nextSources] = await Promise.all([
        getActiveStudyFolders(user.uid),
        getActiveNotebooks(user.uid).catch(() => [] as Notebook[]),
        getDecks(user.uid).catch(() => [] as Deck[]),
        getActiveSources(user.uid).catch(() => [] as Source[]),
      ]);
      setFolders(nextFolders);
      setNotebooks(nextNotebooks);
      setDecks(nextDecks);
      setSources(nextSources);
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
  const folderCards = useMemo(
    () =>
      folders.map((folder) => {
        const folderNotebooks = notebooks.filter((notebook) => notebook.folderId === folder.id);
        const folderDecks = decks.filter((deck) => deck.folderIds.includes(folder.id));
        const folderSources = sources.filter(
          (source) =>
            source.folderIds.includes(folder.id) ||
            source.topicIds.some((topicId) => folder.topicIds.includes(topicId))
        );
        return { folder, notebookCount: folderNotebooks.length, deckCount: folderDecks.length, sourceCount: folderSources.length };
      }),
    [decks, folders, notebooks, sources]
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
      setFolderIcon("book");
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

      <PageHero
        eyebrow="Notebook-first Practice"
        title="Open a folder, then work inside a notebook."
        description="Practice no longer starts from a question bank. Your work lives on notebook pages, with decks and sources kept nearby in the same study folder."
        tone="warm"
        action={
          recentNotebooks[0] ? (
            <Link
              href={`/dashboard/notebooks/${encodeURIComponent(recentNotebooks[0].id)}`}
              className="inline-flex min-h-[3.25rem] items-center justify-center rounded-[2rem] bg-accent px-5 py-3 text-base font-medium text-white shadow-[var(--shadow-accent)] transition duration-fast hover:-translate-y-[1px] hover:bg-accent-hover"
            >
              Continue notebook
            </Link>
          ) : (
            <Button type="button" size="lg" onClick={() => setShowCreateFolder(true)}>
              Create first folder
            </Button>
          )
        }
      />

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <>
          <MetricStrip
            items={[
              { label: "Folders", value: folders.length },
              { label: "Notebooks", value: notebooks.length, tone: notebooks.length > 0 ? "good" : "default" },
              { label: "Decks linked", value: decks.filter((deck) => deck.folderIds.length > 0).length },
              { label: "Sources", value: sources.length },
            ]}
            variant="compact"
          />

          {showCreateFolder ? (
            <Card tone="warm" padding="lg">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <SectionHeader
                  eyebrow="New folder"
                  title="Create a study space"
                  description="Folders are broad spaces for notebooks, decks, sources, and later AI help."
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

          <Card padding="lg">
            <SectionHeader
              eyebrow="Continue working"
              title="Recent notebooks"
              description="Pick up the latest notebook page. This replaces the old question-bank flow."
            />
            <div className="mt-5 grid gap-4 lg:grid-cols-3">
              {recentNotebooks.length > 0 ? (
                recentNotebooks.map((notebook) => {
                  const folder = folders.find((item) => item.id === notebook.folderId);
                  return (
                    <NotebookObjectCard
                      key={notebook.id}
                      href={`/dashboard/notebooks/${encodeURIComponent(notebook.id)}`}
                      title={notebook.title}
                      subtitle="Open the notebook page workspace."
                      typeLabel={notebookTypeLabel(notebook.type)}
                      folderName={folder?.name ?? "Folder"}
                      color={notebook.color}
                      icon={notebook.icon}
                      pageColor={notebook.pageColor}
                      updatedLabel={`Edited ${formatDate(notebook.updatedAt)}`}
                    />
                  );
                })
              ) : (
                <EmptyState
                  emoji="Notebook"
                  title="No notebooks yet"
                  description="Open a folder and create a blank notebook, uploaded-file notebook, or future AI-question notebook."
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
          </Card>

          <Card padding="lg">
            <SectionHeader
              eyebrow="Folders"
              title="Choose a study space"
              description="Folders hold notebooks, decks, and sources together so Practice starts from real work."
            />
            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {folderCards.length > 0 ? (
                folderCards.map(({ folder, notebookCount, deckCount, sourceCount }) => (
                  <FolderObjectCard
                    key={folder.id}
                    href={`/dashboard/folders/${encodeURIComponent(folder.id)}`}
                    title={folder.name}
                    subtitle={folder.subject ?? "Study folder"}
                    description={folder.description || "Open this folder to create notebooks and organise related study material."}
                    color={folder.color}
                    icon={folder.icon}
                    stats={[
                      { label: "Books", value: notebookCount },
                      { label: "Decks", value: deckCount },
                      { label: "Sources", value: sourceCount },
                    ]}
                    updatedLabel={`Updated ${formatDate(folder.updatedAt)}`}
                  />
                ))
              ) : (
                <div className="md:col-span-2 xl:col-span-3">
                  <EmptyState
                    emoji="Folder"
                    title="Create your first folder"
                    description="Start with a subject, module, exam, or project. You can add notebooks, decks, and sources inside it."
                    action={
                      <Button type="button" onClick={() => setShowCreateFolder(true)}>
                        Create folder
                      </Button>
                    }
                  />
                </div>
              )}
            </div>
          </Card>
        </>
      )}
    </AppPage>
  );
}
