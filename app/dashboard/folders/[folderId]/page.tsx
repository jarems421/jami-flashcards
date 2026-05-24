"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppPage from "@/components/layout/AppPage";
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
import { featureFlags } from "@/lib/app/feature-flags";
import { useUser } from "@/lib/auth/user-context";
import type { Topic } from "@/lib/practice/topics";
import type { Question } from "@/lib/practice/questions";
import type { Source } from "@/lib/practice/sources";
import type { Notebook } from "@/lib/workspace/notebooks";
import type { PastPaper, PracticeSet } from "@/lib/workspace/practice-sets";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import { getDecks, updateDeckFolders, type Deck } from "@/services/study/decks";
import { getStudyFolderById } from "@/services/study/folders";
import {
  createNotebook,
  createNotebookPage,
  getNotebooksForFolder,
} from "@/services/study/notebooks";
import {
  createPastPaper,
  createPracticeSet,
  getPastPapersForFolder,
  getPracticeSetsForFolder,
} from "@/services/study/practice-work";
import { getActiveQuestions, updateQuestionFolders } from "@/services/study/practice";
import { getActiveSources, updateSource } from "@/services/study/sources";
import { getActiveTopics } from "@/services/study/topics";

type Feedback = { type: "success" | "error"; message: string };

function getTopicNames(folder: StudyFolder, topics: Topic[]) {
  return folder.topicIds
    .map((topicId) => topics.find((topic) => topic.id === topicId)?.name)
    .filter((name): name is string => Boolean(name));
}

const placeholderSections = [
  {
    title: "Recent work",
    detail: "Today and Progress will later use this folder activity to guide revision.",
    href: "/dashboard",
  },
];

export default function FolderDetailPage() {
  const { user } = useUser();
  const params = useParams<{ folderId?: string | string[] }>();
  const folderId = Array.isArray(params.folderId) ? params.folderId[0] : params.folderId;
  const [folder, setFolder] = useState<StudyFolder | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [practiceSets, setPracticeSets] = useState<PracticeSet[]>([]);
  const [pastPapers, setPastPapers] = useState<PastPaper[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busyAssetId, setBusyAssetId] = useState<string | null>(null);
  const [showNotebookForm, setShowNotebookForm] = useState(false);
  const [notebookTitle, setNotebookTitle] = useState("");
  const [creatingNotebook, setCreatingNotebook] = useState(false);
  const [practiceSetTitle, setPracticeSetTitle] = useState("");
  const [pastPaperTitle, setPastPaperTitle] = useState("");
  const [pastPaperYear, setPastPaperYear] = useState("");
  const [creatingPracticeShell, setCreatingPracticeShell] = useState(false);

  const loadFolder = useCallback(async () => {
    if (!user?.uid || !folderId || !featureFlags.enableFolders) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [
        nextFolder,
        nextTopics,
        nextDecks,
        nextSources,
        nextQuestions,
        nextNotebooks,
        nextPracticeSets,
        nextPastPapers,
      ] = await Promise.all([
        getStudyFolderById(user.uid, folderId),
        getActiveTopics(user.uid),
        getDecks(user.uid),
        getActiveSources(user.uid),
        getActiveQuestions(user.uid),
        getNotebooksForFolder(user.uid, folderId),
        getPracticeSetsForFolder(user.uid, folderId),
        getPastPapersForFolder(user.uid, folderId),
      ]);
      setFolder(nextFolder);
      setTopics(nextTopics);
      setDecks(nextDecks);
      setSources(nextSources);
      setQuestions(nextQuestions);
      setNotebooks(nextNotebooks);
      setPracticeSets(nextPracticeSets);
      setPastPapers(nextPastPapers);
    } catch (error) {
      console.error(error);
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Could not load this folder.",
      });
    } finally {
      setLoading(false);
    }
  }, [folderId, user?.uid]);

  useEffect(() => {
    void loadFolder();
  }, [loadFolder]);

  const topicNames = useMemo(() => (folder ? getTopicNames(folder, topics) : []), [folder, topics]);
  const folderTopicIds = useMemo(() => folder?.topicIds ?? [], [folder?.topicIds]);
  const linkedDecks = useMemo(
    () => decks.filter((deck) => folder && deck.folderIds.includes(folder.id)),
    [decks, folder]
  );
  const linkedSources = useMemo(
    () =>
      sources.filter(
        (source) =>
          folder &&
          (source.folderIds.includes(folder.id) ||
            source.topicIds.some((topicId) => folderTopicIds.includes(topicId)))
      ),
    [folder, folderTopicIds, sources]
  );
  const linkedQuestions = useMemo(
    () =>
      questions.filter(
        (question) =>
          folder &&
          (question.folderIds.includes(folder.id) ||
            question.topicIds.some((topicId) => folderTopicIds.includes(topicId)))
      ),
    [folder, folderTopicIds, questions]
  );

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

  const toggleQuestionFolder = async (question: Question) => {
    if (!user?.uid || !folder) return;
    const shouldLink = !question.folderIds.includes(folder.id);
    setBusyAssetId(question.id);
    try {
      const folderIds = mergeFolderId(question.folderIds, shouldLink);
      await updateQuestionFolders(user.uid, question.id, folderIds);
      setQuestions((current) =>
        current.map((item) => (item.id === question.id ? { ...item, folderIds } : item))
      );
      setFeedback({
        type: "success",
        message: shouldLink
          ? "Question linked to this folder."
          : "Question removed from this folder.",
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Could not update question folder link.",
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
    try {
      const notebook = await createNotebook(user.uid, {
        folderId: folder.id,
        title,
        type: "free_working",
        topicIds: folder.topicIds,
      });
      await createNotebookPage(user.uid, {
        notebookId: notebook.id,
        folderId: folder.id,
        pageNumber: 1,
        pageType: "free_working",
        title: "Page 1",
      });
      setNotebooks((current) => [notebook, ...current]);
      setNotebookTitle("");
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
    }
  };

  const handleCreatePracticeSet = async () => {
    if (!user?.uid || !folder) return;
    const title = practiceSetTitle.trim();
    if (!title) {
      setFeedback({ type: "error", message: "Name the practice set before creating it." });
      return;
    }

    setCreatingPracticeShell(true);
    try {
      const practiceSet = await createPracticeSet(user.uid, {
        folderId: folder.id,
        title,
        type: "manual",
        topicIds: folder.topicIds,
      });
      setPracticeSets((current) => [practiceSet, ...current]);
      setPracticeSetTitle("");
      setFeedback({
        type: "success",
        message: `${practiceSet.title} created as a folder practice set shell.`,
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Could not create practice set.",
      });
    } finally {
      setCreatingPracticeShell(false);
    }
  };

  const handleCreatePastPaper = async () => {
    if (!user?.uid || !folder) return;
    const title = pastPaperTitle.trim();
    if (!title) {
      setFeedback({ type: "error", message: "Name the past paper before creating it." });
      return;
    }

    setCreatingPracticeShell(true);
    try {
      const pastPaper = await createPastPaper(user.uid, {
        folderId: folder.id,
        title,
        year: pastPaperYear,
        module: folder.name,
      });
      setPastPapers((current) => [pastPaper, ...current]);
      setPastPaperTitle("");
      setPastPaperYear("");
      setFeedback({
        type: "success",
        message: `${pastPaper.title} saved as a past paper shell. PDF annotation comes later.`,
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Could not create past paper shell.",
      });
    } finally {
      setCreatingPracticeShell(false);
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

        <PageHero
          eyebrow="Study folder"
          title={folder.name}
          description={
            folder.description ??
            "This folder is the broad home for related notebooks, decks, sources, practice sets, and recent work."
          }
          action={
            <Button type="button" onClick={() => setShowNotebookForm((current) => !current)}>
              Create notebook
            </Button>
          }
          secondaryAction={
            <Link
              href="/dashboard/library"
              className="inline-flex min-h-[3.25rem] items-center justify-center rounded-full border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] px-5 text-base font-medium text-[var(--button-secondary-text)] shadow-[var(--button-secondary-shadow)] transition hover:-translate-y-[1px]"
            >
              Open Library
            </Link>
          }
          aside={
            <MetricStrip
              items={[
                { label: "Notebooks", value: notebooks.length },
                { label: "Topics", value: topicNames.length },
                { label: "Decks", value: linkedDecks.length },
                { label: "Sources", value: linkedSources.length },
                { label: "Questions", value: linkedQuestions.length },
                { label: "Sets", value: practiceSets.length + pastPapers.length },
              ]}
            />
          }
        />

        {showNotebookForm ? (
          <Card padding="md">
            <SectionHeader
              eyebrow="New notebook"
              title="Create a working notebook inside this folder."
              description="Use notebooks for natural typed or handwritten working. Expected answers and solution notes are optional metadata later, not the starting point."
            />
            <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-end">
              <Input
                label="Notebook title"
                value={notebookTitle}
                onChange={(event) => setNotebookTitle(event.target.value)}
                placeholder="Eigenvalues practice"
                containerClassName="flex-1"
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={creatingNotebook}
                  onClick={() => {
                    setShowNotebookForm(false);
                    setNotebookTitle("");
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
          </Card>
        ) : null}

        <Card padding="md">
          <SectionHeader
            eyebrow="Folder map"
            title="Everything for this study area will live here."
            description="Phase 5.1 creates the stable folder shell. The next passes link decks, sources and questions, then add notebook pages."
          />
          <div className="mt-4 flex flex-wrap gap-2">
            {topicNames.length > 0 ? (
              topicNames.map((topicName) => (
                <span
                  key={topicName}
                  className="rounded-full border border-warm-border bg-warm-glow px-3 py-1.5 text-xs font-semibold text-warm-accent"
                >
                  {topicName}
                </span>
              ))
            ) : (
              <span className="rounded-full border border-white/[0.1] bg-white/[0.045] px-3 py-1.5 text-xs text-text-muted">
                No linked topics yet
              </span>
            )}
          </div>
        </Card>

        <Card padding="md">
          <SectionHeader
            eyebrow="Notebooks"
            title="Work naturally on notebook pages."
            description="A notebook is where this folder becomes a study workspace: type, draw, add pages, save, and return later."
          />
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {notebooks.length > 0 ? (
              notebooks.map((notebook) => (
                <Link
                  key={notebook.id}
                  href={`/dashboard/notebooks/${notebook.id}`}
                  className="rounded-[1.2rem] border border-white/[0.09] bg-white/[0.04] p-4 transition duration-fast hover:-translate-y-0.5 hover:border-warm-border hover:bg-white/[0.065]"
                >
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
                    {notebook.type.replace("_", " ")}
                  </div>
                  <div className="mt-2 text-base font-semibold text-white">{notebook.title}</div>
                  <p className="mt-2 text-sm leading-6 text-text-secondary">
                    Open the page workspace for typed and drawn working.
                  </p>
                </Link>
              ))
            ) : (
              <div className="rounded-[1.2rem] border border-white/[0.09] bg-white/[0.035] p-4 text-sm leading-6 text-text-secondary md:col-span-2 xl:col-span-3">
                No notebooks yet. Create one here, then Jami has a real place for your
                Linear Algebra-style working instead of forcing every attempt through a form.
              </div>
            )}
          </div>
        </Card>

        <Card padding="md">
          <SectionHeader
            eyebrow="Practice sets and papers"
            title="Create shells for grouped question work."
            description="This prepares the folder for drills and past-paper working without building PDF annotation or AI generation yet."
          />
          <div className="mt-5 grid gap-4 xl:grid-cols-2">
            <div className="rounded-[1.2rem] border border-white/[0.09] bg-white/[0.035] p-4">
              <div className="text-sm font-semibold text-white">Practice set shell</div>
              <p className="mt-1 text-sm leading-6 text-text-secondary">
                Use this for manual or future AI-generated grouped questions inside this folder.
              </p>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
                <Input
                  label="Set title"
                  value={practiceSetTitle}
                  onChange={(event) => setPracticeSetTitle(event.target.value)}
                  placeholder="Eigenvalues drill"
                  containerClassName="flex-1"
                />
                <Button
                  type="button"
                  disabled={creatingPracticeShell}
                  onClick={() => void handleCreatePracticeSet()}
                >
                  Create set
                </Button>
              </div>
              <div className="mt-4 space-y-2">
                {practiceSets.length > 0 ? (
                  practiceSets.map((practiceSet) => (
                    <div
                      key={practiceSet.id}
                      className="rounded-[1rem] border border-white/[0.09] bg-white/[0.04] p-3"
                    >
                      <div className="text-sm font-semibold text-white">{practiceSet.title}</div>
                      <div className="mt-1 text-xs text-text-muted">
                        {practiceSet.type.replace("_", " ")} - {practiceSet.questionIds.length} questions
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm leading-6 text-text-muted">
                    No practice sets yet. Create a shell now, then connect questions in a later pass.
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-[1.2rem] border border-white/[0.09] bg-white/[0.035] p-4">
              <div className="text-sm font-semibold text-white">Past paper shell</div>
              <p className="mt-1 text-sm leading-6 text-text-secondary">
                Save the paper identity and folder context first. Upload/PDF annotation stays out of Phase 5.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-end">
                <Input
                  label="Paper title"
                  value={pastPaperTitle}
                  onChange={(event) => setPastPaperTitle(event.target.value)}
                  placeholder="2024 Linear Algebra paper"
                />
                <Input
                  label="Year"
                  value={pastPaperYear}
                  onChange={(event) => setPastPaperYear(event.target.value)}
                  placeholder="2024"
                />
                <Button
                  type="button"
                  disabled={creatingPracticeShell}
                  onClick={() => void handleCreatePastPaper()}
                >
                  Create paper
                </Button>
              </div>
              <div className="mt-4 space-y-2">
                {pastPapers.length > 0 ? (
                  pastPapers.map((paper) => (
                    <div
                      key={paper.id}
                      className="rounded-[1rem] border border-white/[0.09] bg-white/[0.04] p-3"
                    >
                      <div className="text-sm font-semibold text-white">{paper.title}</div>
                      <div className="mt-1 text-xs text-text-muted">
                        {paper.year ?? "No year"} - metadata shell only
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm leading-6 text-text-muted">
                    No past paper shells yet. Add one to reserve the working space without promising PDF tools.
                  </p>
                )}
              </div>
            </div>
          </div>
        </Card>

        <section className="grid gap-4 xl:grid-cols-3">
          <Card padding="md" className="xl:col-span-1">
            <SectionHeader
              eyebrow="Decks"
              title="Flashcard decks in this folder"
              description="Decks still appear globally. Linking them here makes this folder feel like the home for the study area."
            />
            <div className="mt-4 space-y-3">
              {decks.length > 0 ? (
                decks.map((deck) => {
                  const linked = deck.folderIds.includes(folder.id);
                  return (
                    <div
                      key={deck.id}
                      className="rounded-[1.15rem] border border-white/[0.09] bg-white/[0.04] p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-white">{deck.name}</div>
                          <div className="mt-1 text-xs text-text-muted">
                            {linked ? "Inside this folder" : "Global deck"}
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
                <p className="text-sm leading-6 text-text-muted">
                  No decks yet. Create decks globally, then link useful ones here.
                </p>
              )}
            </div>
          </Card>

          <Card padding="md" className="xl:col-span-1">
            <SectionHeader
              eyebrow="Sources"
              title="Library sources in this folder"
              description="Sources keep their global Library home, but can also sit beside related notebook and deck work."
            />
            <div className="mt-4 space-y-3">
              {sources.length > 0 ? (
                sources.map((source) => {
                  const linked = source.folderIds.includes(folder.id);
                  const suggested = !linked && source.topicIds.some((topicId) => folderTopicIds.includes(topicId));
                  return (
                    <div
                      key={source.id}
                      className="rounded-[1.15rem] border border-white/[0.09] bg-white/[0.04] p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-white">{source.title}</div>
                          <div className="mt-1 text-xs text-text-muted">
                            {linked ? "Inside this folder" : suggested ? "Suggested by topic" : "Library source"}
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
                <p className="text-sm leading-6 text-text-muted">
                  No sources yet. Add notes or references in Library, then link them here.
                </p>
              )}
            </div>
          </Card>

          <Card padding="md" className="xl:col-span-1">
            <SectionHeader
              eyebrow="Questions"
              title="Practice questions in this folder"
              description="Question records stay available to Practice, but folder links prepare them for notebook and practice-set workflows."
            />
            <div className="mt-4 space-y-3">
              {questions.length > 0 ? (
                questions.map((question) => {
                  const linked = question.folderIds.includes(folder.id);
                  const suggested = !linked && question.topicIds.some((topicId) => folderTopicIds.includes(topicId));
                  return (
                    <div
                      key={question.id}
                      className="rounded-[1.15rem] border border-white/[0.09] bg-white/[0.04] p-3"
                    >
                      <div className="text-sm font-semibold leading-5 text-white">
                        {question.questionText}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-white/[0.1] bg-white/[0.045] px-2.5 py-1 text-[0.68rem] text-text-muted">
                          {linked ? "Inside this folder" : suggested ? "Suggested by topic" : "Practice question"}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant={linked ? "secondary" : "warm"}
                          disabled={busyAssetId === question.id}
                          onClick={() => void toggleQuestionFolder(question)}
                        >
                          {linked ? "Unlink" : "Link"}
                        </Button>
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="text-sm leading-6 text-text-muted">
                  No questions yet. Practice will become folder-first after the notebook foundation is stable.
                </p>
              )}
            </div>
          </Card>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {placeholderSections.map((section) => {
            const content = (
              <Card
                padding="md"
                className="h-full min-h-[11rem] transition duration-fast hover:-translate-y-0.5 hover:border-warm-border"
              >
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
                  {section.title}
                </div>
                <p className="mt-3 text-sm leading-6 text-text-secondary">
                  {section.detail}
                </p>
                <div className="mt-5 text-sm font-semibold text-warm-accent">
                  {section.href ? "Open related page" : "Coming next"}
                </div>
              </Card>
            );

            return section.href ? (
              <Link key={section.title} href={section.href} className="block">
                {content}
              </Link>
            ) : (
              <div key={section.title}>{content}</div>
            );
          })}
        </section>
      </div>
    </AppPage>
  );
}
