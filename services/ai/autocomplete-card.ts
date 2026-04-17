import { auth } from "@/services/firebase/client";
import type { CardBackAutocompleteStyle } from "@/lib/ai/card-autocomplete";

export type { CardBackAutocompleteStyle };

export type CardBackAutocompleteInput = {
  front: string;
  currentBack?: string;
  deckId?: string;
  deckName?: string;
  tags?: string[];
  style?: CardBackAutocompleteStyle;
};

function getFriendlyAutocompleteError(status: number, message?: string) {
  if (status === 429) {
    return "AI drafting is taking a short break. Keep writing, or come back in a little while.";
  }

  if (status === 503) {
    return "AI drafting is not available in this deployment yet.";
  }

  if (status >= 500) {
    return message?.includes("longer")
      ? "AI is taking longer than usual. Keep typing, or draft again in a moment."
      : "AI could not finish the draft just now. Keep typing, or draft again in a moment.";
  }

  return message || "AI could not complete that request.";
}

export async function autocompleteCardBack(input: CardBackAutocompleteInput) {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");

  const token = await user.getIdToken();
  const res = await fetch("/api/ai/autocomplete-card", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(getFriendlyAutocompleteError(res.status, data?.error));
  }

  const data = await res.json();
  const back = typeof data.back === "string" ? data.back.trim() : "";
  if (!back) {
    throw new Error("AI did not return a usable answer. Keep typing, or draft again in a moment.");
  }
  return back;
}
