import "server-only";

import {
  AI_BUDGETS,
  type AiBudgetAction,
  type AiBudgetDecision,
} from "@/lib/ai/budgets";
import { getAdminDb } from "@/services/firebase/admin";

const DAY_MS = 24 * 60 * 60 * 1000;

function getBudgetDayKey(now = Date.now()) {
  return Math.floor(now / DAY_MS).toString();
}

function getNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

function getRetryAfterSeconds(target: number, now: number) {
  return Math.max(1, Math.ceil((target - now) / 1000));
}

export async function checkAiBudget(input: {
  uid: string;
  action: AiBudgetAction;
  now?: number;
}): Promise<AiBudgetDecision> {
  const now = input.now ?? Date.now();
  const config = AI_BUDGETS[input.action];
  const db = getAdminDb();
  const dayKey = getBudgetDayKey(now);
  const budgets = db.collection("aiBudgets");
  const dailyDocId = `${input.uid}:${input.action}:${dayKey}`;
  const burstDocId = `${input.uid}:${config.burstScope}:${dayKey}`;
  const dailyRef = budgets.doc(dailyDocId);
  const burstRef = budgets.doc(burstDocId);

  return db.runTransaction(async (transaction) => {
    const dailySnapshot = await transaction.get(dailyRef);
    const dailyData = dailySnapshot.data();
    const count = getNonNegativeInteger(dailyData?.count);

    if (count >= config.dailyRequestLimit) {
      return {
        allowed: false,
        reason: "daily_limit",
        retryAfterSeconds: getRetryAfterSeconds(
          (Number(dayKey) + 1) * DAY_MS,
          now
        ),
      };
    }

    const burstSnapshot =
      burstDocId === dailyDocId
        ? dailySnapshot
        : await transaction.get(burstRef);
    const burstData = burstSnapshot.data();
    const storedWindowStartedAt =
      typeof burstData?.burstWindowStartedAt === "number" &&
      Number.isFinite(burstData.burstWindowStartedAt)
        ? burstData.burstWindowStartedAt
        : null;
    const isCurrentWindow =
      storedWindowStartedAt !== null &&
      now >= storedWindowStartedAt &&
      now - storedWindowStartedAt < config.burstWindowMs;
    const burstWindowStartedAt = isCurrentWindow
      ? storedWindowStartedAt
      : now;
    const burstCount = isCurrentWindow
      ? getNonNegativeInteger(burstData?.burstCount)
      : 0;

    if (burstCount >= config.burstRequestLimit) {
      return {
        allowed: false,
        reason: "burst_limit",
        retryAfterSeconds: getRetryAfterSeconds(
          burstWindowStartedAt + config.burstWindowMs,
          now
        ),
      };
    }

    const dailyUpdate = {
      uid: input.uid,
      action: input.action,
      dayKey,
      count: count + 1,
      updatedAt: now,
      ...(burstDocId === dailyDocId
        ? {
            burstScope: config.burstScope,
            burstCount: burstCount + 1,
            burstWindowStartedAt,
          }
        : {}),
    };
    transaction.set(dailyRef, dailyUpdate, { merge: true });

    if (burstDocId !== dailyDocId) {
      transaction.set(
        burstRef,
        {
          uid: input.uid,
          burstScope: config.burstScope,
          dayKey,
          burstCount: burstCount + 1,
          burstWindowStartedAt,
          updatedAt: now,
        },
        { merge: true }
      );
    }

    return { allowed: true, reason: null, retryAfterSeconds: 0 };
  });
}

const DAILY_LIMIT_MESSAGES: Record<AiBudgetAction, string> = {
  assistant: "Jami has reached today's AI limit. Try again tomorrow.",
  autocompleteCard: "Jami has reached today's AI limit. Try again tomorrow.",
  sourceFlashcardDrafts: "AI budget reached for source drafts today.",
  sourcePracticeDrafts: "AI budget reached for source drafts today.",
};

export function createAiBudgetLimitResponse(
  action: AiBudgetAction,
  decision: Extract<AiBudgetDecision, { allowed: false }>
) {
  const isBurstLimit = decision.reason === "burst_limit";
  return Response.json(
    {
      error: isBurstLimit
        ? "Jami is receiving requests too quickly. Try again in a moment."
        : DAILY_LIMIT_MESSAGES[action],
      code: decision.reason,
      retryAfterSeconds: decision.retryAfterSeconds,
    },
    {
      status: 429,
      headers: isBurstLimit
        ? { "Retry-After": String(decision.retryAfterSeconds) }
        : undefined,
    }
  );
}

/** Re-exported so a route reads its budget cap and its limit from one module. */
export { getAiTokenCap } from "@/lib/ai/budgets";
export type { AiBudgetAction, AiBudgetDecision };
