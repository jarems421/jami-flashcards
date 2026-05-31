"use client";

import TagInput from "@/components/decks/TagInput";
import { Button } from "@/components/ui";

type BulkTagToolbarProps = {
  selectedCount: number;
  tags: string[];
  pendingTag: string;
  availableTags: string[];
  disabled?: boolean;
  onTagsChange: (tags: string[]) => void;
  onPendingTagChange: (value: string) => void;
  onApply: () => void;
  onClearSelection: () => void;
};

export default function BulkTagToolbar({
  selectedCount,
  tags,
  pendingTag,
  availableTags,
  disabled = false,
  onTagsChange,
  onPendingTagChange,
  onApply,
  onClearSelection,
}: BulkTagToolbarProps) {
  if (selectedCount === 0) {
    return (
      <div className="app-subtle-panel rounded-[1.35rem] px-4 py-3 text-sm leading-6">
        Select a few cards when you want to tag them together.
      </div>
    );
  }

  return (
    <div className="app-selected rounded-[1.5rem] p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-text-primary">
            {selectedCount} card{selectedCount === 1 ? "" : "s"} selected
          </div>
          <p className="mt-1 text-sm leading-6 text-text-secondary">
            Add one or more tags to every selected card at once. Existing tags stay in place.
          </p>
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
        <div className="grid shrink-0 gap-2 sm:flex sm:flex-wrap">
          <Button
            type="button"
            variant="warm"
            disabled={disabled}
            onClick={onApply}
            className="w-full sm:w-auto"
          >
            Apply tags
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={disabled}
            onClick={onClearSelection}
            className="w-full sm:w-auto"
          >
            Clear selection
          </Button>
        </div>
      </div>
    </div>
  );
}
