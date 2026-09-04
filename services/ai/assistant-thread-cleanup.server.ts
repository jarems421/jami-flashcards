import "server-only";

import {
  isOwnedAssistantImagePath,
} from "@/lib/ai/assistant-illustrations";
import { normalizeAssistantIllustrations } from "@/lib/ai/jami-assistant";
import { getAdminDb, getAdminStorageBucket } from "@/services/firebase/admin";

/** Firestore caps a batch at 500 operations. */
const DELETE_BATCH_LIMIT = 400;

/**
 * How long a chat survives without being added to.
 *
 * Long enough that coming back to a problem after a fortnight still finds the
 * conversation, short enough that a year of abandoned one-question threads does
 * not accumulate against an account forever. Measured from the last message
 * rather than from creation, so a thread in active use is never at risk however
 * old it is.
 */
export const ASSISTANT_THREAD_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Removes one chat and everything that belongs only to it.
 *
 * Deliberately in this order: the illustrations first, because a stored image
 * whose message is already gone is unreachable and would never be cleaned up,
 * then the messages, the routing state, and the thread last. A run that fails
 * part way therefore leaves a thread that still opens rather than a header with
 * no conversation under it.
 */
export async function deleteAssistantThread(uid: string, threadId: string) {
  const db = getAdminDb();
  const userRef = db.collection("users").doc(uid);
  const threadRef = userRef.collection("assistantThreads").doc(threadId);

  const messages = await userRef
    .collection("assistantMessages")
    .where("threadId", "==", threadId)
    .get();

  const imagePaths = Array.from(
    new Set(
      messages.docs.flatMap((message) =>
        normalizeAssistantIllustrations(message.data().illustrations)
          .map((item) => item.storagePath)
          .filter((path) => isOwnedAssistantImagePath(path, uid))
      )
    )
  );
  await Promise.all(
    imagePaths.map((path) =>
      getAdminStorageBucket().file(path).delete({ ignoreNotFound: true })
    )
  );

  for (let offset = 0; offset < messages.docs.length; offset += DELETE_BATCH_LIMIT) {
    const batch = db.batch();
    messages.docs
      .slice(offset, offset + DELETE_BATCH_LIMIT)
      .forEach((message) => batch.delete(message.ref));
    await batch.commit();
  }

  await userRef
    .collection("assistantRouteState")
    .doc(threadId)
    .delete()
    .catch(() => undefined);
  await threadRef.delete();

  return { messagesDeleted: messages.docs.length, imagesDeleted: imagePaths.length };
}

/**
 * Which chats have gone quiet for long enough to remove.
 *
 * A collection-group query rather than a walk over every account: the great
 * majority of accounts have nothing expired at any given moment, and paying to
 * enumerate them nightly to discover that is the wrong shape of job.
 */
export async function deleteExpiredAssistantThreads(input: {
  now?: number;
  retentionMs?: number;
  limit?: number;
} = {}) {
  const now = input.now ?? Date.now();
  const cutoff = now - (input.retentionMs ?? ASSISTANT_THREAD_RETENTION_MS);
  const expired = await getAdminDb()
    .collectionGroup("assistantThreads")
    .where("updatedAt", "<", cutoff)
    .limit(input.limit ?? 200)
    .get();

  let deleted = 0;
  const failures: string[] = [];
  for (const thread of expired.docs) {
    // users/{uid}/assistantThreads/{threadId}
    const uid = thread.ref.parent.parent?.id;
    if (!uid) continue;
    try {
      await deleteAssistantThread(uid, thread.id);
      deleted += 1;
    } catch {
      // One account's failure must not stop the rest of the run; the next run
      // picks this thread up again because nothing about it has changed.
      failures.push(thread.id);
    }
  }

  return { scanned: expired.docs.length, deleted, failed: failures.length, cutoff };
}
