"use client";

import { useId, useState } from "react";
import TopicPicker from "@/components/topics/TopicPicker";
import { NotebookObjectCard } from "@/components/workspace/NotebookObjectCard";
import { ObjectStylePicker } from "@/components/workspace/ObjectStylePicker";
import { Button, Card, Input, SectionHeader } from "@/components/ui";
import type { Topic } from "@/lib/material/topics";
import {
  NOTEBOOK_CREATION_PAGE_STYLES,
  type Notebook,
  type NotebookPageColor,
  type NotebookPageStyle,
} from "@/lib/workspace/notebooks";
import {
  type ObjectColorId,
  type ObjectIconId,
} from "@/lib/workspace/object-card-styles";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import { importUploadedNotebook } from "@/services/study/notebook-import";
import {
  createNotebook,
  createNotebookPage,
} from "@/services/study/notebooks";

type FolderNotebookCreatorProps = {
  userId: string;
  folder: StudyFolder;
  topics: Topic[];
  onTopicsChange: (topics: Topic[]) => void;
  onCreated: (notebook: Notebook, message: string) => void;
  onCancel: () => void;
  onError: (error: unknown, fallback: string) => void;
};

const DEFAULT_COLOR: ObjectColorId = "violet";
const DEFAULT_ICON: ObjectIconId = "none";

export default function FolderNotebookCreator({
  userId,
  folder,
  topics,
  onTopicsChange,
  onCreated,
  onCancel,
  onError,
}: FolderNotebookCreatorProps) {
  const fileInputId = useId();
  const [title, setTitle] = useState("");
  const [color, setColor] = useState<ObjectColorId>(DEFAULT_COLOR);
  const [icon, setIcon] = useState<ObjectIconId>(DEFAULT_ICON);
  const [pageColor, setPageColor] = useState<NotebookPageColor>("white");
  const [pageStyle, setPageStyle] = useState<NotebookPageStyle>("plain");
  const [file, setFile] = useState<File | null>(null);
  const [topicIds, setTopicIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const create = async () => {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      onError(new Error("Name the notebook before creating it."), "Could not create notebook.");
      return;
    }

    setCreating(true);
    setUploadProgress(null);
    try {
      if (file) {
        const imported = await importUploadedNotebook({
          userId,
          folderId: folder.id,
          title: normalizedTitle,
          file,
          topicIds,
          color,
          icon,
          onProgress: setUploadProgress,
        });
        onCreated(
          imported.notebook,
          `${imported.notebook.title} created with ${imported.pages.length} ${imported.pages.length === 1 ? "page" : "pages"}.`
        );
        return;
      }

      const notebook = await createNotebook(userId, {
        folderId: folder.id,
        title: normalizedTitle,
        type: "blank",
        topicIds,
        color,
        icon,
        pageColor,
        pageStyle,
      });
      await createNotebookPage(userId, {
        notebookId: notebook.id,
        folderId: folder.id,
        pageNumber: 1,
        pageType: "free_working",
        title: "Page 1",
        pageColor,
        pageStyle,
      });
      onCreated(notebook, `${notebook.title} created. Open it to type or draw on page 1.`);
    } catch (error) {
      onError(error, "Could not create notebook.");
    } finally {
      setCreating(false);
      setUploadProgress(null);
    }
  };

  return (
    <Card padding="md">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8.5rem] sm:items-start">
        <div className="min-w-0">
          <SectionHeader eyebrow="Create notebook" title="Set up your notebook." />
          <div className="mt-4 max-w-xl">
            <Input
              data-dialog-autofocus="true"
              label="Notebook title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
        </div>
        <div className="app-subtle-panel mx-auto w-full max-w-[8.5rem] rounded-[1rem] p-2 sm:mx-0">
          <NotebookObjectCard
            title={title.trim() || "Notebook preview"}
            color={color}
            icon={icon}
            pageColor={pageColor}
            pageStyle={pageStyle}
            updatedLabel="Notebook preview"
            compact
            editorPreview
          />
        </div>
      </div>

      <div className="mt-5">
        <ObjectStylePicker
          color={color}
          icon={icon}
          onColorChange={setColor}
          onIconChange={setIcon}
          colorLabel="Cover colour"
          iconLabel="Cover icon"
        />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-[1.2rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4 lg:col-span-2">
          <label
            htmlFor={fileInputId}
            className="mb-1.5 block text-sm font-medium text-text-secondary"
          >
            Start with a PDF or image <span className="text-text-muted">(optional)</span>
          </label>
          <input
            id={fileInputId}
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            disabled={creating}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="block min-h-[2.75rem] w-full rounded-2xl border border-border bg-surface-panel-strong px-3 py-2 text-sm text-text-primary file:mr-3 file:rounded-full file:border-0 file:bg-warm-glow file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-warm-accent disabled:cursor-not-allowed disabled:saturate-[0.82]"
          />
        </div>

        {!file ? (
          <>
            <fieldset>
              <legend className="text-sm font-medium text-text-secondary">Page colour</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {(["white", "black"] as NotebookPageColor[]).map((option) => (
                  <Button
                    key={option}
                    type="button"
                    size="sm"
                    variant={pageColor === option ? "primary" : "secondary"}
                    aria-pressed={pageColor === option}
                    onClick={() => setPageColor(option)}
                    className="capitalize"
                  >
                    {option}
                  </Button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="text-sm font-medium text-text-secondary">Page style</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {NOTEBOOK_CREATION_PAGE_STYLES.map((option) => (
                  <Button
                    key={option}
                    type="button"
                    size="sm"
                    variant={pageStyle === option ? "primary" : "secondary"}
                    aria-pressed={pageStyle === option}
                    onClick={() => setPageStyle(option)}
                    className="capitalize"
                  >
                    {option}
                  </Button>
                ))}
              </div>
            </fieldset>
          </>
        ) : null}

        <div className="lg:col-span-2">
          <TopicPicker
            userId={userId}
            topics={topics}
            selectedTopicIds={topicIds}
            onChange={setTopicIds}
            onTopicsChange={onTopicsChange}
            disabled={creating}
          />
        </div>
        <div className="flex gap-2 lg:col-span-2">
          <Button type="button" variant="secondary" disabled={creating} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" disabled={creating} onClick={() => void create()}>
            {creating
              ? uploadProgress !== null
                ? `Adding pages ${uploadProgress}%`
                : "Creating..."
              : "Create notebook"}
          </Button>
        </div>
      </div>

      {file && creating && uploadProgress !== null ? (
        <div
          role="progressbar"
          aria-label="Notebook file import progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={uploadProgress}
          className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--color-glass-subtle)]"
        >
          <div
            className="h-full rounded-full bg-[linear-gradient(90deg,var(--color-accent),var(--color-success))] transition-[width]"
            style={{ width: `${uploadProgress}%` }}
          />
        </div>
      ) : null}
    </Card>
  );
}

