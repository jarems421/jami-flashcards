export type CardBrowserView = "grid" | "list";
export type CardBrowserStatus = "all" | "due" | "weak" | "new";

export type CardBrowserState = {
  search: string;
  view: CardBrowserView;
  deckId: string;
  folderId: string;
  tag: string;
  status: CardBrowserStatus;
};

export const DEFAULT_CARD_BROWSER_STATE: CardBrowserState = {
  search: "",
  view: "grid",
  deckId: "",
  folderId: "",
  tag: "",
  status: "all",
};

export function getCardBrowserStateFromSearch(search: string): CardBrowserState {
  const params = new URLSearchParams(search);
  const view = params.get("view");
  const status = params.get("status");

  return {
    search: params.get("q")?.trim() ?? "",
    view: view === "list" ? "list" : "grid",
    deckId: params.get("deck")?.trim() ?? "",
    folderId: params.get("folder")?.trim() ?? "",
    tag: params.get("tag")?.trim() ?? "",
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
  setOptional("tag", state.tag);

  if (state.view === "list") params.set("view", "list");
  else params.delete("view");

  if (state.status === "all") params.delete("status");
  else params.set("status", state.status);

  const next = params.toString();
  return next ? `?${next}` : "";
}
