"use client";

import type { ReactNode } from "react";
import FolderAssetPicker from "@/components/workspace/FolderAssetPicker";
import FolderLoadMoreButton from "@/components/workspace/FolderLoadMoreButton";
import { Button, EmptyState, SectionHeader, Skeleton } from "@/components/ui";
import type { FolderAssetShelf } from "@/hooks/useFolderAssetShelf";

/**
 * A folder tab listing the decks or sources linked to it, with the picker for
 * adding more. While the list is loading only the placeholders show, so an
 * unread list never reads as an empty one.
 */
export default function FolderShelfSection<T extends { id: string }>({
  title,
  pickerKind,
  addLabel,
  actions,
  shelf,
  pickerLabel,
  gridClassName,
  renderItem,
  emptyTitle,
  emptyDescription,
  loadMoreLabel,
}: {
  title: string;
  pickerKind: "deck" | "source";
  addLabel: string;
  /** Further actions beside the add button. */
  actions?: ReactNode;
  shelf: FolderAssetShelf<T>;
  pickerLabel: (item: T) => string;
  gridClassName: string;
  renderItem: (item: T) => ReactNode;
  emptyTitle: string;
  emptyDescription: string;
  loadMoreLabel: string;
}) {
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <SectionHeader title={title} />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={shelf.loading}
            aria-busy={shelf.loading}
            onClick={() => void shelf.togglePicker()}
          >
            {addLabel}
          </Button>
          {actions}
        </div>
      </div>
      {shelf.loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : null}
      {shelf.pickerOpen ? (
        <FolderAssetPicker
          kind={pickerKind}
          items={shelf.available.map((item) => ({ id: item.id, label: pickerLabel(item) }))}
          busy={shelf.pickerBusy}
          onAdd={shelf.addToFolder}
        />
      ) : null}
      {shelf.loading ? null : (
        <div className={gridClassName}>
          {shelf.inFolder.length > 0 ? (
            shelf.inFolder.map(renderItem)
          ) : (
            <EmptyState title={emptyTitle} description={emptyDescription} />
          )}
        </div>
      )}
      {shelf.hasMore && !shelf.pickerOpen ? (
        <FolderLoadMoreButton
          label={loadMoreLabel}
          loading={shelf.loadingMore}
          onLoadMore={() => void shelf.loadMore()}
        />
      ) : null}
    </section>
  );
}
