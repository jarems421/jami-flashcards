import { auth } from "@/services/firebase/client";

export type PracticeTutorIntent =
  | "hint"
  | "check-working"
  | "explain-concept"
  | "show-method"
  | "full-solution"
  | "make-flashcard"
  | "similar-question";

export type PracticeTutorContext = {
  questionId: string;
  questionText: string;
  answerText?: string;
  solutionText?: string;
  topicNames?: string[];
  userAnswer?: string;
  workingText?: string;
};

function getFriendlyTutorError(status: number, message?: string) {
  if (status === 429) {
    return "Tutor budget is taking a short break. Try a smaller hint or come back shortly.";
  }

  if (status === 503) {
    return "Tutor is not configured in this deployment yet.";
  }

  if (status >= 500) {
    return "Tutor is taking longer than usual. Keep working, or try again in a moment.";
  }

  return message || "Tutor could not answer just now.";
}

export async function sendPracticeTutorMessage(input: {
  message: string;
  intent: PracticeTutorIntent;
  context: PracticeTutorContext;
  threadId?: string;
}) {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");

  const token = await user.getIdToken();
  const res = await fetch("/api/ai/practice-tutor", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(getFriendlyTutorError(res.status, data?.error));
  }

  const data = await res.json();
  const reply = typeof data.reply === "string" ? data.reply.trim() : "";
  if (!reply) throw new Error("Tutor is taking longer than usual. Try again in a moment.");

  return {
    reply,
    threadId: typeof data.threadId === "string" ? data.threadId : undefined,
    suggestedFlashcard:
      data.suggestedFlashcard &&
      typeof data.suggestedFlashcard.front === "string" &&
      typeof data.suggestedFlashcard.back === "string"
        ? {
            front: data.suggestedFlashcard.front as string,
            back: data.suggestedFlashcard.back as string,
          }
        : null,
  };
}
