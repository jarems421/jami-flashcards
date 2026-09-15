import { isValidEvidenceTime } from "@/lib/learning/evidence-time";
import {
  flashcardTopicKeys,
  type FlashcardEvidenceCard,
} from "@/lib/learning/profile/flashcard-signals";
import type { LearningExposure } from "@/lib/learning/types";

/** A notebook or source in scope, reduced to its topic links and when it last changed. */
export type LearnerExposureItem = {
  kind: "notebook" | "source";
  id: string;
  topicIds: readonly string[];
  at: number;
};

export function emptyExposure(): LearningExposure {
  return { notebooks: 0, sources: 0, cards: 0 };
}

export function hasExposure(exposure: LearningExposure | undefined) {
  return Boolean(exposure && exposure.notebooks + exposure.sources + exposure.cards > 0);
}

/**
 * The material a student has on each topic, counted and never read.
 *
 * Only explicit links count: a notebook or source tagged with a Topic, a card
 * carrying one (or its deck, for an untagged card). Nothing is inferred from
 * what a file contains. Every card counts, reviewed or not, because a card
 * waiting for its first review is still material the student has.
 */
export function buildExposureByTopic(input: {
  items: readonly LearnerExposureItem[];
  cards: readonly FlashcardEvidenceCard[];
  /** Maps a topic key to the concepts it counts towards, such as its parents. Identity by default. */
  expandKeys?: (keys: readonly string[]) => string[];
}): Map<string, LearningExposure> {
  const expand = input.expandKeys ?? ((keys: readonly string[]) => [...keys]);
  const byTopic = new Map<string, LearningExposure>();
  const touch = (topicKey: string, field: "notebooks" | "sources" | "cards", at: unknown) => {
    const exposure = byTopic.get(topicKey) ?? emptyExposure();
    exposure[field] += 1;
    if (isValidEvidenceTime(at) && (exposure.lastExposedAt === undefined || at > exposure.lastExposedAt)) {
      exposure.lastExposedAt = at;
    }
    byTopic.set(topicKey, exposure);
  };

  const seenItems = new Set<string>();
  for (const item of input.items) {
    const itemKey = `${item.kind}:${item.id}`;
    if (!item.id || seenItems.has(itemKey)) continue;
    seenItems.add(itemKey);
    const keys = Array.from(new Set(item.topicIds)).filter(Boolean).map((topicId) => `topic:${topicId}`);
    for (const topicKey of new Set(expand(keys))) {
      touch(topicKey, item.kind === "notebook" ? "notebooks" : "sources", item.at);
    }
  }

  const seenCards = new Set<string>();
  for (const card of input.cards) {
    if (!card.id || seenCards.has(card.id)) continue;
    seenCards.add(card.id);
    for (const topicKey of new Set(expand(flashcardTopicKeys(card)))) {
      touch(topicKey, "cards", card.createdAt);
    }
  }
  return byTopic;
}
