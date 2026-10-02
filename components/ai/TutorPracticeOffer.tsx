"use client";

import { useEffect, useRef, useState } from "react";
import { ButtonLink, JamiTutorIcon } from "@/components/ui";
import type { TutorPracticeOffer as PracticeOffer } from "@/lib/ai/tutor-practice-offer";
import { noteMissionStarted } from "@/lib/learning/mission-handoff";
import { getStudyDayKey } from "@/lib/study/day";
import { noteStudyActionOutcomeById } from "@/services/learning/study-action-events";

/**
 * The engine's advice to practise, offered under Tutor's answer.
 *
 * The same action Today would show for this topic, so it is recorded the same
 * way: shown when it appears, started when it is opened -- which rests it on
 * Today too, until the practice has been marked -- and dismissed when the
 * student says not now. Starting it also leaves Today the note that lets it
 * acknowledge the work when the student comes back.
 */
export default function TutorPracticeOffer({
  userId,
  offer,
  eyebrow = "Exam practice",
}: {
  userId: string;
  offer: PracticeOffer;
  /** What kind of advice this is: practice for the topic, or the folder's next step. */
  eyebrow?: string;
}) {
  const [dismissed, setDismissed] = useState(false);
  const shownRef = useRef(false);

  useEffect(() => {
    // Once per mount; the write itself is also deduplicated per day.
    if (!userId || shownRef.current) return;
    shownRef.current = true;
    noteStudyActionOutcomeById(userId, offer.actionId, "shown", getStudyDayKey());
  }, [offer.actionId, userId]);

  if (dismissed) return null;

  const start = () => {
    noteStudyActionOutcomeById(userId, offer.actionId, "started", getStudyDayKey());
    noteMissionStarted({
      actionId: offer.actionId,
      headline: offer.title,
      conceptLabel: offer.target.label,
    });
  };

  const dismiss = () => {
    noteStudyActionOutcomeById(userId, offer.actionId, "dismissed", getStudyDayKey());
    setDismissed(true);
  };

  return (
    <section
      aria-label={eyebrow}
      className="app-subtle-panel mt-2 overflow-hidden rounded-2xl"
    >
      <div className="flex items-start gap-2.5 px-3.5 py-3">
        <JamiTutorIcon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-text-muted">
            {eyebrow}
          </p>
          <h3 className="mt-0.5 text-sm font-semibold leading-5 text-text-primary">{offer.title}</h3>
          {offer.description ? (
            <p className="mt-0.5 text-xs leading-5 text-text-secondary">{offer.description}</p>
          ) : null}
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <ButtonLink href={offer.href} size="sm" onClick={start}>
              {offer.label}
            </ButtonLink>
            <button
              type="button"
              onClick={dismiss}
              className="min-h-8 rounded-full px-2.5 text-xs font-semibold text-text-muted transition duration-fast hover:bg-[var(--color-glass-subtle)] hover:text-text-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
