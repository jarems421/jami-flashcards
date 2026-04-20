import { arrayUnion, doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from "@/services/firebase/client";

export type InAppNotice = {
  id: string;
  title: string;
  message: string;
  createdAt: number;
  active: boolean;
};

function normalizeInAppNotice(value: unknown): InAppNotice | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const data = value as Record<string, unknown>;
  const id = typeof data.id === "string" ? data.id.trim() : "";
  const title = typeof data.title === "string" ? data.title.trim() : "";
  const message = typeof data.message === "string" ? data.message.trim() : "";

  if (!id || !title || !message || data.active !== true) {
    return null;
  }

  return {
    id,
    title,
    message,
    active: true,
    createdAt: typeof data.createdAt === "number" ? data.createdAt : 0,
  };
}

function normalizeDismissedNoticeIds(value: unknown) {
  if (!Array.isArray(value)) {
    return new Set<string>();
  }

  return new Set(
    value.filter((entry): entry is string => typeof entry === "string")
  );
}

export async function loadActiveInAppNotice(userId: string) {
  const userRef = doc(db, "users", userId);
  const snapshot = await getDoc(userRef);

  if (!snapshot.exists()) {
    return null;
  }

  const data = snapshot.data() as Record<string, unknown>;
  const notice = normalizeInAppNotice(data.inAppNotice);
  if (!notice) {
    return null;
  }

  const dismissedIds = normalizeDismissedNoticeIds(data.dismissedInAppNoticeIds);
  return dismissedIds.has(notice.id) ? null : notice;
}

export async function dismissInAppNotice(userId: string, noticeId: string) {
  await updateDoc(doc(db, "users", userId), {
    dismissedInAppNoticeIds: arrayUnion(noticeId),
    updatedAt: Date.now(),
  });
}
