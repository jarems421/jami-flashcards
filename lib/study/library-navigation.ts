import type { SourceStatus, SourceType } from "@/lib/practice/sources";

export type LibrarySourceTypeFilter = SourceType | "all";
export type LibrarySourceStatusFilter = SourceStatus | "all";

export type LibraryBrowserState = {
  search: string;
  folderId: string;
  type: LibrarySourceTypeFilter;
  subject: string;
  recent: boolean;
  status: LibrarySourceStatusFilter;
  sourceId: string;
};

export const DEFAULT_LIBRARY_BROWSER_STATE: LibraryBrowserState = {
  search: "",
  folderId: "",
  type: "all",
  subject: "",
  recent: false,
  status: "active",
  sourceId: "",
};

function isSourceTypeFilter(value: string | null): value is SourceType {
  return (
    value === "pasted_text" ||
    value === "manual_note" ||
    value === "link" ||
    value === "file"
  );
}

export function getLibraryBrowserStateFromSearch(
  search: string
): LibraryBrowserState {
  const params = new URLSearchParams(search);
  const type = params.get("type");
  const status = params.get("status");

  return {
    search: params.get("q")?.trim() ?? "",
    folderId: params.get("folder")?.trim() ?? "",
    type: isSourceTypeFilter(type) ? type : "all",
    subject: params.get("subject")?.trim() ?? "",
    recent: params.get("recent") === "1",
    status:
      status === "archived" || status === "all" ? status : "active",
    sourceId: params.get("source")?.trim() ?? "",
  };
}

export function buildLibraryBrowserSearch(
  search: string,
  state: LibraryBrowserState
): string {
  const params = new URLSearchParams(search);
  const setOptional = (key: string, value: string) => {
    if (value) params.set(key, value);
    else params.delete(key);
  };

  setOptional("q", state.search.trim());
  setOptional("folder", state.folderId);
  setOptional("subject", state.subject);
  setOptional("source", state.sourceId);

  if (state.type === "all") params.delete("type");
  else params.set("type", state.type);

  if (state.status === "active") params.delete("status");
  else params.set("status", state.status);

  if (state.recent) params.set("recent", "1");
  else params.delete("recent");

  const next = params.toString();
  return next ? `?${next}` : "";
}
