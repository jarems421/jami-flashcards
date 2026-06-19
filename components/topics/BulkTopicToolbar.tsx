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
  disabled = false,
  onSelectAll,
  onTopicIdsChange,
  onTopicsChange,
  onApply,
  onClearSelection,
}: BulkTopicToolbarProps) {
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
            />
          </div>
        </div>
        <div className="grid shrink-0 gap-2 sm:flex sm:flex-wrap">
          <Button type="button" size="sm" variant="ghost" disabled={disabled || visibleCount === 0} onClick={onSelectAll}>
            Select visible
          </Button>
          <Button type="button" size="sm" variant="secondary" disabled={disabled || selectedCount === 0 || topicIds.length === 0} onClick={onApply}>
            Apply Topics
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={disabled || selectedCount === 0} onClick={onClearSelection}>
            Clear selection
          </Button>
        </div>
      </div>
    </div>
  );
}
