import type { NextRequest } from "next/server";
import { getBearerToken } from "@/lib/auth/bearer";
import { getAdminAuth, getAdminDb } from "@/services/firebase/admin";
import {
  checkAiBudget,
  createAiBudgetLimitResponse,
  getAiTokenCap,
  refundAiBudget,
} from "@/services/ai/budgets";
import { aiSpendContextFor } from "@/services/ai/spend.server";
import { enterAiSpendContext } from "@/lib/ai/spend-context";
import { generateAiText, isAnyAiProviderConfigured } from "@/lib/ai/provider-router";
import { featureFlags } from "@/lib/app/feature-flags";
import { createLogger } from "@/lib/observability/logger";

export const runtime = "nodejs";

const MAX_RESPONSE_LENGTH = 4_000;
const REQUEST_TIMEOUT_MS = 9_000;
/** Below this the verdict is not trusted and the student rates it themselves. */
const MIN_ACCEPTED_CONFIDENCE = 0.7;

const log = createLogger({ route: "api.ai.study-answer" });

const SYSTEM_PROMPT = `You judge whether a student's written answer means the same thing as the expected answer on their flashcard.

Return ONLY JSON: { "verdict": "correct" | "partial" | "incorrect", "coveredConcepts": string[], "missingConcepts": string[], "feedback": string, "confidence": number }

Rules:
- Judge MEANING, not wording. A correct paraphrase is correct.
- Wrong or missing key ideas make it partial or incorrect, whichever fits.
- feedback is at most one short sentence, addressed to the student.
- confidence is how sure you are. If the expected answer is vague, or the student's answer is arguable, say so with a low number.
- A low confidence is the right answer when you are unsure. Do not guess confidently.`;

/**
 * Semantic marking, reached only when local marking could not decide.
 *
 * The student's response is used and discarded. It is never written to
 * Firestore, never logged, never cached and never counted in analytics -- what
 * somebody typed while trying to remember something is theirs.
 *
 * Every failure here is the same failure: the student is shown the answer and
 * rates it themselves. Being unavailable, timing out, being out of budget and
 * being unsure are all the same outcome, which is why none of them can break a
 * session.
 */
export async function POST(request: NextRequest) {
  if (!featureFlags.enableStudyModes) {
    return Response.json({ verdict: "needs-self-grade" }, { status: 200 });
  }

  const token = getBearerToken(request.headers.get("authorization"));
  if (!token) {
    return Response.json(
      { error: "Unauthorized", code: "unauthorized" },
      { status: 401 }
    );
  }

  let uid: string;
  try {
    uid = (await getAdminAuth().verifyIdToken(token)).uid;
  } catch {
    return Response.json(
      { error: "Unauthorized", code: "unauthorized" },
      { status: 401 }
    );
  }

  let cardId: string;
  let response: string;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    cardId = typeof body.cardId === "string" ? body.cardId.trim().slice(0, 120) : "";
    response =
      typeof body.response === "string"
        ? body.response.slice(0, MAX_RESPONSE_LENGTH).trim()
        : "";
    if (!cardId || !response) {
      return Response.json(
        { error: "cardId and response are required", code: "invalid_request" },
        { status: 400 }
      );
    }
  } catch {
    return Response.json(
      { error: "Invalid request body", code: "invalid_request" },
      { status: 400 }
    );
  }

  // The expected answer is read from the student's own card, never taken from
  // the request. A client that could name the answer could mark itself correct.
  const db = getAdminDb();
  const snapshot = await db.collection("cards").doc(cardId).get();
  const card = snapshot.data();
  if (!snapshot.exists || !card || card.userId !== uid) {
    return Response.json(
      { error: "Card not found", code: "not_found" },
      { status: 404 }
    );
  }
  const expectedAnswer = typeof card.back === "string" ? card.back.trim() : "";
  if (!expectedAnswer) {
    return Response.json({ verdict: "needs-self-grade" });
  }

  const assetSnapshot = await db.collection("cardStudyAssets").doc(cardId).get();
  const assetData = assetSnapshot.data();
  const requiredConcepts: string[] =
    assetData?.userId === uid && Array.isArray(assetData?.asset?.requiredConcepts)
      ? (assetData.asset.requiredConcepts as string[]).slice(0, 5)
      : [];

  if (!isAnyAiProviderConfigured("worker")) {
    return Response.json({ verdict: "needs-self-grade", reason: "unavailable" });
  }

  let budgetDecision;
  try {
    budgetDecision = await checkAiBudget({ uid, action: "studyAnswerCheck" });
    enterAiSpendContext(aiSpendContextFor(uid, "studyAnswerCheck"));
  } catch (error) {
    log.error("budget.check_failed", { error });
    return Response.json({ verdict: "needs-self-grade", reason: "unavailable" });
  }
  if (!budgetDecision.allowed) {
    return createAiBudgetLimitResponse("studyAnswerCheck", budgetDecision);
  }
  const grant = budgetDecision.grant;

  try {
    const result = await generateAiText({
      role: "worker",
      routeReason: "explicit_role",
      allowRoleEscalation: false,
      timeoutMs: REQUEST_TIMEOUT_MS,
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: getAiTokenCap("studyAnswerCheck"),
        responseMimeType: "application/json",
      },
      request: {
        systemInstruction: SYSTEM_PROMPT,
        contents: [
          {
            role: "user" as const,
            parts: [
              {
                text: [
                  `Expected answer: ${expectedAnswer}`,
                  requiredConcepts.length > 0
                    ? `Key ideas it must contain: ${requiredConcepts.join("; ")}`
                    : "",
                  `Student's answer: ${response}`,
                ]
                  .filter(Boolean)
                  .join("\n\n"),
              },
            ],
          },
        ],
      },
    });

    const parsed = JSON.parse(
      (/```(?:json)?\s*([\s\S]*?)```/.exec(result)?.[1] ?? result).trim()
    ) as Record<string, unknown>;

    const confidence =
      typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
        ? Math.min(1, Math.max(0, parsed.confidence))
        : 0;
    const verdict =
      parsed.verdict === "correct" ||
      parsed.verdict === "partial" ||
      parsed.verdict === "incorrect"
        ? parsed.verdict
        : null;

    if (!verdict || confidence < MIN_ACCEPTED_CONFIDENCE) {
      return Response.json({ verdict: "needs-self-grade", reason: "uncertain" });
    }

    const strings = (value: unknown) =>
      Array.isArray(value)
        ? value
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.trim().slice(0, 120))
            .filter(Boolean)
            .slice(0, 5)
        : [];

    return Response.json({
      verdict,
      confidence,
      coveredConcepts: strings(parsed.coveredConcepts),
      missingConcepts: strings(parsed.missingConcepts),
      feedback:
        typeof parsed.feedback === "string"
          ? parsed.feedback.trim().slice(0, 240)
          : "",
    });
  } catch (error) {
    // Note what is not in this log: the student's answer, and the card's.
    log.warn("check.failed", { cardId, error });
    try {
      await refundAiBudget(grant);
    } catch (refundError) {
      log.warn("budget.refund_failed", { error: refundError });
    }
    return Response.json({ verdict: "needs-self-grade", reason: "unavailable" });
  }
}
