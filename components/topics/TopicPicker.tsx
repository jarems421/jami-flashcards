"use client";

import { useMemo, useState } from "react";
import type { Topic } from "@/lib/practice/topics";
import {
  MAX_LINKED_TOPICS,
  getTopicNameKey,
} from "@/lib/practice/topics";
import { createOrGetTopic } from "@/services/study/topics";
import { Button, Input } from "@/components/ui";

type TopicPickerProps = {
  userId: string;
  topics: Topic[];
  selectedTopicIds: string[];
  onChange: (topicIds: string[]) => void;
  onTopicsChange: (topics: Topic[]) => void;
  disabled?: boolean;
  label?: string;
};

export default function TopicPicker({
  userId,
  topics,
  selectedTopicIds,
  onChange,
  onTopicsChange,
  disabled = false,
  label = "Topics",
}: TopicPickerProps) {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedSet = useMemo(() => new Set(selectedTopicIds), [selectedTopicIds]);
  const normalizedQuery = getTopicNameKey(query);
  const matches = useMemo(
    () =>
      topics
        .filter(
          (topic) =>
            topic.status === "active" &&
            (!normalizedQuery ||
              (topic.normalizedName ?? getTopicNameKey(topic.name)).includes(normalizedQuery))
        )
        .slice(0, 12),
    [normalizedQuery, topics]
  );
  const canAdd = selectedTopicIds.length < MAX_LINKED_TOPICS;
  const exactMatch = topics.find(
    (topic) =>
      topic.status === "active" &&
      (topic.normalizedName ?? getTopicNameKey(topic.name)) === normalizedQuery
  );

  const toggleTopic = (topicId: string) => {
    if (selectedSet.has(topicId)) {
      onChange(selectedTopicIds.filter((id) => id !== topicId));
      return;
    }
    if (!canAdd) return;
    onChange([...selectedTopicIds, topicId]);
  };

  const createTopic = async () => {
    if (!query.trim() || !canAdd) return;
    setCreating(true);
    setError(null);
    try {
      const topic = await createOrGetTopic(userId, query);
      if (!topics.some((item) => item.id === topic.id)) {
        onTopicsChange([...topics, topic].sort((a, b) => a.name.localeCompare(b.name)));
      }
      if (!selectedSet.has(topic.id)) onChange([...selectedTopicIds, topic.id]);
      setQuery("");
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Could not create that Topic."
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-text-secondary">{label}</div>
        <span className="text-xs text-text-muted">
          {selectedTopicIds.length}/{MAX_LINKED_TOPICS}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {selectedTopicIds.map((topicId) => {
          const topic = topics.find((item) => item.id === topicId);
          return (
            <button
              key={topicId}
              type="button"
              disabled={disabled}
              onClick={() => toggleTopic(topicId)}
              className="app-selected rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            >
              {topic?.name ?? "Topic"} ×
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex gap-2">
        <Input
          aria-label={`Search or create ${label.toLowerCase()}`}
          placeholder="Search or create a topic"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          disabled={disabled}
          containerClassName="min-w-0 flex-1"
        />
        {query.trim() && !exactMatch ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={disabled || creating || !canAdd}
            onClick={() => void createTopic()}
          >
            {creating ? "Creating..." : "Create"}
          </Button>
        ) : null}
      </div>
      {query.trim() ? (
        <div className="mt-2 max-h-44 overflow-y-auto rounded-[1rem] border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-2">
          {matches.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {matches.map((topic) => (
                <button
                  key={topic.id}
                  type="button"
                  disabled={disabled || (!selectedSet.has(topic.id) && !canAdd)}
                  onClick={() => toggleTopic(topic.id)}
                  className={`rounded-full border px-3 py-2 text-sm transition disabled:opacity-45 ${
                    selectedSet.has(topic.id)
                      ? "app-selected"
                      : "app-chip hover:border-border-strong"
                  }`}
                >
                  {topic.name}
                </button>
              ))}
            </div>
          ) : (
            <p className="px-2 py-1 text-xs text-text-muted">
              Create this as a new Topic.
            </p>
          )}
        </div>
      ) : null}
      {!canAdd ? (
        <p className="mt-2 text-xs text-text-muted">
          Remove a Topic before adding another.
        </p>
      ) : null}
      {error ? (
        <p className="app-danger mt-2 rounded-[0.9rem] px-3 py-2 text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}
