import { auth } from "@/services/firebase/client";

export type ChatMessage = {
  role: "user" | "model";
  text: string;
};

export type StudyChatContext = {
  mode: "clue" | "review";
  front: string;
  back: string;
  deckId?: string;
  deckName?: string;
  tags?: string[];
  difficulty?: number;
  lapses?: number;
  reps?: number;
  scheduledDays?: number;
  elapsedDays?: number;
};

export type StudyChatIntent =
  | "clue"
  | "strong-clue"
  | "self-test"
  | "explain-simple"
  | "mnemonic"
  | "why-wrong"
  | "follow-up";

function getFriendlyChatError(status: number, message?: string) {
  if (status === 429) {
    return "AI help is taking a short break. Keep studying, or ask again in a little while.";
  }

  if (status === 503) {
    return "AI help is not available in this deployment yet.";
  }

  if (status >= 500) {
    return "AI is taking longer than usual. Keep studying, or ask again in a moment.";
  }

  return message || "AI could not answer that just now.";
}

export async function sendChatMessage(
  message: string,
  history: ChatMessage[],
  studyContext?: StudyChatContext,
  intent?: StudyChatIntent,
): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");

  const token = await user.getIdToken();

  const res = await fetch("/api/ai/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ message, history, studyContext, intent }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(getFriendlyChatError(res.status, data?.error));
  }

  const data = await res.json();
  const text = typeof data.reply === "string" ? data.reply.trim() : "";
  if (!text) throw new Error("AI is taking longer than usual. Keep studying, or ask again in a moment.");
  return text;
}
