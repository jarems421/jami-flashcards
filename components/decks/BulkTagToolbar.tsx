"use client";

import TagInput from "@/components/decks/TagInput";
import { Button } from "@/components/ui";

type BulkTagToolbarProps = {
  selectedCount: number;
  visibleCount: number;
  tags: string[];
  pendingTag: string;
  availableTags: string[];
  disabled?: boolean;
  onSelectAll: () => void;
  onTagsChange: (tags: string[]) => void;
  onPendingTagChange: (value: string) => void;
  onApply: () => void;
  onClearSelection: () => void;
};

export default function BulkTagToolbar({
  selectedCount,
  visibleCount,
  tags,
  pendingTag,
  availableTags,
  disabled = false,
  onSelectAll,
  onTagsChange,
  onPendingTagChange,
  onApply,
  onClearSelection,
}: BulkTagToolbarProps) {
  if (selectedCount === 0) {
    return (
      <div className="app-subtle-panel flex flex-col gap-3 rounded-[1.35rem] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-text-primary">Manage cards</div>
          <p className="mt-0.5 text-xs leading-5 text-text-muted">
            Select cards to tag or manage them together.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled || visibleCount === 0}
          onClick={onSelectAll}
          className="w-full sm:w-auto"
        >
          Select all shown
        </Button>
      </div>
    );
  }

  return (
    <div className="app-selected rounded-[1.5rem] p-3 sm:p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-text-primary">Manage cards</div>
              <p className="mt-0.5 text-xs text-text-secondary">
                {selectedCount} card{selectedCount === 1 ? "" : "s"} selected
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={disabled || selectedCount >= visibleCount}
                onClick={onSelectAll}
              >
                Select all shown
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={disabled}
                onClick={onClearSelection}
              >
                Clear selection
              </Button>
            </div>
          </div>
          <div className="mt-3">
            <TagInput
              tags={tags}
              pendingTag={pendingTag}
              availableTags={availableTags}
              onTagsChange={onTagsChange}
              onPendingTagChange={onPendingTagChange}
              disabled={disabled}
            />
          </div>
        </div>
        <div className="shrink-0">
          <Button
            type="button"
            variant="warm"
            size="sm"
            disabled={disabled}
            onClick={onApply}
            className="w-full sm:w-auto"
          >
            Apply tags
          </Button>
        </div>
      </div>
    </div>
  );
}
