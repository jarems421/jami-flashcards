"use client";

import { formatJamiAssistantUsedContext } from "@/lib/ai/jami-assistant";
import type { JamiAssistantThread } from "@/lib/ai/jami-assistant-history";
import {
  STUDY_MATERIAL_OFFER_LABELS,
  studyMaterialKindsFor,
  type TutorChatMessage,
} from "@/lib/ai/tutor-chat-messages";
import type { TutorStudyMaterialKind } from "@/lib/ai/tutor-study-material";
import type { TutorAnswerMaterial } from "@/hooks/useTutorAnswerMaterial";
import { JamiTutorIcon } from "@/components/ui";
import AddAnswerToPageButton from "@/components/ai/AddAnswerToPageButton";
import { FloatingTutorPinButton } from "@/components/ai/JamiFloatingTutor";
import TutorAppActions from "@/components/ai/TutorAppActions";
import TutorCardSuggestions from "@/components/ai/TutorCardSuggestions";
import TutorPracticeOffer from "@/components/ai/TutorPracticeOffer";
import TutorStudyMaterialPanel from "@/components/ai/TutorStudyMaterialPanel";
import TutorStudyMaterialSetupCard from "@/components/ai/TutorStudyMaterialSetupCard";

/** What every answer in the chat can reach, from the drawer around it. */
export type TutorAnswerActionTools = {
  userId: string;
  activeThread: JamiAssistantThread | null;
  /** A chat begun elsewhere: read here, never acted on. */
  viewingForeignThread: boolean;
  floating: boolean;
  canInsertAnswer: boolean;
  addedAnswerKey: string | null;
  onAddAnswer: (message: TutorChatMessage, key: string) => void;
  onPin: (text: string) => void;
  generatingIllustrationId: string | null;
  onRequestIllustration: (input: { threadId: string; messageId: string }) => void;
  material: TutorAnswerMaterial;
  /** Only in a notebook, the one place Tutor can add pages. */
  onAddNotebookPages?: (count: number) => Promise<number>;
  onFollowUp: (prompt: string) => void;
};

/**
 * Everything under one answer: where it came from, keeping it, what Tutor
 * offers to make or do from it, and -- on the last answer -- where to go next.
 */
export default function TutorAnswerActions({
  message,
  answerKey,
  writing,
  last,
  showPracticeOffer,
  tools,
}: {
  message: TutorChatMessage;
  /** The answer's saved id, or its place in the chat before it has one. */
  answerKey: string;
  /** Still being written: nothing to add or pin yet. */
  writing: boolean;
  /** The last answer, finished: it carries the follow-ups. */
  last: boolean;
  /** Once per conversation: the first answer that carries this advice. */
  showPracticeOffer: boolean;
  tools: TutorAnswerActionTools;
}) {
  const { userId, activeThread, viewingForeignThread, material } = tools;
  const messageId = message.id;
  const started = messageId ? material.startedFor(messageId) : [];
  const materialKinds = studyMaterialKindsFor(message, started);
  const choice = messageId ? material.choiceFor(messageId) : undefined;

  return (
    <>
      {/* The pin shares the sources line rather than taking a row of its own. */}
      <div className="mt-1.5 flex items-start gap-2 px-1">
        <div className="min-w-0 flex-1 text-2xs leading-relaxed text-text-muted">
          {message.used && message.used.length > 0
            ? formatJamiAssistantUsedContext(message.used)
            : "Used: General knowledge"}
        </div>
        {tools.canInsertAnswer && !writing ? (
          <AddAnswerToPageButton
            added={tools.addedAnswerKey === answerKey}
            onAdd={() => tools.onAddAnswer(message, answerKey)}
          />
        ) : null}
        {tools.floating && !writing ? (
          <FloatingTutorPinButton onPin={() => tools.onPin(message.text)} />
        ) : null}
      </div>
      {message.citations?.length ? (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 px-1" aria-label="Web sources">
          {message.citations.map((citation) => (
            <a
              key={citation.url}
              href={citation.url}
              target="_blank"
              rel="noreferrer"
              className="max-w-full truncate text-2xs font-medium text-accent underline-offset-2 hover:underline"
            >
              {citation.title}
            </a>
          ))}
        </div>
      ) : null}
      {message.suggestedCards?.length ? (
        <TutorCardSuggestions userId={userId} cards={message.suggestedCards} />
      ) : null}
      {message.practiceOffer && showPracticeOffer ? (
        <TutorPracticeOffer userId={userId} offer={message.practiceOffer} />
      ) : null}
      {/* Asked for ("what next?"), so shown on the answer that was asked. */}
      {message.nextStepOffer ? (
        <TutorPracticeOffer userId={userId} offer={message.nextStepOffer} eyebrow="Your next step" />
      ) : null}
      {message.canIllustrate &&
      !message.illustrations?.length &&
      messageId &&
      activeThread &&
      !viewingForeignThread ? (
        <div className="mt-2 px-1">
          <button
            type="button"
            disabled={tools.generatingIllustrationId !== null}
            className="rounded-full border border-accent/25 bg-accent/8 px-2.5 py-1 text-2xs font-semibold text-accent transition hover:border-accent/40 hover:bg-accent/12 disabled:cursor-wait disabled:opacity-60"
            onClick={() => {
              tools.onRequestIllustration({
                threadId: activeThread.id,
                messageId,
              });
            }}
          >
            {tools.generatingIllustrationId === messageId ? "Creating visual..." : "Show visually"}
          </button>
        </div>
      ) : null}
      {message.studyMaterialSetup &&
      messageId &&
      activeThread &&
      !viewingForeignThread &&
      materialKinds.length === 0 ? (
        <TutorStudyMaterialSetupCard
          setup={message.studyMaterialSetup}
          onMake={(kind, setupChoice) => material.makeFromSetup(messageId, kind, setupChoice)}
        />
      ) : null}
      {messageId && activeThread
        ? materialKinds.map((kind) => (
            <TutorStudyMaterialPanel
              key={`${messageId}:${kind}`}
              userId={userId}
              kind={kind}
              threadId={activeThread.id}
              messageId={messageId}
              focus={
                choice?.kind === kind
                  ? choice.choice.focus
                  : message.studyMaterialRequest?.kind === kind
                    ? message.studyMaterialRequest.focus
                    : undefined
              }
              {...(choice?.kind === kind ? { choice: choice.choice } : {})}
              result={message.studyMaterialResults?.[kind]}
              readOnly={viewingForeignThread}
              // Offers always start on the press; a request only in the sitting it was made.
              autoStart={Boolean(message.fresh) || started.includes(kind)}
              getContext={material.getStudyMaterialContext}
              onResult={(result) => material.recordStudyMaterialResult(messageId, result)}
            />
          ))
        : null}
      {messageId && message.appActions?.length ? (
        <TutorAppActions
          userId={userId}
          messageKey={messageId}
          actions={message.appActions}
          scope={message.appScope ?? {}}
          fresh={Boolean(message.fresh)}
          readOnly={viewingForeignThread}
          onAddNotebookPages={tools.onAddNotebookPages}
        />
      ) : null}
      {last ? <TutorAnswerNextSteps message={message} materialKinds={materialKinds} tools={tools} /> : null}
    </>
  );
}

/** Follow-up questions, and offers to make material, under the last answer. */
function TutorAnswerNextSteps({
  message,
  materialKinds,
  tools,
}: {
  message: TutorChatMessage;
  materialKinds: readonly TutorStudyMaterialKind[];
  tools: TutorAnswerActionTools;
}) {
  const messageId = message.id;
  const offers =
    messageId && tools.activeThread && !tools.viewingForeignThread
      ? (message.studyMaterialOffers ?? []).filter((kind) => !materialKinds.includes(kind))
      : [];
  if (!message.followUps?.length && offers.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5 px-1">
      {message.followUps?.map((followUp) => (
        <button
          key={`${followUp.label}:${followUp.prompt}`}
          type="button"
          className="rounded-full border border-[var(--color-border)] px-2.5 py-1 text-2xs font-medium text-text-muted transition duration-fast hover:border-border-strong hover:bg-[var(--color-glass-subtle)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
          onClick={() => tools.onFollowUp(followUp.prompt)}
        >
          {followUp.label}
        </button>
      ))}
      {/*
        Offers to make something, set apart from the prompts beside them:
        those ask Tutor a question, these make material to keep.
      */}
      {messageId
        ? offers.map((kind) => (
            <button
              key={`offer:${kind}`}
              type="button"
              className="inline-flex items-center gap-1 rounded-full border border-accent/25 bg-accent/8 px-2.5 py-1 text-2xs font-semibold text-accent transition duration-fast hover:border-accent/40 hover:bg-accent/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
              onClick={() => tools.material.startStudyMaterial(messageId, kind)}
            >
              <JamiTutorIcon className="h-3 w-3" />
              {STUDY_MATERIAL_OFFER_LABELS[kind]}
            </button>
          ))
        : null}
    </div>
  );
}
