import type { Card } from "@/lib/study/cards";

export type WeakArea = {
  name: string;
  kind: "deck" | "topic";
  /** Average FSRS difficulty (0–10) across cards in this area. */
  avgDifficulty: number;
  /** Total number of times cards in this area were forgotten. */
  totalLapses: number;
  /** Number of cards analysed. */
  cardCount: number;
  /** Weighted score combining difficulty + lapse rate. Higher = weaker. */
  score: number;
};

/**
 * Analyse a set of cards and return the weakest decks and Topics,
 * ranked by a composite score of average difficulty and lapse rate.
 *
 * Only cards that have been reviewed at least once (reps > 0) are included.
 * Returns at most `limit` results (default 5).
 */
export function getWeakPoints(
  cards: Card[],
  deckNamesById: Record<string, string>,
  topicNamesById: Record<string, string> = {},
  limit = 5,
): WeakArea[] {
  const buckets = new Map<
    string,
    { kind: "deck" | "topic"; difficulties: number[]; lapses: number }
  >();

  for (const card of cards) {
    if (!card.reps || card.reps === 0) continue;

    const diff = card.difficulty ?? 0;
    const lapses = card.lapses ?? 0;

    // Deck bucket
    const deckKey = `deck:${card.deckId}`;
    const deckBucket = buckets.get(deckKey) ?? {
      kind: "deck" as const,
      difficulties: [],
      lapses: 0,
    };
    deckBucket.difficulties.push(diff);
    deckBucket.lapses += lapses;
    buckets.set(deckKey, deckBucket);

    for (const topicId of card.topicIds ?? []) {
      const topicKey = `topic:${topicId}`;
      const topicBucket = buckets.get(topicKey) ?? {
        kind: "topic" as const,
        difficulties: [],
        lapses: 0,
      };
      topicBucket.difficulties.push(diff);
      topicBucket.lapses += lapses;
      buckets.set(topicKey, topicBucket);
    }
  }

  const areas: WeakArea[] = [];

  for (const [key, bucket] of buckets) {
    const cardCount = bucket.difficulties.length;
    if (cardCount < 2) continue; // skip areas with very few cards

    const avgDifficulty =
      bucket.difficulties.reduce((s, d) => s + d, 0) / cardCount;
    const lapseRate = bucket.lapses / cardCount;

    // Weighted score: 60% difficulty (0-10) + 40% lapse rate (normalized to 0-10 scale)
    const score = avgDifficulty * 0.6 + Math.min(lapseRate, 10) * 0.4;

    const name =
      bucket.kind === "deck"
        ? deckNamesById[key.slice(5)] ?? "Unknown deck"
        : topicNamesById[key.slice(6)] ?? "Unknown Topic";

    areas.push({
      name,
      kind: bucket.kind,
      avgDifficulty,
      totalLapses: bucket.lapses,
      cardCount,
      score,
    });
  }

  areas.sort((a, b) => b.score - a.score);

  return areas.slice(0, limit);
}
