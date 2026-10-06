"use client";

import { useId, useState, type FormEvent } from "react";
import { JamiTutorIcon } from "@/components/ui";
import type {
  TutorStudyMaterialChoice,
  TutorStudyMaterialKind,
  TutorStudyMaterialSetup,
} from "@/lib/ai/tutor-study-material";

const KIND_LABELS: Record<TutorStudyMaterialKind, string> = {
  flashcards: "Flashcards",
  practice: "Practice set",
};

/** Sizes worth choosing between; the middle one is where each starts. */
const COUNT_CHOICES: Record<TutorStudyMaterialKind, readonly number[]> = {
  flashcards: [6, 10, 15],
  practice: [3, 5, 8],
};
const DEFAULT_COUNT: Record<TutorStudyMaterialKind, number> = { flashcards: 10, practice: 5 };
/** More than this and a set stops being about anything in particular. */
const MAX_CHOSEN_TOPICS = 3;

function chipClass(selected: boolean) {
  return `min-h-9 rounded-full border px-3 text-xs font-semibold transition duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 ${
    selected
      ? "border-accent bg-accent/12 text-text-primary"
      : "border-[var(--color-border-strong)] text-text-secondary hover:border-accent/50 hover:text-text-primary"
  }`;
}

/**
 * Tutor asking what to make, as a short card under its question.
 *
 * Asked for flashcards or a practice set with nothing to go on, Tutor asks
 * before it makes anything: which topic -- from a few it suggests, drawn from
 * the student's material and what they get wrong -- or one of their own, what
 * they are finding hard, and how many. Making starts only when they press it,
 * and what they chose is what is made.
 */
export default function TutorStudyMaterialSetupCard({
  setup,
  onMake,
}: {
  setup: TutorStudyMaterialSetup;
  onMake: (kind: TutorStudyMaterialKind, choice: TutorStudyMaterialChoice) => void;
}) {
  const id = useId();
  const [kind, setKind] = useState<TutorStudyMaterialKind>(setup.kind);
  const [topics, setTopics] = useState<string[]>([]);
  const [ownTopic, setOwnTopic] = useState("");
  const [struggle, setStruggle] = useState("");
  const [counts, setCounts] = useState<Record<TutorStudyMaterialKind, number>>(DEFAULT_COUNT);
  const count = counts[kind];
  const focus = [...topics, ownTopic.trim()].filter(Boolean).join(", ");

  const toggleTopic = (topic: string) =>
    setTopics((current) =>
      current.includes(topic)
        ? current.filter((entry) => entry !== topic)
        : current.length >= MAX_CHOSEN_TOPICS
          ? current
          : [...current, topic]
    );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!focus) return;
    onMake(kind, { focus, count, ...(struggle.trim() ? { struggle: struggle.trim() } : {}) });
  };

  return (
    <form
      onSubmit={submit}
      aria-labelledby={`${id}-title`}
      className="mt-2 flex flex-col gap-4 rounded-2xl border border-accent/20 bg-[var(--color-surface-panel)] px-4 py-4 shadow-e1"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-warm-border bg-warm-glow text-warm-accent"
        >
          <JamiTutorIcon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h3 id={`${id}-title`} className="text-sm font-semibold text-text-primary">
            What should they be on?
          </h3>
          <p className="mt-0.5 text-xs leading-5 text-text-muted">
            Pick a topic or type your own. Say what you find hard and they lean on it.
          </p>
        </div>
      </div>

      {setup.kinds.length > 1 ? (
        <div role="radiogroup" aria-label="What to make" className="flex flex-wrap gap-2">
          {setup.kinds.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={kind === option}
              className={chipClass(kind === option)}
              onClick={() => setKind(option)}
            >
              {KIND_LABELS[option]}
            </button>
          ))}
        </div>
      ) : null}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-xs font-semibold text-text-secondary">Topic</legend>
        {setup.topics.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {setup.topics.map((topic) => (
              <button
                key={topic}
                type="button"
                aria-pressed={topics.includes(topic)}
                className={chipClass(topics.includes(topic))}
                onClick={() => toggleTopic(topic)}
              >
                {topic}
              </button>
            ))}
          </div>
        ) : null}
        <label htmlFor={`${id}-own`} className="sr-only">
          Your own topic
        </label>
        <input
          id={`${id}-own`}
          value={ownTopic}
          maxLength={120}
          onChange={(event) => setOwnTopic(event.target.value)}
          placeholder={setup.topics.length > 0 ? "Or type your own topic" : "e.g. Osmosis and active transport"}
          className="app-field min-h-10 rounded-xl px-3 text-sm text-text-primary outline-none placeholder:text-text-muted"
        />
      </fieldset>

      <div className="flex flex-col gap-2">
        <label htmlFor={`${id}-hard`} className="text-xs font-semibold text-text-secondary">
          Anything you&apos;re finding hard? <span className="font-normal text-text-muted">Optional</span>
        </label>
        <input
          id={`${id}-hard`}
          value={struggle}
          maxLength={160}
          onChange={(event) => setStruggle(event.target.value)}
          placeholder="e.g. I mix up which way water moves"
          className="app-field min-h-10 rounded-xl px-3 text-sm text-text-primary outline-none placeholder:text-text-muted"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="radiogroup" aria-label="How many" className="flex items-center gap-2">
          <span className="text-xs font-semibold text-text-secondary">How many</span>
          {COUNT_CHOICES[kind].map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={count === option}
              className={`${chipClass(count === option)} min-w-9 tabular-nums`}
              onClick={() => setCounts((current) => ({ ...current, [kind]: option }))}
            >
              {option}
            </button>
          ))}
        </div>
        <button
          type="submit"
          disabled={!focus}
          className="min-h-10 rounded-full bg-accent px-4 text-sm font-semibold text-accent-on shadow-accent transition duration-fast hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 disabled:cursor-not-allowed disabled:bg-[var(--color-glass-medium)] disabled:text-text-muted disabled:shadow-none"
        >
          {kind === "flashcards" ? `Make ${count} flashcards` : `Make a ${count}-question set`}
        </button>
      </div>
    </form>
  );
}
