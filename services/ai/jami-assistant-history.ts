import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import {
  JAMI_ASSISTANT_MAX_SAVED_THREADS,
  JAMI_ASSISTANT_MAX_THREAD_TITLE_LENGTH,
  mapJamiAssistantStoredMessage,
  mapJamiAssistantThread,
  type JamiAssistantStoredMessage,
} from "@/lib/ai/jami-assistant-history";
import { auth, db } from "@/services/firebase/client";
import { withTimeout } from "@/services/firebase/firestore";

const LOAD_MS = 30_000;

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
  const user = auth.currentUser;
  if (!user || user.uid !== userId) throw new Error("Sign in again to rename this chat.");
  const response = await fetch(
    `/api/ai/assistant/threads/${encodeURIComponent(threadId)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await user.getIdToken()}`,
      },
      body: JSON.stringify({ title: normalized }),
    }
  );
  const result = (await response.json().catch(() => null)) as {
    error?: unknown;
    title?: unknown;
  } | null;
  if (!response.ok || typeof result?.title !== "string") {
    throw new Error(
      typeof result?.error === "string" ? result.error : "That chat could not be renamed."
    );
  }
  return result.title;
}

export async function deleteJamiAssistantThread(
  userId: string,
  threadId: string
) {
  const user = auth.currentUser;
  if (!user || user.uid !== userId) throw new Error("Sign in again to delete this chat.");
  const token = await user.getIdToken();
  const response = await fetch(
    `/api/ai/assistant/threads/${encodeURIComponent(threadId)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
  );
  if (!response.ok) {
    const result = (await response.json().catch(() => null)) as { error?: unknown } | null;
    throw new Error(
      typeof result?.error === "string" ? result.error : "That chat could not be deleted."
    );
  }
}

export function toDrawerMessages(messages: JamiAssistantStoredMessage[]) {
  return messages.map((message) => ({
    role: message.role,
    text: message.text,
    used: message.used,
    followUps: message.followUps,
    citations: message.citations,
    illustrations: message.illustrations,
    canIllustrate: message.canIllustrate,
    id: message.id,
  }));
}
