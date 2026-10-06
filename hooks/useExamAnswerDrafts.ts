"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { saveExamAnswerDraft } from "@/services/study/exam-practice";

const DRAFT_SAVE_MS = 700;

export type ExamDraftSaveState = "idle" | "saving" | "saved" | "failed";

/**
 * The typed answers of a session, saved as they are written.
 *
 * One draft per attempt, never one unqualified answer string. With a single
 * answer the autosave could observe the new attempt's id beside the previous
 * question's text -- normally the next render fixed it, but a page hide inside
 * that window wrote one question's answer onto another, and it survived a
 * reload. Keyed by attempt there is no pairing to get wrong, and coming back to
 * a question still shows what was typed.
 *
 * The text itself lives in refs: every keystroke used to set state on the page,
 * re-rendering the whole session for a box that only needed its own text.
 * State changes only when an answer goes from empty to written or back.
 */
export function useExamAnswerDrafts({ sessionId }: { sessionId: string }) {
  const latestDrafts = useRef(new Map<string, string>());
  const pendingDrafts = useRef(new Map<string, string>());
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushing = useRef(false);
  const flushAgain = useRef(false);
  const [saveState, setSaveState] = useState<ExamDraftSaveState>("idle");
  /** Whether each attempt's latest draft has any text, once one has been typed. */
  const [typedByAttempt, setTypedByAttempt] = useState<Record<string, boolean>>({});

  const noteTyped = useCallback((attemptId: string, text: string) => {
    latestDrafts.current.set(attemptId, text);
    const hasText = text.trim().length > 0;
    setTypedByAttempt((previous) =>
      previous[attemptId] === hasText ? previous : { ...previous, [attemptId]: hasText }
    );
  }, []);

  /*
   * Drafts are flushed, not cancelled, and a failed one is kept to try again.
   *
   * A debounce that clears itself on cleanup loses whatever was typed in the
   * last three-quarters of a second every time the student changes question or
   * closes the tab -- which is exactly when they have just finished a
   * sentence. Pending text lives in a ref that outlives the render, so leaving
   * sends it. Only one flush runs at a time so a slow save cannot land after a
   * newer one and put back older text.
   */
  const flushDrafts = useCallback(
    async (options?: { keepalive?: boolean }) => {
      const takePending = () => {
        if (draftTimer.current) {
          clearTimeout(draftTimer.current);
          draftTimer.current = null;
        }
        const entries = [...pendingDrafts.current.entries()];
        pendingDrafts.current.clear();
        return entries;
      };
      if (flushing.current) {
        if (draftTimer.current) {
          clearTimeout(draftTimer.current);
          draftTimer.current = null;
        }
        flushAgain.current = true;
        return;
      }
      // A flush asked for while one was running sends what has queued since.
      for (let entries = takePending(); entries.length > 0; entries = takePending()) {
        flushing.current = true;
        setSaveState("saving");
        const outcomes = await Promise.all(
          entries.map(([attemptId, text]) =>
            saveExamAnswerDraft(sessionId, attemptId, text, options)
              .then(() => true)
              .catch(() => {
                // Keep it queued rather than dropping it on the floor.
                if (!pendingDrafts.current.has(attemptId)) pendingDrafts.current.set(attemptId, text);
                return false;
              })
          )
        );
        flushing.current = false;
        setSaveState(outcomes.every(Boolean) ? "saved" : "failed");
        if (!flushAgain.current) break;
        flushAgain.current = false;
      }
    },
    [sessionId]
  );

  /** What was typed, reported by the answer box rather than kept in state here. */
  const handleDraft = useCallback(
    (attemptId: string, text: string, storedText: string) => {
      noteTyped(attemptId, text);
      // Typing back to what is stored still has to replace an edit already queued.
      if (text === storedText && !pendingDrafts.current.has(attemptId)) return;
      pendingDrafts.current.set(attemptId, text);
      if (draftTimer.current) clearTimeout(draftTimer.current);
      draftTimer.current = setTimeout(() => void flushDrafts(), DRAFT_SAVE_MS);
    },
    [flushDrafts, noteTyped]
  );

  /** A draft typed before leaving a question, for the box to open with on return. */
  const readDraft = useCallback((attemptId: string) => latestDrafts.current.get(attemptId), []);

  useEffect(() => {
    // Leaving the page is the one flush that has to outlive the document.
    const onLeave = () => void flushDrafts({ keepalive: true });
    window.addEventListener("pagehide", onLeave);
    return () => {
      window.removeEventListener("pagehide", onLeave);
      void flushDrafts();
    };
  }, [flushDrafts]);

  /**
   * Whether an attempt has an answer typed: its latest draft, or what the
   * server last stored when nothing has been typed here. A box the student has
   * just emptied has no text in it, whatever is still saved.
   */
  const hasTypedText = useCallback(
    (attemptId: string, storedText: string) => typedByAttempt[attemptId] ?? storedText.trim().length > 0,
    [typedByAttempt]
  );

  return { saveState, flushDrafts, handleDraft, readDraft, hasTypedText, noteTyped };
}
