import type { AnswerFeedback } from "@/lib/study/study-feedback";

const TONE_CLASS: Record<AnswerFeedback["tone"], string> = {
  error: "app-danger",
  warm: "app-warning",
  good: "app-success",
  calm: "app-chip",
};

/** The pill that acknowledges a rating without interrupting the session. */
export default function InlineStudyFeedback({
  feedback,
}: {
  feedback: AnswerFeedback | null;
}) {
  if (!feedback) return null;

  return (
    <div
      className={`mx-auto w-fit rounded-full border px-3.5 py-2 text-sm font-semibold shadow-e1 animate-fade-in ${TONE_CLASS[feedback.tone]}`}
      role="status"
      aria-live="polite"
    >
      {feedback.message}
    </div>
  );
}
