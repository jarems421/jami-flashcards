import "server-only";

import { FieldPath } from "firebase-admin/firestore";
import { mapCardData, type Card } from "@/lib/study/cards";
import { getAdminDb } from "@/services/firebase/admin";

/**
 * Cards per response: about a megabyte and a half of JSON before compression,
 * well inside a function's response limit however long the student's cards are.
 */
export const OWN_CARDS_PAGE_SIZE = 2_500;

export type OwnCardsPage = {
  cards: Card[];
  /** The id to read on from, or null when this page was the last. */
  nextCursor: string | null;
};

/**
 * One page of the signed-in student's own cards, in document id order.
 *
 * Read here rather than in the browser because the browser's Firestore
 * connection makes a large read slow: every card arrives in a verbose wire
 * format over long-polling and is decoded on the student's device. Five
 * thousand cards took fifteen to thirty seconds on a phone over 4G. Read beside
 * the database and sent as one compressed response, the same cards arrive in a
 * small fraction of that.
 *
 * Only ever the caller's cards: the query is bound to their uid, and a cursor
 * only moves within it.
 */
export async function readOwnCardsPage(
  uid: string,
  options: { after?: string | null; limit?: number } = {}
): Promise<OwnCardsPage> {
  const limit = Math.max(1, Math.min(OWN_CARDS_PAGE_SIZE, options.limit ?? OWN_CARDS_PAGE_SIZE));
  let query = getAdminDb()
    .collection("cards")
    .where("userId", "==", uid)
    .orderBy(FieldPath.documentId())
    .limit(limit + 1);
  if (options.after) query = query.startAfter(options.after);

  const snapshot = await query.get();
  const docs = snapshot.docs.slice(0, limit);
  return {
    cards: docs.map((doc) => mapCardData(doc.id, doc.data() as Record<string, unknown>)),
    nextCursor: snapshot.docs.length > limit ? (docs.at(-1)?.id ?? null) : null,
  };
}
