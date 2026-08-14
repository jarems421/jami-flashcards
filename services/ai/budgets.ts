import "server-only";

import {
  AI_BUDGETS,
  type AiBudgetAction,
  type AiBudgetDecision,
  type AiBudgetGrant,
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
  /** Durable jobs may queue the remaining daily allowance in one interaction. */
  skipBurstLimit?: boolean;
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

    const burstSnapshot = input.skipBurstLimit
      ? null
      : burstDocId === dailyDocId
        ? dailySnapshot
        : await transaction.get(burstRef);
    const burstData = burstSnapshot?.data();
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

    if (!input.skipBurstLimit && burstCount >= config.burstRequestLimit) {
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
      ...(!input.skipBurstLimit && burstDocId === dailyDocId
        ? {
            burstScope: config.burstScope,
            burstCount: burstCount + 1,
            burstWindowStartedAt,
          }
        : {}),
    };
    transaction.set(dailyRef, dailyUpdate, { merge: true });

    if (!input.skipBurstLimit && burstDocId !== dailyDocId) {
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

    return {
      allowed: true,
      reason: null,
      retryAfterSeconds: 0,
      grant: {
        uid: input.uid,
        action: input.action,
        dayKey,
        burstWindowStartedAt,
        burstCharged: !input.skipBurstLimit,
      },
    };
  });
}

/**
 * Gives a charged request back.
 *
 * A request was charged the moment it was allowed, and nothing ever handed it
 * back -- so a provider timeout or a reader who closed the drawer still cost
 * one of the day's forty, with nothing to show for it. Only counters that
 * still match the grant are touched, so a refund arriving after the burst
 * window has rolled cannot put the new window into credit.
 */
export async function refundAiBudget(grant: AiBudgetGrant) {
  const config = AI_BUDGETS[grant.action];
  const db = getAdminDb();
  const budgets = db.collection("aiBudgets");
  const dailyDocId = `${grant.uid}:${grant.action}:${grant.dayKey}`;
  const burstDocId = `${grant.uid}:${config.burstScope}:${grant.dayKey}`;
  const dailyRef = budgets.doc(dailyDocId);
  const burstRef = budgets.doc(burstDocId);

  await db.runTransaction(async (transaction) => {
    const dailySnapshot = await transaction.get(dailyRef);
    const burstSnapshot =
      burstDocId === dailyDocId
        ? dailySnapshot
        : await transaction.get(burstRef);
    const dailyData = dailySnapshot.data();
    const burstData = burstSnapshot.data();

    const count = getNonNegativeInteger(dailyData?.count);
    const burstCount = getNonNegativeInteger(burstData?.burstCount);
    const refundsBurst =
      grant.burstCharged !== false &&
      burstData?.burstWindowStartedAt === grant.burstWindowStartedAt &&
      burstCount > 0;

    if (count > 0) {
      transaction.set(
        dailyRef,
        {
          count: count - 1,
          updatedAt: Date.now(),
          ...(refundsBurst && burstDocId === dailyDocId
            ? { burstCount: burstCount - 1 }
            : {}),
        },
        { merge: true }
      );
    }

    if (refundsBurst && burstDocId !== dailyDocId) {
      transaction.set(
        burstRef,
        { burstCount: burstCount - 1, updatedAt: Date.now() },
        { merge: true }
      );
    }
  });
}

const DAILY_LIMIT_MESSAGES: Record<AiBudgetAction, string> = {
  assistant: "Jami has reached today's AI limit. Try again tomorrow.",
  tutorIllustration:
    "Jami has reached today's illustration limit. Try again tomorrow.",
  practicePaperGeneration:
    "Jami has reached today's practice-paper generation limit. Try again tomorrow.",
  practicePaperMarking:
    "Jami has reached today's paper-marking limit. Try again tomorrow.",
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
