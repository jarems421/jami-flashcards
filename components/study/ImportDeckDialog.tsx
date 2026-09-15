"use client";

import { useMemo, useRef, useState } from "react";
import {
  Button,
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogPanel,
  DialogTitle,
  FileField,
  Input,
  OptionSwitch,
  ProgressBar,
  Select,
  Textarea,
} from "@/components/ui";
import { parseCardImportText, type ImportedCardDraft } from "@/lib/study/cards";
import type { AnkiPackageResult } from "@/lib/study/import/anki-package";
import { MAX_DECK_IMPORT_CARDS } from "@/lib/study/import/anki-text";
import { useAnkiReader } from "@/lib/study/import/useAnkiImport";
import type { StudyFolder } from "@/lib/workspace/study-folders";

type ImportSource = "anki" | "text";

export type DeckImportInput = {
  name: string;
  folderId: string;
  cards: ImportedCardDraft[];
};

type Props = {
  open: boolean;
  folders: readonly StudyFolder[];
  defaultFolderId?: string;
  /** Cards written so far while an import is running. */
  progress: { completed: number; total: number } | null;
  onDismiss: () => void;
  /** Resolves once the deck is made; rejects with a message to show if it is not. */
  onImport: (input: DeckImportInput) => Promise<void>;
};

const SOURCE_OPTIONS = [
  { value: "anki", label: "Anki deck", detail: "An .apkg file exported from Anki" },
  { value: "text", label: "Pasted text", detail: "Questions and answers, one card a line" },
] as const;

/** Anki exports that include every image and sound get large; a deck of text never does. */
const MAX_ANKI_FILE_BYTES = 200 * 1024 * 1024;

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count.toLocaleString()} ${count === 1 ? one : many}`;

export default function ImportDeckDialog({ open, ...props }: Omit<Props, "open"> & { open: boolean }) {
  // Mounted fresh each time it opens, so a second import never starts from the last one.
  return open ? <ImportDeckForm {...props} /> : null;
}

function skippedNotes(result: AnkiPackageResult) {
  const notes: string[] = [];
  const { empty, tooLong, duplicate, overLimit } = result.skipped;
  if (overLimit) notes.push(`Only the first ${MAX_DECK_IMPORT_CARDS.toLocaleString()} cards are imported; ${plural(overLimit, "card")} left out.`);
  if (duplicate) notes.push(`${plural(duplicate, "card")} repeated another card and ${duplicate === 1 ? "was" : "were"} left out.`);
  if (empty) notes.push(`${plural(empty, "card")} had nothing left once images and sound were removed.`);
  if (tooLong) notes.push(`${plural(tooLong, "card")} ${tooLong === 1 ? "was" : "were"} longer than a card allows.`);
  if (result.mediaRemoved && !empty) notes.push("Images and sound are not imported, only the text.");
  return notes;
}

/**
 * Bringing cards in from Anki or from pasted text.
 *
 * Three steps, each on screen only when it is the next thing to do: choose
 * where the cards come from, check what was found and name the deck, then
 * import. Importing happens only when the button is pressed. It used to fire
 * from an effect as soon as a file was read, and because the page passed a new
 * handler on every render, one file could make the same deck more than once.
 */
function ImportDeckForm({ folders, defaultFolderId = "", progress, onDismiss, onImport }: Omit<Props, "open">) {
  const readAnki = useAnkiReader();
  const readRequest = useRef(0);
  /** Set the moment Import is pressed, so a double tap cannot start a second import before the button disables. */
  const importStarted = useRef(false);
  const [source, setSource] = useState<ImportSource>("anki");
  const [file, setFile] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState("");
  const [ankiResult, setAnkiResult] = useState<AnkiPackageResult | null>(null);
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [folderId, setFolderId] = useState(defaultFolderId);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");

  const parsedText = useMemo(() => parseCardImportText(text), [text]);
  const cards = source === "anki" ? (ankiResult?.cards ?? []) : parsedText.cards.slice(0, MAX_DECK_IMPORT_CARDS);
  const busy = reading || importing;

  const chooseFile = (next: File | null) => {
    readRequest.current += 1;
    const request = readRequest.current;
    setFile(next);
    setAnkiResult(null);
    setReadError("");
    setReading(false);
    if (!next) return;
    if (/\.colpkg$/i.test(next.name)) {
      setReadError("That is a whole Anki collection backup. In Anki, export a single deck as an .apkg file instead.");
      return;
    }
    if (!/\.apkg$/i.test(next.name)) {
      setReadError("Choose an .apkg file exported from Anki.");
      return;
    }
    if (next.size > MAX_ANKI_FILE_BYTES) {
      setReadError("That file is over 200 MB, usually because of images. Export it from Anki again with media left out.");
      return;
    }
    setReading(true);
    readAnki(next)
      .then((result) => {
        if (readRequest.current !== request) return;
        setAnkiResult(result);
        setName(result.deckName);
        if (result.cards.length === 0) setReadError("No cards with text could be found in this deck.");
      })
      .catch((error: unknown) => {
        if (readRequest.current !== request) return;
        setReadError(error instanceof Error ? error.message : "This Anki deck could not be read.");
      })
      .finally(() => {
        if (readRequest.current === request) setReading(false);
      });
  };

  const submit = async () => {
    if (importStarted.current || busy || cards.length === 0 || !name.trim()) return;
    importStarted.current = true;
    setImporting(true);
    setImportError("");
    try {
      await onImport({ name: name.trim(), folderId, cards });
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "The cards could not be imported. Try again.");
      importStarted.current = false;
      setImporting(false);
    }
  };

  const notes = source === "anki" && ankiResult ? skippedNotes(ankiResult) : [];
  const textProblems = source === "text" ? parsedText.errors : [];
  const overTextLimit = source === "text" && parsedText.cards.length > MAX_DECK_IMPORT_CARDS;
  const ready = cards.length > 0;

  return (
    <Dialog
      open
      dismissible={!busy}
      className="fixed inset-0 flex items-end justify-center p-3 sm:items-center sm:p-6"
      onDismiss={onDismiss}
    >
      <DialogBackdrop className="absolute inset-0 bg-black/65 backdrop-blur-sm" />
      <DialogPanel className="app-panel relative flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-xl shadow-e3">
        <header className="px-5 pb-2 pt-5 sm:px-6">
          <DialogTitle className="text-xl font-semibold text-text-primary">Import cards</DialogTitle>
          <DialogDescription className="mt-1 text-sm leading-6 text-text-secondary">
            Bring a deck in from Anki, or paste questions and answers.
          </DialogDescription>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 pb-5 pt-3 sm:px-6">
          <OptionSwitch
            label="Import from"
            hideLabel
            value={source}
            options={SOURCE_OPTIONS}
            columns={2}
            disabled={busy}
            onChange={(next) => {
              setSource(next);
              setImportError("");
            }}
          />

          {source === "anki" ? (
            <div className="space-y-3">
              <FileField
                label="Anki deck"
                hint="In Anki, choose the deck, then File › Export › Anki Deck Package (.apkg)."
                accept=".apkg"
                file={file}
                disabled={busy}
                onChange={chooseFile}
              />
              {reading ? (
                <p role="status" className="flex items-center gap-2.5 text-sm text-text-secondary">
                  <span
                    aria-hidden="true"
                    className="h-4 w-4 animate-spin rounded-full border-2 border-accent/40 border-r-transparent"
                  />
                  Reading your deck…
                </p>
              ) : null}
              {readError ? (
                <p role="alert" className="text-sm leading-6 text-[var(--color-error-mark)]">
                  {readError}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="space-y-2">
              <Textarea
                label="Cards"
                value={text}
                rows={7}
                disabled={busy}
                placeholder={"Photosynthesis | How plants make glucose from light\nMitochondria - Where respiration releases energy"}
                onChange={(event) => setText(event.target.value)}
              />
              <p className="text-xs leading-5 text-text-muted">
                One card a line, with the question and answer split by a tab, a comma, | or a dash.
              </p>
              {textProblems.length > 0 ? (
                <div role="alert" className="space-y-1 text-xs leading-5 text-[var(--color-error-mark)]">
                  {textProblems.map((problem) => (
                    <p key={problem}>{problem}</p>
                  ))}
                  {ready ? <p className="text-text-muted">The lines that could be read will still be imported.</p> : null}
                </div>
              ) : null}
            </div>
          )}

          {ready ? (
            <section aria-label="What will be imported" className="space-y-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-4">
              <p className="text-sm font-semibold text-text-primary">
                {plural(cards.length, "card")} ready to import
              </p>
              {overTextLimit ? (
                <p className="text-xs leading-5 text-text-muted">
                  Only the first {MAX_DECK_IMPORT_CARDS.toLocaleString()} cards are imported.
                </p>
              ) : null}
              {notes.length > 0 ? (
                <ul className="space-y-1 text-xs leading-5 text-text-muted">
                  {notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              ) : null}
              <ul className="space-y-2" aria-label="The first few cards">
                {cards.slice(0, 3).map((card, index) => (
                  <li
                    key={`${index}-${card.front}`}
                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-panel)] px-3 py-2 text-sm"
                  >
                    <p className="line-clamp-2 whitespace-pre-line font-medium text-text-primary">{card.front}</p>
                    <p className="mt-0.5 line-clamp-2 whitespace-pre-line text-text-secondary">{card.back}</p>
                  </li>
                ))}
              </ul>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="Deck name"
                  value={name}
                  maxLength={120}
                  disabled={importing}
                  placeholder="Name this deck"
                  onChange={(event) => setName(event.target.value)}
                />
                <Select
                  label="Folder"
                  value={folderId}
                  disabled={importing}
                  onChange={(event) => setFolderId(event.target.value)}
                >
                  <option value="">No folder</option>
                  {folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.name}
                    </option>
                  ))}
                </Select>
              </div>
            </section>
          ) : null}

          {importing && progress ? (
            <div className="space-y-2" role="status">
              <ProgressBar size="sm" progress={progress.total ? (progress.completed / progress.total) * 100 : 0} />
              <p className="text-xs text-text-muted">
                Adding cards… {progress.completed.toLocaleString()} of {progress.total.toLocaleString()}
              </p>
            </div>
          ) : null}
          {importError ? (
            <p role="alert" className="text-sm leading-6 text-[var(--color-error-mark)]">
              {importError}
            </p>
          ) : null}
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-[var(--color-border)] px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
          <Button type="button" variant="secondary" disabled={importing} onClick={onDismiss}>
            Cancel
          </Button>
          <Button type="button" disabled={busy || !ready || !name.trim()} onClick={() => void submit()}>
            {importing ? "Importing…" : ready ? `Import ${plural(cards.length, "card")}` : "Import"}
          </Button>
        </footer>
      </DialogPanel>
    </Dialog>
  );
}
