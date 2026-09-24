"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { JamiTutorIcon } from "@/components/ui";
import {
  MicrophoneIcon,
  SendIcon,
  StopDictationIcon,
} from "@/components/ai/JamiAssistantIcons";
import { useVoiceDictation } from "@/hooks/useVoiceDictation";
import type { PlanNotice } from "@/lib/ai/assistant-plan";
import type { RevisionPlanDraft } from "@/lib/planning/types";
import {
  draftPlanWithJami,
  PlanDraftError,
  type PlanDraftTurn,
} from "@/services/planning/plan-draft";

/**
 * A short conversation about the shape of a student's week.
 *
 * Deliberately not a wizard. A wizard asks its questions in its order and will
 * not proceed until they are answered, which is exactly wrong here: the student
 * knows their own timetable, their own exam dates and how much they can really
 * face, and the useful version is them saying so in one go and Jami fitting
 * around it.
 *
 * The composer is the one from the Tutor drawer -- a box, dictation, and a send
 * arrow -- because this is a conversation with Jami and should not look like a
 * different product. It had a labelled "Ask Jami" button in the corner, which
 * read as a form being submitted rather than a message being sent.
 *
 * What Jami has noticed sits above it as context rather than as a prescription,
 * and those lines come from the Learning Engine, not from the model: "this has
 * been slipping" is a measurement, and only the thing that counted the answers
 * may say it.
 *
 * Nothing here saves. A proposed plan opens in the ordinary builder, where every
 * part of it can be changed, and the student is the one who commits it.
 */

const OPENERS = [
  "I've got mocks in three weeks",
  "I can only do evenings",
  "Chemistry first, then biology",
];

function NoticeList({ notices }: { notices: readonly PlanNotice[] }) {
  if (notices.length === 0) {
    return (
      <p className="text-sm leading-6 text-text-secondary">
        Tell Jami what&rsquo;s coming up — it knows your subjects and what you
        study on each, so a sentence is usually enough.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-sm leading-6 text-text-secondary">
        From what you&rsquo;ve actually done so far:
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {notices.map((notice) => (
          <li
            key={`${notice.scopeKey}:${notice.detail}`}
            className="app-chip rounded-full px-3 py-1.5 text-xs"
          >
            <span className="text-text-muted">{notice.subject}</span>
            <span className="mx-1.5 text-text-muted">·</span>
            <span className="text-text-primary">{notice.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Turn({ turn }: { turn: PlanDraftTurn }) {
  const fromJami = turn.role === "jami";
  return (
    <div className={`flex ${fromJami ? "justify-start" : "justify-end"}`}>
      <p
        className={`max-w-[85%] animate-slide-up rounded-2xl px-4 py-2.5 text-sm leading-6 ${
          fromJami
            ? "app-subtle-panel text-text-primary ring-1 ring-[var(--color-accent-muted)]"
            : "bg-[var(--color-glass-medium)] text-text-primary"
        }`}
      >
        {turn.text}
      </p>
    </div>
  );
}

export default function PlanWithJami({
  notices,
  draft,
  onProposal,
  initialMessage,
}: {
  notices: readonly PlanNotice[];
  /**
   * The plan on screen beside this conversation.
   *
   * Sent with every message so Jami adjusts what is there rather than starting
   * again -- including the parts the student edited by hand, which Jami would
   * otherwise know nothing about.
   */
  draft?: RevisionPlanDraft | null;
  /** A plan Jami proposed. Nothing is saved; it lands in the preview to edit. */
  onProposal: (draft: RevisionPlanDraft) => void;
  /**
   * Something the student already said, sent as soon as the conversation opens:
   * "change the plan with Jami" on an existing plan starts here, with the
   * message they typed there.
   */
  initialMessage?: string;
}) {
  const [turns, setTurns] = useState<PlanDraftTurn[]>([]);
  const [message, setMessage] = useState("");
  const [thinking, setThinking] = useState(false);
  const [problem, setProblem] = useState("");
  const boxRef = useRef<HTMLTextAreaElement | null>(null);
  const dictation = useVoiceDictation({ onText: setMessage, onError: setProblem });

  const send = useCallback(
    async (text: string) => {
      const said = text.trim();
      if (!said || thinking) return;
      setProblem("");
      setMessage("");
      const asked: PlanDraftTurn[] = [...turns, { role: "student", text: said }];
      setTurns(asked);
      setThinking(true);
      try {
        const answer = await draftPlanWithJami({ message: said, history: turns, draft });
        setTurns([...asked, { role: "jami", text: answer.reply }]);
        if (answer.plan) onProposal(answer.plan);
      } catch (error) {
        /*
         * Never a dead end, and never a lie about why.
         *
         * Building one yourself is always right there in the panel beside this
         * one, which is what the message says. What it no longer does is say the
         * same thing to a student who needs to sign in again, one whose
         * deployment has no provider configured, and one who hit a slow minute
         * -- only the last of those is worth pressing send again for.
         */
        setProblem(
          error instanceof PlanDraftError
            ? error.message
            : "Jami couldn't answer just now. You can still build a plan yourself."
        );
        setTurns(asked);
      } finally {
        setThinking(false);
        boxRef.current?.focus();
      }
    },
    [draft, onProposal, thinking, turns]
  );

  // Once, not on every render that still carries the prop.
  const sentInitial = useRef(false);
  useEffect(() => {
    if (!initialMessage || sentInitial.current) return;
    sentInitial.current = true;
    void send(initialMessage);
  }, [initialMessage, send]);

  const submit = useCallback(() => {
    // Dictation is stopped first and its own reading used: a word the
    // recogniser settles in the same tick would otherwise be lost, because
    // `message` is a render behind at that moment.
    const text = dictation.listening ? dictation.stop() : message;
    void send(text);
  }, [dictation, message, send]);

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-warm-accent">
          <JamiTutorIcon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <NoticeList notices={notices} />
        </div>
      </div>

      {turns.length > 0 ? (
        <div className="space-y-2 border-t border-[var(--color-border)] pt-4">
          {turns.map((turn, index) => (
            <Turn key={`${turn.role}-${index}`} turn={turn} />
          ))}
          {thinking ? (
            <p className="flex items-center gap-2 px-1 text-xs text-text-muted" role="status">
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--color-accent)]"
              />
              <span>Jami is thinking…</span>
            </p>
          ) : null}
        </div>
      ) : null}

      {turns.length === 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {OPENERS.map((opener) => (
            <button
              key={opener}
              type="button"
              onClick={() => {
                setMessage((current) => (current ? `${current} ${opener}` : opener));
                boxRef.current?.focus();
              }}
              className="app-chip rounded-full px-3 py-1.5 text-xs font-medium transition hover:border-[var(--color-border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45"
            >
              {opener}
            </button>
          ))}
        </div>
      ) : null}

      {/* The Tutor drawer's composer, so a conversation with Jami looks the
          same wherever it happens. */}
      <div className="app-field rounded-2xl transition duration-normal focus-within:shadow-accent">
        <textarea
          ref={boxRef}
          rows={2}
          value={message}
          disabled={thinking}
          aria-label="Tell Jami what you're working towards"
          placeholder="When are your exams, which days can you study?"
          className="min-h-[4.5rem] w-full resize-none bg-transparent px-4 pb-1 pt-3 text-sm leading-relaxed text-text-primary outline-none placeholder:text-text-muted focus-visible:outline-none focus-visible:shadow-none disabled:cursor-not-allowed"
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <div className="flex items-center justify-end gap-1.5 px-2 pb-2">
          {dictation.supported ? (
            <button
              type="button"
              aria-label={dictation.listening ? "Stop dictating" : "Dictate your message"}
              aria-pressed={dictation.listening}
              disabled={thinking}
              className={`inline-grid h-9 w-9 place-items-center rounded-full transition duration-fast active:scale-95 disabled:cursor-not-allowed disabled:text-text-muted ${
                dictation.listening
                  ? "bg-error text-text-inverse shadow-e1 hover:brightness-110"
                  : "text-text-secondary hover:bg-[var(--color-glass-subtle)] hover:text-text-primary"
              }`}
              onClick={() => {
              if (dictation.listening) {
                dictation.stop();
                boxRef.current?.focus();
                return;
              }
              setProblem("");
              dictation.start(message);
            }}
            >
              {dictation.listening ? <StopDictationIcon /> : <MicrophoneIcon />}
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Send to Jami"
            disabled={thinking || (!message.trim() && !dictation.listening)}
            className="inline-grid h-9 w-9 place-items-center rounded-full bg-accent text-accent-on shadow-accent transition duration-fast hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:bg-[var(--color-glass-medium)] disabled:text-text-muted disabled:shadow-none"
            onClick={submit}
          >
            <SendIcon />
          </button>
        </div>
      </div>

      {dictation.listening ? (
        <p className="flex items-center gap-2 px-1 text-xs text-text-secondary" role="status">
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-error"
          />
          <span>Listening. Stop to edit what you said, or send it straight away.</span>
        </p>
      ) : null}

      {problem ? (
        <p role="alert" className="text-sm leading-6 text-[var(--color-error-text)]">
          {problem}
        </p>
      ) : null}

    </div>
  );
}
