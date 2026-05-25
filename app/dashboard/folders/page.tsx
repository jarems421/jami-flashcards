"use client";

import Link from "next/link";
import { FirebaseError } from "firebase/app";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppPage from "@/components/layout/AppPage";
import FolderObjectCard from "@/components/workspace/FolderObjectCard";
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
  Skeleton,
  Textarea,
} from "@/components/ui";
import { featureFlags } from "@/lib/app/feature-flags";
import { useUser } from "@/lib/auth/user-context";
import type { Topic } from "@/lib/practice/topics";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import { createStudyFolder, getActiveStudyFolders } from "@/services/study/folders";
import { getActiveTopics } from "@/services/study/topics";

type Feedback = { type: "success" | "error"; message: string };

function isPermissionDenied(error: unknown) {
  return error instanceof FirebaseError && error.code === "permission-denied";
}

const starterFolders = [
  "Biology",
  "History",
  "Spanish",
  "Computer Science",
];

function getTopicNames(folder: StudyFolder, topics: Topic[]) {
  return folder.topicIds
    .map((topicId) => topics.find((topic) => topic.id === topicId)?.name)
    .filter((name): name is string => Boolean(name));
}

export default function FoldersPage() {
  const { user } = useUser();
  const [folders, setFolders] = useState<StudyFolder[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([]);
  const [folderColor, setFolderColor] = useState<ObjectColorId>("sky");
  const [folderIcon, setFolderIcon] = useState<ObjectIconId>("book");
  const [saving, setSaving] = useState(false);

  const loadFolders = useCallback(async () => {
    if (!user?.uid || !featureFlags.enableFolders) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [nextFolders, nextTopics] = await Promise.all([
        getActiveStudyFolders(user.uid),
        getActiveTopics(user.uid),
      ]);
      setFolders(nextFolders);
      setTopics(nextTopics);
    } catch (error) {
      console.error(error);
      setFolders([]);
      setTopics([]);
      setFeedback(
        isPermissionDenied(error)
          ? null
          : {
              type: "error",
              message: "Could not load folders. Try refreshing in a moment.",
            }
      );
    } finally {
      setLoading(false);
    }
  }, [user?.uid]);

  useEffect(() => {
    void loadFolders();
  }, [loadFolders]);

  const folderStats = useMemo(
    () => [
      {
        label: "Folders",
        value: folders.length,
        tone: folders.length > 0 ? ("warm" as const) : ("default" as const),
      },
      {
        label: "Linked topics",
        value: new Set(folders.flatMap((folder) => folder.topicIds)).size,
      },
      {
        label: "Notebook phase",
        value: "Next",
      },
    ],
    [folders]
  );

  const toggleTopic = (topicId: string) => {
    setSelectedTopicIds((current) =>
      current.includes(topicId)
        ? current.filter((id) => id !== topicId)
        : [...current, topicId]
    );
  };

  const resetForm = () => {
    setName("");
    setSubject("");
    setDescription("");
    setSelectedTopicIds([]);
    setFolderColor("sky");
    setFolderIcon("book");
  };

  const handleCreateFolder = async () => {
    if (!user?.uid) return;
    setSaving(true);
    setFeedback(null);
    try {
      const folder = await createStudyFolder(user.uid, {
        name,
        subject,
        description,
        topicIds: selectedTopicIds,
        color: folderColor,
        icon: folderIcon,
      });
      setFolders((current) => [folder, ...current]);
      setShowCreate(false);
      resetForm();
      setFeedback({
        type: "success",
        message: `${folder.name} is ready. Next, add decks, sources, and notebooks inside it.`,
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Could not create folder.",
      });
    } finally {
      setSaving(false);
    }
  };

  if (!featureFlags.enableFolders) {
    return (
      <AppPage title="Folders">
        <EmptyState
          emoji="Soon"
          title="Folders are not enabled yet"
          description="The folder workspace is behind a feature flag in this environment."
        />
      </AppPage>
    );
  }

  return (
    <AppPage
      title="Folders"
      width="3xl"
      action={
        <Button type="button" onClick={() => setShowCreate(true)}>
          Create folder
        </Button>
      }
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
          eyebrow="Study spaces"
          title="Open a folder and keep the whole topic together."
          description="Folders are broad study spaces like Biology, History, Spanish, or Computer Science. They hold notebooks, decks, sources, and recent work without forcing everything through one form-heavy Practice page."
          action={
            <Button type="button" onClick={() => setShowCreate(true)}>
              Create folder
            </Button>
          }
          secondaryAction={
            <Link
              href="/dashboard/practise"
              className="inline-flex min-h-[3.25rem] items-center justify-center rounded-full border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] px-5 text-base font-medium text-[var(--button-secondary-text)] shadow-[var(--button-secondary-shadow)] transition hover:-translate-y-[1px]"
            >
              Open Practice
            </Link>
          }
          aside={
            <div className="w-full min-w-[13rem] max-w-xs">
              <MetricStrip items={folderStats} />
            </div>
          }
        />

        {showCreate ? (
          <Card padding="lg" className="animate-fade-in">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
                  New folder
                </div>
                <h2 className="mt-2 text-xl font-semibold text-white">
                  Create a study space
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">
                  Start broad. Use topics for concepts inside the folder, such as enzymes, essay evidence, verb endings, or algorithms.
                </p>
              </div>
              <Button type="button" variant="ghost" onClick={() => setShowCreate(false)}>
                Close
              </Button>
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_0.9fr]">
              <div className="space-y-4">
                <Input
                  label="Folder name"
                  value={name}
                  placeholder="Biology"
                  onChange={(event) => setName(event.target.value)}
                />
                <Input
                  label="Subject"
                  value={subject}
                  placeholder="Science"
                  onChange={(event) => setSubject(event.target.value)}
                />
                <Textarea
                  label="What belongs here?"
                  rows={4}
                  value={description}
                  placeholder="Flashcards, notebooks, lecture sources, and practice work for this study area."
                  onChange={(event) => setDescription(event.target.value)}
                />
                <ObjectStylePicker
                  color={folderColor}
                  icon={folderIcon}
                  onColorChange={setFolderColor}
                  onIconChange={setFolderIcon}
                  colorLabel="Folder colour"
                  iconLabel="Folder icon"
                />
              </div>
              <div className="rounded-[1.25rem] border border-white/[0.09] bg-white/[0.035] p-4">
                <div className="text-sm font-semibold text-white">Linked topics</div>
                <p className="mt-2 text-sm leading-6 text-text-secondary">
                  Optional. Topics are smaller concepts that can appear inside folders.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {topics.length > 0 ? (
                    topics.map((topic) => {
                      const selected = selectedTopicIds.includes(topic.id);
                      return (
                        <button
                          key={topic.id}
                          type="button"
                          onClick={() => toggleTopic(topic.id)}
                          className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                            selected
                              ? "border-warm-border bg-warm-glow text-warm-accent"
                              : "border-white/[0.1] bg-white/[0.045] text-text-secondary hover:border-white/[0.18]"
                          }`}
                        >
                          {topic.name}
                        </button>
                      );
                    })
                  ) : (
                    <p className="text-sm leading-6 text-text-muted">
                      No topics yet. You can add topics later from Practice or Library.
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <Button
                type="button"
                disabled={saving}
                onClick={handleCreateFolder}
              >
                {saving ? "Creating..." : "Create folder"}
              </Button>
              <Button type="button" variant="secondary" onClick={resetForm}>
                Clear form
              </Button>
            </div>
          </Card>
        ) : null}

        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-72 rounded-[1.45rem]" />
            ))}
          </div>
        ) : folders.length > 0 ? (
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {folders.map((folder) => {
              const names = getTopicNames(folder, topics);
              return (
                <FolderObjectCard
                  key={folder.id}
                  href={`/dashboard/folders/${folder.id}`}
                  title={folder.name}
                  subtitle={folder.subject ?? "General"}
                  description={
                    folder.description ??
                    "A home for notebooks, decks, sources, and recent work."
                  }
                  color={folder.color}
                  icon={folder.icon}
                  stats={
                    names.length > 0
                      ? names.slice(0, 3).map((topicName) => ({ label: "Topic", value: topicName }))
                      : [{ label: "Topics", value: "Link later" }]
                  }
                  updatedLabel="Open folder"
                />
              );
            })}
          </section>
        ) : (
          <EmptyState
            emoji="Folder"
            title="Create your first study folder"
            description="Start with a broad area like Biology, History, Spanish, or Computer Science. Decks, sources, notebooks, and recent work will live together there."
            action={
              <Button type="button" onClick={() => setShowCreate(true)}>
                Create folder
              </Button>
            }
            secondaryAction={
              <div className="flex flex-wrap justify-center gap-2">
                {starterFolders.map((folderName) => (
                  <button
                    key={folderName}
                    type="button"
                    onClick={() => {
                      setName(folderName);
                      setShowCreate(true);
                    }}
                    className="rounded-full border border-white/[0.1] bg-white/[0.045] px-3 py-1.5 text-xs font-semibold text-text-secondary transition hover:border-warm-border hover:text-warm-accent"
                  >
                    {folderName}
                  </button>
                ))}
              </div>
            }
          />
        )}
      </div>
    </AppPage>
  );
}
