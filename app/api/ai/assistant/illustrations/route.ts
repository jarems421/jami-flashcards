import { randomUUID } from "node:crypto";
import { aiSpendContextFor } from "@/services/ai/spend.server";
import { enterAiSpendContext } from "@/lib/ai/spend-context";
import sharp from "sharp";
import type { NextRequest } from "next/server";
import {
  buildTutorIllustrationPrompt,
  getAssistantImageExtension,
  parseAssistantIllustrationRequest,
} from "@/lib/ai/assistant-illustrations";
import {
  normalizeAssistantIllustrations,
  type AssistantIllustration,
} from "@/lib/ai/jami-assistant";
import {
  getJamiAssistantContextKey,
  getJamiAssistantSavedContext,
  mapJamiAssistantThread,
} from "@/lib/ai/jami-assistant-history";
import { generateGeminiImage } from "@/lib/ai/gemini";
import { createLogger } from "@/lib/observability/logger";
import {
  assistantAssetError,
  authenticateAssistantAssetRequest,
} from "@/services/ai/assistant-assets.server";
import {
  checkAiBudget,
  createAiBudgetLimitResponse,
  refundAiBudget,
} from "@/services/ai/budgets";
import { getAdminDb, getAdminStorageBucket } from "@/services/firebase/admin";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const uid = await authenticateAssistantAssetRequest(request);
  if (!uid) return assistantAssetError("Unauthorized", 401, "unauthorized");

  let parsed;
  try {
    parsed = parseAssistantIllustrationRequest(await request.json());
  } catch {
    return assistantAssetError("Invalid request body", 400, "invalid_request");
  }
  if (!parsed) {
    return assistantAssetError("Choose a Tutor answer to show visually.", 400, "invalid_request");
  }
  if (parsed.context.surface === "learn" && parsed.context.phase === "question") {
    return assistantAssetError(
      "Visuals stay hidden until you reveal this flashcard answer.",
      409,
      "answer_withheld"
    );
  }

  const db = getAdminDb();
  const userRef = db.collection("users").doc(uid);
  const threadRef = userRef.collection("assistantThreads").doc(parsed.threadId);
  const messageRef = userRef.collection("assistantMessages").doc(parsed.messageId);
  const [threadSnapshot, messageSnapshot] = await Promise.all([
    threadRef.get(),
    messageRef.get(),
  ]);
  const thread = threadSnapshot.exists
    ? mapJamiAssistantThread(
        threadSnapshot.id,
        threadSnapshot.data() as Record<string, unknown>
      )
    : null;
  const requestedContextKey = getJamiAssistantContextKey(
    getJamiAssistantSavedContext(parsed.context)
  );
  const storedMessage = messageSnapshot.data();
  if (
    !thread ||
    thread.contextKey !== requestedContextKey ||
    !messageSnapshot.exists ||
    storedMessage?.threadId !== parsed.threadId ||
    storedMessage?.role !== "assistant" ||
    storedMessage.canIllustrate !== true ||
    typeof storedMessage.text !== "string" ||
    !storedMessage.text.trim()
  ) {
    return assistantAssetError("That Tutor answer could not be found.", 404, "message_not_found");
  }

  // Derive the prompt from immutable chat history, not browser-supplied answer
  // text. This also prevents a hidden flashcard answer from being smuggled into
  // image generation: question-phase answers are persisted with canIllustrate
  // disabled and are rejected above.
  const messagesSnapshot = await userRef
    .collection("assistantMessages")
    .where("threadId", "==", parsed.threadId)
    .get();
  const assistantCreatedAt =
    typeof storedMessage.createdAt === "number" ? storedMessage.createdAt : Infinity;
  const precedingUserMessage = messagesSnapshot.docs
    .map((entry) => entry.data())
    .filter(
      (entry) =>
        entry.role === "user" &&
        typeof entry.text === "string" &&
        typeof entry.createdAt === "number" &&
        entry.createdAt < assistantCreatedAt
    )
    .sort((left, right) => (right.createdAt as number) - (left.createdAt as number))[0];
  const trustedPromptContext = {
    studentRequest:
      typeof precedingUserMessage?.text === "string"
        ? precedingUserMessage.text.slice(0, 4_000)
        : "Create a visual explanation of the saved Tutor answer.",
    tutorAnswer: storedMessage.text.slice(0, 24_000),
  };

  const budget = await checkAiBudget({ uid, action: "tutorIllustration" });
  // Everything this request spends from here on is billed to this student.
  enterAiSpendContext(aiSpendContextFor(uid, "tutorIllustration"));
  if (!budget.allowed) return createAiBudgetLimitResponse("tutorIllustration", budget);

  const requestId = randomUUID();
  const log = createLogger({ route: "ai.assistant.illustrations", requestId, uid });
  let storagePath = "";
  try {
    const generated = await generateGeminiImage({
      role: "tutorImage",
      prompt: buildTutorIllustrationPrompt(trustedPromptContext),
      aspectRatio: "4:3",
      imageSize: "1K",
      referenceImages:
        parsed.context.surface === "notebook" && parsed.context.snapshot
          ? [
              {
                data: parsed.context.snapshot.dataBase64,
                mimeType: parsed.context.snapshot.mimeType,
              },
            ]
          : undefined,
      timeoutMs: 90_000,
      signal: request.signal,
    });
    const extension = getAssistantImageExtension(generated.mimeType);
    if (!extension) throw new Error("Unsupported generated image type.");
    const bytes = Buffer.from(generated.data, "base64");
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new Error("Generated image size was invalid.");
    }
    const metadata = await sharp(bytes).metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error("Generated image dimensions were invalid.");
    }

    const assetId = randomUUID();
    storagePath = `users/${uid}/assistantImages/${assetId}/illustration.${extension}`;
    await getAdminStorageBucket().file(storagePath).save(bytes, {
      resumable: false,
      metadata: {
        contentType: generated.mimeType,
        cacheControl: "private,max-age=3600",
      },
    });

    const description = generated.description?.replace(/\s+/g, " ").trim().slice(0, 500);
    const topic = trustedPromptContext.studentRequest
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);
    const illustration: AssistantIllustration = {
      id: assetId,
      storagePath,
      mimeType: generated.mimeType as AssistantIllustration["mimeType"],
      width: metadata.width,
      height: metadata.height,
      altText: description || `Educational visual explaining ${topic}`,
      caption: description || `Visual explanation of ${topic}`,
      createdAt: Date.now(),
    };

    await db.runTransaction(async (transaction) => {
      const latest = await transaction.get(messageRef);
      if (
        !latest.exists ||
        latest.data()?.threadId !== parsed.threadId ||
        latest.data()?.role !== "assistant" ||
        latest.data()?.canIllustrate !== true ||
        latest.data()?.text !== storedMessage.text
      ) {
        throw new Error("Tutor answer changed before the visual was saved.");
      }
      const existing = normalizeAssistantIllustrations(latest.data()?.illustrations);
      if (existing.length >= 10) throw new Error("This Tutor answer already has enough visuals.");
      transaction.update(messageRef, {
        illustrations: [...existing, illustration],
      });
    });

    log.info("request.completed", {
      assetId,
      mimeType: illustration.mimeType,
      width: illustration.width,
      height: illustration.height,
    });
    return Response.json({ illustration });
  } catch (error) {
    if (storagePath) {
      await getAdminStorageBucket().file(storagePath).delete({ ignoreNotFound: true }).catch(() => undefined);
    }
    await refundAiBudget(budget.grant).catch(() => undefined);
    log.error("request.failed", { error });
    return assistantAssetError(
      "Jami could not create that visual just now. Try again in a moment.",
      502,
      "generation_failed"
    );
  }
}
