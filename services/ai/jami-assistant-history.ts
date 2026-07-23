import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import {
  createJamiAssistantThreadTitle,
  JAMI_ASSISTANT_MAX_CONTEXT_LABEL_LENGTH,
  JAMI_ASSISTANT_MAX_SAVED_MESSAGE_LENGTH,
  JAMI_ASSISTANT_MAX_SAVED_THREADS,
  JAMI_ASSISTANT_MAX_THREAD_TITLE_LENGTH,
  mapJamiAssistantStoredMessage,
  mapJamiAssistantThread,
  type JamiAssistantSavedContext,
  type JamiAssistantStoredMessage,
  type JamiAssistantThread,
} from "@/lib/ai/jami-assistant-history";
import type {
  JamiAssistantFollowUp,
  JamiAssistantUsedContext,
} from "@/lib/ai/jami-assistant";
import { db } from "@/services/firebase/client";
import { withTimeout } from "@/services/firebase/firestore";

const LOAD_MS = 30_000;
const WRITE_MS = 30_000;

function threadsCollection(userId: string) {
  return collection(db, "users", userId, "assistantThreads");
}

function messagesCollection(userId: string) {
  return collection(db, "users", userId, "assistantMessages");
}

export async function getJamiAssistantThreads(userId: string) {
  const snapshot = await withTimeout(
    getDocs(
      query(
        threadsCollection(userId),
        orderBy("updatedAt", "desc"),
        limit(JAMI_ASSISTANT_MAX_SAVED_THREADS)
      )
    ),
    LOAD_MS,
    "Load Jami chat history"
  );
  return snapshot.docs.flatMap((threadDoc) => {
    const thread = mapJamiAssistantThread(
      threadDoc.id,
      threadDoc.data() as Record<string, unknown>
    );
    return thread ? [thread] : [];
  });
}

export async function getJamiAssistantThreadMessages(
  userId: string,
  threadId: string
) {
  const snapshot = await withTimeout(
    getDocs(
      query(
        messagesCollection(userId),
        where("threadId", "==", threadId)
      )
    ),
    LOAD_MS,
    "Load Jami chat"
  );
  return snapshot.docs
    .flatMap((messageDoc) => {
      const message = mapJamiAssistantStoredMessage(
        messageDoc.id,
        messageDoc.data() as Record<string, unknown>
      );
      return message ? [message] : [];
    })
    .sort(
      (left, right) =>
        left.createdAt - right.createdAt || left.id.localeCompare(right.id)
    );
}

export async function saveJamiAssistantTurn(input: {
  userId: string;
  thread?: JamiAssistantThread;
  context: JamiAssistantSavedContext;
  contextKey: string;
  contextLabel: string;
  userMessage: string;
  assistantMessage: {
    text: string;
    used: JamiAssistantUsedContext[];
    followUps?: JamiAssistantFollowUp[];
  };
}) {
  const now = Date.now();
  const threadRef = input.thread
    ? doc(db, "users", input.userId, "assistantThreads", input.thread.id)
    : doc(threadsCollection(input.userId));
  const userMessageRef = doc(messagesCollection(input.userId));
  const assistantMessageRef = doc(messagesCollection(input.userId));
  const title =
    input.thread?.title ?? createJamiAssistantThreadTitle(input.userMessage);
  const contextLabel =
    input.contextLabel.trim().slice(0, JAMI_ASSISTANT_MAX_CONTEXT_LABEL_LENGTH) ||
    "Study context";
  const userMessage = input.userMessage
    .trim()
    .slice(0, JAMI_ASSISTANT_MAX_SAVED_MESSAGE_LENGTH);
  const assistantText = input.assistantMessage.text
    .trim()
    .slice(0, JAMI_ASSISTANT_MAX_SAVED_MESSAGE_LENGTH);
  const batch = writeBatch(db);

  batch.set(
    threadRef,
    {
      ...(input.thread
        ? {}
        : {
            title,
            surface: input.context.surface,
            context: input.context,
            contextKey: input.contextKey,
            contextLabel,
            createdAt: now,
          }),
      updatedAt: now,
      lastMessagePreview: assistantText.slice(0, 180),
      messageCount: increment(2),
    },
    { merge: true }
  );
  batch.set(userMessageRef, {
    threadId: threadRef.id,
    role: "user",
    text: userMessage,
    createdAt: now,
  });
  batch.set(assistantMessageRef, {
    threadId: threadRef.id,
    role: "assistant",
    text: assistantText,
    used: input.assistantMessage.used,
    followUps: input.assistantMessage.followUps ?? [],
    createdAt: now + 1,
  });
  await withTimeout(batch.commit(), WRITE_MS, "Save Jami chat");

  return {
    id: threadRef.id,
    title,
    surface: input.context.surface,
    contextKey: input.contextKey,
    contextLabel,
    context: input.context,
    lastMessagePreview: assistantText.slice(0, 180),
    messageCount: (input.thread?.messageCount ?? 0) + 2,
    createdAt: input.thread?.createdAt ?? now,
    updatedAt: now,
  } satisfies JamiAssistantThread;
}

export async function renameJamiAssistantThread(
  userId: string,
  threadId: string,
  title: string
) {
  const normalized = title
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, JAMI_ASSISTANT_MAX_THREAD_TITLE_LENGTH);
  if (!normalized) throw new Error("Enter a chat name.");
  await withTimeout(
    updateDoc(doc(db, "users", userId, "assistantThreads", threadId), {
      title: normalized,
      updatedAt: Date.now(),
    }),
    WRITE_MS,
    "Rename Jami chat"
  );
  return normalized;
}

export async function deleteJamiAssistantThread(
  userId: string,
  threadId: string
) {
  const snapshot = await withTimeout(
    getDocs(
      query(
        messagesCollection(userId),
        where("threadId", "==", threadId)
      )
    ),
    LOAD_MS,
    "Load Jami chat for deletion"
  );
  for (let offset = 0; offset < snapshot.docs.length; offset += 400) {
    const batch = writeBatch(db);
    snapshot.docs
      .slice(offset, offset + 400)
      .forEach((messageDoc) => batch.delete(messageDoc.ref));
    await withTimeout(batch.commit(), WRITE_MS, "Delete Jami messages");
  }
  await withTimeout(
    deleteDoc(doc(db, "users", userId, "assistantThreads", threadId)),
    WRITE_MS,
    "Delete Jami chat"
  );
}

export function toDrawerMessages(messages: JamiAssistantStoredMessage[]) {
  return messages.map((message) => ({
    role: message.role,
    text: message.text,
    used: message.used,
    followUps: message.followUps,
  }));
}
