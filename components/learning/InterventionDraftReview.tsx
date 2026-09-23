"use client";

import { useCallback, useMemo, useState } from "react";
import { Button, Dialog, FeedbackBanner, Textarea } from "@/components/ui";
import {
  draftSize,
  editDraftItem,
  isConfirmable,
  removeDraftItem,
  type InterventionDraft,
} from "@/lib/learning/interventions/draft";
import type { GeneratedCardDraft } from "@/lib/ai/card-generation";
import type { PracticeQuestionDraft } from "@/lib/learning/interventions/practice-request";

/**
 * Material Jami has written, before the student has agreed to any of it.
 *
 * One surface for every kind of generated intervention rather than one per
 * generator. The editors differ -- a card has two sides, a question has a
 * tariff and a scheme -- but everything around them is the same thing every
 * time: this is unconfirmed, it belongs to a concept, cancelling leaves
 * nothing behind, and nothing is written until the student says so.
 *
 * Those shared parts are the reason this is generic rather than two screens.
 * Written per generator, the confirmation semantics would be re-decided each
 * time, and the fourth kind of intervention would arrive with a third set.
 */

export type InterventionDraftReviewProps = {
  draft: InterventionDraft | null;
  /** Called with whatever survived editing. Writing is the caller's job. */
  onConfirm: (draft: InterventionDraft) => Promise<unknown> | void;
  onCancel: () => void;
  /** Shown while the caller is writing, so nothing can be confirmed twice. */
  saving?: boolean;
};

const HEADINGS: Record<InterventionDraft["payload"]["kind"], { title: string; verb: string }> = {
  create_flashcards: { title: "Cards Jami has written", verb: "Add these cards" },
  create_practice: { title: "Questions Jami has written", verb: "Add these questions" },
};

function CardEditor({
  card,
  index,
  onChange,
  onRemove,
}: {
  card: GeneratedCardDraft;
  index: number;
  onChange: (next: GeneratedCardDraft) => void;
  onRemove: () => void;
}) {
  return (
    <div className="app-subtle-panel grid gap-3 rounded-lg p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-text-muted">
          Card {index + 1}
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
          Remove
        </Button>
      </div>
      <Textarea
        label="Front"
        id={`draft-card-${index}-front`}
        value={card.front}
        rows={2}
        symbols
        onChange={(event) => onChange({ ...card, front: event.target.value })}
      />
      <Textarea
        label="Back"
        id={`draft-card-${index}-back`}
        value={card.back}
        rows={3}
        symbols
        onChange={(event) => onChange({ ...card, back: event.target.value })}
      />
    </div>
  );
}

function QuestionEditor({
  question,
  index,
  onChange,
  onRemove,
}: {
  question: PracticeQuestionDraft;
  index: number;
  onChange: (next: PracticeQuestionDraft) => void;
  onRemove: () => void;
}) {
  const schemeTotal = question.points.reduce((sum, point) => sum + point.marks, 0);
  const disagrees = schemeTotal !== question.marks;

  return (
    <div className="app-subtle-panel grid gap-3 rounded-lg p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-text-muted">
          Question {index + 1} · {question.marks} {question.marks === 1 ? "mark" : "marks"}
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
          Remove
        </Button>
      </div>
      <Textarea
        label="Question"
        id={`draft-question-${index}-prompt`}
        value={question.prompt}
        rows={3}
        symbols
        onChange={(event) => onChange({ ...question, prompt: event.target.value })}
      />
      <Textarea
        label="Answer"
        id={`draft-question-${index}-answer`}
        value={question.answer}
        rows={3}
        symbols
        onChange={(event) => onChange({ ...question, answer: event.target.value })}
      />
      <div className="grid gap-2">
        <span className="text-xs font-semibold text-text-secondary">
          Mark scheme
        </span>
        {question.points.map((point, pointIndex) => (
          <div key={pointIndex} className="flex items-start gap-2">
            <span className="mt-2 shrink-0 text-xs tabular-nums text-text-muted">
              {point.marks}
            </span>
            <Textarea
              label={`Point ${pointIndex + 1}`}
              id={`draft-question-${index}-point-${pointIndex}`}
              value={point.text}
              rows={2}
              onChange={(event) => {
                const points = [...question.points];
                points[pointIndex] = { ...point, text: event.target.value };
                onChange({ ...question, points });
              }}
            />
          </div>
        ))}
        {/*
          The rule the generator was held to, shown rather than enforced
          silently: a scheme that no longer accounts for its own tariff cannot
          mark the question, and the student would discover that only after
          sitting it.
        */}
        {disagrees ? (
          <p className="text-xs text-error">
            The scheme awards {schemeTotal} of {question.marks} marks. It needs to account for all
            of them before this question can be marked.
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default function InterventionDraftReview({
  draft,
  onConfirm,
  onCancel,
  saving = false,
}: InterventionDraftReviewProps) {
  const [edited, setEdited] = useState<InterventionDraft | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // The caller's draft until the student changes something.
  const current = edited?.interventionId === draft?.interventionId ? edited : draft;

  const apply = useCallback(
    (result: ReturnType<typeof editDraftItem>) => {
      if (result.ok) {
        setEdited(result.draft);
        setProblem(null);
        return;
      }
      setProblem(
        result.reason === "marks_disagree"
          ? "The mark scheme needs to account for every mark the question is worth."
          : "Both parts need something in them."
      );
    },
    []
  );

  const heading = useMemo(
    () => (current ? HEADINGS[current.payload.kind] : null),
    [current]
  );

  if (!current || !heading) return null;

  const confirmable = isConfirmable(current) && !saving;

  return (
    <Dialog
      open
      modal
      onDismiss={() => {
        // Dismissing is declining. Nothing has been written, so nothing is undone.
        setEdited(null);
        onCancel();
      }}
      className="w-full max-w-2xl"
    >
      <div className="grid max-h-[85vh] grid-rows-[auto_minmax(0,1fr)_auto] gap-4 p-5">
        <div>
          <h2 className="font-semibold text-text-primary">{heading.title}</h2>
          <p className="mt-1 text-sm text-text-secondary">
            For {current.conceptLabel}. Nothing is saved until you add them, and you can change
            anything first.
          </p>
          {current.dropped > 0 ? (
            <p className="mt-1 text-xs text-text-muted">
              {current.dropped} more {current.dropped === 1 ? "was" : "were"} left out for
              repeating something you already have.
            </p>
          ) : null}
        </div>

        <div className="grid gap-3 overflow-y-auto pr-1">
          {problem ? (
            <FeedbackBanner type="error" message={problem} onDismiss={() => setProblem(null)} />
          ) : null}
          {current.payload.kind === "create_flashcards"
            ? current.payload.cards.map((card, index) => (
                <CardEditor
                  key={index}
                  card={card}
                  index={index}
                  onChange={(next) => apply(editDraftItem(current, index, next))}
                  onRemove={() => apply(removeDraftItem(current, index))}
                />
              ))
            : current.payload.questions.map((question, index) => (
                <QuestionEditor
                  key={index}
                  question={question}
                  index={index}
                  onChange={(next) => apply(editDraftItem(current, index, next))}
                  onRemove={() => apply(removeDraftItem(current, index))}
                />
              ))}
          {draftSize(current) === 0 ? (
            <p className="text-sm text-text-secondary">
              You have removed all of them. Close this and nothing will be saved.
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
            Not now
          </Button>
          <Button
            type="button"
            disabled={!confirmable}
            onClick={() => {
              setProblem(null);
              void onConfirm(current);
            }}
          >
            {saving ? "Adding…" : `${heading.verb} (${draftSize(current)})`}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
