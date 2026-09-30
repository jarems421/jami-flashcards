"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Button, JamiTutorIcon, StudyText } from "@/components/ui";
import {
  markWord,
  practiceQuestionDraftFields,
  type JamiAssistantSuggestedQuestion,
} from "@/lib/ai/tutor-question-suggestions";
import { getSourcePanelHref } from "@/lib/app/tutor-views";
import { createPracticeQuestionDraft } from "@/services/study/generated-content";

type QuestionState = "idle" | "saving" | "saved" | "failed";

/**
 * Practice questions Tutor offered in an answer.
 *
 * Saving one makes a draft in its source's review queue, beside cards and
 * questions made from the source directly; approving it there puts it on a
 * notebook page to be worked. Each answer and mark scheme is folded away
 * until asked for, so reading the list does not spoil the practice.
 */
export default function TutorQuestionSuggestions({
  userId,
  questions,
}: {
  userId: string;
  questions: readonly JamiAssistantSuggestedQuestion[];
}) {
  const [states, setStates] = useState<QuestionState[]>(() => questions.map(() => "idle"));
  const [opened, setOpened] = useState<ReadonlySet<number>>(() => new Set());
  const savedSources = useMemo(() => {
    const seen = new Map<string, string>();
    questions.forEach((question, index) => {
      if (states[index] === "saved") seen.set(question.sourceId, question.sourceTitle);
    });
    return [...seen.entries()];
  }, [questions, states]);
  const unsaved = states.filter((state) => state === "idle" || state === "failed").length;
  const busy = states.some((state) => state === "saving");
  const anyFailed = states.some((state) => state === "failed");

  const setState = (index: number, state: QuestionState) =>
    setStates((current) => current.map((value, at) => (at === index ? state : value)));

  // Claimed as a save starts, so Save all cannot save one a second time.
  const claimed = useRef(new Set<number>());

  const save = async (index: number) => {
    const question = questions[index];
    if (!question || claimed.current.has(index)) return;
    claimed.current.add(index);
    setState(index, "saving");
    try {
      await createPracticeQuestionDraft(userId, {
        ...practiceQuestionDraftFields(question),
        topicIds: question.topicIds,
        // Reviewed alongside everything else made from this source.
        sourceType: "source",
        sourceId: question.sourceId,
      });
      setState(index, "saved");
    } catch (error) {
      console.error("Failed to save a suggested practice question.", error);
      claimed.current.delete(index);
      setState(index, "failed");
    }
  };

  const saveAll = async () => {
    for (let index = 0; index < questions.length; index += 1) await save(index);
  };

  const toggle = (index: number) =>
    setOpened((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  return (
    <section
      aria-label="Suggested practice questions"
      className="app-subtle-panel mt-2 overflow-hidden rounded-2xl"
    >
      <header className="flex items-center gap-2.5 border-b border-[var(--color-border)] px-3.5 py-2.5">
        <JamiTutorIcon className="h-4 w-4 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-text-primary">
            {questions.length} practice {questions.length === 1 ? "question" : "questions"}
          </h3>
          <p className="text-2xs leading-4 text-text-muted">
            Saved questions wait in drafts, then go on a notebook page to work.
          </p>
        </div>
        {unsaved > 1 ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => void saveAll()}
          >
            Save all
          </Button>
        ) : null}
      </header>

      <ol className="divide-y divide-[var(--color-border)]">
        {questions.map((question, index) => {
          const state = states[index] ?? "idle";
          const isOpen = opened.has(index);
          return (
            <li key={`${question.sourceId}:${index}`} className="px-3.5 py-3">
              <div className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--color-accent-muted)] text-2xs font-semibold tabular-nums text-text-secondary"
                >
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <StudyText
                    as="p"
                    text={question.prompt}
                    className="block text-sm font-medium leading-6 text-text-primary"
                  />
                  <p className="mt-0.5 text-2xs font-semibold text-text-muted">
                    [{markWord(question.marks)}]
                  </p>
                  {isOpen ? (
                    <div className="mt-2 rounded-xl border border-[var(--color-border)] px-3 py-2.5">
                      <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-muted">
                        Model answer
                      </p>
                      <StudyText
                        as="p"
                        text={question.answer}
                        className="mt-1 block text-sm leading-6 text-text-secondary"
                      />
                      <p className="mt-2.5 text-2xs font-semibold uppercase tracking-[0.08em] text-text-muted">
                        Mark scheme
                      </p>
                      <ul className="mt-1 space-y-1">
                        {question.points.map((point, pointIndex) => (
                          <li key={pointIndex} className="flex gap-2 text-sm leading-6 text-text-secondary">
                            <span className="shrink-0 text-2xs font-semibold leading-6 tabular-nums text-text-muted">
                              {point.marks}
                            </span>
                            <StudyText as="span" text={point.text} className="min-w-0" />
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <span className="min-w-0 truncate text-2xs text-text-muted">
                      From {question.sourceTitle}
                    </span>
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => toggle(index)}
                      className="text-2xs font-semibold text-text-secondary underline-offset-2 hover:underline"
                    >
                      {isOpen ? "Hide answer" : "Show answer"}
                    </button>
                    {state === "saved" ? (
                      <span className="text-2xs font-semibold text-accent" role="status">
                        Saved to drafts
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={state === "saving"}
                        onClick={() => void save(index)}
                        className="rounded-full border border-accent/25 bg-accent/8 px-2.5 py-1 text-2xs font-semibold text-accent transition hover:border-accent/40 hover:bg-accent/12 disabled:cursor-wait disabled:opacity-60"
                      >
                        {state === "saving"
                          ? "Saving..."
                          : state === "failed"
                            ? "Try saving again"
                            : "Save to drafts"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {savedSources.length > 0 || anyFailed ? (
        <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--color-border)] px-3.5 py-2.5 text-2xs">
          {anyFailed ? (
            <span className="text-[var(--color-error-text)]" role="alert">
              Some questions could not be saved. Try again.
            </span>
          ) : null}
          {savedSources.map(([sourceId, title]) => (
            <Link
              key={sourceId}
              href={getSourcePanelHref(sourceId, "drafts")}
              className="max-w-full truncate font-semibold text-accent underline-offset-2 hover:underline"
            >
              Review drafts from {title}
            </Link>
          ))}
        </footer>
      ) : null}
    </section>
  );
}
