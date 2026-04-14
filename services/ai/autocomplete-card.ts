import { auth } from "@/services/firebase/client";

export type CardBackAutocompleteStyle =
  | "auto"
  | "definition"
  | "equation"
  | "explanation"
  | "steps"
  | "example"
  | "compare";

export type CardBackAutocompleteInput = {
  front: string;
  currentBack?: string;
  deckId?: string;
  deckName?: string;
  tags?: string[];
  style?: CardBackAutocompleteStyle;
};

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
    throw new Error(data?.error ?? `Request failed (${res.status})`);
  }

  const data = await res.json();
  const back = typeof data.back === "string" ? data.back.trim() : "";
  if (!back) throw new Error("Empty card back received");
  return back;
}
