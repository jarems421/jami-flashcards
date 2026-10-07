"use client";

/** How Jami processes a request, above the composer until the student has read it. */
export default function TutorAiPrivacyNotice({
  floating,
  onDismiss,
}: {
  /** Floating, the notice scrolls and gives way first, so the composer always fits the card. */
  floating: boolean;
  onDismiss: () => void;
}) {
  return (
    <div className={`mx-5 mb-0 rounded-xl border border-accent/20 bg-accent/8 px-3.5 py-3 text-xs leading-5 text-text-secondary sm:mx-7 ${floating ? "max-h-32 min-h-[4.5rem] overflow-y-auto" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <p>
          When you use Jami, relevant work may be processed through OpenRouter
          by Xiaomi, MiniMax or Moonshot under no-retention controls. Google
          handles source documents, optional web checks and visuals. Web search
          is used only when current or course-specific information needs
          checking, and private student work is never put into a search query.
          When you submit a formal paper, Jami keeps a private frozen copy of
          the paper, marking guide and your answers until that attempt is deleted
          so marking and later rechecks use the same evidence.
          This notice explains how Jami processes a request. Avoid personal details
          and check important answers because AI can make mistakes.
        </p>
        <button
          type="button"
          className="shrink-0 font-semibold text-accent hover:underline"
          onClick={onDismiss}
        >
          I understand
        </button>
      </div>
    </div>
  );
}
