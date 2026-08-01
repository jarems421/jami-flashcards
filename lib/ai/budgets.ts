import "server-only";

export type AiBudgetAction =
  | "autocompleteCard"
  | "assistant"
  | "sourceFlashcardDrafts"
  | "sourcePracticeDrafts";

type AiBudgetConfig = {
  dailyRequestLimit: number;
  burstRequestLimit: number;
  burstWindowMs: number;
  burstScope: "assistantInteractive" | "sourceDrafts";
  tokenCap: number;
};

export type AiBudgetLimitReason = "daily_limit" | "burst_limit";

export type AiBudgetDecision =
  | {
      allowed: true;
      reason: null;
      retryAfterSeconds: 0;
    }
  | {
      allowed: false;
      reason: AiBudgetLimitReason;
      retryAfterSeconds: number;
    };

/**
 * tokenCap is passed to the provider as maxOutputTokens. These models count
 * thinking tokens against that budget, so the caps are deliberately generous
 * relative to the requested answer length: too tight and a reply comes back
 * truncated with finishReason MAX_TOKENS instead of shorter.
 */
export const AI_BUDGETS: Record<AiBudgetAction, AiBudgetConfig> = {
  // One request here can cost up to three provider calls because the route
  // retries an incomplete draft, so the daily limit is not a call count.
  autocompleteCard: {
    dailyRequestLimit: 40,
    burstRequestLimit: 6,
    burstWindowMs: 60_000,
    burstScope: "assistantInteractive",
    tokenCap: 900,
  },
  assistant: {
    dailyRequestLimit: 40,
    burstRequestLimit: 6,
    burstWindowMs: 60_000,
    burstScope: "assistantInteractive",
    tokenCap: 8_000,
  },
  sourceFlashcardDrafts: {
    dailyRequestLimit: 10,
    burstRequestLimit: 2,
    burstWindowMs: 60_000,
    burstScope: "sourceDrafts",
    tokenCap: 12_000,
  },
  sourcePracticeDrafts: {
    dailyRequestLimit: 10,
    burstRequestLimit: 2,
    burstWindowMs: 60_000,
    burstScope: "sourceDrafts",
    tokenCap: 12_000,
  },
};

export function getAiTokenCap(action: AiBudgetAction) {
  return AI_BUDGETS[action].tokenCap;
}
