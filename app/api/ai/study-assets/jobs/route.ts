import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
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
import {
  buildStudyAssetUserPrompt,
  getStudyAssetCacheKey,
  MAX_CARDS_PER_BATCH,
  MAX_CARDS_PER_JOB,
  MAX_CONCURRENT_BATCHES,
  parseStudyAssetResponse,
  STUDY_ASSET_PROMPT_VERSION,
  STUDY_ASSET_SCHEMA_VERSION,
  STUDY_ASSET_SYSTEM_PROMPT,
  type StudyAsset,
} from "@/lib/ai/study-assets";
import { featureFlags } from "@/lib/app/feature-flags";
import { createLogger } from "@/lib/observability/logger";

export const runtime = "nodejs";
export const maxDuration = 120;

/*
 * One batch's own patience, and the whole job's.
 *
 * These were twelve and twenty-one seconds, chosen to fit inside the wait a
 * student would tolerate at the start of a session. Measured against the worker
 * model, a batch of six cards takes 18-21s on the fast endpoint and 39-46s on
 * the fallback -- so every batch was being killed before it could answer and
 * first-time preparation produced nothing at all, quietly, while looking like
 * it had merely been unlucky.
 *
 * The fix was not a shorter batch. It was to stop making a student wait for the
 * whole queue: the page blocks on a few cards and prepares the rest while they
 * study, so this can afford to take as long as the work actually takes. What
 * bounds it now is the platform's own function limit, not somebody's patience.
 */
const BATCH_TIMEOUT_MS = 45_000;
const JOB_DEADLINE_MS = 95_000;
/** Below this there is no point starting another call, only finishing one. */
const MIN_USEFUL_MS = 2_500;

const log = createLogger({ route: "api.ai.study-assets" });

type OwnedCard = {
  id: string;
  front: string;
  back: string;
  studySettings?: Record<string, unknown>;
};

async function authenticate(request: NextRequest) {
  const token = getBearerToken(request.headers.get("authorization"));
  if (!token) return null;
  try {
    return (await getAdminAuth().verifyIdToken(token)).uid;
  } catch {
    return null;
  }
}

function failure(error: string, status: number, code: string) {
  return Response.json({ error, code }, { status });
}

/**
 * Prepare the AI half of the study modes for one deck.
 *
 * Called when a session starts, which is what makes the cache the whole design
 * rather than an optimisation. Cards already prepared under their current
 * content are answered for free and never reach a model, so a student studying
 * a deck they have studied before spends nothing and waits for nothing; only
 * genuinely new or edited cards cost anything.
 *
 * Nothing here runs because a card was created or edited. Preparation follows
 * the student into a session; it does not chase them around the app.
 */
export async function POST(request: NextRequest) {
  if (!featureFlags.enableStudyModes) {
    return failure("Study modes are not enabled.", 404, "not_enabled");
  }

  const uid = await authenticate(request);
  if (!uid) return failure("Unauthorized", 401, "unauthorized");

  if (!isAnyAiProviderConfigured("worker")) {
    return failure(
      "Jami cannot prepare study modes just now.",
      503,
      "provider_unavailable"
    );
  }

  let deckId: string;
  let cardIds: string[];
  try {
    const body = (await request.json()) as Record<string, unknown>;
    deckId = typeof body.deckId === "string" ? body.deckId.trim().slice(0, 120) : "";
    cardIds = Array.isArray(body.cardIds)
      ? Array.from(
          new Set(
            body.cardIds
              .filter((id): id is string => typeof id === "string" && Boolean(id.trim()))
              .map((id) => id.trim().slice(0, 120))
          )
        ).slice(0, MAX_CARDS_PER_JOB)
      : [];
    if (!deckId || cardIds.length === 0) {
      return failure("deckId and cardIds are required", 400, "invalid_request");
    }
  } catch {
    return failure("Invalid request body", 400, "invalid_request");
  }

  const db = getAdminDb();

  // Ownership is established from the server's own read of the deck and the
  // cards, never from anything the client said about them.
  const deckSnapshot = await db.collection("decks").doc(deckId).get();
  const deckData = deckSnapshot.data() ?? {};
  const deckOwner =
    typeof deckData.userId === "string" ? deckData.userId.trim() : "";
  if (!deckSnapshot.exists || deckOwner !== uid) {
    return failure("Deck not found", 404, "deck_not_found");
  }

  const cardSnapshots = await db.getAll(
    ...cardIds.map((id) => db.collection("cards").doc(id))
  );
  const cards: OwnedCard[] = [];
  for (const snapshot of cardSnapshots) {
    const data = snapshot.data();
    if (!data || data.userId !== uid || data.deckId !== deckId) continue;
    const front = typeof data.front === "string" ? data.front : "";
    const back = typeof data.back === "string" ? data.back : "";
    if (!front.trim() || !back.trim()) continue;
    cards.push({
      id: snapshot.id,
      front,
      back,
      studySettings:
        data.studySettings && typeof data.studySettings === "object"
          ? (data.studySettings as Record<string, unknown>)
          : undefined,
    });
  }
  if (cards.length === 0) {
    return failure("No owned cards to prepare", 404, "no_cards");
  }

  // Deterministic analysis before spending anything: a card whose asset is
  // already cached under this exact content and prompt version costs nothing.
  const keyed = cards.map((card) => ({
    card,
    cacheKey: getStudyAssetCacheKey({
      front: card.front,
      back: card.back,
      studySettings: card.studySettings as never,
    }),
  }));
  const existing = await db.getAll(
    ...keyed.map((entry) => db.collection("cardStudyAssets").doc(entry.card.id))
  );
  const cached = new Set<string>();
  existing.forEach((snapshot, position) => {
    const data = snapshot.data();
    if (data && data.userId === uid && data.cacheKey === keyed[position].cacheKey) {
      cached.add(keyed[position].card.id);
    }
  });

  const pending = keyed.filter((entry) => !cached.has(entry.card.id));
  const jobId = randomUUID();
  const jobRef = db.collection("cardStudyAssetJobs").doc(jobId);

  if (pending.length === 0) {
    await jobRef.set({
      userId: uid,
      deckId,
      status: "completed",
      requested: cards.length,
      prepared: 0,
      reused: cached.size,
      failed: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return Response.json({
      jobId,
      status: "completed",
      requested: cards.length,
      prepared: 0,
      reused: cached.size,
      failed: 0,
    });
  }

  let budgetDecision;
  try {
    budgetDecision = await checkAiBudget({ uid, action: "studyAssetGeneration" });
    enterAiSpendContext(aiSpendContextFor(uid, "studyAssetGeneration"));
  } catch (error) {
    log.error("budget.check_failed", { error });
    return failure(
      "AI usage limits are temporarily unavailable.",
      503,
      "budget_unavailable"
    );
  }
  if (!budgetDecision.allowed) {
    return createAiBudgetLimitResponse("studyAssetGeneration", budgetDecision);
  }
  const grant = budgetDecision.grant;

  await jobRef.set({
    userId: uid,
    deckId,
    status: "running",
    requested: cards.length,
    prepared: 0,
    reused: cached.size,
    failed: 0,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const batches: (typeof pending)[] = [];
  for (let start = 0; start < pending.length; start += MAX_CARDS_PER_BATCH) {
    batches.push(pending.slice(start, start + MAX_CARDS_PER_BATCH));
  }

  const runBatch = async (
    batch: typeof pending,
    timeoutMs: number
  ): Promise<StudyAsset[]> => {
    const text = await generateAiText({
      role: "worker",
      routeReason: "explicit_role",
      // A batch that quietly escalates to the supervisor is a batch whose cost
      // nobody predicted. A worker that cannot do this should fail loudly.
      allowRoleEscalation: false,
      timeoutMs,
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: getAiTokenCap("studyAssetGeneration"),
        responseMimeType: "application/json",
      },
      request: {
        systemInstruction: STUDY_ASSET_SYSTEM_PROMPT,
        contents: [
          {
            role: "user" as const,
            parts: [
              { text: buildStudyAssetUserPrompt(batch.map((entry) => entry.card)) },
            ],
          },
        ],
      },
    });
    return parseStudyAssetResponse(text, batch.map((entry) => entry.card));
  };

  /*
   * A fixed pool of workers pulling from one queue, under a shared deadline.
   *
   * Firing every batch at once was fine at twenty cards a batch, when a hundred
   * cards was five calls. At six a batch it is seventeen, and seventeen
   * simultaneous requests is a way to be rate-limited rather than a way to be
   * fast. Eight in flight is the width that keeps the provider busy without
   * queueing behind itself.
   *
   * Each worker checks the clock before starting anything: a batch that cannot
   * finish is never begun, so the job ends near its deadline instead of one
   * batch timeout past it.
   */
  const deadlineAt = Date.now() + JOB_DEADLINE_MS;
  const msLeft = () => deadlineAt - Date.now();

  const assetsByCardId = new Map<string, StudyAsset>();
  let failedBatches = 0;
  let skippedBatches = 0;
  let cursor = 0;

  const worker = async () => {
    for (;;) {
      const position = cursor;
      cursor += 1;
      if (position >= batches.length) return;
      const batch = batches[position];

      if (msLeft() < MIN_USEFUL_MS) {
        skippedBatches += 1;
        continue;
      }

      try {
        const assets = await runBatch(batch, Math.min(BATCH_TIMEOUT_MS, msLeft()));
        for (const asset of assets) assetsByCardId.set(asset.cardId, asset);
      } catch (error) {
        log.warn("batch.failed", { size: batch.length, error });
        // One retry, and only if there is still time for it to land. Retrying
        // into the deadline just spends the student's wait twice.
        if (msLeft() < MIN_USEFUL_MS) {
          failedBatches += 1;
          continue;
        }
        try {
          const assets = await runBatch(batch, Math.min(BATCH_TIMEOUT_MS, msLeft()));
          for (const asset of assets) assetsByCardId.set(asset.cardId, asset);
        } catch (retryError) {
          log.warn("batch.retry_failed", { size: batch.length, error: retryError });
          failedBatches += 1;
        }
      }
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(MAX_CONCURRENT_BATCHES, batches.length) },
      worker
    )
  );

  if (assetsByCardId.size > 0) {
    const writer = db.batch();
    for (const entry of pending) {
      const asset = assetsByCardId.get(entry.card.id);
      if (!asset) continue;
      writer.set(db.collection("cardStudyAssets").doc(entry.card.id), {
        userId: uid,
        deckId,
        cardId: entry.card.id,
        cacheKey: entry.cacheKey,
        schemaVersion: STUDY_ASSET_SCHEMA_VERSION,
        promptVersion: STUDY_ASSET_PROMPT_VERSION,
        asset,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    await writer.commit();
  }

  const prepared = assetsByCardId.size;
  // Nothing was produced and no provider work landed, so the request is handed
  // back. A partial success is not refunded: work was done and kept.
  if (prepared === 0) {
    try {
      await refundAiBudget(grant);
    } catch (error) {
      log.warn("budget.refund_failed", { error });
    }
  }

  const summary = {
    status:
      failedBatches + skippedBatches === batches.length ? "failed" : "completed",
    requested: cards.length,
    prepared,
    reused: cached.size,
    failed: pending.length - prepared,
  };
  await jobRef.set(
    { ...summary, updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );

  return Response.json({ jobId, ...summary });
}
