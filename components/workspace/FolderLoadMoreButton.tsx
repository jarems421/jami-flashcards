"use client";

import { Button } from "@/components/ui";

/** The next page of a folder's notebooks, decks or sources. */
export default function FolderLoadMoreButton({
  label,
  loading,
  onLoadMore,
}: {
  label: string;
  loading: boolean;
  onLoadMore: () => void;
}) {
  return (
    <div className="flex justify-center">
      <Button
        type="button"
        variant="secondary"
        disabled={loading}
        aria-busy={loading}
        onClick={onLoadMore}
      >
        {loading ? "Loading..." : label}
      </Button>
    </div>
  );
}
