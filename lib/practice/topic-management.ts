import type { GeneratedContentDraft } from "@/services/study/generated-content";
import type { Source } from "@/lib/practice/sources";
import {
  getTopicNameKey,
  normalizeTopicName,
  type Topic,
} from "@/lib/practice/topics";
import type { Card } from "@/lib/study/cards";
import { getMemoryRiskInfo } from "@/lib/study/memory-risk";
import type { Notebook } from "@/lib/workspace/notebooks";

export type TopicSummary = {
  topic: Topic;
  cardCount: number;
  notebookCount: number;
  sourceCount: number;
  draftCount: number;
  dueCardCount: number;
  weakCardCount: number;
};

export function collectMissingTopicNames(
  tagsByCard: string[][],
  existingTopics: Pick<Topic, "name">[]
) {
  const existingKeys = new Set(
    existingTopics.map((topic) => getTopicNameKey(topic.name))
  );
  const missing = new Map<string, string>();

  for (const tags of tagsByCard) {
    for (const tag of tags) {
      const name = normalizeTopicName(tag);
      const key = getTopicNameKey(name);
      if (name && !existingKeys.has(key) && !missing.has(key)) {
        missing.set(key, name);
      }
    }
  }

  return Array.from(missing.values());
}

export function buildMigratedTopicIds(
  currentTopicIds: string[],
  legacyTags: string[],
  topicIdsByNormalizedName: ReadonlyMap<string, string>
) {
  const migratedIds = legacyTags
    .map((tag) => topicIdsByNormalizedName.get(getTopicNameKey(tag)))
    .filter((topicId): topicId is string => Boolean(topicId));

  return Array.from(new Set([...currentTopicIds, ...migratedIds]));
}

export function chunkTopicWrites<T>(items: T[], size = 400) {
  if (size < 1) throw new Error("Chunk size must be positive.");
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export function buildTopicSummaries(input: {
  topics: Topic[];
  cards: Card[];
  notebooks: Notebook[];
  sources: Source[];
  drafts: GeneratedContentDraft[];
  now?: number;
}) {
  const now = input.now ?? Date.now();

  return input.topics
    .filter((topic) => topic.status === "active")
    .map((topic): TopicSummary => {
      const cards = input.cards.filter((card) => card.topicIds?.includes(topic.id));
      return {
        topic,
        cardCount: cards.length,
        notebookCount: input.notebooks.filter((item) => item.topicIds.includes(topic.id)).length,
        sourceCount: input.sources.filter((item) => item.topicIds.includes(topic.id)).length,
        draftCount: input.drafts.filter(
          (item) => item.contentStatus === "draft" && item.topicIds.includes(topic.id)
        ).length,
        dueCardCount: cards.filter(
          (card) => typeof card.dueDate === "number" && card.dueDate <= now
        ).length,
        weakCardCount: cards.filter(
          (card) => getMemoryRiskInfo(card, now).tier === "high"
        ).length,
      };
    })
    .sort((left, right) => left.topic.name.localeCompare(right.topic.name));
}
