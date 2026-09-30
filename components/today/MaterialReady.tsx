"use client";

import { Button, ButtonLink } from "@/components/ui";

/**
 * Material the student has just agreed to, and the way into it.
 *
 * Careful about what it claims. Cards written are not cards answered, so this
 * says they exist and offers to go and use them -- it does not congratulate
 * anybody, and the recommendation that asked for them is still open until the
 * work is actually done.
 */
export default function MaterialReady({
  kind,
  created,
  conceptLabel,
  href,
  onDismiss,
}: {
  kind: "create_flashcards" | "create_practice";
  created: number;
  conceptLabel: string;
  href: string;
  onDismiss: () => void;
}) {
  const cards = kind === "create_flashcards";
  const noun = cards ? (created === 1 ? "card" : "cards") : created === 1 ? "question" : "questions";

  return (
    <div className="app-panel-warm animate-slide-up relative overflow-hidden rounded-xl p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-lg font-medium text-text-primary">
            {created} {noun} added.
          </div>
          <p className="mt-1 text-sm leading-6 text-text-secondary">
            Saved to <span className="font-medium text-text-primary">{conceptLabel}</span>.{" "}
            {cards
              ? "They are yours now -- edit or delete any of them whenever you like."
              : "Sit them whenever you are ready; Jami will mark them the same way it marks anything else."}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button type="button" variant="ghost" onClick={onDismiss}>
            Later
          </Button>
          <ButtonLink href={href} onClick={onDismiss}>
            {cards ? "Study them" : "Open the questions"}
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
