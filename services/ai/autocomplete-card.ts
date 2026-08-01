import { auth } from "@/services/firebase/client";

export type CardBackAutocompleteInput = {
  front: string;
  currentBack?: string;
  deckId?: string;
  deckName?: string;
  topics?: string[];
  topicIds?: string[];
};

function getFriendlyAutocompleteError(
  status: number,
  message?: string,
  code?: string
) {
  if (status === 429) {
    if (code === "daily_limit") {
      return "Jami has reached today's AI limit. Try again tomorrow.";
    }
    return "AI drafting is taking a short break. Keep writing, or come back in a little while.";
  }

  if (status === 503) {
    if (code === "budget_unavailable") {
      return message || "AI usage limits are temporarily unavailable. Try again shortly.";
    }
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
    const data = await res.json().catch(() => {
      // A gateway can return HTML/plain text on failure; the response status
      // still maps to a safe user-facing fallback.
      return null;
    });
    throw new Error(
      getFriendlyAutocompleteError(res.status, data?.error, data?.code)
    );
  }

  const data = await res.json();
  const back = typeof data.back === "string" ? data.back.trim() : "";
  if (!back) {
    throw new Error("AI did not return a usable answer. Keep typing, or draft again in a moment.");
  }
  return back;
}
