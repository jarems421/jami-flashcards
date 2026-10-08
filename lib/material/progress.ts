import type { Card } from "@/lib/study/cards";
import { getMemoryRiskInfo } from "@/lib/study/memory-risk";
import type { Source } from "@/lib/material/sources";
import type { Topic } from "@/lib/material/topics";
import type { Notebook } from "@/lib/workspace/notebooks";

export type TopicProgressSummary = {
  topic: Topic;
  cardCount: number;
  weakCardCount: number;
  dueCardCount: number;
  notebookCount: number;
  sourceCount: number;
};

/**
 * Each active Topic's cards, weak cards and due cards, weakest first.
 *
 * Cards are grouped by Topic in one pass rather than every card being checked
 * against every Topic: a student with five thousand cards across ninety Topics
 * was half a million comparisons on every render of Today.
 */
export function buildTopicProgress(input: {
  topics: Topic[];
  cards: Card[];
  sources?: Source[];
  notebooks?: Notebook[];
  now?: number;
}): TopicProgressSummary[] {
  const now = input.now ?? Date.now();
  const cardsByTopic = new Map<string, Card[]>();
  for (const card of input.cards) {
    for (const topicId of card.topicIds ?? []) {
      const topicCards = cardsByTopic.get(topicId);
      if (topicCards) topicCards.push(card);
      else cardsByTopic.set(topicId, [card]);
    }
  }

  return input.topics
    .filter((topic) => topic.status === "active")
    .map((topic) => {
      const topicCards = cardsByTopic.get(topic.id) ?? [];
      return {
        topic,
        cardCount: topicCards.length,
        weakCardCount: topicCards.filter((card) => getMemoryRiskInfo(card, now).tier === "high").length,
        dueCardCount: topicCards.filter((card) => typeof card.dueDate === "number" && card.dueDate <= now).length,
        notebookCount: (input.notebooks ?? []).filter((notebook) => notebook.topicIds.includes(topic.id)).length,
        sourceCount: (input.sources ?? []).filter((source) => source.topicIds.includes(topic.id)).length,
      };
    })
    .sort(
      (left, right) =>
        right.weakCardCount * 10 + right.dueCardCount * 4 - (left.weakCardCount * 10 + left.dueCardCount * 4)
    );
}
