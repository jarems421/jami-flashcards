/**
 * What a student's AI use actually costs, as opposed to how often they ask.
 *
 * The budgets in `lib/ai/budgets.ts` cap requests per day, which is the wrong
 * unit for the thing that gets billed: a ninety-minute video read by an agentic
 * model and a one-line card autocomplete both count as one request. Nothing
 * anywhere summed what was spent, so the honest answer to "what does a user
 * cost" was that nobody knew.
 *
 * Tokens are recorded always. Cost is recorded only where it is genuinely
 * known -- OpenRouter reports what it charged, and that number is used as-is;
 * Gemini reports tokens only, so it is priced from the table below and left
 * unpriced when the model is not in it. An unpriced call is visible as such in
 * the report rather than being quietly counted as zero, because a spend figure
 * that silently omits a provider is worse than no figure at all.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export type AiModelPrice = {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  /**
   * Gemini bills a video's soundtrack above its frames: 2.5 Flash-Lite charges
   * three times as much for audio input. Absent, audio is billed as input.
   */
  audioInputPerMillionUsd?: number;
  /**
   * Generated image tokens, which image models bill far above their text:
   * a 1K image from 3.1 Flash Image is about $0.067 of output at $60 a million.
   */
  imageOutputPerMillionUsd?: number;
  /**
   * One grounded web search. Gemini 3 bills each search query the model runs;
   * Gemini 2.5 bills each grounded prompt, however many queries it ran.
   */
  searchUsd?: number;
};

export type AiSpendSample = {
  provider: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  /** The part of `promptTokens` that was audio. */
  audioPromptTokens?: number;
  /** The part of `completionTokens` that was a generated image. */
  imageCompletionTokens?: number;
  /** Billable web searches, counted the way the model's provider bills them. */
  searches?: number;
  /** What the provider says it charged, where it says so. */
  reportedCostUsd?: number;
};

export type AiSpendEntry = {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  /** Calls whose cost could not be established, priced or reported. */
  unpricedCalls: number;
};

export function getSpendDayKey(now = Date.now()) {
  return new Date(now - (now % DAY_MS)).toISOString().slice(0, 10);
}

/**
 * Prices per million tokens, for providers that bill without saying so.
 *
 * Deliberately empty of guesses. Populate `AI_MODEL_PRICES_JSON` in the
 * environment -- `{"gemini-2.5-flash-lite":{"in":0.1,"out":0.4}}` -- rather
 * than hardcoding numbers here, because published prices change and a stale
 * constant compiled into the app reads as authoritative when it is not.
 *
 * Optional per-model extras: `audioIn` and `imageOut` (per million tokens) and
 * `search` (per billable search). A call that used one of those without its
 * price configured is reported unpriced, never priced as if it were free.
 */
export function readModelPrices(
  env: Record<string, string | undefined>
): Record<string, AiModelPrice> {
  const raw = env.AI_MODEL_PRICES_JSON?.trim();
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const prices: Record<string, AiModelPrice> = {};
    for (const [model, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object") continue;
      const entry = value as Record<string, unknown>;
      const input = Number(entry.in ?? entry.inputPerMillionUsd);
      const output = Number(entry.out ?? entry.outputPerMillionUsd);
      if (!Number.isFinite(input) || !Number.isFinite(output)) continue;
      if (input < 0 || output < 0) continue;
      const audioInput = optionalPrice(entry.audioIn ?? entry.audioInputPerMillionUsd);
      const imageOutput = optionalPrice(entry.imageOut ?? entry.imageOutputPerMillionUsd);
      const search = optionalPrice(entry.search ?? entry.searchUsd);
      // A malformed extra makes the whole entry untrustworthy, not free.
      if (audioInput === null || imageOutput === null || search === null) continue;
      prices[model] = {
        inputPerMillionUsd: input,
        outputPerMillionUsd: output,
        ...(audioInput === undefined ? {} : { audioInputPerMillionUsd: audioInput }),
        ...(imageOutput === undefined ? {} : { imageOutputPerMillionUsd: imageOutput }),
        ...(search === undefined ? {} : { searchUsd: search }),
      };
    }
    return prices;
  } catch {
    // A malformed table must not take the AI path down with it; unpriced is
    // the safe reading, and the report says so out loud.
    return {};
  }
}

/**
 * The price for a model, matching the longest configured prefix.
 *
 * Providers version model names (`gemini-2.5-flash-lite-preview-09`), so an
 * exact-match table goes stale the first time a suffix appears. Longest prefix
 * lets one entry cover a family while a more specific entry still wins.
 */
export function findModelPrice(
  model: string,
  prices: Record<string, AiModelPrice>
): AiModelPrice | null {
  let best: { key: string; price: AiModelPrice } | null = null;
  for (const [key, price] of Object.entries(prices)) {
    if (!model.startsWith(key)) continue;
    if (!best || key.length > best.key.length) best = { key, price };
  }
  return best?.price ?? null;
}

/** Undefined when absent, null when present but unusable, else the price. */
function optionalPrice(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  const price = Number(value);
  return Number.isFinite(price) && price >= 0 ? price : null;
}

/** What a single call cost, or null when that cannot honestly be said. */
export function estimateCallCostUsd(
  sample: AiSpendSample,
  prices: Record<string, AiModelPrice>
): number | null {
  if (typeof sample.reportedCostUsd === "number" && Number.isFinite(sample.reportedCostUsd)) {
    return Math.max(0, sample.reportedCostUsd);
  }

  const price = findModelPrice(sample.model, prices);
  if (!price) return null;

  const promptTokens = Math.max(0, sample.promptTokens ?? 0);
  const completionTokens = Math.max(0, sample.completionTokens ?? 0);
  const audioTokens = Math.min(promptTokens, Math.max(0, sample.audioPromptTokens ?? 0));
  const imageTokens = Math.min(completionTokens, Math.max(0, sample.imageCompletionTokens ?? 0));
  const searches = Math.max(0, sample.searches ?? 0);
  if (!promptTokens && !completionTokens && !searches) return null;

  // Priced parts the table cannot price make the whole call unknown.
  if (imageTokens > 0 && price.imageOutputPerMillionUsd === undefined) return null;
  if (searches > 0 && price.searchUsd === undefined) return null;

  const audioRate = price.audioInputPerMillionUsd ?? price.inputPerMillionUsd;
  return (
    ((promptTokens - audioTokens) * price.inputPerMillionUsd) / 1_000_000 +
    (audioTokens * audioRate) / 1_000_000 +
    ((completionTokens - imageTokens) * price.outputPerMillionUsd) / 1_000_000 +
    (imageTokens * (price.imageOutputPerMillionUsd ?? 0)) / 1_000_000 +
    searches * (price.searchUsd ?? 0)
  );
}

export function emptySpendEntry(): AiSpendEntry {
  return { calls: 0, promptTokens: 0, completionTokens: 0, costUsd: 0, unpricedCalls: 0 };
}

/** Folds one call into a running total. Pure, so the arithmetic is testable. */
export function addCallToSpend(
  entry: AiSpendEntry,
  sample: AiSpendSample,
  prices: Record<string, AiModelPrice>
): AiSpendEntry {
  const cost = estimateCallCostUsd(sample, prices);
  return {
    calls: entry.calls + 1,
    promptTokens: entry.promptTokens + Math.max(0, sample.promptTokens ?? 0),
    completionTokens: entry.completionTokens + Math.max(0, sample.completionTokens ?? 0),
    costUsd: entry.costUsd + (cost ?? 0),
    unpricedCalls: entry.unpricedCalls + (cost === null ? 1 : 0),
  };
}
