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
import { getFolderNameValidationError } from "@/lib/workspace/folder-form";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import { createStudyFolder, getActiveStudyFolders } from "@/services/study/folders";
import { getActiveTopics } from "@/services/study/topics";

type Feedback = { type: "success" | "error"; message: string };

function isPermissionDenied(error: unknown) {
  return error instanceof FirebaseError && error.code === "permission-denied";
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
  const [folderIcon, setFolderIcon] = useState<ObjectIconId>("none");
  const [saving, setSaving] = useState(false);
  const [nameTouched, setNameTouched] = useState(false);
  const folderNameError = getFolderNameValidationError(name);
  const folderNameIsValid = folderNameError === null;
  const showNameError = nameTouched && Boolean(folderNameError);

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
    setNameTouched(false);
  };

  const handleCreateFolder = async () => {
    if (!user?.uid) return;
    if (!folderNameIsValid) {
      setNameTouched(true);
      return;
    }
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
              className="app-button-secondary inline-flex min-h-[2.75rem] items-center justify-center rounded-full px-4 text-sm font-medium"
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
                <h2 className="mt-2 text-xl font-semibold text-text-primary">
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
                  placeholder="Folder name"
                  onBlur={() => setNameTouched(true)}
                  onChange={(event) => {
                    setName(event.target.value);
                    if (event.target.value.trim()) {
                      setNameTouched(false);
                    }
                  }}
                  aria-invalid={showNameError}
                />
                {showNameError ? (
                  <p className="-mt-2 text-sm font-medium text-danger-text">
                    {folderNameError}
                  </p>
                ) : null}
                <Input
                  label="Subject"
                  value={subject}
                  placeholder="Optional"
                  onChange={(event) => setSubject(event.target.value)}
                />
                <Textarea
                  label="Notes"
                  rows={4}
                  value={description}
                  placeholder="Optional"
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
              <div className="app-subtle-panel rounded-[1.25rem] p-4">
                <div className="text-sm font-semibold text-text-primary">Linked topics</div>
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
                              ? "app-selected"
                              : "app-chip hover:border-border-strong"
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
                disabled={saving || !folderNameIsValid}
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
              <Skeleton key={index} className="h-32 rounded-[1.15rem]" />
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
            description="Create a folder to begin."
            action={
              <Button type="button" onClick={() => setShowCreate(true)}>
                Create folder
              </Button>
            }
          />
        )}
      </div>
    </AppPage>
  );
}
