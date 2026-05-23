import type { Card } from "@/lib/study/cards";
import { getMemoryRiskInfo } from "@/lib/study/memory-risk";
import type { Attempt, Question } from "@/lib/practice/questions";
import type { MasteryEvent } from "@/lib/practice/mastery";
import type { Topic } from "@/lib/practice/topics";

export type TopicProgressSummary = {
  topic: Topic;
  cardCount: number;
  weakCardCount: number;
  dueCardCount: number;
  attemptCount: number;
  correctAttemptCount: number;
  accuracy: number;
  recentMistakes: string[];
  supportLevel: "Low" | "Medium" | "High";
  hintToCorrectRate: number | null;
  fullSolutionDependence: number;
  masteryScore: number;
};

function getQuestionTopicIds(question: Question | undefined) {
  return question?.topicIds ?? [];
}

function getSupportLevel(attempts: Attempt[]): TopicProgressSummary["supportLevel"] {
  if (attempts.length === 0) return "Low";
  const supported = attempts.filter((attempt) => attempt.tutorUsed || (attempt.hintsUsed ?? 0) > 0).length;
  const ratio = supported / attempts.length;
  if (ratio >= 0.6) return "High";
  if (ratio >= 0.25) return "Medium";
  return "Low";
}

export function buildTopicProgress(input: {
  topics: Topic[];
  cards: Card[];
  questions: Question[];
  attempts: Attempt[];
  masteryEvents: MasteryEvent[];
  now?: number;
}): TopicProgressSummary[] {
  const now = input.now ?? Date.now();
  const questionsById = new Map(input.questions.map((question) => [question.id, question]));

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
      const topicAttempts = input.attempts.filter((attempt) =>
        getQuestionTopicIds(questionsById.get(attempt.questionId)).includes(topic.id)
      );
      const correctAttemptCount = topicAttempts.filter((attempt) => attempt.isCorrect).length;
      const supportedCorrect = topicAttempts.filter(
        (attempt) => attempt.isCorrect && ((attempt.hintsUsed ?? 0) > 0 || attempt.tutorUsed)
      ).length;
      const supportedAttempts = topicAttempts.filter(
        (attempt) => (attempt.hintsUsed ?? 0) > 0 || attempt.tutorUsed
      ).length;
      const masteryScore = input.masteryEvents
        .filter((event) => event.topicId === topic.id)
        .reduce((sum, event) => sum + (event.scoreDelta ?? 0), 0);

      return {
        topic,
        cardCount: topicCards.length,
        weakCardCount: weakCards.length,
        dueCardCount,
        attemptCount: topicAttempts.length,
        correctAttemptCount,
        accuracy:
          topicAttempts.length > 0
            ? Math.round((correctAttemptCount / topicAttempts.length) * 100)
            : 0,
        recentMistakes: Array.from(
          new Set(
            topicAttempts
              .filter((attempt) => !attempt.isCorrect)
              .sort((left, right) => right.createdAt - left.createdAt)
              .flatMap((attempt) => attempt.mistakeLabels)
          )
        ).slice(0, 4),
        supportLevel: getSupportLevel(topicAttempts),
        hintToCorrectRate:
          supportedAttempts > 0 ? Math.round((supportedCorrect / supportedAttempts) * 100) : null,
        fullSolutionDependence: topicAttempts.filter((attempt) =>
          attempt.mistakeLabels.some((label) => label.toLowerCase().includes("full solution"))
        ).length,
        masteryScore,
      };
    })
    .sort((left, right) => {
      const leftWeakness = left.weakCardCount + (100 - left.accuracy) + left.fullSolutionDependence * 8;
      const rightWeakness = right.weakCardCount + (100 - right.accuracy) + right.fullSolutionDependence * 8;
      return rightWeakness - leftWeakness;
    });
}
