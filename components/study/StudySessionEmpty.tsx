"use client";

import { Button, ButtonLink, EmptyState } from "@/components/ui";
import type { StudySessionKind } from "@/lib/study/session";

const EMPTY_SESSION_DESCRIPTIONS: Record<StudySessionKind, string> = {
  "daily-required": "Your Daily Review is clear right now.",
  "daily-optional": "There are no easy extras left right now.",
  simple: "Simple Study is clear right now.",
  custom: "This Focused Review does not match any cards yet.",
};

/** A session that opened onto an empty queue and so reviewed nothing. */
export default function StudySessionEmpty({
  sessionKind,
  onExit,
}: {
  sessionKind: StudySessionKind;
  onExit: () => void;
}) {
  return (
    <EmptyState
      emoji="Review"
      eyebrow="Nothing to study"
      title="No cards in this session"
      description={EMPTY_SESSION_DESCRIPTIONS[sessionKind]}
      helperText="That is not a bug, it just means this queue is empty for the current selection."
      action={
        <Button type="button" onClick={onExit}>
          Back to study home
        </Button>
      }
      secondaryAction={
        sessionKind === "custom" ? (
          <ButtonLink href="/dashboard/cards" variant="secondary">
            Edit cards
          </ButtonLink>
        ) : undefined
      }
    />
  );
}
