"use client";

import { useId, useState } from "react";
import {
  Button,
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogPanel,
  DialogTitle,
  Input,
} from "@/components/ui";
import { practicePaperSourceRole } from "@/lib/ai/practice-paper-generation";
import type { Source } from "@/lib/material/sources";
import { MAX_PRACTICE_PAPER_SOURCE_IDS } from "@/lib/practice/practice-papers";

/** Past papers and schemes first, then notes: what a new paper starts with. */
export function defaultPaperMaterial(sources: readonly Source[]) {
  const papers = sources.filter((source) => practicePaperSourceRole(source) !== "notes");
  const notes = sources.filter((source) => practicePaperSourceRole(source) === "notes");
  return [...papers, ...notes].slice(0, MAX_PRACTICE_PAPER_SOURCE_IDS).map((source) => source.id);
}

const UPLOAD_ACCEPT =
  "application/pdf,image/jpeg,image/png,image/webp,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,.pdf,.docx,.pptx,.txt";

const actionClass =
  "inline-flex min-h-9 shrink-0 cursor-pointer items-center rounded-full border border-[var(--color-border-strong)] px-3.5 text-xs font-semibold text-text-primary transition hover:bg-[var(--color-glass-medium)]";

function Section({
  title,
  description,
  addLabel,
  items,
  selectedIds,
  disabled,
  uploading,
  libraryAvailable,
  onToggle,
  onAdd,
  onOpenLibrary,
  emptyText,
}: {
  title: string;
  description: string;
  addLabel: string;
  items: Source[];
  selectedIds: readonly string[];
  disabled: boolean;
  uploading: boolean;
  libraryAvailable: boolean;
  onToggle: (id: string) => void;
  onAdd: (files: File[]) => void;
  onOpenLibrary: () => void;
  emptyText: string;
}) {
  const inputId = useId();
  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
          <p className="mt-0.5 max-w-md text-xs leading-5 text-text-muted">{description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {libraryAvailable ? (
            <button
              type="button"
              className={`${actionClass} disabled:pointer-events-none disabled:opacity-50`}
              disabled={disabled || uploading}
              onClick={onOpenLibrary}
            >
              From your library
            </button>
          ) : null}
          <label
            htmlFor={inputId}
            className={`${actionClass} ${disabled || uploading ? "pointer-events-none opacity-50" : ""}`}
          >
            {uploading ? "Adding…" : addLabel}
          </label>
          <input
            id={inputId}
            type="file"
            multiple
            accept={UPLOAD_ACCEPT}
            className="sr-only"
            disabled={disabled || uploading}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              if (files.length) onAdd(files);
            }}
          />
        </div>
      </div>
      {items.length === 0 ? (
        <p className="mt-3 text-xs leading-5 text-text-muted">{emptyText}</p>
      ) : (
        <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {items.map((source) => {
            const chosen = selectedIds.includes(source.id);
            return (
              <li key={source.id}>
                <label
                  className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm transition ${
                    chosen
                      ? "border-[var(--color-selected-border)] bg-[var(--color-selected-bg)] text-text-primary"
                      : "border-[var(--color-border)] text-text-secondary"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0 accent-[var(--color-accent)]"
                    checked={chosen}
                    disabled={disabled}
                    onChange={() => onToggle(source.id)}
                  />
                  <span className="min-w-0 truncate">{source.title}</span>
                  {practicePaperSourceRole(source) === "scheme" ? (
                    <span className="ml-auto shrink-0 rounded-full bg-[var(--color-glass-medium)] px-2 py-0.5 text-2xs font-semibold text-text-muted">
                      Mark scheme
                    </span>
                  ) : null}
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * Material already in the student's library, from other folders or none, to
 * bring into this one without uploading it again.
 */
function LibraryDialog({
  open,
  library,
  adding,
  onClose,
  onAdd,
}: {
  open: boolean;
  library: Source[];
  adding: boolean;
  onClose: () => void;
  onAdd: (ids: string[]) => void;
}) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const term = search.trim().toLowerCase();
  const shown = term
    ? library.filter((source) => `${source.title} ${source.fileName ?? ""}`.toLowerCase().includes(term))
    : library;
  const close = () => {
    setChosen([]);
    setSearch("");
    onClose();
  };
  return (
    <Dialog open={open} className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center" onDismiss={close}>
      <DialogBackdrop className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <DialogPanel className="app-panel relative flex max-h-[85dvh] w-full max-w-xl flex-col rounded-2xl p-5 shadow-e3 sm:p-6">
        <DialogTitle className="text-lg font-semibold text-text-primary">Add from your library</DialogTitle>
        <DialogDescription className="mt-1 text-sm leading-6 text-text-secondary">
          Notes and papers you&apos;ve already added elsewhere. They&apos;re added to this folder too, so they&apos;re here next time.
        </DialogDescription>
        <Input
          containerClassName="mt-4"
          label="Search"
          value={search}
          placeholder="Lecture 4, 2023 exam…"
          onChange={(event) => setSearch(event.target.value)}
        />
        <ul className="mt-3 grid min-h-0 flex-1 gap-1.5 overflow-y-auto pr-1">
          {shown.length === 0 ? (
            <li className="py-6 text-center text-sm text-text-muted">Nothing matches that.</li>
          ) : (
            shown.map((source) => {
              const checked = chosen.includes(source.id);
              return (
                <li key={source.id}>
                  <label
                    className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm transition ${
                      checked
                        ? "border-[var(--color-selected-border)] bg-[var(--color-selected-bg)] text-text-primary"
                        : "border-[var(--color-border)] text-text-secondary"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 accent-[var(--color-accent)]"
                      checked={checked}
                      onChange={() =>
                        setChosen((current) =>
                          checked ? current.filter((id) => id !== source.id) : [...current, source.id]
                        )
                      }
                    />
                    <span className="min-w-0 truncate">{source.title}</span>
                  </label>
                </li>
              );
            })
          )}
        </ul>
        <div className="mt-4 flex justify-end gap-2 border-t border-[var(--color-border)] pt-4">
          <Button type="button" variant="ghost" disabled={adding} onClick={close}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={adding || chosen.length === 0}
            onClick={() => {
              onAdd(chosen);
              setChosen([]);
              setSearch("");
            }}
          >
            {adding ? "Adding…" : chosen.length > 0 ? `Add ${chosen.length}` : "Add"}
          </Button>
        </div>
      </DialogPanel>
    </Dialog>
  );
}

/**
 * The material a paper is built from, the way a student gathers it: the past
 * papers and mark schemes they were given, and their lecture notes.
 *
 * This replaced a list Jami proposed and the student had to confirm, which put
 * Jami's needs first. Here the student sees their own papers and notes, all
 * ticked, and adds more -- uploaded, or brought in from their library -- and
 * whatever is added joins the folder, so the next paper starts from it too.
 */
export default function PaperMaterialPicker({
  sources,
  library,
  selectedIds,
  onChange,
  onUpload,
  onAddFromLibrary,
  uploading,
  addingFromLibrary,
  disabled = false,
}: {
  sources: Source[];
  /** The student's other material, not yet in this folder. */
  library: Source[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  onUpload: (files: File[], kind: "paper" | "notes") => void;
  onAddFromLibrary: (ids: string[]) => void;
  /** Which section is adding files, if any. */
  uploading: "paper" | "notes" | null;
  addingFromLibrary: boolean;
  disabled?: boolean;
}) {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const papers = sources.filter((source) => practicePaperSourceRole(source) !== "notes");
  const notes = sources.filter((source) => practicePaperSourceRole(source) === "notes");
  const toggle = (id: string) =>
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((chosen) => chosen !== id)
        : [...selectedIds, id].slice(0, MAX_PRACTICE_PAPER_SOURCE_IDS)
    );
  const shared = {
    selectedIds,
    disabled,
    libraryAvailable: library.length > 0,
    onToggle: toggle,
    onOpenLibrary: () => setLibraryOpen(true),
  };

  return (
    <div className="space-y-3">
      <Section
        {...shared}
        title="Past papers and mark schemes"
        description="Jami copies their format — the sections, the marks and the kinds of question — and writes new questions in it."
        addLabel="Upload"
        items={papers}
        uploading={uploading === "paper"}
        onAdd={(files) => onUpload(files, "paper")}
        emptyText="Add the papers you were given. Even one or two is enough for Jami to match the format."
      />
      <Section
        {...shared}
        title="Lecture notes and module material"
        description="What was taught, so every question stays on the module."
        addLabel="Upload"
        items={notes}
        uploading={uploading === "notes"}
        onAdd={(files) => onUpload(files, "notes")}
        emptyText="Add lecture slides, notes or the module handbook."
      />
      <p className="text-xs text-text-muted">
        {selectedIds.length} {selectedIds.length === 1 ? "file" : "files"} chosen. Anything you add stays in this folder for your next paper.
      </p>
      <LibraryDialog
        open={libraryOpen}
        library={library}
        adding={addingFromLibrary}
        onClose={() => setLibraryOpen(false)}
        onAdd={(ids) => {
          onAddFromLibrary(ids);
          setLibraryOpen(false);
        }}
      />
    </div>
  );
}
