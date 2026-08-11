import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { getAdminAuth, getAdminDb } from "@/services/firebase/admin";
import { getBearerToken } from "@/lib/auth/bearer";
import {
  checkAiBudget,
  createAiBudgetLimitResponse,
  getAiTokenCap,
  refundAiBudget,
} from "@/services/ai/budgets";
import { isGeminiTimeoutError } from "@/lib/ai/gemini";
import {
  generateAiText,
  isAnyAiProviderConfigured,
  type AiResponseDiagnostics,
} from "@/lib/ai/provider-router";
import {
  cleanGeneratedCardBack,
  detectCardBackSubject,
  getSubjectPrompt,
} from "@/lib/ai/card-autocomplete";
import { featureFlags } from "@/lib/app/feature-flags";
import { createLogger } from "@/lib/observability/logger";

export const runtime = "nodejs";

const REQUEST_TIMEOUT_MS = 12_000;
/**
 * A ceiling on the route as a whole.
 *
 * One request here can make three provider calls -- the draft, a simplified
 * fallback, then a completeness rewrite -- and each of those can fall back to a
 * second model. At twelve seconds an attempt that is over a minute of waiting
 * for a card back, so the whole route shares one budget and stops when it runs
 * out rather than each attempt starting the clock again.
 */
const REQUEST_DEADLINE_MS = 25_000;
const MAX_RELATED_CARDS = 5;
const RELATED_CARD_SCAN_LIMIT = 20;
const MAX_BACK_OUTPUT_LENGTH = 2000;
const MIN_COMPLETE_BACK_LENGTH = 42;

function hasBalancedPairs(text: string, left: string, right: string) {
  let depth = 0;
  for (const char of text) {
    if (char === left) {
      depth += 1;
    } else if (char === right) {
      depth -= 1;
      if (depth < 0) {
        return false;
      }
    }
  }
  return depth === 0;
}

function isLikelyIncompleteBack(text: string, front: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return true;
  }

  if (
    !hasBalancedPairs(trimmed, "(", ")") ||
    !hasBalancedPairs(trimmed, "[", "]") ||
    !hasBalancedPairs(trimmed, "{", "}")
  ) {
    return true;
  }

  if (/[:;,(\[{/\-]$/.test(trimmed)) {
    return true;
  }

  if (/\b(?:etc|e\.g)\.?$/i.test(trimmed)) {
    return true;
  }

  if (trimmed.length < MIN_COMPLETE_BACK_LENGTH) {
    return true;
  }

  const frontWords = front.trim().split(/\s+/).filter(Boolean).length;
  const backWords = trimmed.split(/\s+/).filter(Boolean).length;
  if (frontWords >= 8 && backWords < 7) {
    return true;
  }

  return false;
}

async function loadRelatedCardsPrompt(input: {
  adminDb: ReturnType<typeof getAdminDb>;
  uid: string;
  deckId?: string;
  topicIds: string[];
  front: string;
}) {
  if (!input.deckId) return "No nearby cards are available.";

  // These cards are only a formatting and tone reference, so the read is
  // scoped to the owned deck instead of scanning an arbitrary card slice.
  const relatedCardDocuments = Array.from(
    new Map(
      (
        await Promise.all(
          (["userId", "uid"] as const).map((ownerField) =>
            input.adminDb
              .collection("cards")
              .where(ownerField, "==", input.uid)
              .where("deckId", "==", input.deckId)
              .limit(RELATED_CARD_SCAN_LIMIT)
              .get()
          )
        )
      ).flatMap((snapshot) =>
        snapshot.docs.map((cardDoc) => [cardDoc.id, cardDoc] as const)
      )
    ).values()
  );
  const relatedCards = relatedCardDocuments
    .map((cardDoc) => {
      const data = cardDoc.data();
      const cardFront = typeof data.front === "string" ? data.front : "";
      const cardBack = typeof data.back === "string" ? data.back : "";
      const cardTopicIds = Array.isArray(data.topicIds)
        ? data.topicIds.filter(
            (topicId): topicId is string =>
              typeof topicId === "string" && topicId.trim().length > 0
          )
        : [];
      let score = 5;
      if (input.topicIds.length > 0) {
        score +=
          cardTopicIds.filter((topicId) => input.topicIds.includes(topicId))
            .length * 3;
      }
      if (cardFront.trim() === input.front.trim()) score -= 10;
      return { front: cardFront, back: cardBack, score };
    })
    .filter((card) => card.score > 0 && card.front && card.back)
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_RELATED_CARDS);

  return relatedCards.length
    ? `Nearby cards for tone, level, and formatting:
${relatedCards
  .map(
    (card) =>
      `- Front: ${card.front.slice(0, 160)}
  Back: ${card.back.slice(0, 260)}`
  )
  .join("\n")}`
    : "No nearby cards are available.";
}

export async function POST(request: NextRequest) {
  if (!featureFlags.enableFlashcardAi) {
    return Response.json(
      { error: "Flashcard AI is disabled. Use source or Tutor drafts instead." },
      { status: 403 },
    );
  }

  if (!isAnyAiProviderConfigured()) {
    return Response.json(
      { error: "AI features are not configured" },
      { status: 503 },
    );
  }

  const token = getBearerToken(request.headers.get("authorization"));
  if (!token) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let uid: string;
  try {
    const adminAuth = getAdminAuth();
    const decoded = await adminAuth.verifyIdToken(token);
    uid = decoded.uid;
  } catch {
    // An expired, malformed and forged token must be indistinguishable in the
    // response, so the verifier's reason is deliberately not surfaced.
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const log = createLogger({
    route: "ai.autocomplete-card",
    requestId: randomUUID(),
    uid,
  });

  let front: string;
  let currentBack: string;
  let deckId: string | undefined;
  let deckName: string | undefined;
  let topics: string[];
  let topicIds: string[];

  try {
    const body = (await request.json()) as Record<string, unknown>;
    front = typeof body.front === "string" ? body.front.slice(0, 700).trim() : "";
    currentBack = typeof body.currentBack === "string" ? body.currentBack.slice(0, 1500).trim() : "";
    deckId = typeof body.deckId === "string" && body.deckId.trim()
      ? body.deckId.trim().slice(0, 120)
      : undefined;
    deckName = typeof body.deckName === "string" && body.deckName.trim() ? body.deckName.slice(0, 120) : undefined;
    topics = Array.isArray(body.topics)
      ? body.topics
          .filter((topic): topic is string => typeof topic === "string" && topic.trim().length > 0)
          .map((topic) => topic.trim().slice(0, 80))
          .slice(0, 5)
      : [];
    topicIds = Array.isArray(body.topicIds)
      ? body.topicIds
          .filter((topicId): topicId is string => typeof topicId === "string" && topicId.trim().length > 0)
          .map((topicId) => topicId.trim().slice(0, 120))
          .slice(0, 5)
      : [];

    if (!front) {
      return Response.json({ error: "front is required" }, { status: 400 });
    }
  } catch {
    // Rejected before any quota is charged. Malformed JSON is a client error
    // describing the caller's own payload, so there is nothing to log.
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  let adminDb: ReturnType<typeof getAdminDb>;
  try {
    adminDb = getAdminDb();
    if (deckId) {
      const deckSnapshot = await adminDb.collection("decks").doc(deckId).get();
      const deckData = deckSnapshot.data() ?? {};
      const deckOwner =
        typeof deckData.userId === "string"
          ? deckData.userId.trim()
          : typeof deckData.uid === "string"
            ? deckData.uid.trim()
            : "";
      if (!deckSnapshot.exists || deckOwner !== uid) {
        return Response.json({ error: "Deck not found" }, { status: 404 });
      }
    }
  } catch (error) {
    log.error("deck.verify_failed", { deckId, error });
    return Response.json(
      { error: "This deck could not be loaded just now." },
      { status: 500 },
    );
  }

  let relatedCardsPrompt: string;
  try {
    relatedCardsPrompt = await loadRelatedCardsPrompt({
      adminDb,
      uid,
      deckId,
      topicIds,
      front,
    });
  } catch (error) {
    log.error("related_cards.load_failed", { deckId, error });
    return Response.json(
      { error: "Nearby cards could not be loaded just now." },
      { status: 500 }
    );
  }

  let budgetDecision;
  try {
    budgetDecision = await checkAiBudget({ uid, action: "autocompleteCard" });
  } catch (error) {
    log.error("budget.check_failed", { error });
    return Response.json(
      {
        error: "AI usage limits are temporarily unavailable. Try again shortly.",
        code: "budget_unavailable",
      },
      { status: 503 },
    );
  }
  if (!budgetDecision.allowed) {
    return createAiBudgetLimitResponse("autocompleteCard", budgetDecision);
  }
  const budgetGrant = budgetDecision.grant;
  const deadlineAt = startedAt + REQUEST_DEADLINE_MS;

  /** Hands back a request that produced nothing the student can use. */
  const refundRequest = async (why: string) => {
    try {
      await refundAiBudget(budgetGrant);
    } catch (error) {
      log.warn("budget.refund_failed", { why, error });
    }
  };

  // Declared outside the attempt so the failure log can still say which models
  // were reached before it went wrong.
  const providerDiagnostics: (AiResponseDiagnostics & {
    stage: string;
  })[] = [];

  try {
    const subject = detectCardBackSubject({ front, deckName, topics });
    const subjectPrompt = getSubjectPrompt(subject);
    const systemPrompt = `You write the BACK side of a flashcard for a student.

Non-negotiable rules:
- Return only the finished back-of-card text. No labels, no preamble, no markdown fence.
- Be accurate, compact, and easy to review during active recall.
- Prefer one strong answer over a mini textbook section.
- Use line breaks or bullets only when they make the card easier to scan.
- If the front is ambiguous, give the most likely useful answer and include the key assumption in a short phrase.
- If equations are useful, keep symbols readable, define them briefly, and avoid malformed characters.
- Never output raw HTML entities, literal unicode escape codes, or broken symbol substitutes.
- Do not invent niche facts that are not implied by the front, deck, Topics, or related cards.
- Match the user's existing card style when nearby cards give a clear pattern.

${subjectPrompt}`;

    const userPrompt = `Deck: ${deckName ?? "Unknown"}
Topics: ${topics.length ? topics.join(", ") : "None"}

Front:
${front}

Current back draft:
${currentBack || "(empty)"}

${relatedCardsPrompt}

Write the best flashcard back. If there is already a draft, improve or complete it without making it bloated.`;

    const generateDraft = async (prompt: string, stage: string) => {
      const text = await generateAiText({
        taskClass: "standard",
        timeoutMs: REQUEST_TIMEOUT_MS,
        deadlineAt,
        signal: request.signal,
        generationConfig: {
          temperature: 0.15,
          topP: 0.85,
          maxOutputTokens: getAiTokenCap("autocompleteCard"),
        },
        request: {
          systemInstruction: systemPrompt,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
        },
        onResponse: (diagnostics) => {
          providerDiagnostics.push({ ...diagnostics, stage });
        },
        onRetry: ({ error, provider, modelName, nextProvider, nextModelName }) => {
          log.warn("provider.model_fallback", {
            stage,
            provider,
            modelName,
            nextProvider,
            nextModelName,
            error,
          });
        },
      });
      return cleanGeneratedCardBack(text);
    };

    let reply = await generateDraft(userPrompt, "first").catch(async (error) => {
      log.warn("provider.first_attempt_failed", { error });
      const quickPrompt = `Write a complete, concise flashcard back for this front.

Front:
${front}

Current draft:
${currentBack || "(empty)"}

Return only the finished back text.`;
      return generateDraft(quickPrompt, "simplified");
    });

    if (isLikelyIncompleteBack(reply, front)) {
      const retryPrompt = `The previous draft looks incomplete.

Front:
${front}

Previous draft:
${reply || "(empty)"}

Rewrite the complete final back in one concise response.
- Keep it accurate and fully usable as the back of a flashcard.
- Finish all equations/sentences.
- Do not output placeholders like "etc." or unfinished fragments.`;
      const retriedReply = await generateDraft(retryPrompt, "completion");
      const accepted =
        !isLikelyIncompleteBack(retriedReply, front) ||
        retriedReply.length > reply.length;
      // Whether the completeness heuristic is earning the extra call is only
      // visible from how often it fires and how often the rewrite is kept.
      log.info("draft.completeness_retry", {
        accepted,
        firstLength: reply.length,
        retriedLength: retriedReply.length,
      });
      if (accepted) {
        reply = retriedReply;
      }
    }

    if (!reply) {
      log.warn("provider.empty_answer", {
        durationMs: Date.now() - startedAt,
        providerDiagnostics,
      });
      await refundRequest("empty_answer");
      return Response.json({ error: "AI could not return a usable answer right now." }, { status: 502 });
    }

    log.info("request.completed", {
      durationMs: Date.now() - startedAt,
      backLength: reply.length,
      providerDiagnostics,
    });
    return Response.json({ back: reply.slice(0, MAX_BACK_OUTPUT_LENGTH) });
  } catch (error) {
    await refundRequest("provider_failed");
    log.error("provider.failed", {
      error,
      timedOut: isGeminiTimeoutError(error),
      durationMs: Date.now() - startedAt,
      providerDiagnostics,
    });
    const message =
      isGeminiTimeoutError(error)
        ? "AI is taking longer than usual."
        : "AI could not complete the draft right now.";
    return Response.json({ error: message }, { status: 502 });
  }
}
