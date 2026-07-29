import "server-only";

import { AI_BUDGETS, type AiBudgetAction } from "@/lib/ai/budgets";
import { getAdminDb } from "@/services/firebase/admin";

const DAY_MS = 24 * 60 * 60 * 1000;

function getBudgetDayKey(now = Date.now()) {
  return Math.floor(now / DAY_MS).toString();
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

/** Re-exported so a route reads its budget cap and its limit from one module. */
export { getAiTokenCap } from "@/lib/ai/budgets";
export type { AiBudgetAction };
