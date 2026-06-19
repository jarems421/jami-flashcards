export type CardBrowserStatus = "all" | "due" | "weak" | "new";

export type CardBrowserState = {
  search: string;
  deckId: string;
  folderId: string;
  topicId: string;
  legacyTag: string;
  status: CardBrowserStatus;
};

export const DEFAULT_CARD_BROWSER_STATE: CardBrowserState = {
  search: "",
  deckId: "",
  folderId: "",
  topicId: "",
  legacyTag: "",
  status: "all",
};

export function getCardBrowserStateFromSearch(search: string): CardBrowserState {
  const params = new URLSearchParams(search);
  const status = params.get("status");

  return {
    search: params.get("q")?.trim() ?? "",
    deckId: params.get("deck")?.trim() ?? "",
    folderId: params.get("folder")?.trim() ?? "",
    topicId: params.get("topic")?.trim() ?? "",
    legacyTag: params.get("tag")?.trim() ?? "",
    status:
      status === "due" || status === "weak" || status === "new"
        ? status
        : "all",
  };
}

export function buildCardBrowserSearch(
  search: string,
  state: CardBrowserState
): string {
  const params = new URLSearchParams(search);

  const setOptional = (key: string, value: string) => {
    if (value) params.set(key, value);
    else params.delete(key);
  };

  setOptional("q", state.search.trim());
  setOptional("deck", state.deckId);
  setOptional("folder", state.folderId);
  setOptional("topic", state.topicId);
  setOptional("tag", state.topicId ? "" : state.legacyTag);
  params.delete("view");

  if (state.status === "all") params.delete("status");
  else params.set("status", state.status);

  const next = params.toString();
  return next ? `?${next}` : "";
}
