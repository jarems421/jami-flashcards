"use client";

import { useCallback, useMemo, useState } from "react";
import {
  getFeedbackErrorMessage,
  type Feedback,
} from "@/lib/app/feedback";

export type FeedbackController = {
  feedback: Feedback | null;
  success: (message: string) => void;
  showError: (message: string) => void;
  /**
   * Shows a thrown value's message, falling back when it is not an Error or
   * carries nothing readable.
   */
  showThrownError: (error: unknown, fallback: string) => void;
  clear: () => void;
  /**
   * Clears only when the banner still shows `message`, so a later success is
   * not wiped by a stale retry finishing behind it.
   */
  clearIfShowing: (message: string) => void;
};

/**
 * One page-level banner: the success and error notices every dashboard page
 * shows above its content.
 *
 * The write surface is stable, so it can sit in a dependency array without
 * rebuilding the callbacks that report into it.
 */
export function useFeedback(): FeedbackController {
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const success = useCallback((message: string) => {
    setFeedback({ type: "success", message });
  }, []);

  const showError = useCallback((message: string) => {
    setFeedback({ type: "error", message });
  }, []);

  const showThrownError = useCallback((thrown: unknown, fallback: string) => {
    setFeedback({
      type: "error",
      message: getFeedbackErrorMessage(thrown, fallback),
    });
  }, []);

  const clear = useCallback(() => setFeedback(null), []);

  const clearIfShowing = useCallback((message: string) => {
    setFeedback((current) => (current?.message === message ? null : current));
  }, []);

  return useMemo(
    () => ({
      feedback,
      success,
      showError,
      showThrownError,
      clear,
      clearIfShowing,
    }),
    [clear, clearIfShowing, feedback, showError, showThrownError, success]
  );
}
