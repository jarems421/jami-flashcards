"use client";

import type { Topic } from "@/lib/practice/topics";
import TopicPicker from "@/components/topics/TopicPicker";
import { Button } from "@/components/ui";

type BulkTopicToolbarProps = {
  userId: string;
  selectedCount: number;
  visibleCount: number;
  topicIds: string[];
  topics: Topic[];
  maxTopicsToAdd: number;
  disabled?: boolean;
  onSelectAll: () => void;
  onTopicIdsChange: (topicIds: string[]) => void;
  onTopicsChange: (topics: Topic[]) => void;
  onApply: () => void;
  onClearSelection: () => void;
};

export default function BulkTopicToolbar({
  userId,
  selectedCount,
  visibleCount,
  topicIds,
  topics,
  maxTopicsToAdd,
  disabled = false,
  onSelectAll,
  onTopicIdsChange,
  onTopicsChange,
  onApply,
  onClearSelection,
}: BulkTopicToolbarProps) {
  if (selectedCount < 2) return null;

  const overCapacity = topicIds.length > maxTopicsToAdd;

  return (
    <div className="rounded-[1.25rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-text-primary">Manage cards</div>
          <p className="mt-1 text-xs text-text-muted">
            {selectedCount} selected
          </p>
          <div className="mt-3">
            <TopicPicker
              userId={userId}
              topics={topics}
              selectedTopicIds={topicIds}
              onChange={onTopicIdsChange}
              onTopicsChange={onTopicsChange}
              disabled={disabled}
              label="Add Topics"
              maxSelections={maxTopicsToAdd}
              selectionCountLabel={`${topicIds.length} Topic${topicIds.length === 1 ? "" : "s"} selected`}
            />
            <p className="mt-2 text-xs text-text-muted">
              Up to {maxTopicsToAdd} more per card
            </p>
          </div>
        </div>
        <div className="grid shrink-0 gap-2 sm:flex sm:flex-wrap">
          <Button type="button" size="sm" variant="ghost" disabled={disabled || visibleCount === 0} onClick={onSelectAll}>
            Select visible
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={disabled || selectedCount === 0} onClick={onClearSelection}>
            Clear selection
          </Button>
          <Button type="button" size="sm" variant="secondary" disabled={disabled || topicIds.length === 0 || overCapacity} onClick={onApply}>
            Apply Topics
          </Button>
        </div>
      </div>
    </div>
  );
}
