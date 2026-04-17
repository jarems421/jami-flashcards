import { auth } from "@/services/firebase/client";

export type ExplanationContext = {
  deckId?: string;
  deckName?: string;
  tags?: string[];
  difficulty?: number;
  lapses?: number;
  reps?: number;
  scheduledDays?: number;
  elapsedDays?: number;
};

function getFriendlyExplanationError(status: number, message?: string) {
  if (status === 429) {
    return "AI explanations are taking a short break. Keep studying, or ask again in a little while.";
  }

  if (status === 503) {
    return "AI explanations are not available in this deployment yet.";
  }

  if (status >= 500) {
    return "AI is taking longer than usual. Keep studying, or ask again in a moment.";
  }

  return message || "AI could not explain that just now.";
}

export async function getExplanation(
  front: string,
  back: string,
  context?: ExplanationContext,
): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");

  const token = await user.getIdToken();

  const res = await fetch("/api/ai/explain", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ front, back, context }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(getFriendlyExplanationError(res.status, data?.error));
  }

  const data = await res.json();
  const text = typeof data.explanation === "string" ? data.explanation.trim() : "";
  if (!text) throw new Error("AI is taking longer than usual. Keep studying, or ask again in a moment.");
  return text;
}
