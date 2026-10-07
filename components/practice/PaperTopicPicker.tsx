"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui";
import { servableExamSpecificationTopics } from "@/lib/practice/exam-specification-topics";
import { servableExamSpecificationConcepts } from "@/lib/practice/exam-specification-concepts";
import type { PaperTopicSelection } from "@/lib/practice/paper-topic-scope";

/**
 * What goes in the paper, from the course's own checked topic list.
 *
 * Every topic starts ticked, because most papers are the whole course. A
 * student takes out what they are already strong on, or opens a topic to keep
 * only some of its subtopics. It replaced a free-text "coverage" box, which
 * asked students to describe their course in words Jami then had to guess at.
 */
export default function PaperTopicPicker({
  specificationId,
  value,
  onChange,
  disabled = false,
}: {
  specificationId: string;
  value: PaperTopicSelection;
  onChange: (value: PaperTopicSelection) => void;
  disabled?: boolean;
}) {
  const topics = useMemo(() => servableExamSpecificationTopics(specificationId)?.topics ?? [], [specificationId]);
  const concepts = useMemo(() => servableExamSpecificationConcepts(specificationId), [specificationId]);

  if (topics.length === 0) {
    return (
      <p className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-4 py-3 text-sm leading-6 text-text-muted">
        A checked topic list isn&apos;t available for this course yet, so the paper covers the whole
        course, as the real one does.
      </p>
    );
  }

  const conceptsOf = (topicId: string) => concepts.filter((concept) => concept.parentTopicId === topicId);
  const includedCount = topics.filter(
    (topic) =>
      value.topicIds.includes(topic.id) ||
      conceptsOf(topic.id).some((concept) => value.conceptIds.includes(concept.id))
  ).length;
  const whole = value.topicIds.length === topics.length;

  const toggleTopic = (topicId: string) => {
    const inside = new Set(conceptsOf(topicId).map((concept) => concept.id));
    const partial = value.conceptIds.some((id) => inside.has(id));
    // A topic kept in part is taken out on the first tap, like a ticked one.
    const on = value.topicIds.includes(topicId) || partial;
    onChange({
      topicIds: on ? value.topicIds.filter((id) => id !== topicId) : [...value.topicIds, topicId],
      conceptIds: value.conceptIds.filter((id) => !inside.has(id)),
    });
  };

  const toggleConcept = (topicId: string, conceptId: string) => {
    const inside = conceptsOf(topicId).map((concept) => concept.id);
    // Opening a whole topic to change one subtopic starts from all of them.
    const current = value.topicIds.includes(topicId)
      ? inside
      : value.conceptIds.filter((id) => inside.includes(id));
    const next = current.includes(conceptId) ? current.filter((id) => id !== conceptId) : [...current, conceptId];
    const allChosen = next.length === inside.length;
    onChange({
      topicIds: allChosen
        ? [...value.topicIds.filter((id) => id !== topicId), topicId]
        : value.topicIds.filter((id) => id !== topicId),
      conceptIds: [...value.conceptIds.filter((id) => !inside.includes(id)), ...(allChosen ? [] : next)],
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-text-secondary">
          {whole
            ? "The whole course. Untick anything you're already confident with."
            : `${includedCount} of ${topics.length} topics in this paper.`}
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled || whole}
            onClick={() => onChange({ topicIds: topics.map((topic) => topic.id), conceptIds: [] })}
          >
            Select all
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled || includedCount === 0}
            onClick={() => onChange({ topicIds: [], conceptIds: [] })}
          >
            Clear
          </Button>
        </div>
      </div>
      <div className="grid items-start gap-2 sm:grid-cols-2">
        {topics.map((topic) => {
          const inside = conceptsOf(topic.id);
          const chosenInside = inside.filter((concept) => value.conceptIds.includes(concept.id)).length;
          const wholeTopic = value.topicIds.includes(topic.id);
          const state = wholeTopic ? "all" : chosenInside > 0 ? "some" : "none";
          return (
            <div
              key={topic.id}
              className={`rounded-2xl border px-3 py-2.5 transition ${
                state === "none"
                  ? "border-[var(--color-border)] bg-transparent"
                  : "border-[var(--color-selected-border)] bg-[var(--color-selected-bg)]"
              }`}
            >
              <label className="flex cursor-pointer items-start gap-3 text-sm text-text-primary">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
                  checked={state !== "none"}
                  ref={(element) => {
                    if (element) element.indeterminate = state === "some";
                  }}
                  disabled={disabled}
                  onChange={() => toggleTopic(topic.id)}
                />
                <span className="min-w-0 leading-5">{topic.label}</span>
              </label>
              {inside.length > 0 ? (
                <details className="mt-1.5 pl-7">
                  <summary className="cursor-pointer text-xs text-text-muted">
                    {state === "some"
                      ? `${chosenInside} of ${inside.length} subtopics`
                      : `${inside.length} subtopics`}
                  </summary>
                  <div className="mt-2 grid gap-1.5">
                    {inside.map((concept) => (
                      <label
                        key={concept.id}
                        className="flex cursor-pointer items-start gap-2 text-xs leading-5 text-text-secondary"
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--color-accent)]"
                          checked={wholeTopic || value.conceptIds.includes(concept.id)}
                          disabled={disabled}
                          onChange={() => toggleConcept(topic.id, concept.id)}
                        />
                        {concept.label}
                      </label>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
