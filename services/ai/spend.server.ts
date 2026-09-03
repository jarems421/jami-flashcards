import "server-only";

import { FieldValue } from "firebase-admin/firestore";
import type { AiSpendContext } from "@/lib/ai/spend-context";
import {
  estimateCallCostUsd,
  getSpendDayKey,
  readModelPrices,
  type AiSpendSample,
} from "@/lib/ai/spend";
import { createLogger } from "@/lib/observability/logger";
import { getAdminDb } from "@/services/firebase/admin";

const log = createLogger({ route: "ai.spend" });

/**
 * Records what one AI call consumed, against the student who caused it.
 *
 * Deliberately fire-and-forget and deliberately silent on failure: a metering
 * write must never be the reason a student's request fails. A lost row costs a
 * slightly low total; a thrown error costs the answer they were waiting for.
 *
 * Increments rather than reads-then-writes, so concurrent calls from the same
 * student on the same day cannot lose each other.
 */
export async function recordAiSpend(input: {
  uid: string;
  action: string;
  sample: AiSpendSample;
  now?: number;
}) {
  const uid = input.uid.trim();
  if (!uid) return;

  try {
    const prices = readModelPrices(process.env);
    const cost = estimateCallCostUsd(input.sample, prices);
    const dayKey = getSpendDayKey(input.now);
    const promptTokens = Math.max(0, input.sample.promptTokens ?? 0);
    const completionTokens = Math.max(0, input.sample.completionTokens ?? 0);

    // Model names carry dots and slashes, which Firestore reads as a field
    // path, so they are flattened before being used as a map key.
    const modelKey = `${input.sample.provider}:${input.sample.model}`.replace(/[.$/[\]#]/g, "_");

    await getAdminDb()
      .collection("aiSpend")
      .doc(`${uid}:${dayKey}`)
      .set(
        {
          uid,
          dayKey,
          updatedAt: Date.now(),
          calls: FieldValue.increment(1),
          promptTokens: FieldValue.increment(promptTokens),
          completionTokens: FieldValue.increment(completionTokens),
          costUsd: FieldValue.increment(cost ?? 0),
          unpricedCalls: FieldValue.increment(cost === null ? 1 : 0),
          byAction: { [input.action]: FieldValue.increment(1) },
          byModel: {
            [modelKey]: {
              calls: FieldValue.increment(1),
              promptTokens: FieldValue.increment(promptTokens),
              completionTokens: FieldValue.increment(completionTokens),
              costUsd: FieldValue.increment(cost ?? 0),
            },
          },
        },
        { merge: true }
      );
  } catch (error) {
    log.warn("record.failed", {
      action: input.action,
      provider: input.sample.provider,
      errorMessage: error instanceof Error ? error.message : "unknown",
    });
  }
}

/**
 * A spend context with its recorder already attached.
 *
 * The domain layer holds the context and calls `record`; only this module knows
 * that recording means a Firestore increment. Call sites say who and what, and
 * nothing else has to know either.
 */
export function aiSpendContextFor(uid: string, action: string): AiSpendContext {
  return {
    uid,
    action,
    record: (sample) => void recordAiSpend({ uid, action, sample }),
  };
}
