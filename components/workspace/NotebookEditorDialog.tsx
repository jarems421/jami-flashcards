"use client";

import { useRef, useState } from "react";
import TopicPicker from "@/components/topics/TopicPicker";
import {
  Button,
  ConfirmDialog,
  FeedbackBanner,
  Input,
} from "@/components/ui";
import FormDisclosure from "@/components/ui/FormDisclosure";
import type { Topic } from "@/lib/material/topics";
import type { Notebook } from "@/lib/workspace/notebooks";
import { updateNotebook } from "@/services/study/notebooks";
import { NotebookObjectCard } from "./NotebookObjectCard";
import { ObjectStylePicker } from "./ObjectStylePicker";
import WorkspaceActionDialog from "./WorkspaceActionDialog";
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

/**
 * A notebook's name, cover and topics -- the same dialog that makes one.
 */
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

  const footer = (
    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={saving}
        onClick={() => setConfirmArchive(true)}
        className="self-start text-danger-text"
      >
        Archive notebook
      </Button>
      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={saving || !title.trim()}
          onClick={() => void handleSave()}
        >
          {saving ? "Saving..." : "Save notebook"}
        </Button>
      </div>
    </div>
  );

  return (
    <>
      <WorkspaceActionDialog
        open
        title="Edit notebook"
        busy={saving}
        maxWidth="lg"
        onClose={onClose}
        footer={footer}
      >
        {error ? (
          <div className="mb-4">
            <FeedbackBanner
              type="error"
              message={error}
              onDismiss={() => setError(null)}
            />
          </div>
        ) : null}

        <div className="grid gap-6">
          <div className="grid gap-4 sm:grid-cols-[6.75rem_minmax(0,1fr)] sm:items-center sm:gap-5">
            <div className="mx-auto w-[6.75rem] sm:mx-0">
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
            <Input
              ref={titleInputRef}
              data-dialog-autofocus="true"
              label="Notebook title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={saving}
            />
          </div>

          <div className="grid gap-3">
            <FormDisclosure title="Cover" summary="Colour and icon" defaultOpen>
              <ObjectStylePicker
                color={color}
                icon={icon}
                onColorChange={setColor}
                onIconChange={setIcon}
                colorLabel="Cover colour"
                iconLabel="Cover icon"
                compact
              />
            </FormDisclosure>
            <FormDisclosure
              title="Topics"
              summary={topicIds.length ? `${topicIds.length} selected` : "Optional"}
              defaultOpen={topicIds.length > 0}
            >
              <TopicPicker
                userId={userId}
                topics={topics}
                selectedTopicIds={topicIds}
                onChange={setTopicIds}
                onTopicsChange={onTopicsChange}
                disabled={saving}
              />
            </FormDisclosure>
          </div>
        </div>
      </WorkspaceActionDialog>

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
