import { collection, getCountFromServer, query, where } from "firebase/firestore";
import { db } from "@/services/firebase/client";
import { withTimeout } from "@/services/firebase/firestore";
import { readThroughCache, type CachedReadOptions } from "@/services/cache/read-through";
import { dueFromCounts, type DeckCardCount } from "@/lib/study/deck-counts";

const COUNT_MS = 20_000;

/**
 * How many cards a deck holds and how many are due, counted by the server.
 *
 * An aggregation costs one read per thousand cards counted rather than one per
 * card, and nothing about the cards is downloaded, so it stays fast however
 * large the deck grows.
 *
 * The due count needs the (userId, deckId, dueDate) index. Where that cannot be
 * served the total still stands, with `due` left null, so a deck never loses
 * its count because of the other one.
 */
export function getDeckCardCount(
  userId: string,
  deckId: string,
  options: CachedReadOptions = {}
): Promise<DeckCardCount> {
  return readThroughCache(
    { collection: "deckCardCount", params: deckId, userId },
    () => countDeckCards(userId, deckId, Date.now()),
    options
  );
}

async function countDeckCards(userId: string, deckId: string, now: number): Promise<DeckCardCount> {
  const deckCards = query(
    collection(db, "cards"),
    where("userId", "==", userId),
    where("deckId", "==", deckId)
  );
  const [total, scheduledLater] = await Promise.allSettled([
    withTimeout(getCountFromServer(deckCards), COUNT_MS, "Count deck cards"),
    withTimeout(
      getCountFromServer(query(deckCards, where("dueDate", ">", now))),
      COUNT_MS,
      "Count deck cards scheduled later"
    ),
  ]);
  if (total.status === "rejected") throw total.reason;

  const totalCount = total.value.data().count;
  return {
    total: totalCount,
    due:
      scheduledLater.status === "fulfilled"
        ? dueFromCounts(totalCount, scheduledLater.value.data().count)
        : null,
  };
}
