"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import TopicPicker from "@/components/topics/TopicPicker";
import {
  Button,
  Card as Panel,
  FileField,
  Input,
  OptionSwitch,
  ProgressBar,
  Select,
  Textarea,
} from "@/components/ui";
import {
  CARD_SOURCE_TEXT_MAX_LENGTH,
  type VideoCardDraft,
  type VideoCardEvidence,
  type VideoCardJob,
  type VideoCoverage,
} from "@/lib/ai/video-card-jobs";
import type { Topic } from "@/lib/material/topics";
import type { Card } from "@/lib/study/cards";
import type { Deck } from "@/lib/study/decks";
import { resolveSourceFileMimeType } from "@/lib/material/source-files";
import { validateSourceUploadFile } from "@/services/study/source-files";
import {
  createStorageFileId,
  deleteStorageFile,
  sanitizeStorageFileName,
  uploadStorageFile,
} from "@/services/firebase/storage-files";
import {
  approveVideoCardJob,
  cancelVideoCardJob,
  createVideoCardJob,
  getRecentVideoCardJobs,
  getVideoCardJob,
  saveVideoCardDrafts,
} from "@/services/ai/video-card-jobs";

type Props = {
  userId: string;
  decks: Deck[];
  topics: Topic[];
  defaultDeckId?: string;
  onTopicsChange: (topics: Topic[]) => void;
  onCardsCreated: (cards: Card[]) => void;
  onMessage: (message: string, error?: boolean) => void;
};

const COVERAGE_OPTIONS = [
  { value: "focused" as const, label: "Key points", detail: "Core teaching only" },
  { value: "standard" as const, label: "Standard", detail: "Core teaching and worked examples" },
  { value: "thorough" as const, label: "Thorough", detail: "Plus definitions and detail" },
];

const ACCEPTED_SOURCE_FILES = [
  ".pdf", ".docx", ".pptx", ".txt", ".jpg", ".jpeg", ".png", ".webp",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain", "image/jpeg", "image/png", "image/webp",
].join(",");

const STAGE_LABELS = {
  preparing: "Preparing source",
  reading_video: "Reading source",
  creating_cards: "Creating cards",
  ready: "Ready to review",
} as const;

function Evidence({ entries }: { entries: VideoCardEvidence[] }) {
  if (!entries.length) return null;
  return (
    <details className="mt-3 border-t border-[var(--color-border)] pt-3">
      <summary className="cursor-pointer text-xs font-medium text-text-muted transition-colors duration-fast hover:text-text-secondary">
        Evidence from the source
      </summary>
      <ul className="mt-3 space-y-2 border-l border-[var(--color-border)] pl-3">
        {entries.map((entry) => (
          <li key={entry.id} className="text-xs leading-relaxed text-text-secondary">
            {entry.summary}
          </li>
        ))}
      </ul>
    </details>
  );
}

export default function SourceCardCreator({
  userId,
  decks,
  topics,
  defaultDeckId,
  onTopicsChange,
  onCardsCreated,
  onMessage,
}: Props) {
  const [inputKind, setInputKind] = useState<"file" | "text">("file");
  const [file, setFile] = useState<File | null>(null);
  const [sourceText, setSourceText] = useState("");
  const [deckId, setDeckId] = useState(defaultDeckId || decks[0]?.id || "");
  const [topicIds, setTopicIds] = useState<string[]>([]);
  const [coverage, setCoverage] = useState<VideoCoverage>("standard");
  const [focus, setFocus] = useState("");
  const [job, setJob] = useState<VideoCardJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const polling = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setDeckId((current) => current || defaultDeckId || decks[0]?.id || "");
  }, [decks, defaultDeckId]);

  useEffect(() => {
    void getRecentVideoCardJobs()
      .then((jobs) => {
        const resumable = jobs.find((item) =>
          ["file", "text"].includes(item.sourceKind) &&
          ["queued", "running", "ready"].includes(item.status)
        );
        if (resumable) setJob(resumable);
      })
      .catch(() => undefined);
  }, []);

  const activeJobId = job?.id;
  const activeJobStatus = job?.status;
  useEffect(() => {
    if (polling.current) clearInterval(polling.current);
    if (!activeJobId || !activeJobStatus || !["queued", "running"].includes(activeJobStatus)) return;
    polling.current = setInterval(
      () => void getVideoCardJob(activeJobId).then(setJob).catch(() => undefined),
      2500
    );
    return () => {
      if (polling.current) clearInterval(polling.current);
    };
  }, [activeJobId, activeJobStatus]);

  const evidenceById = useMemo(
    () => new Map((job?.evidence ?? []).map((entry) => [entry.id, entry])),
    [job?.evidence]
  );

  const start = async () => {
    const text = sourceText.trim();
    if (!deckId || (inputKind === "file" ? !file : !text)) {
      onMessage("Add a source and choose a deck.", true);
      return;
    }
    if (text.length > CARD_SOURCE_TEXT_MAX_LENGTH) {
      onMessage(`Pasted text must be ${CARD_SOURCE_TEXT_MAX_LENGTH.toLocaleString()} characters or fewer.`, true);
      return;
    }

    setBusy(true);
    const id = createStorageFileId();
    let storagePath = "";
    try {
      if (inputKind === "file" && file) {
        const mimeType = validateSourceUploadFile(file) || resolveSourceFileMimeType(file.name, file.type);
        if (!mimeType) throw new Error("This file type is not supported.");
        storagePath = `users/${userId}/cardSourceImports/${id}/${sanitizeStorageFileName(file.name, "source")}`;
        await uploadStorageFile({
          storagePath,
          file,
          contentType: mimeType,
          onProgress: setUploadProgress,
        });
      }

      const created = await createVideoCardJob({
        id,
        sourceKind: inputKind,
        ...(inputKind === "file"
          ? { storagePath, fileName: file?.name, mimeType: file?.type }
          : { contentText: text }),
        deckId,
        topicIds,
        coverage,
        focus: focus.trim() || undefined,
      });
      setJob(created);
      onMessage("Source import started.");
    } catch (error) {
      if (storagePath) await deleteStorageFile(storagePath).catch(() => undefined);
      onMessage(error instanceof Error ? error.message : "Could not start that import.", true);
    } finally {
      setBusy(false);
      setUploadProgress(0);
    }
  };

  const updateDraft = (id: string, field: "front" | "back", value: string) =>
    setJob((current) => current ? {
      ...current,
      drafts: current.drafts.map((draft) => draft.id === id ? { ...draft, [field]: value } : draft),
    } : current);

  const toggleDraft = (id: string) =>
    setJob((current) => current ? {
      ...current,
      drafts: current.drafts.map((draft) => draft.id === id ? { ...draft, selected: !draft.selected } : draft),
    } : current);

  const approve = async () => {
    if (!job) return;
    setBusy(true);
    try {
      await saveVideoCardDrafts(job.id, job.drafts);
      const cards = await approveVideoCardJob(job.id);
      onCardsCreated(cards);
      onMessage(`Added ${cards.length} cards.`);
      setJob(null);
      setFile(null);
      setSourceText("");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Could not add those cards.", true);
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    if (!job) return;
    setBusy(true);
    try {
      await cancelVideoCardJob(job.id);
      setJob(null);
    } finally {
      setBusy(false);
    }
  };

  const renderDraft = (draft: VideoCardDraft, index: number) => {
    const evidence = draft.evidenceIds
      .map((id) => evidenceById.get(id))
      .filter((entry): entry is VideoCardEvidence => Boolean(entry));
    return (
      <Panel key={draft.id} tone="subtle" padding="md" className={draft.selected ? "" : "opacity-55"}>
        <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-text-muted">
          <input
            type="checkbox"
            className="accent-[var(--color-accent)]"
            checked={draft.selected}
            onChange={() => toggleDraft(draft.id)}
          />
          Card {index + 1}
        </label>
        <Input
          className="mt-3"
          aria-label={`Card ${index + 1} front`}
          value={draft.front}
          onChange={(event) => updateDraft(draft.id, "front", event.target.value)}
        />
        <Textarea
          className="mt-3"
          aria-label={`Card ${index + 1} back`}
          rows={3}
          value={draft.back}
          onChange={(event) => updateDraft(draft.id, "back", event.target.value)}
        />
        <Evidence entries={evidence} />
      </Panel>
    );
  };

  if (job) {
    const selectedCount = job.drafts.filter((draft) => draft.selected).length;
    return (
      <div className="mt-5 space-y-4 animate-fade-in">
        {job.status === "failed" ? (
          <Panel tone="subtle" padding="md">
            <p className="text-sm text-text-secondary">{job.failureMessage}</p>
            <Button className="mt-3" variant="secondary" onClick={() => setJob(null)}>Try another</Button>
          </Panel>
        ) : null}

        {["queued", "running"].includes(job.status) ? (
          <Panel tone="subtle" padding="md">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium text-text-primary">{STAGE_LABELS[job.stage]}</span>
              <span className="tabular-nums text-text-muted">{job.progress}%</span>
            </div>
            <ProgressBar className="mt-3" progress={job.progress} size="sm" variant="warm" />
            <Button className="mt-4" variant="ghost" onClick={() => void discard()}>Cancel</Button>
          </Panel>
        ) : null}

        {job.status === "ready" ? (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-text-primary">{job.title}</p>
                <p className="mt-1 text-xs text-text-muted">{selectedCount} of {job.drafts.length} selected</p>
              </div>
              <Button variant="ghost" onClick={() => void discard()}>Discard</Button>
            </div>
            {job.warnings.length ? (
              <ul className="space-y-2">
                {job.warnings.map((warning) => (
                  <li key={warning.id} className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-text-secondary">
                    {warning.message}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="space-y-3">{job.drafts.map(renderDraft)}</div>
            <p className="text-xs leading-5 text-text-muted">
              The uploaded file and source evidence are removed after you add or discard this batch.
            </p>
            <Button size="lg" disabled={busy || !selectedCount} onClick={() => void approve()}>
              Add selected cards
            </Button>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-5 space-y-4 animate-fade-in">
      <div className="flex gap-2">
        <Button
          variant={inputKind === "file" ? "secondary" : "ghost"}
          disabled={busy}
          onClick={() => setInputKind("file")}
        >
          Upload
        </Button>
        <Button
          variant={inputKind === "text" ? "secondary" : "ghost"}
          disabled={busy}
          onClick={() => setInputKind("text")}
        >
          Paste text
        </Button>
      </div>

      {inputKind === "file" ? (
        <FileField
          label="Study file"
          hint="PDF, PowerPoint, Word, text or image · under 20 MB"
          accept={ACCEPTED_SOURCE_FILES}
          file={file}
          disabled={busy}
          onChange={setFile}
        />
      ) : (
        <Textarea
          label={`Study text · ${sourceText.length.toLocaleString()} / ${CARD_SOURCE_TEXT_MAX_LENGTH.toLocaleString()} characters`}
          placeholder="Paste lecture notes, a transcript, an article, or any study material…"
          rows={11}
          maxLength={CARD_SOURCE_TEXT_MAX_LENGTH}
          value={sourceText}
          disabled={busy}
          onChange={(event) => setSourceText(event.target.value)}
        />
      )}

      {!defaultDeckId ? (
        <Select label="Deck" value={deckId} onChange={(event) => setDeckId(event.target.value)}>
          <option value="" disabled>Choose a deck</option>
          {decks.map((deck) => <option key={deck.id} value={deck.id}>{deck.name}</option>)}
        </Select>
      ) : null}

      <OptionSwitch label="Coverage" value={coverage} options={COVERAGE_OPTIONS} disabled={busy} onChange={setCoverage} />

      <Input
        label="Focus (optional)"
        placeholder="e.g. causes and consequences"
        value={focus}
        onChange={(event) => setFocus(event.target.value)}
        maxLength={500}
        disabled={busy}
      />

      <details className="rounded-lg border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium text-text-secondary">
          Topics <span className="font-normal text-text-muted">(optional)</span>
        </summary>
        <div className="mt-4">
          <TopicPicker
            userId={userId}
            topics={topics}
            selectedTopicIds={topicIds}
            onChange={setTopicIds}
            onTopicsChange={onTopicsChange}
            disabled={busy}
          />
        </div>
      </details>

      <Button
        size="lg"
        className="w-full sm:w-auto"
        disabled={busy || !deckId || (inputKind === "file" ? !file : !sourceText.trim())}
        onClick={() => void start()}
      >
        {busy ? (uploadProgress ? `Uploading ${uploadProgress}%` : "Preparing…") : "Create cards"}
      </Button>
    </div>
  );
}
