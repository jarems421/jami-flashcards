"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import CardFaceImage from "@/components/cards/CardFaceImage";
import DiagramZoomDialog from "@/components/cards/DiagramZoomDialog";
import OcclusionFigure, { OcclusionPicture } from "@/components/cards/OcclusionFigure";
import { StudyText } from "@/components/ui";
import type { CardImage } from "@/lib/study/card-images";
import type { Card } from "@/lib/study/cards";
import {
  getOcclusionPrompt,
  getOcclusionTargets,
  getRevealedAnswerWords,
  getWalkthroughMasks,
  isWholeDiagramGroupId,
  type CardOcclusion,
} from "@/lib/study/image-occlusion";

const VISIBLE_TOPIC_LIMIT = 2;
/** Long enough to see the last label uncovered before the card turns on its own. */
const AUTO_TURN_DELAY_MS = 700;

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
 * What one face shows: its image, its text, or both.
 *
 * The image takes whatever height the text leaves and is letterboxed rather
 * than cropped, because a diagram with its labels cut off is not the card that
 * was written.
 */
function FlashcardFaceContent({
  text,
  image,
  side,
}: {
  text: string;
  image?: CardImage;
  side: "front" | "back";
}) {
  const hasText = Boolean(text.trim());
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 py-6">
      {image ? (
        <div className="flex min-h-0 w-full flex-1 items-center justify-center">
          <CardFaceImage
            source={image}
            alt={hasText ? `Image on the ${side} of this card` : `The ${side} of this card`}
            className="h-full w-full rounded-xl object-contain"
          />
        </div>
      ) : null}
      {hasText ? (
        <StudyText
          as="p"
          text={text}
          className={`max-w-4xl shrink-0 whitespace-pre-wrap text-center font-medium leading-snug tracking-[0.01em] text-[color:inherit] ${
            image ? "text-base sm:text-xl xl:text-2xl" : "text-lg sm:text-2xl xl:text-4xl"
          }`}
        />
      ) : null}
    </div>
  );
}

/**
 * A diagram card's face: the picture, as large as the card allows, and one
 * line under it.
 *
 * The front asks -- the header, or what to do when there is none. A
 * whole-diagram front turns on its own once every label has been uncovered.
 * The back writes the label's name and note (every label's, for a group),
 * unless the picture prints the name itself: uncovering a covered label is its
 * answer. It also offers the whole picture uncovered, which is how a student
 * checks the neighbours they were unsure of. Either face can be opened full
 * screen for a closer look.
 */
function DiagramFaceContent({
  occlusion,
  header,
  side,
  onReveal,
}: {
  occlusion: CardOcclusion;
  header: string;
  side: "front" | "back";
  onReveal?: () => void;
}) {
  const [unmasked, setUnmasked] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  /** On a whole-diagram card's front: the labels the student has uncovered to check. */
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set());
  const { labels } = getOcclusionTargets(occlusion);
  /*
   * A whole-diagram card is worked through, not answered in one go: every
   * label starts covered, the student uncovers each to check their recall,
   * and flipping the card shows them all to rate it once.
   */
  const checking = side === "front" && isWholeDiagramGroupId(occlusion.groupId);
  const toggleChecked = (labelId: string) =>
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(labelId)) next.delete(labelId);
      else next.add(labelId);
      return next;
    });
  const total = occlusion.diagram.labels.length;
  const allChecked = checking && occlusion.diagram.labels.every((label) => checked.has(label.id));
  // The latest onReveal, so a parent re-render never restarts the turn.
  const onRevealRef = useRef(onReveal);
  useEffect(() => {
    onRevealRef.current = onReveal;
  });
  useEffect(() => {
    if (!allChecked) return;
    const timer = window.setTimeout(() => onRevealRef.current?.(), AUTO_TURN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [allChecked]);
  const answers = getRevealedAnswerWords(occlusion);
  const notes = labels.map((label) => label.note?.trim()).filter((note): note is string => Boolean(note));
  const canUnmask = side === "back" && total > labels.length;
  const phase = side === "front" ? "question" : unmasked ? "unmasked" : "answer";

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 py-2 sm:gap-3">
      <div className="flex min-h-0 w-full flex-1 items-center justify-center">
        {checking ? (
          <OcclusionPicture
            diagram={occlusion.diagram}
            masks={getWalkthroughMasks(occlusion.diagram, checked)}
            label="Diagram with every label covered. Tap a label to uncover it."
            fit="contain"
            onMaskActivate={toggleChecked}
            onZoom={() => setZoomed(true)}
          />
        ) : (
          <OcclusionFigure occlusion={occlusion} phase={phase} fit="contain" onZoom={() => setZoomed(true)} />
        )}
      </div>
      {checking ? (
        <div className="flex w-full max-w-4xl shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-center">
          <StudyText
            as="p"
            text={`${getOcclusionPrompt(occlusion, header)} Tap each label to check it (${checked.size} of ${total}).`}
            className="text-sm font-medium opacity-80 sm:text-base"
          />
          {onReveal ? (
            <button
              type="button"
              onClick={onReveal}
              className="rounded-full border border-current/25 px-3.5 py-1 text-sm font-semibold transition hover:bg-current/[0.06]"
            >
              Show all labels
            </button>
          ) : null}
        </div>
      ) : side === "front" ? (
        <StudyText
          as="p"
          text={getOcclusionPrompt(occlusion, header)}
          className="max-w-4xl shrink-0 text-center text-sm font-medium opacity-80 sm:text-base"
        />
      ) : (
        <div className="flex w-full max-w-4xl shrink-0 flex-wrap items-center justify-center gap-x-4 gap-y-1 text-center">
          {answers.length > 0 ? (
            <StudyText
              as="p"
              text={answers.join(" · ")}
              className={`font-semibold ${answers.length > 1 ? "text-sm sm:text-base xl:text-lg" : "text-base sm:text-xl xl:text-2xl"}`}
            />
          ) : null}
          {notes.map((note) => (
            <StudyText key={note} as="p" text={note} className="w-full text-sm opacity-75" />
          ))}
          {canUnmask ? (
            <button
              type="button"
              aria-pressed={unmasked}
              onClick={() => setUnmasked((current) => !current)}
              className="rounded-full border border-current/20 px-3 py-1 text-xs font-medium opacity-80 transition hover:opacity-100"
            >
              {unmasked ? "Hide the other labels" : "Show every label"}
            </button>
          ) : null}
        </div>
      )}
      <DiagramZoomDialog open={zoomed} title={header.trim() || "Diagram"} onClose={() => setZoomed(false)}>
        <OcclusionFigure occlusion={occlusion} phase={phase} fit="contain" />
      </DiagramZoomDialog>
    </div>
  );
}

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
  /*
   * A diagram is read, not glanced at: in a wide 16:9 card a tall picture was
   * left a thin strip between the header, prompt and hint. A diagram card is
   * sized by the screen instead, with less padding round the picture.
   */
  const isDiagram = Boolean(card.occlusion);
  const cardShape = isDiagram
    ? "h-[clamp(22rem,68dvh,54rem)] sm:h-[clamp(26rem,74dvh,58rem)]"
    : "aspect-[5/4] sm:aspect-[16/10] xl:aspect-[16/9]";
  const facePadding = isDiagram ? "p-3 sm:p-5 lg:p-6" : "p-5 sm:p-8 lg:p-10";

  return (
    <div
      data-study-current-card-id={card.id}
      data-tutorial-target="flashcard"
      className="study-flashcard-shell mx-auto w-full max-w-[62rem] cursor-pointer rounded-2xl"
      onClick={
        !flipped
          ? (event) => {
              // A tap on a control inside the card -- a label being checked, the zoom -- is for that control.
              if ((event.target as Element).closest("button")) return;
              // A whole diagram is turned only by its own button: a stray tap while checking labels would end it.
              if (isWholeDiagramGroupId(card.occlusion?.groupId)) return;
              onReveal();
            }
          : undefined
      }
      onKeyDown={(event) => {
        if (flipped || event.target !== event.currentTarget) return;
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
        className={`study-flashcard-turn relative w-full [transform-style:preserve-3d] ${cardShape} ${
          flipped ? "[transform:rotateY(180deg)]" : ""
        }`}
      >
        <div
          className={`study-flashcard-face study-flashcard-face-front absolute inset-0 flex flex-col rounded-2xl [backface-visibility:hidden] ${facePadding}`}
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
          {card.occlusion ? (
            <DiagramFaceContent
              key={`${card.id}:front`}
              occlusion={card.occlusion}
              header={card.front}
              side="front"
              onReveal={onReveal}
            />
          ) : (
            <FlashcardFaceContent text={card.front} image={card.frontImage} side="front" />
          )}
          <div className="text-center text-xs font-medium opacity-60">
            {isWholeDiagramGroupId(card.occlusion?.groupId)
              ? "The card turns once every label is uncovered"
              : "Tap anywhere on the card or press Space to reveal"}
          </div>
        </div>
        {/*
          backface-visibility hides the answer visually but leaves it in the
          accessibility tree and in find-in-page, so an unflipped card would
          read out its own answer. inert and aria-hidden take it out of both
          until the flip.
        */}
        <div
          className={`study-flashcard-face study-flashcard-face-back absolute inset-0 flex flex-col rounded-2xl [backface-visibility:hidden] [transform:rotateY(180deg)] ${facePadding}`}
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
          {card.occlusion ? (
            // Keyed on the card so "Show every label" never carries over to the next one.
            <DiagramFaceContent
              key={`${card.id}:back`}
              occlusion={card.occlusion}
              header={card.front}
              side="back"
            />
          ) : (
            <FlashcardFaceContent text={card.back} image={card.backImage} side="back" />
          )}
          <div className="text-center text-xs font-medium opacity-60">
            {answerHint}
          </div>
        </div>
      </div>
    </div>
  );
}
