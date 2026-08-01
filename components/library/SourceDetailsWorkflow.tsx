"use client";

import { useState } from "react";
import type { Source } from "@/lib/material/sources";
import type { Topic } from "@/lib/material/topics";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import { addFolderId, removeFolderId } from "@/lib/workspace/folder-links";
import { useFeedback } from "@/hooks/useFeedback";
import { updateSource } from "@/services/study/sources";
import SourceDetailsDrawer from "./SourceDetailsDrawer";

type SourceDetailsWorkflowProps = {
  open: boolean;
  source: Source | null;
  folders: StudyFolder[];
  topics: Topic[];
  userId: string;
  onClose: () => void;
  onSourceChange: (source: Source) => void;
  onTopicsChange: (topics: Topic[]) => void;
};

/** Owns folder/topic organisation mutations for the selected source. */
export default function SourceDetailsWorkflow({
  open,
  source,
  folders,
  topics,
  userId,
  onClose,
  onSourceChange,
  onTopicsChange,
}: SourceDetailsWorkflowProps) {
  const { feedback, showThrownError, clear } = useFeedback();
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const updateTopics = async (nextTopicIds: string[]) => {
    if (!source) return;
    setBusyAction("source-topics");
    try {
      await updateSource(userId, source.id, { topicIds: nextTopicIds });
      onSourceChange({
        ...source,
        topicIds: nextTopicIds,
        updatedAt: Date.now(),
      });
    } catch (error) {
      showThrownError(error, "Could not update source Topics.");
    } finally {
      setBusyAction(null);
    }
  };

  const toggleFolder = async (folderId: string) => {
    if (!source) return;
    const nextFolderIds = source.folderIds.includes(folderId)
      ? removeFolderId(source.folderIds, folderId)
      : addFolderId(source.folderIds, folderId);
    setBusyAction("source-folders");
    try {
      await updateSource(userId, source.id, { folderIds: nextFolderIds });
      onSourceChange({
        ...source,
        folderIds: nextFolderIds,
        updatedAt: Date.now(),
      });
    } catch (error) {
      showThrownError(error, "Could not update source folders.");
    } finally {
      setBusyAction(null);
    }
  };

  const closeDetails = () => {
    clear();
    onClose();
  };

  return (
    <SourceDetailsDrawer
      open={open}
      source={source}
      userId={userId}
      referenceData={{ folders, topics }}
      status={{ feedback, busyAction }}
      actions={{
        onClose: closeDetails,
        onDismissFeedback: clear,
        onToggleFolder: (folderId) => void toggleFolder(folderId),
        onUpdateTopics: (topicIds) => void updateTopics(topicIds),
        onTopicsChange,
      }}
    />
  );
}
