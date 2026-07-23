"use client";

import { useState } from "react";
import type { JamiAssistantThread } from "@/lib/ai/jami-assistant-history";

type JamiAssistantHistoryProps = {
  threads: JamiAssistantThread[];
  loading: boolean;
  error: string | null;
  onOpen: (thread: JamiAssistantThread) => void;
  onNew: () => void;
  onRename: (thread: JamiAssistantThread, title: string) => Promise<void>;
  onDelete: (thread: JamiAssistantThread) => Promise<void>;
};

function EditIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path
        d="m12.8 4.2 3 3M4.5 15.5l.8-3.6 7.8-7.8a1.5 1.5 0 0 1 2.1 0l.7.7a1.5 1.5 0 0 1 0 2.1l-7.8 7.8-3.6.8Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path
        d="M4.5 6h11m-7-2h3m-5.8 2 .6 10h7.4l.6-10M8.2 8.5v5m3.6-5v5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <circle cx="5" cy="10" r="1.25" fill="currentColor" />
      <circle cx="10" cy="10" r="1.25" fill="currentColor" />
      <circle cx="15" cy="10" r="1.25" fill="currentColor" />
    </svg>
  );
}

function formatUpdatedAt(timestamp: number) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  return new Intl.DateTimeFormat(undefined, {
    ...(sameDay
      ? { hour: "numeric", minute: "2-digit" }
      : { day: "numeric", month: "short" }),
  }).format(date);
}

function surfaceName(surface: JamiAssistantThread["surface"]) {
  if (surface === "notebook") return "Notebook";
  if (surface === "learn") return "Learn";
  return "Sources";
}

export default function JamiAssistantHistory({
  threads,
  loading,
  error,
  onOpen,
  onNew,
  onRename,
  onDelete,
}: JamiAssistantHistoryProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const beginRename = (thread: JamiAssistantThread) => {
    setDeleteId(null);
    setEditingId(thread.id);
    setEditingTitle(thread.title);
    setActionError(null);
  };

  const saveRename = async (thread: JamiAssistantThread) => {
    const nextTitle = editingTitle.trim();
    if (!nextTitle || busyId) return;
    setBusyId(thread.id);
    setActionError(null);
    try {
      await onRename(thread, nextTitle);
      setEditingId(null);
    } catch (renameError) {
      setActionError(
        renameError instanceof Error
          ? renameError.message
          : "That chat could not be renamed."
      );
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async (thread: JamiAssistantThread) => {
    if (busyId) return;
    setBusyId(thread.id);
    setActionError(null);
    try {
      await onDelete(thread);
      setDeleteId(null);
    } catch (deleteError) {
      setActionError(
        deleteError instanceof Error
          ? deleteError.message
          : "That chat could not be deleted."
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section aria-label="Jami chat history" className="mx-auto w-full max-w-lg">
      <div className="flex items-start justify-between gap-4">
        <h3 className="pt-1 text-base font-semibold text-text-primary">
          Previous chats
        </h3>
        <button
          type="button"
          className="shrink-0 rounded-full bg-accent px-3.5 py-2 text-xs font-semibold text-white transition duration-fast hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
          onClick={onNew}
        >
          New chat
        </button>
      </div>

      {error || actionError ? (
        <div
          role="alert"
          className="mt-4 rounded-[1rem] border border-error/30 bg-error-muted px-3.5 py-3 text-xs leading-relaxed text-[var(--color-error-text)]"
        >
          {actionError ?? error}
        </div>
      ) : null}

      {loading ? (
        <div
          className="mt-8 flex items-center justify-center gap-2 text-sm text-text-muted"
          role="status"
        >
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
          Loading chats
        </div>
      ) : threads.length === 0 ? (
        <div className="mt-8 rounded-[1.35rem] border border-dashed border-[var(--color-border-strong)] px-5 py-8 text-center">
          <p className="text-sm font-medium text-text-primary">No saved chats yet</p>
          <p className="mt-1.5 text-xs leading-relaxed text-text-muted">
            Your next conversation with Jami will appear here.
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {threads.map((thread) => {
            const editing = editingId === thread.id;
            const deleting = deleteId === thread.id;
            const busy = busyId === thread.id;

            return (
              <article
                key={thread.id}
                className="relative rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-panel)] p-1.5 transition duration-fast hover:border-[var(--color-border-strong)]"
              >
                {editing ? (
                  <form
                    className="flex items-center gap-2 p-1"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveRename(thread);
                    }}
                  >
                    <label htmlFor={`jami-chat-title-${thread.id}`} className="sr-only">
                      Chat name
                    </label>
                    <input
                      id={`jami-chat-title-${thread.id}`}
                      autoFocus
                      maxLength={80}
                      value={editingTitle}
                      disabled={busy}
                      className="min-w-0 flex-1 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface-panel)] px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/55 focus:ring-2 focus:ring-accent/15"
                      onChange={(event) => setEditingTitle(event.target.value)}
                    />
                    <button
                      type="submit"
                      disabled={busy || !editingTitle.trim()}
                      className="rounded-full bg-accent px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded-full px-2.5 py-2 text-xs font-medium text-text-muted hover:bg-[var(--color-glass-subtle)] hover:text-text-primary"
                      onClick={() => setEditingId(null)}
                    >
                      Cancel
                    </button>
                  </form>
                ) : deleting ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 px-2 py-1.5">
                    <p className="text-xs font-medium text-text-primary">Delete this chat?</p>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={busy}
                        className="rounded-full px-3 py-2 text-xs font-medium text-text-muted hover:bg-[var(--color-glass-subtle)] hover:text-text-primary"
                        onClick={() => setDeleteId(null)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        className="rounded-full bg-error px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                        onClick={() => void confirmDelete(thread)}
                      >
                        {busy ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="min-w-0 flex-1 rounded-xl px-2.5 py-2 text-left transition duration-fast hover:bg-[var(--color-glass-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
                      onClick={() => onOpen(thread)}
                    >
                      <span className="block truncate text-sm font-semibold leading-snug text-text-primary">
                        {thread.title}
                      </span>
                      <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[0.68rem] text-text-muted">
                        <span>{surfaceName(thread.surface)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{formatUpdatedAt(thread.updatedAt)}</span>
                      </span>
                    </button>
                    <details className="group relative shrink-0">
                      <summary
                        aria-label={`More options for ${thread.title}`}
                        title="More options"
                        className="inline-grid h-9 w-9 cursor-pointer list-none place-items-center rounded-full text-text-muted transition duration-fast hover:bg-[var(--color-glass-subtle)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 [&::-webkit-details-marker]:hidden"
                      >
                        <MoreIcon />
                      </summary>
                      <div className="absolute right-0 top-10 z-20 w-36 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-panel-strong)] p-1 shadow-[0_12px_28px_rgba(8,3,20,0.16)]">
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-text-secondary hover:bg-[var(--color-glass-subtle)] hover:text-text-primary"
                          onClick={(event) => {
                            event.currentTarget
                              .closest("details")
                              ?.removeAttribute("open");
                            beginRename(thread);
                          }}
                        >
                          <EditIcon />
                          Rename
                        </button>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-text-secondary hover:bg-error-muted hover:text-[var(--color-error-text)]"
                          onClick={(event) => {
                            event.currentTarget
                              .closest("details")
                              ?.removeAttribute("open");
                            setEditingId(null);
                            setDeleteId(thread.id);
                            setActionError(null);
                          }}
                        >
                          <DeleteIcon />
                          Delete
                        </button>
                      </div>
                    </details>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
