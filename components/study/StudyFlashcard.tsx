"use client";

import type { CSSProperties } from "react";
import { StudyText } from "@/components/ui";
import type { Card } from "@/lib/study/cards";

const VISIBLE_TOPIC_LIMIT = 2;

type StudyFlashcardProps = {
  card: Card;
  flipped: boolean;
  onReveal: () => void;
  deckName: string;
  deckColor: string;
  topicNames: string[];
  /** Shown under the answer, e.g. how the student should rate what they recalled. */
  answerHint?: string;
};

/**
 * The card itself: two faces in one 3D space, turned by `flipped`.
 *
 * Presentational on purpose. It knows how to show a card and how to ask to be
 * revealed, and nothing at all about marking, scheduling or what mode is
 * running -- which is what lets a mode wrap it without inheriting the review
 * pipeline along with it.
 */
export default function StudyFlashcard({
  card,
  flipped,
  onReveal,
  deckName,
  deckColor,
  topicNames,
  answerHint = "How well did you recall this?",
}: StudyFlashcardProps) {
  const faceStyle = { "--study-card-border": deckColor } as CSSProperties;
  const visibleTopics = topicNames.slice(0, VISIBLE_TOPIC_LIMIT);
  const hiddenTopicCount = topicNames.length - visibleTopics.length;

  return (
    <div
      data-study-current-card-id={card.id}
      className="study-flashcard-shell mx-auto w-full max-w-[62rem] cursor-pointer rounded-2xl"
      onClick={!flipped ? onReveal : undefined}
      onKeyDown={(event) => {
        if (flipped) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onReveal();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={flipped ? "Flashcard answer shown" : "Flip flashcard"}
    >
      <div
        className={`study-flashcard-turn relative aspect-[5/4] w-full [transform-style:preserve-3d] sm:aspect-[16/10] xl:aspect-[16/9] ${
          flipped ? "[transform:rotateY(180deg)]" : ""
        }`}
      >
        <div
          className="study-flashcard-face study-flashcard-face-front absolute inset-0 flex flex-col rounded-2xl p-5 [backface-visibility:hidden] sm:p-8 lg:p-10"
          aria-hidden={flipped}
          inert={flipped}
          style={faceStyle}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2 text-xs font-medium opacity-65">
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: deckColor }}
              />
              <span className="truncate">{deckName}</span>
            </div>
            {visibleTopics.length > 0 ? (
              <div className="flex max-w-[60%] flex-wrap justify-end gap-1.5">
                {visibleTopics.map((topicName, position) => (
                  <span
                    key={`${topicName}-${position}`}
                    className="rounded-full border border-current/15 bg-current/[0.05] px-2.5 py-1 text-2xs font-medium opacity-75"
                  >
                    {topicName}
                  </span>
                ))}
                {hiddenTopicCount > 0 ? (
                  <span className="rounded-full border border-current/15 bg-current/[0.05] px-2.5 py-1 text-2xs font-medium opacity-65">
                    +{hiddenTopicCount}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="flex flex-1 items-center justify-center py-6">
            <StudyText
              as="p"
              text={card.front}
              className="max-w-4xl whitespace-pre-wrap text-center text-lg font-medium leading-snug tracking-[0.01em] text-[color:inherit] sm:text-2xl xl:text-4xl"
            />
          </div>
          <div className="text-center text-xs font-medium opacity-60">
            Tap anywhere on the card or press Space to reveal
          </div>
        </div>
        {/*
          backface-visibility hides the answer visually but leaves it in the
          accessibility tree and in find-in-page, so an unflipped card would
          read out its own answer. inert and aria-hidden take it out of both
          until the flip.
        */}
        <div
          className="study-flashcard-face study-flashcard-face-back absolute inset-0 flex flex-col rounded-2xl p-5 [backface-visibility:hidden] [transform:rotateY(180deg)] sm:p-8 lg:p-10"
          aria-hidden={!flipped}
          inert={!flipped}
          style={faceStyle}
        >
          <div className="flex items-center gap-2 text-xs font-normal tracking-[0.06em] opacity-65">
            <span
              aria-hidden="true"
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: deckColor }}
            />
            <span>Answer</span>
          </div>
          <div className="flex flex-1 items-center justify-center py-6">
            <StudyText
              as="p"
              text={card.back}
              className="max-w-4xl whitespace-pre-wrap text-center text-lg font-medium leading-snug tracking-[0.01em] text-[color:inherit] sm:text-2xl xl:text-4xl"
            />
          </div>
          <div className="text-center text-xs font-medium opacity-60">
            {answerHint}
          </div>
        </div>
      </div>
    </div>
  );
}
