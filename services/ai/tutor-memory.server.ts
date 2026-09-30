import "server-only";

import { randomUUID } from "node:crypto";
import { mapJamiAssistantThread } from "@/lib/ai/jami-assistant-history";
import {
  applyTutorMemoryOperations,
  emptyTutorMemory,
  normalizeTutorMemory,
  RECENT_ACTIVITY_WINDOW_MS,
  TUTOR_MEMORY_VERSION,
  type RecentTutorActivity,
  type TutorMemoryState,
  type TutorMemoryWriteContext,
} from "@/lib/ai/tutor-memory";
import { getAdminDb } from "@/services/firebase/admin";

/**
 * Where Tutor's memory of a student lives, and how it changes.
 *
 * One document per student, read beside everything else Tutor loads for a
 * question, and written only here: by Tutor after an answer, or by the student
 * from the memory settings. The client never writes it directly, so what
 * lands in it has always passed `applyTutorMemoryOperations`.
 */

export function tutorMemoryRef(uid: string) {
  return getAdminDb().collection("users").doc(uid).collection("tutorMemory").doc("state");
}

export async function loadTutorMemory(uid: string): Promise<TutorMemoryState> {
  const snapshot = await tutorMemoryRef(uid).get();
  return snapshot.exists ? normalizeTutorMemory(snapshot.data()) : emptyTutorMemory();
}

function serialize(state: TutorMemoryState) {
  return {
    version: TUTOR_MEMORY_VERSION,
    enabled: state.enabled,
    items: state.items,
    updatedAt: state.updatedAt,
  };
}

/**
 * Reads, changes and writes the memory in one transaction, so an answer
 * finishing in one chat and a deletion in the settings cannot overwrite each
 * other. `change` returns null to leave the document untouched.
 */
export async function updateTutorMemory(
  uid: string,
  change: (state: TutorMemoryState) => TutorMemoryState | null
): Promise<TutorMemoryState> {
  const ref = tutorMemoryRef(uid);
  return getAdminDb().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.exists ? normalizeTutorMemory(snapshot.data()) : emptyTutorMemory();
    const next = change(current);
    if (!next) return current;
    transaction.set(ref, serialize(next));
    return next;
  });
}

/** What Tutor proposed in one answer, applied under the module's rules. */
export async function applyTutorMemoryFromAnswer(input: {
  uid: string;
  operations: unknown;
  context: TutorMemoryWriteContext;
  refs: ReadonlyMap<string, string>;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  let outcome = { added: 0, updated: 0, forgotten: 0, rejected: 0 };
  await updateTutorMemory(input.uid, (state) => {
    const applied = applyTutorMemoryOperations({
      state,
      operations: input.operations,
      context: input.context,
      refs: input.refs,
      now,
      makeId: () => randomUUID(),
    });
    outcome = applied.outcome;
    return applied.changed ? applied.state : null;
  });
  return outcome;
}

/**
 * The student's most recent Tutor chats, from the chat list that already
 * exists. Only the where and the title -- never a message.
 */
export async function loadRecentTutorActivity(
  uid: string,
  now = Date.now()
): Promise<RecentTutorActivity[]> {
  const snapshot = await getAdminDb()
    .collection("users")
    .doc(uid)
    .collection("assistantThreads")
    .orderBy("updatedAt", "desc")
    .limit(8)
    .get();
  return snapshot.docs.flatMap((document) => {
    const thread = mapJamiAssistantThread(document.id, document.data() as Record<string, unknown>);
    if (!thread || now - thread.updatedAt > RECENT_ACTIVITY_WINDOW_MS) return [];
    return [{
      threadId: thread.id,
      surface: thread.surface,
      label: thread.contextLabel,
      title: thread.title,
      updatedAt: thread.updatedAt,
    }];
  });
}
