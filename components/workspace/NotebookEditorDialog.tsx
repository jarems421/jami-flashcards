"use client";

import { useRef, useState } from "react";
import TopicPicker from "@/components/topics/TopicPicker";
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogPanel,
  DialogTitle,
  FeedbackBanner,
  Input,
} from "@/components/ui";
import type { Topic } from "@/lib/material/topics";
import type { Notebook } from "@/lib/workspace/notebooks";
import { updateNotebook } from "@/services/study/notebooks";
import { NotebookObjectCard } from "./NotebookObjectCard";
import { ObjectStylePicker } from "./ObjectStylePicker";
import {
  normalizeObjectColor,
  normalizeObjectIcon,
  type ObjectColorId,
  type ObjectIconId,
} from "@/lib/workspace/object-card-styles";

type NotebookEditorDialogProps = {
  userId: string;
  notebook: Notebook;
  topics: Topic[];
  onTopicsChange: (topics: Topic[]) => void;
  onClose: () => void;
  onSaved: (notebook: Notebook) => void;
  onArchived: (notebookId: string) => void;
};

export default function NotebookEditorDialog({
  userId,
  notebook,
  topics,
  onTopicsChange,
  onClose,
  onSaved,
  onArchived,
}: NotebookEditorDialogProps) {
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(notebook.title);
  const [topicIds, setTopicIds] = useState(notebook.topicIds);
  const [color, setColor] = useState<ObjectColorId>(
    normalizeObjectColor(notebook.color)
  );
  const [icon, setIcon] = useState<ObjectIconId>(
    normalizeObjectIcon(notebook.icon)
  );
  const [saving, setSaving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      setError("Notebook title is required.");
      titleInputRef.current?.focus();
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await updateNotebook(userId, notebook.id, {
        title: normalizedTitle,
        topicIds,
        color,
        icon,
      });
      onSaved({
        ...notebook,
        title: normalizedTitle,
        topicIds,
        color,
        icon,
        updatedAt: Date.now(),
      });
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not update notebook."
      );
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateNotebook(userId, notebook.id, { archived: true });
      setConfirmArchive(false);
      onArchived(notebook.id);
    } catch (archiveError) {
      setConfirmArchive(false);
      setError(
        archiveError instanceof Error
          ? archiveError.message
          : "Could not archive notebook."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog
        open
        dismissible={!saving}
        initialFocusRef={titleInputRef}
        className="fixed inset-0 flex items-end justify-center p-3 sm:items-center sm:p-5"
        onDismiss={() => onClose()}
      >
        <DialogBackdrop
          className="absolute inset-0 bg-black/55 backdrop-blur-sm"
        />
        <DialogPanel
          className="app-panel relative max-h-[calc(100dvh-1.5rem)] w-full max-w-[44rem] overflow-y-auto rounded-[1.55rem] p-3 backdrop-blur-md transition duration-fast sm:max-h-[calc(100dvh-2.5rem)] sm:p-4"
        >
          <div className="text-center sm:text-left">
            <DialogTitle className="text-sm font-semibold text-text-primary">
              Edit notebook
            </DialogTitle>
            <DialogDescription className="mt-0.5 text-xs text-text-muted">
              Update the notebook name, cover, or Topics.
            </DialogDescription>
          </div>

          {error ? (
            <div className="mt-3">
              <FeedbackBanner
                type="error"
                message={error}
                onDismiss={() => setError(null)}
              />
            </div>
          ) : null}

          <div className="mx-auto mt-4 grid max-w-[31rem] gap-3 sm:grid-cols-[minmax(0,19rem)_8.5rem] sm:items-start">
            <Input
              ref={titleInputRef}
              label="Notebook title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={saving}
              containerClassName="w-full max-w-[19rem]"
            />
            <div className="app-subtle-panel rounded-[1rem] p-2">
              <NotebookObjectCard
                title={title.trim() || "Notebook preview"}
                color={color}
                icon={icon}
                pageColor={notebook.pageColor}
                pageStyle={notebook.pageStyle}
                updatedLabel="Notebook preview"
                compact
                editorPreview
              />
            </div>
            <div className="sm:col-span-2">
              <ObjectStylePicker
                color={color}
                icon={icon}
                onColorChange={setColor}
                onIconChange={setIcon}
                colorLabel="Cover colour"
                iconLabel="Cover icon"
                compact
                centered
              />
            </div>
            <div className="sm:col-span-2">
              <TopicPicker
                userId={userId}
                topics={topics}
                selectedTopicIds={topicIds}
                onChange={setTopicIds}
                onTopicsChange={onTopicsChange}
                disabled={saving}
              />
            </div>
          </div>

          <div className="mt-4 flex min-h-[3.25rem] flex-wrap items-center justify-center gap-3 border-t border-[var(--color-border)] px-1 pt-3 sm:justify-between sm:px-2">
            <Button
              type="button"
              variant="danger"
              size="sm"
              disabled={saving}
              onClick={() => setConfirmArchive(true)}
            >
              Archive notebook
            </Button>
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={saving}
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={saving || !title.trim()}
                onClick={() => void handleSave()}
              >
                {saving ? "Saving..." : "Save notebook"}
              </Button>
            </div>
          </div>
        </DialogPanel>
      </Dialog>

      <ConfirmDialog
        open={confirmArchive}
        title="Archive notebook?"
        description={`Archive "${notebook.title}"? Its saved pages will remain available if the notebook is restored later.`}
        confirmLabel="Archive notebook"
        busy={saving}
        onConfirm={() => void handleArchive()}
        onClose={() => setConfirmArchive(false)}
      />
    </>
  );
}
