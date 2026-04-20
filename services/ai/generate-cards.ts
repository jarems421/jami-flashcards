import { auth } from "@/services/firebase/client";
import type { GeneratedCardDraft } from "@/lib/ai/card-generation";

export type GenerateCardsInput = {
  notes: string;
  deckName?: string;
  tags?: string[];
  count?: number;
};

function getFriendlyGenerateCardsError(status: number, message?: string) {
  if (status === 429) {
    return "AI card generation is taking a short break. Try again in a little while.";
  }

  if (status === 503) {
    return "AI card generation is not available in this deployment yet.";
  }

  if (status >= 500) {
    return message?.includes("longer")
      ? "AI is taking longer than usual. Try fewer notes or ask again in a moment."
      : "AI could not generate cards just now. Try trimming the notes or ask again in a moment.";
  }

  return message || "AI could not complete that request.";
}

export async function generateCardsFromNotes(input: GenerateCardsInput) {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");

  const token = await user.getIdToken();
  const res = await fetch("/api/ai/generate-cards", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });

  const data = (await res.json().catch(() => null)) as
    | { cards?: GeneratedCardDraft[]; error?: string }
    | null;

  if (!res.ok) {
    throw new Error(getFriendlyGenerateCardsError(res.status, data?.error));
  }

  const cards = Array.isArray(data?.cards)
    ? data.cards.filter(
        (card): card is GeneratedCardDraft =>
          typeof card.front === "string" &&
          card.front.trim().length > 0 &&
          typeof card.back === "string" &&
          card.back.trim().length > 0
      )
    : [];

  if (cards.length === 0) {
    throw new Error("AI did not return usable cards. Try a more structured set of notes.");
  }

  return cards;
}
