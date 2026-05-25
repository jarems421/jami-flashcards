import type { Card } from "@/lib/study/cards";
import { getMemoryRiskInfo } from "@/lib/study/memory-risk";
import type { MasteryEvent } from "@/lib/practice/mastery";
import type { Source } from "@/lib/practice/sources";
import type { Topic } from "@/lib/practice/topics";
import type { StudyFolder } from "@/lib/workspace/study-folders";
import type { Notebook } from "@/lib/workspace/notebooks";

export type TopicProgressSummary = {
  topic: Topic;
  cardCount: number;
  weakCardCount: number;
  dueCardCount: number;
  notebookCount: number;
  sourceCount: number;
  folderCount: number;
  masteryScore: number;
};

export function buildTopicProgress(input: {
  topics: Topic[];
  cards: Card[];
  masteryEvents: MasteryEvent[];
  sources?: Source[];
  notebooks?: Notebook[];
  studyFolders?: StudyFolder[];
  now?: number;
}): TopicProgressSummary[] {
  const now = input.now ?? Date.now();

  return input.topics
    .filter((topic) => topic.status === "active")
    .map((topic) => {
      const topicCards = input.cards.filter((card) =>
        Array.isArray((card as Card & { topicIds?: unknown }).topicIds) &&
        ((card as Card & { topicIds?: string[] }).topicIds ?? []).includes(topic.id)
      );
      const weakCards = topicCards.filter((card) => {
        const risk = getMemoryRiskInfo(card, now);
        return risk.tier === "high" || (typeof card.dueDate === "number" && card.dueDate <= now);
      });
      const dueCardCount = topicCards.filter(
        (card) => typeof card.dueDate === "number" && card.dueDate <= now
      ).length;
      const masteryScore = input.masteryEvents
        .filter((event) => event.topicId === topic.id)
        .reduce((sum, event) => sum + (event.scoreDelta ?? 0), 0);
      const notebookCount = (input.notebooks ?? []).filter((notebook) =>
        notebook.topicIds.includes(topic.id)
      ).length;
      const sourceCount = (input.sources ?? []).filter((source) =>
        source.topicIds.includes(topic.id)
      ).length;
      const folderCount = (input.studyFolders ?? []).filter((folder) =>
        folder.topicIds.includes(topic.id)
      ).length;

      return {
        topic,
        cardCount: topicCards.length,
        weakCardCount: weakCards.length,
        dueCardCount,
        notebookCount,
        sourceCount,
        folderCount,
        masteryScore,
      };
    })
    .sort((left, right) => {
      const leftWeakness = left.weakCardCount * 10 + left.dueCardCount * 4 - left.masteryScore;
      const rightWeakness = right.weakCardCount * 10 + right.dueCardCount * 4 - right.masteryScore;
      return rightWeakness - leftWeakness;
    });
}
