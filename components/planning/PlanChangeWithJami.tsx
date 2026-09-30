"use client";

import { useState, type FormEvent } from "react";
import { JamiTutorIcon } from "@/components/ui";

/**
 * Where a student tells Jami their plan needs to change.
 *
 * Sending opens the planning conversation with the message already said and
 * the current plan beside it, so Jami adjusts what is there rather than
 * starting again. Nothing changes until the student starts the new version.
 */

const STARTERS = [
  "I'm busy one day this week",
  "More time before my first exam",
  "An exam date changed",
] as const;

export default function PlanChangeWithJami({ onStart }: { onStart: (message: string) => void }) {
  const [message, setMessage] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (message.trim()) onStart(message.trim());
  };
  return (
    <section
      aria-labelledby="plan-change-title"
      className="space-y-3 rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-accent-muted)] p-5"
    >
      <div className="flex items-center gap-2">
        <JamiTutorIcon className="h-4 w-4 text-warm-accent" />
        <h2 id="plan-change-title" className="text-base font-bold text-text-primary">
          Change the plan with Jami
        </h2>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {STARTERS.map((starter) => (
          <button
            key={starter}
            type="button"
            onClick={() => onStart(starter)}
            className="app-chip rounded-full px-3 py-1.5 text-xs font-medium transition hover:border-[var(--color-border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
          >
            {starter}
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="app-field flex items-center gap-2 rounded-2xl py-1 pl-4 pr-1.5">
        <label htmlFor="plan-change-message" className="sr-only">
          Tell Jami what changed
        </label>
        <input
          id="plan-change-message"
          value={message}
          maxLength={500}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Tell Jami what changed"
          className="min-h-[2.75rem] min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
        />
        <button
          type="submit"
          aria-label="Send to Jami"
          disabled={!message.trim()}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--color-accent)] text-text-inverse transition hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
        >
          <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4" aria-hidden="true">
            <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </form>
    </section>
  );
}
