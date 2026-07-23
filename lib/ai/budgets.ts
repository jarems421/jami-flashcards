import "server-only";

import { getAdminDb } from "@/services/firebase/admin";

export type AiBudgetAction =
  | "chat"
  | "assistant"
  | "sourceTutorExplain"
  | "sourceFlashcardDrafts"
  | "sourcePracticeDrafts";

type AiBudgetConfig = {
  dailyRequestLimit: number;
  tokenCap: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export const AI_BUDGETS: Record<AiBudgetAction, AiBudgetConfig> = {
  chat: { dailyRequestLimit: 50, tokenCap: 8_000 },
  assistant: { dailyRequestLimit: 40, tokenCap: 8_000 },
  sourceTutorExplain: { dailyRequestLimit: 20, tokenCap: 10_000 },
  sourceFlashcardDrafts: { dailyRequestLimit: 10, tokenCap: 12_000 },
  sourcePracticeDrafts: { dailyRequestLimit: 10, tokenCap: 12_000 },
};

function getBudgetDayKey(now = Date.now()) {
  return Math.floor(now / DAY_MS).toString();
}

export function getAiTokenCap(action: AiBudgetAction) {
  return AI_BUDGETS[action].tokenCap;
}

export async function checkAiBudget(input: {
  uid: string;
  action: AiBudgetAction;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  const config = AI_BUDGETS[input.action];
  const maxRequests = config.dailyRequestLimit;
  const db = getAdminDb();
  const dayKey = getBudgetDayKey(now);
  const docRef = db.collection("aiBudgets").doc(`${input.uid}:${input.action}:${dayKey}`);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(docRef);
    const data = snapshot.data();
    const count = typeof data?.count === "number" ? data.count : 0;

    if (count >= maxRequests) {
      return false;
    }

    transaction.set(
      docRef,
      {
        uid: input.uid,
        action: input.action,
        dayKey,
        count: count + 1,
        updatedAt: now,
      },
      { merge: true }
    );

    return true;
  });
}
