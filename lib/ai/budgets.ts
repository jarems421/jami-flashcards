import "server-only";

export type AiBudgetAction =
  | "autocompleteCard"
  | "assistant"
  | "tutorIllustration"
  | "practicePaperGeneration"
  | "practicePaperMarking"
  | "examQuestionMarking"
  | "examQuestionReview"
  | "videoCardImport"
  | "sourceFlashcardDrafts"
  | "sourcePracticeDrafts"
  | "studyAssetGeneration"
  | "studyAnswerCheck";

type AiBudgetConfig = {
  dailyRequestLimit: number;
  burstRequestLimit: number;
  burstWindowMs: number;
  burstScope:
    | "assistantInteractive"
    | "tutorIllustrations"
    | "sourceDrafts"
    // Its own scope so preparing a deck cannot use up the allowance the
    // tutor needs to answer a question mid-session.
    | "studyModes";
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
  /** False for durable jobs intentionally excluded from short-window limits. */
  burstCharged?: boolean;
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
  tutorIllustration: {
    dailyRequestLimit: 10,
    burstRequestLimit: 3,
    burstWindowMs: 60_000,
    burstScope: "tutorIllustrations",
    // The image model can also return a short caption/alt-text payload. Image
    // bytes are billed separately by Gemini and are limited by the route.
    tokenCap: 1_024,
    inputTokenCap: null,
  },
  practicePaperGeneration: {
    dailyRequestLimit: 6,
    burstRequestLimit: 2,
    burstWindowMs: 60_000,
    burstScope: "sourceDrafts",
    tokenCap: 24_000,
    inputTokenCap: 250_000,
  },
  // Raised from 18,000 once the distribution was known: the longest supervisor
  // report logged ran to 16,491 tokens, which left 8% of headroom under the old
  // cap, and a report that hits the cap is discarded rather than shortened.
  practicePaperMarking: {
    dailyRequestLimit: 8,
    burstRequestLimit: 2,
    burstWindowMs: 60_000,
    burstScope: "sourceDrafts",
    tokenCap: 24_000,
    inputTokenCap: 250_000,
  },
  examQuestionMarking: {
    dailyRequestLimit: 60,
    burstRequestLimit: 12,
    burstWindowMs: 60_000,
    burstScope: "studyModes",
    /*
     * Sized for what the supervisor emits, not for what the report contains.
     *
     * At 8,000 this truncated 8 of 41 supervisor calls in a 40-record
     * benchmark -- one marking in six -- and every one of those was paid for in
     * full and thrown away: 18% of the run's spend bought nothing. A cap that
     * cuts a report off mid-JSON does not save the money, it wastes it.
     *
     * The report is not what needs the room. Given the identical prompt on the
     * identical question, the worker wrote its whole report in a median of
     * 1,197 tokens while the supervisor used 4,634 and reached 8,000. The
     * supervisor is a reasoning model and its thinking is billed and counted
     * against this ceiling, so a terser instruction -- the fix this file's
     * neighbour anticipated -- would trim the 1,200 and leave the rest.
     *
     * 16,000 is chosen to see the distribution rather than to fit it: the old
     * ceiling censored everything above it, so how far the tail runs is still
     * unknown. Observed generation ran near 80 tokens/second, so even a
     * maximal call lands inside the 408-second per-call timeout with room.
     * If timeouts start appearing here instead, `ROLE_OUTPUT_CEILING` is the
     * next number to revisit -- it still assumes 7,600.
     */
    tokenCap: 16_000,
    inputTokenCap: 32_000,
  },
  examQuestionReview: {
    dailyRequestLimit: 20,
    burstRequestLimit: 4,
    burstWindowMs: 60_000,
    burstScope: "studyModes",
    tokenCap: 8_000,
    inputTokenCap: 32_000,
  },
  videoCardImport: {
    dailyRequestLimit: 10,
    burstRequestLimit: 2,
    burstWindowMs: 60_000,
    burstScope: "sourceDrafts",
    tokenCap: 16_000,
    inputTokenCap: null,
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
  // One job prepares up to a hundred cards, so the daily limit is a job count
  // rather than a card count.
  //
  // This was ten a day, set when preparation was a button a student pressed on
  // a deck. It runs at the start of a session now, so the limit has to survive
  // a normal day's studying rather than a deliberate act -- and because a
  // prepared card is cached until it is edited, a returning student's session
  // spends nothing at all. Sixty is generous for new material and still a
  // ceiling on a runaway loop.
  studyAssetGeneration: {
    dailyRequestLimit: 60,
    burstRequestLimit: 10,
    burstWindowMs: 60_000,
    burstScope: "studyModes",
    tokenCap: 10_000,
    inputTokenCap: 30_000,
  },
  // Reached only when a typed prose answer is locally uncertain, so most
  // sessions never touch it. Running out costs a self-grade tap, not a broken
  // session, which is why the cap can be generous without being risky.
  studyAnswerCheck: {
    dailyRequestLimit: 150,
    burstRequestLimit: 12,
    burstWindowMs: 60_000,
    burstScope: "studyModes",
    tokenCap: 600,
    inputTokenCap: 4_000,
  },
};

export function getAiTokenCap(action: AiBudgetAction) {
  return AI_BUDGETS[action].tokenCap;
}

export function getAiInputTokenCap(action: AiBudgetAction) {
  return AI_BUDGETS[action].inputTokenCap;
}
