import "server-only";

import type { DocumentReference } from "firebase-admin/firestore";
import { featureFlags } from "@/lib/app/feature-flags";
import {
  splitJamiAssistantHistoryWindow,
  type JamiAssistantHistoryMessage,
} from "@/lib/ai/jami-assistant";
import {
  mapJamiAssistantStoredMessage,
  mapJamiAssistantThread,
  type JamiAssistantStoredMessage,
  type JamiAssistantThread,
} from "@/lib/ai/jami-assistant-history";
import type { TutorRecallMessage } from "@/lib/ai/tutor-chat-recall";
import { readSavedTutorSuggestions, type TutorSuggestion } from "@/lib/ai/tutor-suggestion";
import { readPendingTutorCheck, type PendingTutorCheck } from "@/lib/learning/events/tutor-check";

/**
 * The saved chat a Tutor turn continues, read from the server's own copy.
 *
 * Conversation history is security-sensitive because it controls
 * supervisor/juror escalation. Browser-supplied history is ignored and the
 * server-owned thread is loaded instead; a new thread always starts with no
 * history.
 */
export type TutorTurnThread = {
  existingThread: JamiAssistantThread | null;
  conversationHistory: JamiAssistantHistoryMessage[];
  /** This chat's turns older than the history Tutor reads back; searched only on a recall. */
  earlierInThread: TutorRecallMessage[];
  /** What Tutor's previous answer in this chat offered, told to Tutor before it offers again. */
  previousSuggestions: TutorSuggestion[];
  trustedRouteState: Record<string, unknown> | null;
  /** Where a saved chat began, when it began somewhere other than here. */
  movedFromSurface: JamiAssistantThread["surface"] | null;
  /**
   * A quick check Tutor asked last turn, waiting for this message to answer it.
   * Read only from server-written route state, so a client cannot invent one.
   */
  pendingCheck: PendingTutorCheck | null;
};

/** What Tutor's newest saved answer in a chat offered, so Tutor knows before offering it again. */
function readPreviousTutorSuggestions(
  docs: readonly { id: string; data(): unknown }[]
): TutorSuggestion[] {
  let newest: JamiAssistantStoredMessage | null = null;
  for (const doc of docs) {
    const stored = mapJamiAssistantStoredMessage(doc.id, doc.data() as Record<string, unknown>);
    if (
      stored?.role === "assistant" &&
      (!newest ||
        stored.createdAt > newest.createdAt ||
        (stored.createdAt === newest.createdAt && stored.id > newest.id))
    ) {
      newest = stored;
    }
  }
  return newest ? readSavedTutorSuggestions(newest) : [];
}

/**
 * The chat this turn continues, or a new one when no thread was named.
 * Null when a thread was named and the student has no such chat.
 */
export async function loadTutorTurnThread(input: {
  userRef: DocumentReference;
  threadId?: string;
  /** Where the student is now, to tell whether the chat has moved. */
  canonicalContextKey: string;
  /** When the turn started, which a pending check's age is measured from. */
  now: number;
}): Promise<TutorTurnThread | null> {
  const { userRef } = input;
  let existingThread: JamiAssistantThread | null = null;
  let conversationHistory: JamiAssistantHistoryMessage[] = [];
  let earlierInThread: TutorRecallMessage[] = [];
  let previousSuggestions: TutorSuggestion[] = [];
  let trustedRouteState: Record<string, unknown> | null = null;
  let movedFromSurface: JamiAssistantThread["surface"] | null = null;
  if (input.threadId) {
    const threadRef = userRef
      .collection("assistantThreads")
      .doc(input.threadId);
    const [threadSnapshot, messagesSnapshot, routeStateSnapshot] =
      await Promise.all([
        threadRef.get(),
        userRef
          .collection("assistantMessages")
          .where("threadId", "==", input.threadId)
          .get(),
        userRef
          .collection("assistantRouteState")
          .doc(input.threadId)
          .get(),
      ]);
    existingThread = threadSnapshot.exists
      ? mapJamiAssistantThread(
          threadSnapshot.id,
          threadSnapshot.data() as Record<string, unknown>
        )
      : null;
    if (!existingThread) return null;
    /*
     * A chat started somewhere else carries on here: one tutor, one
     * conversation, wherever the student opens it. The dialogue comes along;
     * what the old place's route state decided -- such as a flashcard whose
     * answer was being held back -- does not, and the chat now lives here.
     */
    if (existingThread.contextKey !== input.canonicalContextKey) {
      movedFromSurface = existingThread.surface;
    }
    const storedHistory = splitJamiAssistantHistoryWindow(
      messagesSnapshot.docs
        .flatMap((messageDoc) => {
          const stored = mapJamiAssistantStoredMessage(
            messageDoc.id,
            messageDoc.data() as Record<string, unknown>
          );
          return stored ? [stored] : [];
        })
        .sort(
          (left, right) =>
            left.createdAt - right.createdAt || left.id.localeCompare(right.id)
        )
    );
    conversationHistory = storedHistory.window.map((stored) => ({
      role: stored.role === "assistant" ? ("model" as const) : ("user" as const),
      text: stored.text,
    }));
    earlierInThread = storedHistory.earlier.map((stored) => ({
      id: stored.id,
      threadId: stored.threadId,
      role: stored.role,
      text: stored.text,
      createdAt: stored.createdAt,
    }));
    previousSuggestions = readPreviousTutorSuggestions(messagesSnapshot.docs);
    trustedRouteState = routeStateSnapshot.exists && !movedFromSurface
      ? (routeStateSnapshot.data() as Record<string, unknown>)
      : null;
  }
  const pendingCheck = featureFlags.enableTutorChecks
    ? readPendingTutorCheck(trustedRouteState?.pendingCheck, input.now)
    : null;
  return {
    existingThread,
    conversationHistory,
    earlierInThread,
    previousSuggestions,
    trustedRouteState,
    movedFromSurface,
    pendingCheck,
  };
}
