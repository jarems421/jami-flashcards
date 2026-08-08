"use client";

import { useEffect, useRef, useState } from "react";
import type { SourceType } from "@/lib/material/sources";
import type { Topic } from "@/lib/material/topics";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import {
  buildSourceComposerContent,
  clearFilenameDerivedTitle,
  getSourceTitleFromFileName,
  type SourceComposerKind,
} from "@/lib/study/source-composer";
import { useFeedback } from "@/hooks/useFeedback";
import { createSource, deleteSource, updateSource } from "@/services/study/sources";
import {
  deleteSourceFile,
  uploadSourceFile,
  validateSourceUploadFile,
} from "@/services/study/source-files";
import TopicPicker from "@/components/topics/TopicPicker";
import WorkspaceActionDialog from "@/components/workspace/WorkspaceActionDialog";
import { Button, FeedbackBanner, Input, Textarea } from "@/components/ui";
import { SourceFolderPicker } from "./SourceWorkspace";

const sourceComposerKinds: Array<{
  value: SourceComposerKind;
  label: string;
}> = [
  { value: "text", label: "Text" },
  { value: "link", label: "Link" },
  { value: "upload", label: "Upload" },
];

type SourceComposerDialogProps = {
  open: boolean;
  userId: string;
  folders: StudyFolder[];
  topics: Topic[];
  initialFolderId: string;
  onClose: () => void;
  onTopicsChange: (topics: Topic[]) => void;
  onCreated: (sourceId: string, message: string) => Promise<void>;
};

/** Owns source-composition fields, upload progress, persistence, and rollback. */
export default function SourceComposerDialog({
  open,
  userId,
  folders,
  topics,
  initialFolderId,
  onClose,
  onTopicsChange,
  onCreated,
}: SourceComposerDialogProps) {
  const { feedback, showError, showThrownError, clear } = useFeedback();
  const [composerKind, setComposerKind] =
    useState<SourceComposerKind>("text");
  const [title, setTitle] = useState("");
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([]);
  const [selectedFolderIds, setSelectedFolderIds] = useState<string[]>([]);
  const [contentText, setContentText] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileType, setFileType] = useState("");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const filenameDerivedTitleRef = useRef("");

  useEffect(() => {
    if (!open) return;
    setSelectedFolderIds(
      initialFolderId &&
        folders.some((folder) => folder.id === initialFolderId)
        ? [initialFolderId]
        : []
    );
  }, [folders, initialFolderId, open]);

  const sourceType: SourceType =
    composerKind === "text"
      ? "manual_note"
      : composerKind === "link"
        ? "link"
        : "file";

  const changeComposerKind = (kind: SourceComposerKind) => {
    if (kind === composerKind) return;
    setTitle((current) =>
      clearFilenameDerivedTitle(current, filenameDerivedTitleRef.current)
    );
    filenameDerivedTitleRef.current = "";
    setContentText("");
    setExternalUrl("");
    setSourceFile(null);
    setFileName("");
    setFileType("");
    setComposerKind(kind);
  };

  const resetComposer = () => {
    setComposerKind("text");
    setTitle("");
    setSelectedTopicIds([]);
    setSelectedFolderIds([]);
    setContentText("");
    setExternalUrl("");
    setFileName("");
    setFileType("");
    setSourceFile(null);
    filenameDerivedTitleRef.current = "";
  };

  const closeComposer = () => {
    resetComposer();
    clear();
    onClose();
  };

  const createNextSource = async () => {
    setSaving(true);
    setUploadProgress(null);
    clear();
    let createdSourceId = "";
    let uploadedStoragePath = "";
    try {
      if (sourceType === "file" && !sourceFile) {
        showError("Choose a file to upload.");
        return;
      }
      const validatedFileType = sourceFile
        ? validateSourceUploadFile(sourceFile)
        : "";
      const modeContent = buildSourceComposerContent(composerKind, {
        contentText,
        externalUrl,
        fileName: sourceFile?.name ?? fileName,
        fileType: validatedFileType || sourceFile?.type || fileType,
      });
      const sourceId = await createSource(userId, {
        title: title.trim() || sourceFile?.name || title,
        type: sourceType,
        topicIds: selectedTopicIds,
        folderIds: selectedFolderIds,
        ...modeContent,
      });
      createdSourceId = sourceId;
      if (sourceType === "file" && sourceFile) {
        const upload = await uploadSourceFile({
          userId,
          sourceId,
          file: sourceFile,
          onProgress: setUploadProgress,
        });
        uploadedStoragePath = upload.storagePath;
        await updateSource(userId, sourceId, {
          fileName: upload.fileName,
          fileType: upload.fileType,
          storagePath: upload.storagePath,
          sizeBytes: upload.sizeBytes,
        });
      }

      resetComposer();
      closeComposer();
      await onCreated(
        sourceId,
        sourceType === "file" ? "File uploaded to Sources." : "Source saved."
      );
    } catch (error) {
      if (uploadedStoragePath) {
        // Best-effort rollback: surface the original save failure to the user.
        await deleteSourceFile(uploadedStoragePath).catch(() => undefined);
      }
      if (createdSourceId) {
        // Best-effort rollback: surface the original save failure to the user.
        await deleteSource(userId, createdSourceId).catch(() => undefined);
      }
      showThrownError(error, "Could not save source.");
    } finally {
      setSaving(false);
      setUploadProgress(null);
    }
  };

  return (
    <WorkspaceActionDialog
      open={open}
      title="Add source"
      description="Save the material first. You can organise it now or later."
      busy={saving}
      maxWidth="lg"
      onClose={closeComposer}
    >
      {feedback ? (
        <div className="mb-4">
          <FeedbackBanner
            type={feedback.type}
            message={feedback.message}
            autoDismissMs={0}
            onDismiss={clear}
          />
        </div>
      ) : null}
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          void createNextSource();
        }}
      >
        <div>
          <div className="mb-2 text-sm font-medium text-text-secondary">
            Source type
          </div>
          <div
            role="group"
            aria-label="Source type"
            className="app-subtle-panel grid grid-cols-3 gap-1 rounded-lg p-1"
          >
            {sourceComposerKinds.map((item) => (
              <button
                key={item.value}
                type="button"
                aria-pressed={composerKind === item.value}
                onClick={() => changeComposerKind(item.value)}
                className={
                  composerKind === item.value
                    ? "app-selected min-h-11 rounded-md px-3 text-sm font-semibold"
                    : "min-h-11 rounded-md px-3 text-sm font-medium text-text-muted transition hover:bg-[var(--color-glass-subtle)] hover:text-text-primary"
                }
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <Input
          label="Title"
          value={title}
          data-dialog-autofocus="true"
          onChange={(event) => {
            setTitle(event.target.value);
            if (event.target.value !== filenameDerivedTitleRef.current) {
              filenameDerivedTitleRef.current = "";
            }
          }}
        />

        {composerKind === "text" ? (
          <Textarea
            label="Source text"
            rows={10}
            value={contentText}
            onChange={(event) => setContentText(event.target.value)}
          />
        ) : null}

        {composerKind === "link" ? (
          <Input
            label="Source link"
            type="url"
            placeholder="https://"
            value={externalUrl}
            onChange={(event) => setExternalUrl(event.target.value)}
          />
        ) : null}

        {composerKind === "upload" ? (
          <div className="app-subtle-panel rounded-lg p-4">
            <label
              className="block text-sm font-medium text-text-secondary"
              htmlFor="library-source-file"
            >
              Choose a study file
            </label>
            <p className="mt-1 text-xs leading-5 text-text-muted">
              PDF, image, Word, PowerPoint, or plain text.
            </p>
            <input
              id="library-source-file"
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,.pdf,.docx,.pptx,.txt"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                setSourceFile(file);
                setFileName(file?.name ?? "");
                setFileType(file?.type ?? "");
                if (
                  file &&
                  (!title.trim() || title === filenameDerivedTitleRef.current)
                ) {
                  const nextTitle = getSourceTitleFromFileName(file.name);
                  filenameDerivedTitleRef.current = nextTitle;
                  setTitle(nextTitle);
                } else if (!file) {
                  setTitle((current) =>
                    clearFilenameDerivedTitle(
                      current,
                      filenameDerivedTitleRef.current
                    )
                  );
                  filenameDerivedTitleRef.current = "";
                }
              }}
              className="app-field mt-3 block w-full cursor-pointer rounded-md p-3 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-[var(--button-secondary-bg)] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-[var(--button-secondary-text)]"
            />
            {sourceFile ? (
              <div className="mt-3 text-sm text-text-secondary">
                {sourceFile.name} · {Math.round(sourceFile.size / 1024)} KB
              </div>
            ) : null}
          </div>
        ) : null}

        <details className="group rounded-lg border border-[var(--color-border)]">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-semibold text-text-secondary [&::-webkit-details-marker]:hidden">
            <span>Organise now (optional)</span>
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="none"
              className="h-4 w-4 transition group-open:rotate-180"
            >
              <path
                d="m6 8 4 4 4-4"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </summary>
          <div className="space-y-4 border-t border-[var(--color-border)] p-4">
            <SourceFolderPicker
              folders={folders}
              selectedFolderIds={selectedFolderIds}
              onChange={setSelectedFolderIds}
            />
            <TopicPicker
              userId={userId}
              topics={topics}
              selectedTopicIds={selectedTopicIds}
              onChange={setSelectedTopicIds}
              onTopicsChange={onTopicsChange}
            />
          </div>
        </details>

        {saving && sourceType === "file" && uploadProgress !== null ? (
          <div>
            <div className="mb-2 flex items-center justify-between text-xs text-text-muted">
              <span>Uploading file</span>
              <span>{uploadProgress}%</span>
            </div>
            <div
              role="progressbar"
              aria-label="Source upload progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={uploadProgress}
              className="h-2 overflow-hidden rounded-full bg-[var(--color-glass-subtle)]"
            >
              <div
                className="h-full rounded-full bg-[linear-gradient(90deg,var(--color-accent),var(--color-success))] transition-[width]"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        ) : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="secondary"
            disabled={saving}
            onClick={closeComposer}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving
              ? sourceType === "file" && uploadProgress !== null
                ? "Uploading..."
                : "Saving..."
              : "Save source"}
          </Button>
        </div>
      </form>
    </WorkspaceActionDialog>
  );
}
