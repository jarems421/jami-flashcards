import { randomUUID } from "node:crypto";
import { getCardContentHash } from "@/lib/study/study-modes";
import { STUDY_ASSET_VALIDATOR_VERSION } from "@/lib/study/study-asset-versions";
import { isStudyAssetRecordCurrent } from "@/lib/study/study-asset-cache";
import type { NextRequest } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/services/firebase/admin";
import { authenticateWriteRequest } from "@/services/auth/authenticate-request.server";
import {
  checkAiBudget,
  createAiBudgetLimitResponse,
  refundAiBudget,
} from "@/services/ai/budgets";
import { aiSpendContextFor } from "@/services/ai/spend.server";
import { enterAiSpendContext } from "@/lib/ai/spend-context";
import { isAnyAiProviderConfigured } from "@/lib/ai/provider-router";
import {
  getStudyAssetCacheKey,
  MAX_CARDS_PER_BATCH,
  MAX_CARDS_PER_JOB,
  MAX_CONCURRENT_BATCHES,
  STUDY_ASSET_PROMPT_VERSION,
  STUDY_ASSET_SCHEMA_VERSION,
  type StudyAsset,
} from "@/lib/ai/study-assets";
import { generateStudyAssetBatch } from "@/services/ai/study-asset-generation.server";
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
const BATCH_TIMEOUT_MS = 70_000;
const JOB_DEADLINE_MS = 110_000;
/** Below this there is no point starting another call, only finishing one. */
const MIN_USEFUL_MS = 2_500;

const log = createLogger({ route: "api.ai.study-assets" });

type OwnedCard = {
  id: string;
  front: string;
  back: string;
  studySettings?: Record<string, unknown>;
};

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
 * Each card is saved the moment its own call lands, not when the whole
 * request is done, so a page reading the cache while this runs sees cards
 * arrive one at a time.
 *
 * Nothing here runs because a card was created or edited. Preparation follows
 * the student into a session; it does not chase them around the app.
 */
export async function POST(request: NextRequest) {
  if (!featureFlags.enableStudyModes) {
    return failure("Study modes are not enabled.", 404, "not_enabled");
  }

  const uid = await authenticateWriteRequest(request);
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
  let wantsMultipleChoice = false;
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
    wantsMultipleChoice = body.purpose === "multiple-choice";
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
    // Preparation reads words and cannot see a picture, so a card carrying one
    // is never prepared, whatever a client asks for.
    if (data.frontImage || data.backImage || data.occlusion) continue;
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
  /** Cards being asked again for a question, because the first try had none. */
  const multipleChoiceRetries = new Set<string>();
  let cachedMcqVariants = 0;
  let cachedGapVariants = 0;
  existing.forEach((snapshot, position) => {
    const data = snapshot.data();
    const { card, cacheKey } = keyed[position];
    if (isStudyAssetRecordCurrent(data, { uid, card, cacheKey, wantsMultipleChoice })) {
      cached.add(card.id);
      cachedMcqVariants += Array.isArray(data?.asset?.mcqVariants) ? data.asset.mcqVariants.length : 0;
      cachedGapVariants += Array.isArray(data?.asset?.gapVariants) ? data.asset.gapVariants.length : 0;
    } else if (isStudyAssetRecordCurrent(data, { uid, card, cacheKey, wantsMultipleChoice: false })) {
      multipleChoiceRetries.add(card.id);
    }
  });

  let pending = keyed.filter((entry) => !cached.has(entry.card.id));
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
      validatedMcqVariants: cachedMcqVariants,
      validatedGapVariants: cachedGapVariants,
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
      validatedMcqVariants: cachedMcqVariants,
      validatedGapVariants: cachedGapVariants,
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

  // Claim repairs atomically: two tabs may both report/start preparation.
  // A failed attempt stays claimed until a new report or prompt version.
  const claims = await Promise.all(pending.map(async (entry) => {
    const ref = db.collection("cardStudyAssets").doc(entry.card.id);
    return db.runTransaction(async (transaction) => {
      const data = (await transaction.get(ref)).data();
      if (data?.repairRequested !== true) return true;
      if (data.repairAttemptedForPromptVersion === STUDY_ASSET_PROMPT_VERSION) return false;
      transaction.set(ref, { repairAttemptedForPromptVersion: STUDY_ASSET_PROMPT_VERSION }, { merge: true });
      return true;
    });
  }));
  pending = pending.filter((_, index) => claims[index]);

  const batches: (typeof pending)[] = [];
  for (let start = 0; start < pending.length; start += MAX_CARDS_PER_BATCH) {
    batches.push(pending.slice(start, start + MAX_CARDS_PER_BATCH));
  }

  /** Save what one batch produced, straight away, so it can be used straight away. */
  const saveBatch = async (
    batch: typeof pending,
    assets: StudyAsset[],
    declinedCardIds: readonly string[]
  ) => {
    const writer = db.batch();
    let writes = 0;
    for (const entry of batch) {
      const ref = db.collection("cardStudyAssets").doc(entry.card.id);
      const asset = assets.find((candidate) => candidate.cardId === entry.card.id);
      const base = {
        userId: uid,
        deckId,
        cardId: entry.card.id,
        cacheKey: entry.cacheKey,
        schemaVersion: STUDY_ASSET_SCHEMA_VERSION,
        promptVersion: STUDY_ASSET_PROMPT_VERSION,
        sourceFingerprint: getCardContentHash(entry.card),
        ...(multipleChoiceRetries.has(entry.card.id)
          ? { mcqRetryPromptVersion: STUDY_ASSET_PROMPT_VERSION }
          : {}),
      };
      if (asset) {
        writer.set(ref, {
          ...base,
          asset: {
            ...asset,
            mcqVariants: asset.mcqVariants?.map((variant) => ({ ...variant, id: `${jobId}:${variant.id}` })) ?? [],
            gapVariants: asset.gapVariants?.map((variant) => ({ ...variant, id: `${jobId}:${variant.id}` })) ?? [],
          },
          bundleRevision: jobId,
          validatorVersion: STUDY_ASSET_VALIDATOR_VERSION,
          generationFailed: false,
          failureKind: FieldValue.delete(),
          repairRequested: false,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        writes += 1;
      } else if (declinedCardIds.includes(entry.card.id) && !multipleChoiceRetries.has(entry.card.id)) {
        // The model's considered answer about this card: kept, so it is not paid for twice.
        writer.set(ref, {
          ...base,
          generationFailed: true,
          failureKind: "declined",
          generationAttemptedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        writes += 1;
      } else if (declinedCardIds.includes(entry.card.id)) {
        // A second try that was turned down keeps the first try's material,
        // and is marked so the second try is not paid for again.
        writer.set(ref, { mcqRetryPromptVersion: STUDY_ASSET_PROMPT_VERSION }, { merge: true });
        writes += 1;
      }
      // Anything else was a failure to answer, not an answer. Nothing is
      // written, so the card is simply asked again next time.
    }
    if (writes > 0) await writer.commit();
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

  let prepared = 0;
  let producedMcqVariants = 0;
  let producedGapVariants = 0;
  let failedBatches = 0;
  let skippedBatches = 0;
  let cursor = 0;

  const attempt = async (batch: typeof pending) => {
    const result = await generateStudyAssetBatch(
      batch.map((entry) => ({ id: entry.card.id, front: entry.card.front, back: entry.card.back })),
      { timeoutMs: Math.min(BATCH_TIMEOUT_MS, msLeft()) }
    );
    await saveBatch(batch, result.assets, result.declinedCardIds);
    prepared += result.assets.length;
    for (const asset of result.assets) {
      producedMcqVariants += asset.mcqVariants?.length ?? 0;
      producedGapVariants += asset.gapVariants?.length ?? 0;
    }
  };

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
        await attempt(batch);
      } catch (error) {
        log.warn("batch.failed", { size: batch.length, error });
        // One retry, and only if there is still time for it to land. Retrying
        // into the deadline just spends the student's wait twice.
        if (msLeft() < MIN_USEFUL_MS) {
          failedBatches += 1;
          continue;
        }
        try {
          await attempt(batch);
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
    validatedMcqVariants: cachedMcqVariants + producedMcqVariants,
    validatedGapVariants: cachedGapVariants + producedGapVariants,
  };
  await jobRef.set(
    { ...summary, updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );

  return Response.json({ jobId, ...summary });
}
