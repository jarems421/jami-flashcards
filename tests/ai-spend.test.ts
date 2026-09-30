import { describe, expect, it } from "vitest";
import {
  addCallToSpend,
  emptySpendEntry,
  estimateCallCostUsd,
  findModelPrice,
  getSpendDayKey,
  readModelPrices,
} from "@/lib/ai/spend";

/**
 * The meter's arithmetic, and the one rule that matters most: it never invents
 * a price.
 *
 * The budgets this sits beside count requests, which is the wrong unit for the
 * thing being billed -- a ninety-minute video read and a one-line autocomplete
 * are both one request. What makes the number trustworthy is that a call whose
 * cost is genuinely unknown is counted as unknown rather than as zero, because
 * a total that silently omits a whole provider is worse than no total.
 */
describe("ai spend", () => {
  describe("readModelPrices", () => {
    it("is empty when nothing has been configured", () => {
      expect(readModelPrices({})).toEqual({});
    });

    it("accepts the short and long spellings of a price", () => {
      const prices = readModelPrices({
        AI_MODEL_PRICES_JSON: JSON.stringify({
          "gemini-x": { in: 0.1, out: 0.4 },
          "kimi-y": { inputPerMillionUsd: 1, outputPerMillionUsd: 2 },
        }),
      });

      expect(prices["gemini-x"]).toEqual({ inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.4 });
      expect(prices["kimi-y"]).toEqual({ inputPerMillionUsd: 1, outputPerMillionUsd: 2 });
    });

    it("survives a malformed table rather than taking the AI path down", () => {
      expect(readModelPrices({ AI_MODEL_PRICES_JSON: "{not json" })).toEqual({});
    });

    it("ignores entries that are not usable numbers", () => {
      const prices = readModelPrices({
        AI_MODEL_PRICES_JSON: JSON.stringify({
          good: { in: 1, out: 2 },
          negative: { in: -1, out: 2 },
          missing: { in: 1 },
          nonsense: "free",
        }),
      });

      expect(Object.keys(prices)).toEqual(["good"]);
    });
  });

  describe("findModelPrice", () => {
    /*
     * Providers version model names, so an exact-match table goes stale the
     * first time a suffix appears.
     */
    it("matches a family by prefix", () => {
      const prices = { "gemini-2.5": { inputPerMillionUsd: 1, outputPerMillionUsd: 2 } };
      expect(findModelPrice("gemini-2.5-flash-lite-preview-09", prices)).toEqual(prices["gemini-2.5"]);
    });

    it("lets the more specific entry win", () => {
      const prices = {
        "gemini-2.5": { inputPerMillionUsd: 1, outputPerMillionUsd: 2 },
        "gemini-2.5-pro": { inputPerMillionUsd: 10, outputPerMillionUsd: 20 },
      };
      expect(findModelPrice("gemini-2.5-pro-latest", prices)?.inputPerMillionUsd).toBe(10);
    });

    it("returns nothing for a model it has never heard of", () => {
      expect(findModelPrice("some-new-model", { "gemini-2.5": { inputPerMillionUsd: 1, outputPerMillionUsd: 2 } })).toBeNull();
    });
  });

  describe("estimateCallCostUsd", () => {
    it("prefers what the provider says it charged", () => {
      const cost = estimateCallCostUsd(
        { provider: "openrouter", model: "anything", promptTokens: 1_000_000, reportedCostUsd: 0.02 },
        { anything: { inputPerMillionUsd: 999, outputPerMillionUsd: 999 } }
      );
      expect(cost).toBe(0.02);
    });

    it("prices from tokens when the provider reports none", () => {
      const cost = estimateCallCostUsd(
        { provider: "gemini", model: "gemini-x", promptTokens: 1_000_000, completionTokens: 500_000 },
        { "gemini-x": { inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.4 } }
      );
      expect(cost).toBeCloseTo(0.3, 10);
    });

    it("refuses to guess when the model has no price", () => {
      expect(
        estimateCallCostUsd({ provider: "gemini", model: "unknown", promptTokens: 5_000 }, {})
      ).toBeNull();
    });

    it("refuses to guess when there are no tokens to price", () => {
      expect(
        estimateCallCostUsd(
          { provider: "gemini", model: "gemini-x" },
          { "gemini-x": { inputPerMillionUsd: 1, outputPerMillionUsd: 1 } }
        )
      ).toBeNull();
    });
  });

  describe("addCallToSpend", () => {
    it("counts an unpriced call rather than adding zero to the total", () => {
      const entry = addCallToSpend(
        emptySpendEntry(),
        { provider: "gemini", model: "unknown", promptTokens: 900, completionTokens: 100 },
        {}
      );

      expect(entry).toEqual({
        calls: 1,
        promptTokens: 900,
        completionTokens: 100,
        costUsd: 0,
        unpricedCalls: 1,
      });
    });

    it("accumulates priced and unpriced calls side by side", () => {
      const prices = { known: { inputPerMillionUsd: 1_000_000, outputPerMillionUsd: 0 } };
      let entry = emptySpendEntry();
      entry = addCallToSpend(entry, { provider: "gemini", model: "known", promptTokens: 1 }, prices);
      entry = addCallToSpend(entry, { provider: "gemini", model: "other", promptTokens: 1 }, prices);

      expect(entry.calls).toBe(2);
      expect(entry.costUsd).toBeCloseTo(1, 10);
      expect(entry.unpricedCalls).toBe(1);
    });
  });

  /*
   * Gemini bills three things per item rather than per plain token: a
   * generated image, a video's soundtrack, and each web search. Those were the
   * calls the meter never saw, and they are most of what Gemini costs.
   */
  describe("per-item prices", () => {
    const imageModel = {
      "image-model": { inputPerMillionUsd: 0.5, outputPerMillionUsd: 3, imageOutputPerMillionUsd: 60 },
    };

    it("reads the optional extras in both spellings", () => {
      const prices = readModelPrices({
        AI_MODEL_PRICES_JSON: JSON.stringify({
          short: { in: 0.1, out: 0.4, audioIn: 0.3, imageOut: 60, search: 0.035 },
          long: {
            inputPerMillionUsd: 0.3,
            outputPerMillionUsd: 2.5,
            audioInputPerMillionUsd: 0.3,
            imageOutputPerMillionUsd: 30,
            searchUsd: 0.014,
          },
        }),
      });

      expect(prices.short).toEqual({
        inputPerMillionUsd: 0.1,
        outputPerMillionUsd: 0.4,
        audioInputPerMillionUsd: 0.3,
        imageOutputPerMillionUsd: 60,
        searchUsd: 0.035,
      });
      expect(prices.long?.searchUsd).toBe(0.014);
    });

    it("drops an entry whose extra is unusable rather than pricing it as free", () => {
      const prices = readModelPrices({
        AI_MODEL_PRICES_JSON: JSON.stringify({ broken: { in: 0.1, out: 0.4, search: "cheap" } }),
      });
      expect(prices).toEqual({});
    });

    it("prices a generated image at the image rate and its caption at the text rate", () => {
      const cost = estimateCallCostUsd(
        { provider: "gemini", model: "image-model", promptTokens: 200, completionTokens: 1_220, imageCompletionTokens: 1_120 },
        imageModel
      );
      expect(cost).toBeCloseTo((200 * 0.5 + 100 * 3 + 1_120 * 60) / 1_000_000, 12);
    });

    it("leaves an image unpriced when the table has no image rate", () => {
      expect(
        estimateCallCostUsd(
          { provider: "gemini", model: "text-only", completionTokens: 1_120, imageCompletionTokens: 1_120 },
          { "text-only": { inputPerMillionUsd: 0.5, outputPerMillionUsd: 3 } }
        )
      ).toBeNull();
    });

    it("prices audio at its own rate, and at the input rate when it has none", () => {
      const sample = { provider: "gemini", model: "video-model", promptTokens: 1_000_000, audioPromptTokens: 400_000 };
      expect(
        estimateCallCostUsd(sample, {
          "video-model": { inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.4, audioInputPerMillionUsd: 0.3 },
        })
      ).toBeCloseTo(0.6 * 0.1 + 0.4 * 0.3, 10);
      expect(
        estimateCallCostUsd(sample, { "video-model": { inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.4 } })
      ).toBeCloseTo(0.1, 10);
    });

    it("adds each billed search to the token cost", () => {
      const cost = estimateCallCostUsd(
        { provider: "gemini", model: "research", promptTokens: 1_000_000, completionTokens: 0, searches: 3 },
        { research: { inputPerMillionUsd: 0.3, outputPerMillionUsd: 2.5, searchUsd: 0.014 } }
      );
      expect(cost).toBeCloseTo(0.3 + 3 * 0.014, 10);
    });

    it("leaves a searched call unpriced when searches have no price", () => {
      expect(
        estimateCallCostUsd(
          { provider: "gemini", model: "research", promptTokens: 5_000, searches: 1 },
          { research: { inputPerMillionUsd: 0.3, outputPerMillionUsd: 2.5 } }
        )
      ).toBeNull();
    });
  });

  describe("getSpendDayKey", () => {
    it("buckets by UTC day", () => {
      expect(getSpendDayKey(Date.UTC(2026, 8, 3, 23, 59))).toBe("2026-09-03");
      expect(getSpendDayKey(Date.UTC(2026, 8, 4, 0, 1))).toBe("2026-09-04");
    });
  });
});
