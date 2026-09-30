import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { aiSpendContextFor } from "@/services/ai/spend.server";
import { enterAiSpendContext } from "@/lib/ai/spend-context";
import { authenticateWriteRequest } from "@/services/auth/authenticate-request.server";
import {
  checkAiBudget,
  createAiBudgetLimitResponse,
  getAiTokenCap,
  refundAiBudget,
} from "@/services/ai/budgets";
import { getAdminStorageBucket } from "@/services/firebase/admin";
import { generateAiText, isAnyAiProviderConfigured } from "@/lib/ai/provider-router";
import { featureFlags } from "@/lib/app/feature-flags";
import { cardImageStoragePrefix } from "@/lib/study/card-images";
import {
  LABEL_DETECTION_SYSTEM_PROMPT,
  LABEL_DETECTION_USER_PROMPT,
  parseDetectedLabels,
} from "@/lib/study/diagram-label-detection";
import { createLogger } from "@/lib/observability/logger";

export const runtime = "nodejs";

const REQUEST_TIMEOUT_MS = 30_000;
const REQUEST_DEADLINE_MS = 45_000;
/** The browser scales pictures down before sending; anything larger is not one of ours. */
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function failure(error: string, status: number, code: string) {
  return Response.json({ error, code }, { status });
}

function typeFromPath(path: string) {
  const extension = path.split(".").pop()?.toLowerCase();
  return extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";
}

/**
 * Finds the printed labels on a diagram picture, when a student asks.
 *
 * The picture comes either inline -- a new picture not yet uploaded -- or as
 * the path of one of the student's own stored card images. It is sent to the
 * model for this one request and never written anywhere, logged or kept;
 * what comes back is words and boxes, which the student reviews before any of
 * it becomes a card.
 */
export async function POST(request: NextRequest) {
  if (!featureFlags.enableFlashcardAi) {
    return failure("Finding labels with Jami is switched off.", 403, "disabled");
  }
  if (!isAnyAiProviderConfigured("documentVision")) {
    return failure("Finding labels with Jami is not available in this deployment.", 503, "not_configured");
  }
  const uid = await authenticateWriteRequest(request);
  if (!uid) return failure("Unauthorized", 401, "unauthorized");

  const startedAt = Date.now();
  const log = createLogger({ route: "ai.diagram-labels", requestId: randomUUID(), uid });

  let mimeType: string;
  let data: string;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const image = body.image as { mimeType?: unknown; data?: unknown } | undefined;
    if (image && typeof image === "object") {
      mimeType = typeof image.mimeType === "string" ? image.mimeType : "";
      data = typeof image.data === "string" ? image.data : "";
      if (!IMAGE_TYPES.has(mimeType) || !data || (data.length * 3) / 4 > MAX_IMAGE_BYTES) {
        return failure("Send a JPEG, PNG or WebP picture under 6 MB.", 400, "invalid_image");
      }
    } else {
      const storagePath = typeof body.storagePath === "string" ? body.storagePath.trim() : "";
      // Only the student's own card pictures, however the path is written.
      if (!storagePath.startsWith(cardImageStoragePrefix(uid)) || storagePath.includes("..")) {
        return failure("Picture not found.", 404, "not_found");
      }
      const file = getAdminStorageBucket().file(storagePath);
      const [bytes] = await file.download();
      if (bytes.length > MAX_IMAGE_BYTES * 2) {
        return failure("That picture is too large to read.", 413, "too_large");
      }
      mimeType = typeFromPath(storagePath);
      data = bytes.toString("base64");
    }
  } catch (error) {
    log.warn("request.invalid", { error });
    return failure("The picture could not be read.", 400, "invalid_request");
  }

  let budgetDecision;
  try {
    budgetDecision = await checkAiBudget({ uid, action: "diagramLabelDetection" });
    enterAiSpendContext(aiSpendContextFor(uid, "diagramLabelDetection"));
  } catch (error) {
    log.error("budget.check_failed", { error });
    return failure("AI usage limits are temporarily unavailable. Try again shortly.", 503, "budget_unavailable");
  }
  if (!budgetDecision.allowed) {
    return createAiBudgetLimitResponse("diagramLabelDetection", budgetDecision);
  }
  const grant = budgetDecision.grant;
  const refund = async (why: string) => {
    try {
      await refundAiBudget(grant);
    } catch (error) {
      log.warn("budget.refund_failed", { why, error });
    }
  };

  try {
    const text = await generateAiText({
      role: "documentVision",
      taskClass: "visual",
      timeoutMs: REQUEST_TIMEOUT_MS,
      deadlineAt: startedAt + REQUEST_DEADLINE_MS,
      signal: request.signal,
      generationConfig: {
        temperature: 0,
        maxOutputTokens: getAiTokenCap("diagramLabelDetection"),
        responseMimeType: "application/json",
      },
      request: {
        systemInstruction: LABEL_DETECTION_SYSTEM_PROMPT,
        contents: [
          {
            role: "user" as const,
            parts: [{ inlineData: { mimeType, data } }, { text: LABEL_DETECTION_USER_PROMPT }],
          },
        ],
      },
    });
    const labels = parseDetectedLabels(text);
    log.info("labels.found", { count: labels.length, latencyMs: Date.now() - startedAt });
    return Response.json({ labels });
  } catch (error) {
    await refund("provider_failed");
    log.error("labels.failed", { error, latencyMs: Date.now() - startedAt });
    return failure("Jami could not read the labels just now. Try again, or draw the boxes yourself.", 502, "provider_failed");
  }
}
