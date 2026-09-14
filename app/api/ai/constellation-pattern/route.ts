import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { getBearerToken } from "@/lib/auth/bearer";
import { isGeminiTimeoutError } from "@/lib/ai/gemini";
import {
  generateAiText,
  isAnyAiProviderConfigured,
} from "@/lib/ai/provider-router";
import { enterAiSpendContext } from "@/lib/ai/spend-context";
import {
  arrangeStarsToDrawing,
  describeStarShortage,
  readSkyDrawing,
  type SkyDrawing,
} from "@/lib/constellation/sky-drawing";
import {
  buildSkyPatternPrompt,
  clampSkyAspectRatio,
  isValidConstellationId,
  parseSkyPatternReply,
  readSkyPatternHistory,
  SKY_PATTERN_REQUEST_MAX_LENGTH,
  SKY_PATTERN_SYSTEM_PROMPT,
  type SkyPattern,
} from "@/lib/constellation/sky-pattern";
import { parseStarData, type NormalizedStar } from "@/lib/constellation/stars";
import { createLogger } from "@/lib/observability/logger";
import {
  checkAiBudget,
  createAiBudgetLimitResponse,
  getAiTokenCap,
  refundAiBudget,
} from "@/services/ai/budgets";
import { aiSpendContextFor } from "@/services/ai/spend.server";
import { getAdminAuth, getAdminDb } from "@/services/firebase/admin";

export const runtime = "nodejs";

const REQUEST_TIMEOUT_MS = 30_000;
const REQUEST_DEADLINE_MS = 45_000;

/**
 * Jami turns a sky into the picture a student asks for.
 *
 * The stars are read here, from the student's own documents, rather than taken
 * from the request: what gets arranged is whatever that sky already holds, and
 * nothing a page sends can add to it. Jami only draws; the drawing is fitted
 * to those stars here, and the page saves the result.
 *
 * It runs on the worker, the cheapest model, at medium effort and never
 * escalates. Compared on the same six pictures, the worker thinking a little
 * drew as well as anything tried -- closed hearts, recognisable rockets and
 * butterflies -- in about four seconds for a fraction of a cent, where the
 * supervisor took forty to ninety seconds, cost twenty times as much and ran
 * out of room on two of the six. Real constellations are not drawn at all: no
 * model placed Orion's stars correctly, so they come from a star map.
 */
export async function POST(request: NextRequest) {
  if (!isAnyAiProviderConfigured()) {
    return Response.json({ error: "AI features are not configured" }, { status: 503 });
  }

  const token = getBearerToken(request.headers.get("authorization"));
  if (!token) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let uid: string;
  try {
    uid = (await getAdminAuth().verifyIdToken(token)).uid;
  } catch {
    // Expired, malformed and forged tokens must look the same from outside.
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const log = createLogger({ route: "ai.constellation-pattern", requestId: randomUUID(), uid });

  let constellationId: string;
  let ask: string;
  let history: ReturnType<typeof readSkyPatternHistory>;
  let previousDrawing: SkyDrawing | null;
  let aspectRatio: number;
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null) {
      return Response.json({ error: "Invalid request body" }, { status: 400 });
    }
    const fields = body as Record<string, unknown>;
    if (!isValidConstellationId(fields.constellationId)) {
      return Response.json({ error: "Choose a sky first." }, { status: 400 });
    }
    constellationId = fields.constellationId;
    ask = typeof fields.request === "string"
      ? fields.request.trim().slice(0, SKY_PATTERN_REQUEST_MAX_LENGTH)
      : "";
    if (!ask) {
      return Response.json({ error: "Tell Jami what to make." }, { status: 400 });
    }
    history = readSkyPatternHistory(fields.history);
    previousDrawing = readSkyDrawing(fields.previousDrawing);
    aspectRatio = clampSkyAspectRatio(fields.aspectRatio);
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  let stars: NormalizedStar[];
  try {
    const db = getAdminDb();
    const [constellationSnapshot, starsSnapshot] = await Promise.all([
      db.doc(`users/${uid}/constellations/${constellationId}`).get(),
      db.collection(`users/${uid}/stars`).where("constellationId", "==", constellationId).get(),
    ]);
    if (!constellationSnapshot.exists) {
      return Response.json({ error: "That sky could not be found." }, { status: 404 });
    }
    stars = starsSnapshot.docs.map((starDoc) => parseStarData(starDoc.id, starDoc.data()));
  } catch (error) {
    log.error("sky.load_failed", { error });
    return Response.json({ error: "Your sky could not be loaded just now." }, { status: 500 });
  }

  if (stars.length < 2) {
    return Response.json(
      { error: "Earn at least two stars and Jami can arrange them into a pattern." },
      { status: 400 }
    );
  }

  let budgetDecision;
  try {
    budgetDecision = await checkAiBudget({ uid, action: "constellationPattern" });
    enterAiSpendContext(aiSpendContextFor(uid, "constellationPattern"));
  } catch (error) {
    log.error("budget.check_failed", { error });
    return Response.json(
      {
        error: "AI usage limits are temporarily unavailable. Try again shortly.",
        code: "budget_unavailable",
      },
      { status: 503 }
    );
  }
  if (!budgetDecision.allowed) {
    return createAiBudgetLimitResponse("constellationPattern", budgetDecision);
  }
  const budgetGrant = budgetDecision.grant;

  const refundRequest = async (why: string) => {
    try {
      await refundAiBudget(budgetGrant);
    } catch (error) {
      log.warn("budget.refund_failed", { why, error });
    }
  };

  try {
    const text = await generateAiText({
      role: "worker",
      routeReason: "explicit_role",
      allowRoleEscalation: false,
      reasoningEffort: "medium",
      timeoutMs: REQUEST_TIMEOUT_MS,
      deadlineAt: startedAt + REQUEST_DEADLINE_MS,
      signal: request.signal,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: getAiTokenCap("constellationPattern"),
        responseMimeType: "application/json",
      },
      request: {
        systemInstruction: SKY_PATTERN_SYSTEM_PROMPT,
        contents: [
          {
            role: "user",
            parts: [
              {
                text: buildSkyPatternPrompt({
                  starCount: stars.length,
                  request: ask,
                  history,
                  previousDrawing,
                  aspectRatio,
                }),
              },
            ],
          },
        ],
      },
    });

    const reply = parseSkyPatternReply(text);
    if (!reply) {
      await refundRequest("unusable_answer");
      log.warn("provider.unusable_answer", { durationMs: Date.now() - startedAt });
      return Response.json(
        { error: "Jami could not draw that one. Try describing it another way." },
        { status: 502 }
      );
    }

    if (!reply.drawing) {
      return Response.json({ reply: reply.reply, positions: {}, lines: null, drawing: null } satisfies SkyPattern);
    }

    const arrangement = arrangeStarsToDrawing({ stars, drawing: reply.drawing, aspectRatio });
    const shortage = describeStarShortage(stars.length, reply.idealStars);

    log.info("request.completed", {
      durationMs: Date.now() - startedAt,
      starCount: stars.length,
      figureStarCount: arrangement.figureStarCount,
      idealStars: reply.idealStars,
      lineCount: arrangement.lines.length,
    });
    return Response.json({
      reply: shortage ? `${reply.reply} ${shortage}` : reply.reply,
      positions: arrangement.positions,
      lines: arrangement.lines,
      drawing: reply.drawing,
    } satisfies SkyPattern);
  } catch (error) {
    await refundRequest("provider_failed");
    log.error("provider.failed", {
      error,
      timedOut: isGeminiTimeoutError(error),
      durationMs: Date.now() - startedAt,
    });
    return Response.json(
      {
        error: isGeminiTimeoutError(error)
          ? "Jami is taking longer than usual. Try again in a moment."
          : "Jami could not arrange your sky just now.",
      },
      { status: 502 }
    );
  }
}
