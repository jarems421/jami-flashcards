import "server-only";

import { generateGroundedResearch, type GeminiResearchResult } from "@/lib/ai/gemini";
import {
  extractTutorResearchUrls,
  sanitizeTutorResearchQuery,
  shouldResearchTutorGap,
  type JamiAssistantContext,
} from "@/lib/ai/jami-assistant";
import type { Source } from "@/lib/material/sources";
import type { Logger } from "@/lib/observability/logger";
import { chargeAllowance } from "@/services/billing/allowances.server";

/**
 * A grounded web search for a Tutor turn, run only when the question needs
 * something current or course-specific that the student's own material does
 * not settle, and only within the plan's searches and the turn's time.
 */
export type TutorTurnResearch = {
  /** Whether the question needed the web at all. */
  needed: boolean;
  /** Whether the month's searches had run out, so none was run. */
  allowanceUsed: boolean;
  result: GeminiResearchResult;
};

export async function researchTutorTurn(input: {
  uid: string;
  message: string;
  context: JamiAssistantContext;
  hasLocalSources: boolean;
  /** The study context's sources, whose course links are searched too. */
  sources: readonly Source[];
  preAnswerDeadlineAt: number;
  signal: AbortSignal;
  log: Logger;
}): Promise<TutorTurnResearch> {
  const { uid, log, preAnswerDeadlineAt } = input;
  const needsWebResearch = shouldResearchTutorGap({
    message: input.message,
    hasLocalSources: input.hasLocalSources,
    context: input.context,
  });
  const researchUrls = needsWebResearch
    ? Array.from(
        new Set([
          ...extractTutorResearchUrls(input.message),
          ...input.sources.flatMap((source) =>
            source.externalUrl
              ? extractTutorResearchUrls(source.externalUrl)
              : []
          ),
        ])
      ).slice(0, 20)
    : [];
  const sanitizedResearchQuery = needsWebResearch
    ? sanitizeTutorResearchQuery(input.message) ??
      (researchUrls.length > 0 ? "official course source" : null)
    : null;
  /*
   * Research is the one call that cannot be told a deadline, so it is given the
   * time that is left instead. It asked for twenty-two seconds regardless of
   * how much of the request had already been spent, which on a slow read left
   * the answer to start after its own deadline had passed and fail at once.
   */
  const researchTimeoutMs = Math.min(
    22_000,
    preAnswerDeadlineAt - Date.now()
  );
  /*
   * A web search is a plan allowance of its own (docs/plans-and-stardust.md),
   * charged only when one is about to run. Out of searches, the Tutor answers
   * from what the student gave it and says so once -- the answer is never
   * refused for it. A failed lookup gives its search back.
   */
  const searchCharge =
    sanitizedResearchQuery && researchTimeoutMs > 0
      ? await chargeAllowance({ uid, key: "searches" }).catch((error: unknown) => {
          log.warn("allowance.search_check_failed", { error });
          return null;
        })
      : null;
  const searchAllowanceUsed = searchCharge?.allowed === false;
  const webResearch = !sanitizedResearchQuery
    ? ({ ok: false, reason: "invalid_query" } as const)
    : researchTimeoutMs <= 0 || searchAllowanceUsed
      // Reported as its own reason rather than folded into the query check, so
      // the log says "there was no time left" instead of blaming the sanitiser.
      ? ({ ok: false, reason: "unavailable" } as const)
      : await generateGroundedResearch({
          sanitizedQuery: sanitizedResearchQuery,
          ...(researchUrls.length > 0 ? { urls: researchUrls } : {}),
          timeoutMs: researchTimeoutMs,
          signal: input.signal,
        });
  if (searchCharge?.allowed && !webResearch.ok) {
    await searchCharge.refund().catch(() => undefined);
  }
  if (needsWebResearch && !webResearch.ok) {
    log.warn("research.unavailable", {
      reason: searchAllowanceUsed ? "allowance_used" : webResearch.reason,
    });
  }
  return { needed: needsWebResearch, allowanceUsed: searchAllowanceUsed, result: webResearch };
}
