"use client";

import Link from "next/link";
import { FirebaseError } from "firebase/app";
import { useCallback, useEffect, useState } from "react";
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
  const [folderIcon, setFolderIcon] = useState<ObjectIconId>("none");
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
    setFolderIcon("none");
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

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">Folders</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-text-primary sm:text-4xl">
              Study spaces
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => setShowCreate(true)}>
              Create folder
            </Button>
            <Link
              href="/dashboard/practise"
              className="inline-flex min-h-[2.75rem] items-center justify-center rounded-full border border-[var(--button-secondary-border)] bg-[var(--button-secondary-bg)] px-4 text-sm font-medium text-[var(--button-secondary-text)] shadow-[var(--button-secondary-shadow)] transition hover:-translate-y-[1px]"
            >
              Open Practice
            </Link>
          </div>
        </div>

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
                  placeholder="Optional notes for this folder."
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
                      No topics yet.
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-40 rounded-[1.25rem]" />
            ))}
          </div>
        ) : folders.length > 0 ? (
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
            {folders.map((folder) => (
              <FolderObjectCard
                key={folder.id}
                href={`/dashboard/folders/${folder.id}`}
                title={folder.name}
                color={folder.color}
                icon={folder.icon}
              />
            ))}
          </section>
        ) : (
          <EmptyState
            emoji="Folder"
            title="Create your first study folder"
            description="Start with a broad subject, module, exam, or project."
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
