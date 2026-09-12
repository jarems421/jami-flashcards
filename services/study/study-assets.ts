import {
  collection,
  documentId,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { auth, db } from "@/services/firebase/client";
import { withTimeout } from "@/services/firebase/firestore";
import type { StudyAsset } from "@/lib/ai/study-assets";
import type { CardStudySettings } from "@/lib/study/study-modes";
import { hasCurrentStudySource } from "@/lib/study/asset-freshness";
import type { Card } from "@/lib/study/cards";
import { STUDY_ASSET_PROMPT_VERSION, STUDY_ASSET_SCHEMA_VERSION, STUDY_ASSET_VALIDATOR_VERSION } from "@/lib/study/study-asset-versions";

const LOAD_MS = 20_000;
/** Firestore's `in` filter takes at most thirty values per query. */
const ID_QUERY_CHUNK = 30;

export type StudyAssetPreparation = {
  jobId: string;
  status: "completed" | "failed" | "running";
  requested: number;
  prepared: number;
  reused: number;
  failed: number;
  validatedMcqVariants?: number;
  validatedGapVariants?: number;
};

async function authHeaders() {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${await user.getIdToken()}`,
  };
}

/**
 * Ask the server to prepare study material for a deck.
 *
 * Only ever called from an explicit Prepare action. Nothing about editing or
 * creating a card reaches this.
 */
export async function prepareStudyAssets(input: {
  deckId: string;
  cardIds: string[];
}): Promise<StudyAssetPreparation> {
  const response = await fetch("/api/ai/study-assets/jobs", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });

  const data = (await response.json().catch(() => null)) as
    | (StudyAssetPreparation & { error?: string })
    | null;
  if (!response.ok || !data) {
    throw new Error(data?.error ?? "Jami could not prepare these cards.");
  }
  return data;
}

export async function getStudyAssetJob(jobId: string) {
  const response = await fetch(`/api/ai/study-assets/jobs/${jobId}`, {
    headers: await authHeaders(),
  });
  if (!response.ok) return null;
  return (await response.json()) as StudyAssetPreparation;
}

/**
 * Read the prepared assets for a set of cards.
 *
 * Failure is not an error worth surfacing: without assets the modes fall back
 * to what can be built deterministically, which is most of them.
 */
export async function loadStudyAssets(
  cards: Card[]
): Promise<Record<string, StudyAsset>> {
  const byId = new Map(cards.map((card) => [card.id, card]));
  const unique = [...byId.keys()];
  if (unique.length === 0) return {};

  const assets: Record<string, StudyAsset> = {};
  for (let start = 0; start < unique.length; start += ID_QUERY_CHUNK) {
    const chunk = unique.slice(start, start + ID_QUERY_CHUNK);
    try {
      const snapshot = await withTimeout(
        getDocs(
          query(
            collection(db, "cardStudyAssets"),
            where(documentId(), "in", chunk)
          )
        ),
        LOAD_MS,
        "Load study assets"
      );
      snapshot.forEach((entry) => {
        const data = entry.data();
        const card = byId.get(entry.id);
        if (card && data?.asset && hasCurrentStudySource(data, card) && !data.generationFailed && data.schemaVersion === STUDY_ASSET_SCHEMA_VERSION && data.promptVersion === STUDY_ASSET_PROMPT_VERSION && data.validatorVersion === STUDY_ASSET_VALIDATOR_VERSION && typeof data.bundleRevision === "string") {
          assets[entry.id] = { ...data.asset, retiredVariantIds: [...new Set([...(data.asset.retiredVariantIds ?? []), ...(data.retiredVariantIds ?? [])])], cacheKey: data.cacheKey, sourceFingerprint: data.sourceFingerprint, bundleRevision: data.bundleRevision, validatorVersion: data.validatorVersion, repairRequested: data.repairRequested === true && data.repairAttemptedForPromptVersion !== STUDY_ASSET_PROMPT_VERSION } as StudyAsset;
        }
      });
    } catch (error) {
      console.warn("Failed to load prepared study assets.", error);
    }
  }
  return assets;
}

/**
 * Ask a marker to judge prose that local marking could not decide.
 *
 * Returns null on every kind of failure, which the caller reads as
 * "needs-self-grade". The student's response is sent and not kept: nothing
 * here writes, logs or caches it.
 */
export async function checkTypedAnswer(input: {
  cardId: string;
  response: string;
  sourceHash: string;
  presentationId: string;
  assetKey?: string;
  bundleRevision?: string;
  gapResponses?: Record<string, string>;
  variantId?: string;
}) {
  try {
    const headers = await authHeaders();
    const response = await fetch("/api/ai/study-answer/check", {
      method: "POST",
      headers: { ...headers, "x-idempotency-key": input.presentationId },
      body: JSON.stringify(input),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      verdict: "correct" | "partial" | "incorrect" | "needs-self-grade";
      feedback?: string;
      missingConcepts?: string[];
      gapResults?: import("@/lib/study/answer-marking").MarkedAnswer["gapResults"];
    };
    return data.verdict === "needs-self-grade" ? null : data;
  } catch (error) {
    console.warn("Semantic answer check was unavailable.", error);
    return null;
  }
}

/** Fold a prepared asset into the settings the deterministic markers read. */
export function retireStudyAsset(assets: Record<string, StudyAsset>, cardId: string, variantId: string) {
  const asset = assets[cardId];
  return asset ? { ...assets, [cardId]: { ...asset, retiredVariantIds: [...new Set([...(asset.retiredVariantIds ?? []), variantId])], repairRequested: true } } : assets;
}

export function cardWithStudyAsset(card: Card, assets: Record<string, StudyAsset>): Card {
  const asset = assets[card.id];
  const settings = mergeAssetIntoSettings(hasCurrentStudySource(asset, card) ? asset : undefined, card.studySettings);
  return settings === card.studySettings ? card : { ...card, studySettings: settings };
}

export function mergeAssetIntoSettings(
  asset: StudyAsset | undefined,
  settings: CardStudySettings | undefined
): CardStudySettings | undefined {
  if (!asset) return settings;
  const toGaps = (variant: NonNullable<StudyAsset["gapVariants"]>[number]) => {
    return variant.gaps.flatMap((gap, index) => {
      return [{ id: `${variant.id}-${index + 1}`, start: gap.start, end: gap.end, answer: gap.answer, acceptedAnswers: gap.acceptedAnswers, concept: gap.concept }];
    });
  };
  const generatedGaps = (asset.gapVariants ?? []).map((variant) => ({ id: variant.id, gaps: toGaps(variant) })).filter((variant) => variant.gaps.length > 0);
  const generatedMcqs = asset.mcqVariants ?? [];
  return {
    ...settings,
    acceptedAnswers:
      settings?.acceptedAnswers !== undefined
        ? settings.acceptedAnswers
        : asset.acceptedAliases,
    requiredConcepts:
      settings?.requiredConcepts !== undefined
        ? settings.requiredConcepts
        : asset.requiredConcepts,
    // Only authors own these overrides. Legacy generated fields are never
    // promoted into author settings or used to bypass variant validation.
    mcqExplanations: {
      ...asset.misconceptions,
      ...settings?.mcqExplanations,
    },
    generatedStudy: {
      bundleVersion: STUDY_ASSET_SCHEMA_VERSION,
      sourceHash: asset.cacheKey ?? "legacy",
      ...(asset.bundleRevision ? { bundleRevision: asset.bundleRevision } : {}),
      ...(asset.validatorVersion ? { validatorVersion: asset.validatorVersion } : {}),
      ...(asset.task ? { taskProfile: {
        task: asset.task,
        preferredModes: asset.preferredModes?.length ? asset.preferredModes : ["classic"],
        suitableModes: asset.suitableModes?.length ? asset.suitableModes : ["classic"],
        reasons: ["prepared-classification"],
        source: "prepared" as const,
      } } : {}),
      gapVariants: generatedGaps,
      mcqVariants: generatedMcqs,
      retiredVariantIds: Array.from(new Set([...(asset.retiredVariantIds ?? []), ...(settings?.generatedStudy?.retiredVariantIds ?? [])])),
    },
  };
}

export async function reportStudyVariant(input: {
  cardId: string;
  variantId: string;
  bundleVersion: number;
  reason: "multiple-correct" | "wrong-grade" | "poor-gap" | "unrelated-options" | "other";
}) {
  const response = await fetch("/api/ai/study-assets/report", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error("Jami could not save that report.");
}
