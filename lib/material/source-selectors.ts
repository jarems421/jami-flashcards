import type { GeneratedContentDraft } from "@/lib/material/generated-content";
import type { Source } from "@/lib/material/sources";
import type {
  LibrarySourceStatusFilter,
  LibrarySourceTypeFilter,
} from "@/lib/study/library-navigation";

export type SourceFilters = {
  search: string;
  folderId: string;
  type: LibrarySourceTypeFilter;
  status: LibrarySourceStatusFilter;
};

/**
 * The sources the Library list should show.
 *
 * Search covers the title and whichever body a source happens to have — pasted
 * text, a link, or an uploaded filename — so a student can find a source by
 * whatever they remember about it.
 */
export function filterSources(sources: Source[], filters: SourceFilters) {
  const normalizedSearch = filters.search.trim().toLowerCase();

  return sources.filter((source) => {
    if (filters.status !== "all" && source.status !== filters.status) {
      return false;
    }
    if (filters.type !== "all" && source.type !== filters.type) return false;
    if (filters.folderId && !source.folderIds.includes(filters.folderId)) {
      return false;
    }
    if (!normalizedSearch) return true;

    return [
      source.title,
      source.contentText,
      source.externalUrl,
      source.fileName,
    ].some((value) => value?.toLowerCase().includes(normalizedSearch));
  });
}

/** Drafts still waiting on review for one source. */
export function getPendingSourceDrafts(
  drafts: GeneratedContentDraft[],
  sourceId: string | null
) {
  if (!sourceId) return [];
  return drafts.filter(
    (draft) =>
      draft.contentStatus === "draft" &&
      draft.sourceType === "source" &&
      draft.sourceId === sourceId
  );
}

/**
 * What a source has actually produced, as opposed to what is still waiting.
 *
 * Approved drafts have already become cards or notebook pages, so they are
 * counted here rather than shown in the review queue.
 */
export function getSourceMadeCounts(
  drafts: GeneratedContentDraft[],
  sourceId: string | null
) {
  const approved = sourceId
    ? drafts.filter(
        (draft) =>
          draft.contentStatus === "approved" &&
          draft.sourceType === "source" &&
          draft.sourceId === sourceId
      )
    : [];

  return {
    flashcards: approved.filter((draft) => draft.kind === "flashcard").length,
    questions: approved.filter((draft) => draft.kind !== "flashcard").length,
  };
}

/**
 * Keeps a selection pointing at something real.
 *
 * A filter change can drop whatever was selected, and showing an empty detail
 * pane beside a full list reads as breakage, so the first item stands in.
 */
export function resolveSelected<T extends { id: string }>(
  items: T[],
  selectedId: string | null
): T | null {
  return items.find((item) => item.id === selectedId) ?? items[0] ?? null;
}
