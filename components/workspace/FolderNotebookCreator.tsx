"use client";

import { useId, useRef, useState } from "react";
import TopicPicker from "@/components/topics/TopicPicker";
import { NotebookObjectCard } from "@/components/workspace/NotebookObjectCard";
import NotebookPageDefaultsPicker from "@/components/workspace/NotebookPageDefaultsPicker";
import { ObjectStylePicker } from "@/components/workspace/ObjectStylePicker";
import WorkspaceActionDialog from "@/components/workspace/WorkspaceActionDialog";
import { Button, ElapsedTime, FeedbackBanner, Input } from "@/components/ui";
import FormDisclosure from "@/components/ui/FormDisclosure";
import type { Topic } from "@/lib/material/topics";
import type {
  Notebook,
  NotebookPageColor,
  NotebookPageStyle,
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

function fileSizeLabel(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Making a notebook, as a focused dialog.
 *
 * This was a card that opened inside the folder page, with the cover, paper,
 * upload and topics all laid out at once. Now the title and the paper are what
 * is on screen -- the notebook being made is shown beside its name -- and the
 * cover and topics wait in sections that say what is chosen without opening.
 */
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [color, setColor] = useState<ObjectColorId>(DEFAULT_COLOR);
  const [icon, setIcon] = useState<ObjectIconId>(DEFAULT_ICON);
  const [pageColor, setPageColor] = useState<NotebookPageColor>("white");
  const [pageStyle, setPageStyle] = useState<NotebookPageStyle>("plain");
  const [file, setFile] = useState<File | null>(null);
  const [topicIds, setTopicIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  // The folder page shows errors in its own banner, which sits behind this dialog.
  const [error, setError] = useState<string | null>(null);

  const report = (thrown: unknown, fallback: string) => {
    setError(thrown instanceof Error ? thrown.message : fallback);
    onError(thrown, fallback);
  };

  const create = async () => {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      setError("Name the notebook before creating it.");
      return;
    }

    setCreating(true);
    setError(null);
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
    } catch (thrown) {
      report(thrown, "Could not create notebook.");
    } finally {
      setCreating(false);
      setUploadProgress(null);
    }
  };

  const clearFile = () => {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const footer = (
    <div className="grid gap-3">
      {file && creating && uploadProgress !== null ? (
        <div className="flex items-center gap-3">
          <div
            role="progressbar"
            aria-label="Notebook file import progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={uploadProgress}
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-glass-subtle)]"
          >
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,var(--color-accent),var(--color-success))] transition-[width]"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
          <ElapsedTime label="Importing for" className="shrink-0 text-xs text-text-muted" />
        </div>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" disabled={creating} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          data-testid="create-notebook-submit"
          disabled={creating || !title.trim()}
          onClick={() => void create()}
        >
          {creating
            ? uploadProgress !== null
              ? `Adding pages ${uploadProgress}%`
              : "Creating..."
            : "Create notebook"}
        </Button>
      </div>
    </div>
  );

  return (
    <WorkspaceActionDialog
      open
      title="New notebook"
      description={`In ${folder.name}`}
      busy={creating}
      maxWidth="lg"
      onClose={onCancel}
      footer={footer}
    >
      {error ? (
        <div className="mb-4">
          <FeedbackBanner type="error" message={error} onDismiss={() => setError(null)} />
        </div>
      ) : null}

      <div className="grid gap-6">
        <div className="grid gap-4 sm:grid-cols-[6.75rem_minmax(0,1fr)] sm:items-center sm:gap-5">
          <div aria-hidden="true" className="mx-auto w-[6.75rem] sm:mx-0">
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
          <Input
            data-dialog-autofocus="true"
            label="Notebook title"
            value={title}
            placeholder="Cell biology"
            disabled={creating}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>

        <section className="grid gap-3" aria-label="Pages">
          {file ? (
            <div className="flex items-center gap-3 rounded-2xl border border-accent/40 bg-accent/10 px-4 py-3">
              <span
                aria-hidden="true"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--color-surface-panel-strong)] text-accent"
              >
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-5 w-5">
                  <path d="M6 2.75h5.5L15.25 6.5v10.75H6a1.25 1.25 0 0 1-1.25-1.25V4A1.25 1.25 0 0 1 6 2.75Z" strokeLinejoin="round" />
                  <path d="M11.25 2.75V6.5h4" strokeLinejoin="round" />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-text-primary">{file.name}</p>
                <p className="text-xs text-text-muted">
                  {fileSizeLabel(file.size)} · its pages become this notebook&apos;s pages
                </p>
              </div>
              <Button type="button" variant="ghost" size="sm" disabled={creating} onClick={clearFile}>
                Remove
              </Button>
            </div>
          ) : (
            <NotebookPageDefaultsPicker
              pageColor={pageColor}
              pageStyle={pageStyle}
              onPageColorChange={setPageColor}
              onPageStyleChange={setPageStyle}
              disabled={creating}
            />
          )}

          <input
            ref={fileInputRef}
            id={fileInputId}
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            disabled={creating}
            aria-label="Notebook file"
            tabIndex={-1}
            className="sr-only"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          {file ? null : (
            <button
              type="button"
              disabled={creating}
              aria-controls={fileInputId}
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-[var(--color-border-strong)] px-4 py-3 text-left transition duration-fast hover:border-accent/50 hover:bg-[var(--color-glass-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span
                aria-hidden="true"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--color-glass-subtle)] text-text-muted"
              >
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-5 w-5">
                  <path d="M10 13V4m0 0L6.5 7.5M10 4l3.5 3.5M4 13.5v1.25A1.25 1.25 0 0 0 5.25 16h9.5A1.25 1.25 0 0 0 16 14.75V13.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-text-primary">
                  Or start from a PDF or image
                </span>
                <span className="block text-xs text-text-muted">
                  Its pages become your notebook pages, ready to write on.
                </span>
              </span>
            </button>
          )}
        </section>

        <div className="grid gap-3">
          <FormDisclosure title="Cover" summary="Colour and icon">
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
          >
            <TopicPicker
              userId={userId}
              topics={topics}
              selectedTopicIds={topicIds}
              onChange={setTopicIds}
              onTopicsChange={onTopicsChange}
              disabled={creating}
            />
          </FormDisclosure>
        </div>
      </div>
    </WorkspaceActionDialog>
  );
}
