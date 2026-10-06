"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Button, Input, Select } from "@/components/ui";
import { PinIcon } from "@/components/ai/JamiFloatingTutor";
import type { PendingTutorAttachment } from "@/hooks/useTutorAttachments";
import { isNotebookSheetFileType } from "@/lib/workspace/notebook-sheet";
import type { TutorAttachment, TutorSourceSaveOffer } from "@/lib/ai/tutor-attachments";
import { SOURCE_FILE_MIME_TYPES, getSourceFileTypeLabel } from "@/lib/material/source-files";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import { getTutorAttachmentUrl, saveTutorAttachmentAsSource } from "@/services/ai/tutor-attachments";
import { getActiveStudyFolders } from "@/services/study/folders";

const ACCEPT = [...SOURCE_FILE_MIME_TYPES, ".pdf", ".jpg", ".jpeg", ".png", ".webp", ".docx", ".pptx", ".txt"].join(",");

function PaperclipIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-[1.15rem] w-[1.15rem]">
      <path d="M15.5 9.5 10 15a3.5 3.5 0 0 1-5-5l6-6a2.3 2.3 0 0 1 3.3 3.3l-5.8 5.8a1.2 1.2 0 0 1-1.7-1.7L12 6.2" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true" className="h-5 w-5">
      <path d="M5 2.5h6.5L15 6v11.5H5z" />
      <path d="M11.5 2.5V6H15" />
    </svg>
  );
}

/** The composer's attach button: pictures, PDFs, Word, PowerPoint and text, as sources take. */
export function TutorAttachButton({
  disabled,
  onFiles,
}: {
  disabled?: boolean;
  onFiles: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={(event) => {
          onFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      <button
        type="button"
        aria-label="Attach a picture or file"
        title="Attach a picture or file"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="inline-grid h-9 w-9 place-items-center rounded-full text-text-secondary transition duration-fast hover:bg-[var(--color-glass-subtle)] hover:text-text-primary active:scale-95 disabled:cursor-not-allowed disabled:text-text-muted"
      >
        <PaperclipIcon />
      </button>
    </>
  );
}

function Thumb({ previewUrl, fileType }: { previewUrl?: string | null; fileType: string }) {
  return previewUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- a local preview or a signed URL
    <img src={previewUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
  ) : (
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[var(--color-glass-medium)] text-text-secondary">
      {fileType.startsWith("image/") ? <span className="h-4 w-4 animate-pulse rounded bg-current/30" /> : <FileIcon />}
    </span>
  );
}

/** Files waiting to go with the next message, above the box they are typed in. */
export function TutorPendingAttachments({
  items,
  onRemove,
}: {
  items: readonly PendingTutorAttachment[];
  onRemove: (key: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <ul aria-label="Attached files" className="flex flex-wrap gap-2 px-3 pt-3">
      {items.map((item) => (
        <li
          key={item.key}
          className={`relative flex max-w-[15rem] items-center gap-2.5 rounded-xl border bg-[var(--color-glass-subtle)] py-1.5 pl-1.5 pr-8 ${
            item.status === "failed" ? "border-error/40" : "border-[var(--color-border)]"
          }`}
        >
          <Thumb previewUrl={item.previewUrl} fileType={item.file.type} />
          <span className="min-w-0">
            <span className="block truncate text-xs font-medium text-text-primary">{item.file.name}</span>
            <span className={`block truncate text-2xs ${item.status === "failed" ? "text-[var(--color-error-text)]" : "text-text-muted"}`}>
              {item.status === "uploading"
                ? `Adding… ${Math.round(item.progress * 100)}%`
                : item.status === "failed"
                  ? item.error
                  : getSourceFileTypeLabel(item.file.type) ?? "File"}
            </span>
          </span>
          <button
            type="button"
            aria-label={`Remove ${item.file.name}`}
            onClick={() => onRemove(item.key)}
            className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full text-xs text-text-muted transition hover:bg-[var(--color-glass-medium)] hover:text-text-primary"
          >
            ✕
          </button>
        </li>
      ))}
    </ul>
  );
}

/** A picture from this chat: from memory when it was sent this sitting, otherwise fetched. */
function useAttachmentPreview(attachment: TutorAttachment, localUrl?: string) {
  const [url, setUrl] = useState<string | null>(localUrl ?? null);
  useEffect(() => {
    if (localUrl || !attachment.fileType.startsWith("image/")) return;
    let cancelled = false;
    void getTutorAttachmentUrl(attachment)
      .then((next) => {
        if (!cancelled) setUrl(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [attachment, localUrl]);
  return localUrl ?? url;
}

function SentAttachment({ attachment, localUrl }: { attachment: TutorAttachment; localUrl?: string }) {
  const previewUrl = useAttachmentPreview(attachment, localUrl);
  if (attachment.fileType.startsWith("image/")) {
    return previewUrl ? (
      // eslint-disable-next-line @next/next/no-img-element -- a local preview or a signed URL
      <img src={previewUrl} alt={attachment.fileName} className="max-h-48 max-w-[14rem] rounded-xl object-cover shadow-e1" />
    ) : (
      <span className="block h-32 w-40 animate-pulse rounded-xl bg-[var(--color-glass-medium)]" aria-label={attachment.fileName} />
    );
  }
  return (
    <span className="flex max-w-[15rem] items-center gap-2.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-panel)] py-1.5 pl-1.5 pr-3">
      <Thumb fileType={attachment.fileType} />
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-text-primary">{attachment.fileName}</span>
        <span className="block text-2xs text-text-muted">{getSourceFileTypeLabel(attachment.fileType) ?? "File"}</span>
      </span>
    </span>
  );
}

/** What a student sent with a message, shown above it. */
export function TutorMessageAttachments({
  attachments,
  previewUrlFor,
  onKeepBeside,
}: {
  attachments: readonly TutorAttachment[];
  previewUrlFor: (storagePath: string) => string | undefined;
  /** In a notebook: keeps a PDF or picture open beside the page to work from. */
  onKeepBeside?: (attachment: TutorAttachment) => void;
}) {
  return (
    <div className="mb-1.5 flex flex-wrap justify-end gap-2">
      {attachments.map((attachment) =>
        onKeepBeside && isNotebookSheetFileType(attachment.fileType) ? (
          <span key={attachment.storagePath} className="flex flex-col items-end gap-1">
            <SentAttachment attachment={attachment} localUrl={previewUrlFor(attachment.storagePath)} />
            <button
              type="button"
              className="inline-flex min-h-7 items-center gap-1 rounded-full px-2 text-2xs font-semibold text-text-muted transition duration-fast hover:bg-[var(--color-glass-subtle)] hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
              onClick={() => onKeepBeside(attachment)}
            >
              <PinIcon className="h-3 w-3" />
              Keep beside page
            </button>
          </span>
        ) : (
          <SentAttachment
            key={attachment.storagePath}
            attachment={attachment}
            localUrl={previewUrlFor(attachment.storagePath)}
          />
        )
      )}
    </div>
  );
}

/**
 * Tutor's suggestion to keep an attached file as a source, for the student to
 * check and confirm. Nothing is saved until they press Save, and they can
 * change the title or folder first.
 */
export function TutorSourceSaveCard({
  userId,
  offer,
  fileFor,
  defaultFolderId,
}: {
  userId: string;
  offer: TutorSourceSaveOffer;
  fileFor: (storagePath: string) => File | undefined;
  defaultFolderId?: string;
}) {
  const fieldId = useId();
  const [title, setTitle] = useState(offer.title);
  const [folders, setFolders] = useState<StudyFolder[] | null>(null);
  const [folderId, setFolderId] = useState(offer.folderId ?? defaultFolderId ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getActiveStudyFolders(userId)
      .then((loaded) => {
        if (cancelled) return;
        setFolders(loaded);
        setFolderId((current) =>
          current && loaded.some((folder) => folder.id === current) ? current : loaded[0]?.id ?? ""
        );
      })
      .catch(() => {
        if (!cancelled) setFolders([]);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const folderName = folders?.find((folder) => folder.id === folderId)?.name;

  if (state === "saved") {
    return (
      <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-3.5 py-2.5 text-xs text-text-secondary" role="status">
        <span>
          Saved <strong className="font-semibold text-text-primary">{title.trim()}</strong>
          {folderName ? <> to {folderName}</> : null}.
        </span>
        <Link href="/dashboard/library" className="shrink-0 font-semibold text-accent underline-offset-2 hover:underline">
          Open Library
        </Link>
      </div>
    );
  }

  const save = async () => {
    if (!title.trim() || !folderId) return;
    setState("saving");
    setError(null);
    try {
      await saveTutorAttachmentAsSource({
        userId,
        attachment: offer.attachment,
        title: title.trim(),
        folderId,
        file: fileFor(offer.attachment.storagePath),
      });
      setState("saved");
    } catch (saveError) {
      setState("idle");
      setError(saveError instanceof Error ? saveError.message : "That file could not be saved.");
    }
  };

  return (
    <div className="mt-2 space-y-3 rounded-xl border border-accent/25 bg-accent/[0.06] p-3.5">
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[var(--color-glass-medium)] text-accent">
          <FileIcon />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-text-primary">Save as a source</p>
          <p className="truncate text-2xs text-text-muted">{offer.attachment.fileName}</p>
        </div>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <Input
          id={`${fieldId}-title`}
          label="Title"
          value={title}
          maxLength={120}
          disabled={state === "saving"}
          onChange={(event) => setTitle(event.target.value)}
        />
        {folders && folders.length === 0 ? (
          <p className="self-end text-2xs leading-5 text-text-muted">
            Make a folder in your Library first, then save this to it.
          </p>
        ) : (
          <Select
            id={`${fieldId}-folder`}
            label="Folder"
            value={folderId}
            disabled={!folders || state === "saving"}
            onChange={(event) => setFolderId(event.target.value)}
          >
            {!folders ? <option value="">Loading…</option> : null}
            {(folders ?? []).map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </Select>
        )}
      </div>
      {error ? <p className="text-2xs text-[var(--color-error-text)]" role="alert">{error}</p> : null}
      <div className="flex justify-end">
        <Button type="button" size="sm" disabled={state === "saving" || !title.trim() || !folderId} onClick={() => void save()}>
          {state === "saving" ? "Saving…" : "Save source"}
        </Button>
      </div>
    </div>
  );
}
