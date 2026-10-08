import "server-only";

import { featureFlags } from "@/lib/app/feature-flags";
import { mapJamiAssistantThread } from "@/lib/ai/jami-assistant-history";
import {
  findTutorRecallExchanges,
  formatTutorRecallReference,
  type TutorRecallMessage,
  type TutorRecallThread,
} from "@/lib/ai/tutor-chat-recall";
import type { createLogger } from "@/lib/observability/logger";
import { getAdminDb } from "@/services/firebase/admin";
import { loadTutorMemory } from "@/services/ai/tutor-memory.server";

/**
 * Messages read from the student's other chats, newest first. Enough to reach
 * back a few weeks for most students, and a bounded read for any of them.
 */
const OTHER_CHAT_MESSAGE_LIMIT = 600;
const OTHER_CHAT_THREAD_LIMIT = 50;
/** Recall improves an answer and never holds one up past this. */
const RECALL_BUDGET_MS = 2_500;

export type TutorChatRecall = { text: string; found: number };

/**
 * Searches what a student referred back to, for one request that asked.
 *
 * The current chat's earlier turns come from the route, which has already read
 * them. Other chats are read only while Tutor memory is on for this student:
 * remembering across chats is what memory is, and turning it off turns this
 * off too. A slow or failed read returns null and the answer goes ahead
 * without it.
 */
export async function loadTutorChatRecall(input: {
  uid: string;
  message: string;
  currentThreadId?: string;
  earlierInThread: readonly TutorRecallMessage[];
  currentThreadTitle?: string;
  deadlineAt: number;
  log: ReturnType<typeof createLogger>;
}): Promise<TutorChatRecall | null> {
  if (!featureFlags.enableTutorChatRecall) return null;
  const startedAt = Date.now();
  const budget = Math.min(RECALL_BUDGET_MS, input.deadlineAt - startedAt);
  if (budget <= 0) return null;

  const loading =
    featureFlags.enableTutorMemory
      ? loadOtherChats(input.uid, input.currentThreadId)
      : Promise.resolve({ messages: [] as TutorRecallMessage[], threads: [] as TutorRecallThread[] });
  loading.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const settled = await Promise.race([
      loading,
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), budget);
      }),
    ]);
    if (settled === "timeout") {
      input.log.warn("tutor_recall.timed_out", { budgetMs: budget });
      return null;
    }
    const candidates = [...input.earlierInThread, ...settled.messages];
    const exchanges = findTutorRecallExchanges({
      message: input.message,
      candidates,
      ...(input.currentThreadId ? { currentThreadId: input.currentThreadId } : {}),
    });
    const threads: TutorRecallThread[] = [
      ...settled.threads,
      ...(input.currentThreadId
        ? [{ id: input.currentThreadId, title: input.currentThreadTitle ?? "", contextLabel: "", updatedAt: startedAt }]
        : []),
    ];
    input.log.info("tutor_recall.searched", {
      // Counts only, never what was said.
      searched: candidates.length,
      otherChats: settled.threads.length,
      found: exchanges.length,
      latencyMs: Date.now() - startedAt,
    });
    return {
      text: formatTutorRecallReference({
        exchanges,
        threads,
        ...(input.currentThreadId ? { currentThreadId: input.currentThreadId } : {}),
      }),
      found: exchanges.length,
    };
  } catch (error) {
    input.log.warn("tutor_recall.failed", { error, latencyMs: Date.now() - startedAt });
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function loadOtherChats(uid: string, currentThreadId?: string) {
  const userRef = getAdminDb().collection("users").doc(uid);
  const [memory, threadSnapshot, messageSnapshot] = await Promise.all([
    loadTutorMemory(uid),
    userRef
      .collection("assistantThreads")
      .orderBy("updatedAt", "desc")
      .limit(OTHER_CHAT_THREAD_LIMIT)
      .get(),
    userRef
      .collection("assistantMessages")
      .orderBy("createdAt", "desc")
      .limit(OTHER_CHAT_MESSAGE_LIMIT)
      .select("threadId", "role", "text", "createdAt")
      .get(),
  ]);
  if (!memory.enabled) return { messages: [], threads: [] };
  const threads: TutorRecallThread[] = threadSnapshot.docs.flatMap((document) => {
    const thread = mapJamiAssistantThread(document.id, document.data() as Record<string, unknown>);
    return thread && thread.id !== currentThreadId
      ? [{ id: thread.id, title: thread.title, contextLabel: thread.contextLabel, updatedAt: thread.updatedAt }]
      : [];
  });
  // Only chats still in the student's list: a deleted chat's leftovers are not searched.
  const listed = new Set(threads.map((thread) => thread.id));
  const messages: TutorRecallMessage[] = messageSnapshot.docs.flatMap((document) => {
    const data = document.data();
    const threadId = typeof data.threadId === "string" ? data.threadId : "";
    const role = data.role === "user" || data.role === "assistant" ? data.role : null;
    const text = typeof data.text === "string" ? data.text : "";
    const createdAt = typeof data.createdAt === "number" ? data.createdAt : 0;
    return listed.has(threadId) && role && text
      ? [{ id: document.id, threadId, role, text, createdAt }]
      : [];
  });
  return { messages, threads };
}
