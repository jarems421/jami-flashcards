"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useUser } from "@/lib/auth/user-context";
import type { Source, SourceType } from "@/lib/practice/sources";
import type { Topic } from "@/lib/practice/topics";
import type { Deck } from "@/services/study/decks";
import {
  convertFlashcardDraftToCard,
  convertPracticeQuestionDraftToQuestion,
  getGeneratedContentDrafts,
  updateGeneratedContentDraftContent,
  updateGeneratedContentDraftStatus,
  type GeneratedContentDraft,
} from "@/services/study/generated-content";
import { getDecks } from "@/services/study/decks";
import { getActiveTopics } from "@/services/study/topics";
import { createSource, getActiveSources, updateSource } from "@/services/study/sources";
import { askSourceTutor, generateSourceDrafts } from "@/services/ai/source";
import AppPage from "@/components/layout/AppPage";
import {
  Button,
  Card,
  EmptyState,
  FeedbackBanner,
  Input,
  MetricStrip,
  SectionHeader,
  Skeleton,
  Textarea,
} from "@/components/ui";

type Feedback = { type: "success" | "error"; message: string };
type TutorMessage = { role: "user" | "model"; text: string };

const sourceTypes: Array<{ value: SourceType; label: string; helper: string }> = [
  { value: "pasted_text", label: "Paste text", helper: "Notes, extracts, worked examples." },
  { value: "manual_note", label: "Manual note", helper: "Your own summary or reminder." },
  { value: "link", label: "Link", helper: "Save the reference; parsing comes later." },
  { value: "file", label: "File metadata", helper: "Save file details; upload/parsing comes later." },
];

function typeLabel(type: SourceType) {
  return sourceTypes.find((item) => item.value === type)?.label ?? "Source";
}

function topicNames(topicIds: string[], topics: Topic[]) {
  return topicIds
    .map((topicId) => topics.find((topic) => topic.id === topicId)?.name)
    .filter((name): name is string => Boolean(name));
}

function sourcePreview(source: Source) {
  if (source.contentText) return source.contentText;
  if (source.externalUrl) return source.externalUrl;
  if (source.fileName) return `${source.fileName}${source.fileType ? ` (${source.fileType})` : ""}`;
  return "No source text yet.";
}

function DraftEditor({
  draft,
  topics,
  decks,
  selectedDeckId,
  onDeckChange,
  onSaved,
  userId,
}: {
  draft: GeneratedContentDraft;
  topics: Topic[];
  decks: Deck[];
  selectedDeckId: string;
  onDeckChange: (value: string) => void;
  onSaved: (message: string) => void;
  userId: string;
}) {
  const [front, setFront] = useState(draft.front ?? "");
  const [back, setBack] = useState(draft.back ?? "");
  const [questionText, setQuestionText] = useState(draft.questionText ?? "");
  const [answerText, setAnswerText] = useState(draft.answerText ?? "");
  const [solutionText, setSolutionText] = useState(draft.solutionText ?? "");
  const [busy, setBusy] = useState(false);
  const isFlashcard = draft.kind === "flashcard";

  useEffect(() => {
    setFront(draft.front ?? "");
    setBack(draft.back ?? "");
    setQuestionText(draft.questionText ?? "");
    setAnswerText(draft.answerText ?? "");
    setSolutionText(draft.solutionText ?? "");
  }, [draft]);

  return (
    <div className="rounded-[1.25rem] border border-white/[0.09] bg-white/[0.04] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-white">
            {isFlashcard ? "Flashcard draft" : "Practice question draft"}
          </div>
          <div className="mt-1 text-xs text-text-muted">
            Draft - review before it enters Learn or Practise.
          </div>
        </div>
        <span className="rounded-full border border-warm-border bg-warm-glow px-3 py-1 text-xs font-semibold text-warm-accent">
          Source-linked
        </span>
      </div>
      <div className="mt-4 space-y-3">
        {isFlashcard ? (
          <>
            <Textarea label="Front" rows={3} value={front} onChange={(event) => setFront(event.target.value)} />
            <Textarea label="Back" rows={4} value={back} onChange={(event) => setBack(event.target.value)} />
          </>
        ) : (
          <>
            <Textarea
              label="Question"
              rows={3}
              value={questionText}
              onChange={(event) => setQuestionText(event.target.value)}
            />
            <Textarea
              label="Expected answer"
              rows={3}
              value={answerText}
              onChange={(event) => setAnswerText(event.target.value)}
            />
            <Textarea
              label="Solution notes"
              rows={3}
              value={solutionText}
              onChange={(event) => setSolutionText(event.target.value)}
            />
          </>
        )}
        <div className="flex flex-wrap gap-2">
          {topicNames(draft.topicIds, topics).map((name) => (
            <span key={name} className="rounded-full border border-white/[0.1] bg-white/[0.05] px-3 py-1 text-xs text-text-secondary">
              {name}
            </span>
          ))}
        </div>
        {isFlashcard ? (
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">
              Destination deck
            </span>
            <select
              value={selectedDeckId}
              onChange={(event) => onDeckChange(event.target.value)}
              className="mt-2 min-h-[2.8rem] w-full rounded-2xl border border-white/[0.1] bg-surface-panel-strong px-3 text-sm text-white outline-none focus:border-warm-accent"
            >
              {decks.map((deck) => (
                <option key={deck.id} value={deck.id}>
                  {deck.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await updateGeneratedContentDraftContent(userId, draft.id, isFlashcard ? { front, back } : { questionText, answerText, solutionText });
                onSaved("Draft edits saved.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Save edits
          </Button>
          <Button
            type="button"
            disabled={busy || (isFlashcard && !selectedDeckId)}
            onClick={async () => {
              setBusy(true);
              try {
                await updateGeneratedContentDraftContent(userId, draft.id, isFlashcard ? { front, back } : { questionText, answerText, solutionText });
                if (isFlashcard) {
                  await convertFlashcardDraftToCard(userId, { draftId: draft.id, deckId: selectedDeckId });
                  onSaved("Card added to your deck. You can review it in Learn.");
                } else {
                  await convertPracticeQuestionDraftToQuestion(userId, { draftId: draft.id });
                  onSaved("Practice question approved. You can attempt it in Practise.");
                }
              } finally {
                setBusy(false);
              }
            }}
          >
            {isFlashcard ? "Add to deck" : "Approve question"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await updateGeneratedContentDraftStatus(userId, draft.id, "rejected");
                onSaved("Draft rejected.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Reject
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function LibraryPage() {
  const { user } = useUser();
  const [sources, setSources] = useState<Source[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [drafts, setDrafts] = useState<GeneratedContentDraft[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddSource, setShowAddSource] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [sourceType, setSourceType] = useState<SourceType>("pasted_text");
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([]);
  const [contentText, setContentText] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileType, setFileType] = useState("");
  const [tutorMessage, setTutorMessage] = useState("Explain the key ideas in this source.");
  const [tutorMessages, setTutorMessages] = useState<TutorMessage[]>([]);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [deckIdByDraft, setDeckIdByDraft] = useState<Record<string, string>>({});

  const selectedSource = useMemo(
    () => sources.find((source) => source.id === selectedSourceId) ?? sources[0] ?? null,
    [selectedSourceId, sources]
  );
  const sourceDrafts = useMemo(
    () =>
      drafts.filter(
        (draft) =>
          draft.contentStatus === "draft" &&
          draft.sourceType === "source" &&
          selectedSource &&
          draft.sourceId === selectedSource.id
      ),
    [drafts, selectedSource]
  );

  const loadAll = useCallback(async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const [nextSources, nextTopics, nextDecks, nextDrafts] = await Promise.all([
        getActiveSources(user.uid),
        getActiveTopics(user.uid),
        getDecks(user.uid),
        getGeneratedContentDrafts(user.uid),
      ]);
      setSources(nextSources);
      setTopics(nextTopics);
      setDecks(nextDecks);
      setDrafts(nextDrafts);
      setSelectedSourceId((current) =>
        current && nextSources.some((source) => source.id === current)
          ? current
          : nextSources[0]?.id ?? null
      );
    } catch (error) {
      console.error(error);
      setFeedback({ type: "error", message: "Failed to load Library." });
    } finally {
      setLoading(false);
    }
  }, [user.uid]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (decks[0]?.id) {
      setDeckIdByDraft((current) => {
        const next = { ...current };
        for (const draft of drafts) {
          if (draft.kind === "flashcard" && !next[draft.id]) {
            next[draft.id] = decks[0].id;
          }
        }
        return next;
      });
    }
  }, [decks, drafts]);

  const createNextSource = async () => {
    setBusyAction("create-source");
    setFeedback(null);
    try {
      const sourceId = await createSource(user.uid, {
        title,
        type: sourceType,
        subject,
        topicIds: selectedTopicIds,
        contentText,
        externalUrl,
        fileName,
        fileType,
      });
      setTitle("");
      setSubject("");
      setSelectedTopicIds([]);
      setContentText("");
      setExternalUrl("");
      setFileName("");
      setFileType("");
      setShowAddSource(false);
      await loadAll();
      setSelectedSourceId(sourceId);
      setFeedback({ type: "success", message: "Source saved. Link it to drafts, Tutor, and revision tasks." });
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Could not save source." });
    } finally {
      setBusyAction(null);
    }
  };

  const runSourceTutor = async () => {
    if (!selectedSource) return;
    setBusyAction("source-tutor");
    setFeedback(null);
    setTutorMessages((current) => [...current, { role: "user", text: tutorMessage }]);
    try {
      const response = await askSourceTutor({ sourceId: selectedSource.id, message: tutorMessage });
      setTutorMessages((current) => [...current, { role: "model", text: response.reply }]);
      setFeedback({ type: "success", message: "Tutor used this source as context." });
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Source Tutor failed." });
    } finally {
      setBusyAction(null);
    }
  };

  const generateDrafts = async (kind: "flashcard" | "practice-question") => {
    if (!selectedSource) return;
    setBusyAction(kind);
    setFeedback(null);
    try {
      const created = await generateSourceDrafts({ sourceId: selectedSource.id, kind });
      await loadAll();
      setFeedback({
        type: "success",
        message: `${created.length} ${kind === "flashcard" ? "flashcard" : "practice question"} draft${created.length === 1 ? "" : "s"} created. Review before approving.`,
      });
    } catch (error) {
      setFeedback({ type: "error", message: error instanceof Error ? error.message : "Could not generate drafts." });
    } finally {
      setBusyAction(null);
    }
  };

  const toggleSourceTopic = async (topicId: string) => {
    if (!selectedSource) return;
    const nextTopicIds = selectedSource.topicIds.includes(topicId)
      ? selectedSource.topicIds.filter((id) => id !== topicId)
      : [...selectedSource.topicIds, topicId];
    await updateSource(user.uid, selectedSource.id, { topicIds: nextTopicIds });
    await loadAll();
  };

  const handleDraftSaved = async (message: string) => {
    setFeedback({ type: "success", message });
    await loadAll();
  };

  const metrics = [
    { label: "Sources", value: sources.length, detail: "Saved study material." },
    {
      label: "Drafts waiting",
      value: drafts.filter((draft) => draft.sourceType === "source" && draft.contentStatus === "draft").length,
      detail: "Approve before study.",
      tone: "warm" as const,
    },
    {
      label: "Linked topics",
      value: new Set(sources.flatMap((source) => source.topicIds)).size,
      detail: "Connected to Progress.",
      tone: "good" as const,
    },
  ];

  if (loading) {
    return (
      <AppPage title="Library" backHref="/dashboard" backLabel="Today">
        <div className="space-y-4">
          <Skeleton className="h-28" />
          <Skeleton className="h-80" />
        </div>
      </AppPage>
    );
  }

  return (
    <AppPage
      title="Library"
      backHref="/dashboard"
      backLabel="Today"
      width="3xl"
      action={
        <Button type="button" onClick={() => setShowAddSource(true)}>
          Add source
        </Button>
      }
      contentClassName="space-y-4 sm:space-y-6"
    >
      {feedback ? <FeedbackBanner type={feedback.type} message={feedback.message} onDismiss={() => setFeedback(null)} /> : null}
      <Card tone="warm" padding="lg">
        <SectionHeader
          eyebrow="Basic Library"
          title="Turn sources into revision."
          description="Save notes, references, or pasted material, then use Tutor and reviewed drafts to connect it back to Learn, Practise, Today, and Progress."
        />
        <div className="mt-5">
          <MetricStrip items={metrics} variant="compact" />
        </div>
      </Card>

      {showAddSource ? (
        <Card padding="lg">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <SectionHeader
              eyebrow="Add source"
              title="Save study material"
              description="Pasted text and manual notes work best right now. Links and files are saved as references; automatic reading comes later."
            />
            <Button type="button" variant="secondary" onClick={() => setShowAddSource(false)}>
              Close
            </Button>
          </div>
          <div className="mt-5 grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
            <div className="space-y-3">
              {sourceTypes.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setSourceType(item.value)}
                  className={`w-full rounded-[1.2rem] border p-4 text-left transition ${
                    sourceType === item.value
                      ? "border-warm-border bg-warm-glow text-white"
                      : "border-white/[0.09] bg-white/[0.04] text-text-secondary hover:border-white/[0.16]"
                  }`}
                >
                  <div className="font-semibold">{item.label}</div>
                  <div className="mt-1 text-xs text-text-muted">{item.helper}</div>
                </button>
              ))}
            </div>
            <div className="space-y-4">
              <Input label="Title" value={title} onChange={(event) => setTitle(event.target.value)} />
              <Input label="Subject" value={subject} onChange={(event) => setSubject(event.target.value)} />
              {(sourceType === "pasted_text" || sourceType === "manual_note") ? (
                <Textarea
                  label="Source text"
                  rows={8}
                  value={contentText}
                  onChange={(event) => setContentText(event.target.value)}
                />
              ) : null}
              {sourceType === "link" ? (
                <Input label="Source link" value={externalUrl} onChange={(event) => setExternalUrl(event.target.value)} />
              ) : null}
              {sourceType === "file" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input label="File name" value={fileName} onChange={(event) => setFileName(event.target.value)} />
                  <Input label="File type" value={fileType} onChange={(event) => setFileType(event.target.value)} />
                </div>
              ) : null}
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">Topics</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {topics.length === 0 ? (
                    <span className="text-sm text-text-secondary">Create topics in Practise, then link them here.</span>
                  ) : (
                    topics.map((topic) => {
                      const active = selectedTopicIds.includes(topic.id);
                      return (
                        <button
                          key={topic.id}
                          type="button"
                          onClick={() =>
                            setSelectedTopicIds((current) =>
                              active ? current.filter((id) => id !== topic.id) : [...current, topic.id]
                            )
                          }
                          className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                            active
                              ? "border-warm-border bg-warm-glow text-warm-accent"
                              : "border-white/[0.1] bg-white/[0.04] text-text-secondary"
                          }`}
                        >
                          {topic.name}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
              <Button type="button" disabled={busyAction === "create-source"} onClick={createNextSource}>
                {busyAction === "create-source" ? "Saving..." : "Save source"}
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {sources.length === 0 ? (
        <EmptyState
          emoji="Library"
          eyebrow="No sources yet"
          title="Add notes, pasted text, links, or file references."
          description="Library is where source material starts becoming Tutor context, flashcard drafts, practice drafts, and Progress evidence."
          action={
            <Button type="button" onClick={() => setShowAddSource(true)}>
              Add source
            </Button>
          }
        />
      ) : (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 2xl:grid-cols-[minmax(280px,0.75fr)_minmax(0,1.25fr)_minmax(280px,0.85fr)]">
          <Card padding="lg" className="2xl:sticky 2xl:top-4 2xl:self-start">
            <SectionHeader eyebrow="Sources" title="Saved material" description="Choose a source to preview, link, or turn into drafts." />
            <div className="mt-5 space-y-3">
              {sources.map((source) => {
                const active = source.id === selectedSource?.id;
                return (
                  <button
                    key={source.id}
                    type="button"
                    onClick={() => setSelectedSourceId(source.id)}
                    className={`w-full rounded-[1.2rem] border p-4 text-left transition ${
                      active
                        ? "border-warm-border bg-warm-glow text-white"
                        : "border-white/[0.09] bg-white/[0.04] text-text-secondary hover:border-white/[0.16]"
                    }`}
                  >
                    <div className="font-semibold">{source.title}</div>
                    <div className="mt-1 text-xs text-text-muted">{typeLabel(source.type)}</div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {topicNames(source.topicIds, topics).slice(0, 3).map((name) => (
                        <span key={name} className="rounded-full bg-white/[0.08] px-2.5 py-1 text-[0.68rem] text-text-secondary">
                          {name}
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>

          <div className="min-w-0 space-y-4">
            {selectedSource ? (
              <>
                <Card tone="warm" padding="lg">
                  <SectionHeader
                    eyebrow={typeLabel(selectedSource.type)}
                    title={selectedSource.title}
                    description={selectedSource.subject || "No subject set yet."}
                  />
                  <div className="mt-4 flex flex-wrap gap-2">
                    {topicNames(selectedSource.topicIds, topics).map((name) => (
                      <span key={name} className="rounded-full border border-warm-border bg-warm-glow px-3 py-1.5 text-xs font-semibold text-warm-accent">
                        {name}
                      </span>
                    ))}
                  </div>
                  <div className="mt-5 max-h-[24rem] overflow-y-auto whitespace-pre-wrap rounded-[1.25rem] border border-white/[0.09] bg-white/[0.04] p-4 text-sm leading-6 text-text-secondary">
                    {sourcePreview(selectedSource)}
                  </div>
                </Card>
                <Card padding="lg">
                  <SectionHeader
                    eyebrow="Draft review"
                    title="Source-generated drafts"
                    description="Approve useful drafts into Learn or Practise. Reject anything weak."
                  />
                  <div className="mt-5 space-y-3">
                    {sourceDrafts.length === 0 ? (
                      <p className="rounded-[1.2rem] border border-white/[0.09] bg-white/[0.035] p-4 text-sm leading-6 text-text-secondary">
                        No drafts waiting from this source. Generate a small batch, then review before adding.
                      </p>
                    ) : (
                      sourceDrafts.map((draft) => (
                        <DraftEditor
                          key={draft.id}
                          draft={draft}
                          topics={topics}
                          decks={decks}
                          selectedDeckId={deckIdByDraft[draft.id] ?? decks[0]?.id ?? ""}
                          onDeckChange={(value) => setDeckIdByDraft((current) => ({ ...current, [draft.id]: value }))}
                          onSaved={handleDraftSaved}
                          userId={user.uid}
                        />
                      ))
                    )}
                  </div>
                </Card>
              </>
            ) : null}
          </div>

          <div className="space-y-4 2xl:sticky 2xl:top-4 2xl:self-start">
            <Card padding="lg">
              <SectionHeader
                eyebrow="Actions"
                title="Use this source"
                description="Keep generation small. Everything stays draft-only until you approve it."
              />
              {selectedSource ? (
                <div className="mt-5 space-y-3">
                  <Textarea
                    label="Tutor request"
                    rows={4}
                    value={tutorMessage}
                    onChange={(event) => setTutorMessage(event.target.value)}
                  />
                  <div className="grid gap-2">
                    <Button type="button" variant="secondary" disabled={busyAction === "source-tutor"} onClick={runSourceTutor}>
                      {busyAction === "source-tutor" ? "Asking..." : "Ask Tutor about source"}
                    </Button>
                    <Button type="button" variant="secondary" disabled={busyAction === "flashcard"} onClick={() => generateDrafts("flashcard")}>
                      {busyAction === "flashcard" ? "Generating..." : "Make flashcard drafts"}
                    </Button>
                    <Button type="button" variant="secondary" disabled={busyAction === "practice-question"} onClick={() => generateDrafts("practice-question")}>
                      {busyAction === "practice-question" ? "Generating..." : "Make practice drafts"}
                    </Button>
                  </div>
                </div>
              ) : null}
            </Card>
            <Card padding="lg">
              <SectionHeader
                eyebrow="Topic links"
                title="Connect to Progress"
                description="Topics help Jami connect this source to flashcards, practice, Tutor, and weak areas."
              />
              <div className="mt-5 flex flex-wrap gap-2">
                {selectedSource && topics.length > 0 ? (
                  topics.map((topic) => {
                    const active = selectedSource.topicIds.includes(topic.id);
                    return (
                      <button
                        key={topic.id}
                        type="button"
                        onClick={() => void toggleSourceTopic(topic.id)}
                        className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                          active
                            ? "border-warm-border bg-warm-glow text-warm-accent"
                            : "border-white/[0.1] bg-white/[0.04] text-text-secondary"
                        }`}
                      >
                        {topic.name}
                      </button>
                    );
                  })
                ) : (
                  <p className="text-sm leading-6 text-text-secondary">
                    Create topics in Practise, then link sources here.
                  </p>
                )}
              </div>
            </Card>
            <Card padding="lg">
              <SectionHeader eyebrow="Source Tutor" title="Tutor transcript" description="Context stays attached to this source." />
              <div className="mt-5 space-y-3">
                {tutorMessages.length === 0 ? (
                  <p className="rounded-[1.2rem] border border-white/[0.09] bg-white/[0.035] p-4 text-sm leading-6 text-text-secondary">
                    Ask Tutor to explain, summarise, or find revision ideas in the selected source.
                  </p>
                ) : (
                  tutorMessages.map((message, index) => (
                    <div
                      key={`${message.role}-${index}`}
                      className={`rounded-[1.1rem] border p-4 text-sm leading-6 ${
                        message.role === "model"
                          ? "border-warm-border bg-warm-glow text-white"
                          : "border-white/[0.09] bg-white/[0.04] text-text-secondary"
                      }`}
                    >
                      <div className="mb-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-text-muted">
                        {message.role === "model" ? "Jami Tutor" : "You"}
                      </div>
                      {message.text}
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>
        </div>
      )}
      <div className="text-sm text-text-muted">
        Need cards instead? <Link className="text-warm-accent hover:text-white" href="/dashboard/cards">Open Cards</Link>.
      </div>
    </AppPage>
  );
}
