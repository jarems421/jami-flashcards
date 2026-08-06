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
  /**
   * Ceiling on what one request may cost to *send*, or null where the input is
   * already bounded by construction.
   *
   * The daily limit bounds how many requests a student can make, not how big
   * one can be, and only the output was capped. The assistant can be handed
   * several PDFs, so one request there had no cost ceiling at all.
   */
  inputTokenCap: number | null;
};

export type AiBudgetLimitReason = "daily_limit" | "burst_limit";

/**
 * A receipt for one charged request, so it can be given back.
 *
 * It names the exact counters that were incremented. A refund that simply
 * decremented today's count could otherwise hand back a request charged in a
 * burst window that has since rolled over, which would let the next window
 * start already in credit.
 */
export type AiBudgetGrant = {
  uid: string;
  action: AiBudgetAction;
  dayKey: string;
  burstWindowStartedAt: number;
};

export type AiBudgetDecision =
  | {
      allowed: true;
      reason: null;
      retryAfterSeconds: 0;
      grant: AiBudgetGrant;
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
  // Built from one card front and a handful of nearby cards, all length-capped,
  // so the input cannot run away.
  autocompleteCard: {
    dailyRequestLimit: 40,
    burstRequestLimit: 6,
    burstWindowMs: 60_000,
    burstScope: "assistantInteractive",
    tokenCap: 900,
    inputTokenCap: null,
  },
  assistant: {
    dailyRequestLimit: 40,
    burstRequestLimit: 6,
    burstWindowMs: 60_000,
    burstScope: "assistantInteractive",
    tokenCap: 8_000,
    // Comfortably above a full set of chosen sources and well below the model's
    // window, so it only ever catches a request that is genuinely outsized.
    inputTokenCap: 250_000,
  },
  // The source text is sliced to a fixed length before it is sent.
  sourceFlashcardDrafts: {
    dailyRequestLimit: 10,
    burstRequestLimit: 2,
    burstWindowMs: 60_000,
    burstScope: "sourceDrafts",
    tokenCap: 12_000,
    inputTokenCap: null,
  },
  sourcePracticeDrafts: {
    dailyRequestLimit: 10,
    burstRequestLimit: 2,
    burstWindowMs: 60_000,
    burstScope: "sourceDrafts",
    tokenCap: 12_000,
    inputTokenCap: null,
  },
};

export function getAiTokenCap(action: AiBudgetAction) {
  return AI_BUDGETS[action].tokenCap;
}

export function getAiInputTokenCap(action: AiBudgetAction) {
  return AI_BUDGETS[action].inputTokenCap;
}
