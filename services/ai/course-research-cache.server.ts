import "server-only";

import { createHash } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";

import {
  generateGroundedResearch,
  type GeminiResearchCitation,
  type GeminiResearchResult,
} from "@/lib/ai/gemini";
import { resolveAiProviderPolicy } from "@/lib/ai/provider-policy";
import { createLogger } from "@/lib/observability/logger";
import { getAdminDb } from "@/services/firebase/admin";

const log = createLogger({ route: "ai.course-research-cache" });

/**
 * A week. The brief describes how a course is examined -- papers, timings,
 * mark totals -- which changes with a new specification, not from one week to
 * the next.
 */
export const COURSE_RESEARCH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Bump when the research prompt changes, so no brief outlives the prompt that wrote it. */
const CACHE_VERSION = 1;

/**
 * Grounded research for a paper, shared between students on the same course.
 *
 * Every student generating an AQA GCSE Biology paper asked the web the same
 * question -- the query is built only from the course's public terms -- and
 * each paid for their own search and brief. One brief now serves them all for
 * a week.
 *
 * Deliberately narrow, so reuse can never cost quality or privacy:
 * - Only a query with no URLs is shared. URLs come from a student's own link
 *   sources, which makes the research theirs rather than the course's.
 * - Only a brief with at least one citation is kept. A thin answer is used
 *   once, as before, and asked for again next time rather than served for a
 *   week.
 * - The key is a hash of the model, the query and a version, and the query is
 *   not stored.
 * - A cache failure of any kind falls through to asking, as before.
 */
export async function researchCourseWithCache(input: {
  sanitizedQuery: string;
  urls: readonly string[];
  now?: number;
}): Promise<GeminiResearchResult> {
  if (input.urls.length > 0) {
    return generateGroundedResearch({ sanitizedQuery: input.sanitizedQuery, urls: input.urls });
  }

  const now = input.now ?? Date.now();
  const model = resolveAiProviderPolicy(process.env).capabilities.research.modelId;
  const query = input.sanitizedQuery.replace(/\s+/g, " ").trim().toLowerCase();
  const key = createHash("sha256").update(`${CACHE_VERSION}|${model}|${query}`).digest("hex");
  const ref = getAdminDb().collection("courseResearchCache").doc(key);

  try {
    const cached = readCachedResearch((await ref.get()).data(), now);
    if (cached) {
      log.info("research.cache_hit", { model });
      return cached;
    }
  } catch (error) {
    log.warn("research.cache_read_failed", { errorMessage: errorMessage(error) });
  }

  const result = await generateGroundedResearch({ sanitizedQuery: input.sanitizedQuery });
  if (result.ok && result.citations.length > 0) {
    try {
      await ref.set({
        brief: result.brief,
        citations: result.citations,
        model,
        createdAt: now,
        expiresAt: Timestamp.fromMillis(now + COURSE_RESEARCH_TTL_MS),
      });
    } catch (error) {
      log.warn("research.cache_write_failed", { errorMessage: errorMessage(error) });
    }
  }
  return result;
}

/** A stored brief, or null when it is missing, expired or not the shape written. */
export function readCachedResearch(
  data: Record<string, unknown> | undefined,
  now: number
): Extract<GeminiResearchResult, { ok: true }> | null {
  if (!data) return null;
  const expiresAt = data.expiresAt instanceof Timestamp ? data.expiresAt.toMillis() : 0;
  if (expiresAt <= now) return null;
  if (typeof data.brief !== "string" || !data.brief.trim()) return null;
  if (!Array.isArray(data.citations)) return null;
  const citations = data.citations.filter(
    (item): item is GeminiResearchCitation =>
      Boolean(item) &&
      typeof item === "object" &&
      typeof (item as GeminiResearchCitation).title === "string" &&
      typeof (item as GeminiResearchCitation).url === "string"
  );
  if (citations.length === 0) return null;
  return { ok: true, brief: data.brief, citations };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 300) : "unknown";
}
