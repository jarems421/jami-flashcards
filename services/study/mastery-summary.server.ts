import "server-only";

import { getAdminDb } from "@/services/firebase/admin";

export type TopicMasterySum = { topicId: string; scoreDelta: number; lastAt: number };

/**
 * Each topic's summed score from the early practice loop's mastery events.
 *
 * The sum is all Today reads from them, and a student who used that loop
 * heavily has thousands: read and added up here, they reach the browser as one
 * small number per topic instead of every event through its Firestore
 * connection.
 */
export async function readTopicMasterySums(uid: string): Promise<TopicMasterySum[]> {
  const snapshot = await getAdminDb()
    .collection("users")
    .doc(uid)
    .collection("masteryEvents")
    .select("topicId", "scoreDelta", "createdAt")
    .get();

  const sums = new Map<string, TopicMasterySum>();
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const topicId = typeof data.topicId === "string" ? data.topicId : "";
    if (!topicId) continue;
    const scoreDelta = typeof data.scoreDelta === "number" && Number.isFinite(data.scoreDelta) ? data.scoreDelta : 0;
    const createdAt = typeof data.createdAt === "number" ? data.createdAt : 0;
    const current = sums.get(topicId) ?? { topicId, scoreDelta: 0, lastAt: 0 };
    current.scoreDelta += scoreDelta;
    current.lastAt = Math.max(current.lastAt, createdAt);
    sums.set(topicId, current);
  }
  return [...sums.values()];
}
